"""Train an educational facial skin-concern classifier from folder labels."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np
import tensorflow as tf
from PIL import Image, ImageOps
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split


PROJECT_DIR = Path(__file__).resolve().parent
SOURCE_DATASET_DIR = PROJECT_DIR / "dataset" / "facial_skin_concerns" / "images"
DATASET_DIR = PROJECT_DIR / "dataset" / "facial_skin_concerns" / "rgb_images_v2"
OOD_CALIBRATION_DIR = PROJECT_DIR / "dataset" / "facial_skin_concerns" / "unknown_calibration"
OOD_TEST_DIR = PROJECT_DIR / "dataset" / "facial_skin_concerns" / "unknown_test"
OOD_CALIBRATION_PREPARED_DIR = PROJECT_DIR / "dataset" / "facial_skin_concerns" / "rgb_unknown_calibration"
OOD_TEST_PREPARED_DIR = PROJECT_DIR / "dataset" / "facial_skin_concerns" / "rgb_unknown_test"
BASE_MODEL_PATH = PROJECT_DIR / "skin_disease_model.keras"
OUTPUT_MODEL_PATH = PROJECT_DIR / "skin_cosmetic_model.keras"
REPORT_PATH = PROJECT_DIR / "skin_cosmetic_training_report.json"
LABELS_PATH = PROJECT_DIR / "skin_cosmetic_labels.json"
THRESHOLD_PATH = PROJECT_DIR / "skin_cosmetic_threshold.json"
IMAGE_SIZE = 128
SEED = 42
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument(
        "--max-ood-accept-rate",
        type=float,
        default=0.05,
        help="Maximum allowed fraction of OOD calibration images accepted as known.",
    )
    args = parser.parse_args()
    if args.epochs < 1 or args.batch_size < 1:
        parser.error("--epochs and --batch-size must be positive.")
    if not 0.0 <= args.max_ood_accept_rate < 1.0:
        parser.error("--max-ood-accept-rate must be in [0, 1).")
    return args


def collect_images() -> tuple[
    list[str], list[int], list[str], dict[str, int], dict[str, int], dict[str, int]
]:
    if not SOURCE_DATASET_DIR.is_dir():
        raise FileNotFoundError(f"Dataset image folder not found: {SOURCE_DATASET_DIR}")
    if DATASET_DIR.exists():
        # This is only a generated normalized-image cache; source images stay intact.
        shutil.rmtree(DATASET_DIR)
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    for source_class_dir in sorted(
        path for path in SOURCE_DATASET_DIR.iterdir()
        if path.is_dir() and not path.name.startswith("_")
    ):
        output_class_dir = DATASET_DIR / source_class_dir.name
        output_class_dir.mkdir(parents=True, exist_ok=True)
        for source in sorted(source_class_dir.rglob("*")):
            if not source.is_file() or source.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            output = output_class_dir / f"{source.stem}__{source.suffix.lower().lstrip('.')}.jpg"
            if output.exists():
                continue
            with Image.open(source) as image:
                image = ImageOps.exif_transpose(image).convert("RGB")
                image.save(output, format="JPEG", quality=94, optimize=True)
    print(f"Prepared RGB JPEG images: {DATASET_DIR}")
    class_dirs = sorted(path for path in DATASET_DIR.iterdir() if path.is_dir())
    if len(class_dirs) < 2:
        raise ValueError(f"Expected class folders in {DATASET_DIR}")
    class_names = [path.name for path in class_dirs]
    if "melasma" in class_names and "pigmentation" in class_names:
        raise ValueError(
            "Do not train 'melasma' beside the old broad 'pigmentation' class. "
            "Review the old images: put confirmed melasma in 'melasma', confirmed "
            "non-melasma pigmentation in 'other pigmentation', and move uncertain "
            "images to a folder starting with '_' so they are excluded."
        )
    class_to_index = {name: index for index, name in enumerate(class_names)}

    by_hash: dict[str, list[tuple[str, str]]] = defaultdict(list)
    raw_counts: dict[str, int] = {}
    for class_dir in class_dirs:
        files = sorted(
            path for path in class_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        )
        raw_counts[class_dir.name] = len(files)
        for path in files:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            by_hash[digest].append((str(path), class_dir.name))

    retained: list[tuple[str, str]] = []
    dropped_duplicates = 0
    dropped_conflicts = 0
    for same_image in by_hash.values():
        labels = {label for _, label in same_image}
        if len(labels) > 1:
            # Conflicting duplicate labels are ambiguous; discard the whole group.
            dropped_conflicts += len(same_image)
            continue
        retained.append(same_image[0])
        dropped_duplicates += len(same_image) - 1

    image_paths = [path for path, _ in retained]
    labels = [class_to_index[label] for _, label in retained]
    counts = {
        name: sum(label == class_to_index[name] for label in labels)
        for name in class_names
    }
    print(
        f"Images: {sum(raw_counts.values())}; retained unique: {len(image_paths)}; "
        f"same-class duplicates removed: {dropped_duplicates}; "
        f"cross-class duplicate images removed: {dropped_conflicts}"
    )
    dedup_counts = {
        "same_class_duplicate_images_removed": dropped_duplicates,
        "cross_class_duplicate_images_removed": dropped_conflicts,
    }
    return image_paths, labels, class_names, raw_counts, counts, dedup_counts


def prepare_unlabeled_images(source_dir: Path, prepared_dir: Path) -> list[str]:
    """Normalize a separate OOD set; these images never enter classifier training."""
    if not source_dir.is_dir():
        raise FileNotFoundError(
            f"Create {source_dir} and add representative out-of-scope images for OOD calibration/testing."
        )
    if prepared_dir.exists():
        shutil.rmtree(prepared_dir)
    prepared_dir.mkdir(parents=True, exist_ok=True)
    output_paths: list[str] = []
    for index, source in enumerate(sorted(source_dir.rglob("*"))):
        if not source.is_file() or source.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        output = prepared_dir / f"ood_{index:06d}.jpg"
        try:
            with Image.open(source) as image:
                image = ImageOps.exif_transpose(image).convert("RGB")
                image.save(output, format="JPEG", quality=94, optimize=True)
        except Exception as exc:
            print(f"Skipping unreadable OOD image {source}: {exc}")
            continue
        output_paths.append(str(output))
    if not output_paths:
        raise ValueError(f"No readable images found under {source_dir}.")
    return output_paths


def assert_no_image_overlap(known_paths: list[str], *other_path_groups: list[str]) -> None:
    """Reject exact image reuse across known and OOD partitions."""
    seen: dict[str, str] = {}
    groups = [("known", known_paths)] + [
        (f"OOD group {index}", paths)
        for index, paths in enumerate(other_path_groups, start=1)
    ]
    for group_name, paths in groups:
        for path in paths:
            digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
            previous = seen.get(digest)
            if previous is not None:
                raise ValueError(
                    f"Exact image overlap between {previous} and {group_name}: {path}"
                )
            seen[digest] = group_name


def calibrate_unknown_threshold(
    known_probabilities: np.ndarray,
    ood_probabilities: np.ndarray,
    max_ood_accept_rate: float,
) -> tuple[float, dict[str, float]]:
    """Choose the lowest confidence cutoff meeting the OOD false-accept target."""
    known_scores = np.max(known_probabilities, axis=1)
    ood_scores = np.max(ood_probabilities, axis=1)
    candidates = np.unique(
        np.concatenate(
            [
                known_scores,
                ood_scores,
                np.nextafter(np.concatenate([known_scores, ood_scores]), np.inf),
                np.array([0.0, 1.000001]),
            ]
        )
    )
    eligible: list[tuple[float, float, float]] = []
    for threshold in candidates:
        known_coverage = float(np.mean(known_scores >= threshold))
        ood_accept_rate = float(np.mean(ood_scores >= threshold))
        if ood_accept_rate <= max_ood_accept_rate:
            eligible.append((known_coverage, -float(threshold), float(threshold)))
    # Prefer the greatest known coverage; break ties with the more conservative cutoff.
    _, _, threshold = max(eligible)
    details = {
        "calibration_known_coverage": float(np.mean(known_scores >= threshold)),
        "calibration_ood_accept_rate": float(np.mean(ood_scores >= threshold)),
        "calibration_ood_rejection_rate": float(np.mean(ood_scores < threshold)),
    }
    return threshold, details


def make_dataset(paths: list[str], labels: list[int], batch_size: int, training: bool) -> tf.data.Dataset:
    dataset = tf.data.Dataset.from_tensor_slices(
        (np.asarray(paths), np.asarray(labels, dtype=np.int32))
    )

    def load_image(path: tf.Tensor, label: tf.Tensor) -> tuple[tf.Tensor, tf.Tensor]:
        contents = tf.io.read_file(path)
        image = tf.io.decode_jpeg(contents, channels=3)
        image = tf.image.resize(image, [IMAGE_SIZE, IMAGE_SIZE])
        return tf.cast(image, tf.float32) / 255.0, label

    if training:
        dataset = dataset.shuffle(len(paths), seed=SEED, reshuffle_each_iteration=True)
    return (
        dataset.map(load_image, num_parallel_calls=tf.data.AUTOTUNE)
        .batch(batch_size)
        .prefetch(tf.data.AUTOTUNE)
    )


def build_model(class_names: list[str]) -> tf.keras.Model:
    if not BASE_MODEL_PATH.is_file():
        raise FileNotFoundError(
            f"Transfer-learning backbone source not found: {BASE_MODEL_PATH}"
        )
    source = tf.keras.models.load_model(BASE_MODEL_PATH, compile=False)
    backbone = source.get_layer("mobilenetv2_1.00_128")
    backbone.trainable = False

    inputs = tf.keras.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3), name="image")
    x = tf.keras.layers.RandomFlip("horizontal", seed=SEED)(inputs)
    x = tf.keras.layers.RandomRotation(0.06, seed=SEED)(x)
    x = tf.keras.layers.RandomZoom(0.08, seed=SEED)(x)
    x = tf.keras.layers.Rescaling(scale=2.0, offset=-1.0, name="mobilenet_scaling")(x)
    x = backbone(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D(name="feature_pool")(x)
    x = tf.keras.layers.Dropout(0.35, seed=SEED)(x)
    outputs = tf.keras.layers.Dense(
        len(class_names), activation="softmax", name="skin_concern_class"
    )(x)
    model = tf.keras.Model(inputs, outputs, name="skinwise_cosmetic_classifier")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def main() -> None:
    args = parse_args()
    tf.keras.utils.set_random_seed(SEED)
    paths, labels, class_names, raw_counts, unique_counts, dedup_counts = collect_images()
    if min(unique_counts.values()) < 3:
        raise ValueError(
            "Every class needs at least 3 unique images to create train, validation, and test splits."
        )

    ood_calibration_paths = prepare_unlabeled_images(
        OOD_CALIBRATION_DIR, OOD_CALIBRATION_PREPARED_DIR
    )
    ood_test_paths = prepare_unlabeled_images(OOD_TEST_DIR, OOD_TEST_PREPARED_DIR)
    assert_no_image_overlap(paths, ood_calibration_paths, ood_test_paths)

    train_paths, held_paths, train_labels, held_labels = train_test_split(
        paths, labels, test_size=0.2, random_state=SEED, stratify=labels
    )
    validation_paths, test_paths, validation_labels, test_labels = train_test_split(
        held_paths, held_labels, test_size=0.5, random_state=SEED, stratify=held_labels
    )
    splits = {
        "train": (train_paths, train_labels),
        "validation": (validation_paths, validation_labels),
        "test": (test_paths, test_labels),
    }
    for name, (split_paths, _) in splits.items():
        print(f"{name.capitalize()} images: {len(split_paths)}")

    train_data = make_dataset(*splits["train"], args.batch_size, training=True)
    validation_data = make_dataset(*splits["validation"], args.batch_size, training=False)
    test_data = make_dataset(*splits["test"], args.batch_size, training=False)
    ood_calibration_data = make_dataset(
        ood_calibration_paths,
        [0] * len(ood_calibration_paths),
        args.batch_size,
        training=False,
    )
    ood_test_data = make_dataset(
        ood_test_paths,
        [0] * len(ood_test_paths),
        args.batch_size,
        training=False,
    )
    model = build_model(class_names)
    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=4, restore_best_weights=True, verbose=1
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=2, min_lr=1e-6, verbose=1
        ),
    ]
    history = model.fit(
        train_data,
        validation_data=validation_data,
        epochs=args.epochs,
        callbacks=callbacks,
        shuffle=False,
        verbose=1,
    )

    test_loss, test_accuracy = model.evaluate(test_data, verbose=0)
    validation_probabilities = model.predict(validation_data, verbose=0)
    ood_calibration_probabilities = model.predict(ood_calibration_data, verbose=0)
    unknown_threshold, calibration_metrics = calibrate_unknown_threshold(
        validation_probabilities,
        ood_calibration_probabilities,
        args.max_ood_accept_rate,
    )
    probabilities = model.predict(test_data, verbose=0)
    ood_test_probabilities = model.predict(ood_test_data, verbose=0)
    true_labels = np.concatenate([batch_labels.numpy() for _, batch_labels in test_data])
    predicted_labels = np.argmax(probabilities, axis=1)
    report = classification_report(
        true_labels,
        predicted_labels,
        labels=list(range(len(class_names))),
        target_names=class_names,
        output_dict=True,
        zero_division=0,
    )
    confusion = confusion_matrix(
        true_labels, predicted_labels, labels=list(range(len(class_names)))
    ).tolist()
    known_test_scores = np.max(probabilities, axis=1)
    ood_test_scores = np.max(ood_test_probabilities, axis=1)
    accepted_known = known_test_scores >= unknown_threshold
    ood_rejected = ood_test_scores < unknown_threshold
    accepted_known_count = int(np.sum(accepted_known))
    selective_accuracy = (
        float(np.mean(predicted_labels[accepted_known] == true_labels[accepted_known]))
        if accepted_known_count
        else None
    )

    model.save(OUTPUT_MODEL_PATH)
    LABELS_PATH.write_text(json.dumps(class_names, indent=2), encoding="utf-8")
    THRESHOLD_PATH.write_text(
        json.dumps(
            {
                "model": OUTPUT_MODEL_PATH.name,
                "method": "maximum_softmax_probability",
                "threshold": float(unknown_threshold),
                "known_if_confidence_at_least": float(unknown_threshold),
                "max_ood_accept_rate_target": args.max_ood_accept_rate,
                "calibration_metrics": calibration_metrics,
                "calibration_image_counts": {
                    "known_validation": len(splits["validation"][0]),
                    "out_of_distribution": len(ood_calibration_paths),
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    summary = {
        "dataset": "Folder-labeled facial skin-concern collection",
        "original_dataset_url": "https://www.kaggle.com/datasets/shijo96john/facial-skin-acne-pigmentation-pores-wrinkles",
        "source_note": "Record the source, license, and label provenance of every added dataset before training.",
        "model": str(OUTPUT_MODEL_PATH.name),
        "architecture": f"MobileNetV2 ImageNet feature backbone from the existing HAM10000 model; frozen backbone with a newly trained {len(class_names)}-class head",
        "seed": SEED,
        "image_size": IMAGE_SIZE,
        "class_names": class_names,
        "raw_image_counts": raw_counts,
        "unique_image_counts": unique_counts,
        "deduplication": dedup_counts,
        "images_after_deduplication": len(paths),
        "split_counts": {name: len(items[0]) for name, items in splits.items()},
        "epochs_requested": args.epochs,
        "epochs_completed": len(history.history["loss"]),
        "test_loss": float(test_loss),
        "test_accuracy": float(test_accuracy),
        "unknown_handling": {
            "method": "maximum_softmax_probability threshold calibrated on known validation and separate OOD calibration images",
            "threshold": float(unknown_threshold),
            "calibration_metrics": calibration_metrics,
            "calibration_image_counts": {
                "known_validation": len(splits["validation"][0]),
                "out_of_distribution": len(ood_calibration_paths),
            },
            "ood_test_image_count": len(ood_test_paths),
            "known_test_coverage": float(np.mean(accepted_known)),
            "known_test_selective_accuracy": selective_accuracy,
            "ood_test_rejection_rate": float(np.mean(ood_rejected)),
        },
        "test_classification_report": report,
        "test_confusion_matrix": confusion,
        "limitations": [
            "Folder labels are broad dataset labels, not clinician-confirmed diagnoses.",
            "A broad pigmentation folder must not be split into melasma and non-melasma without reliable per-image relabeling.",
            "Maximum-softmax unknown rejection is a heuristic and cannot guarantee detection of every out-of-distribution image.",
            "The unknown threshold is calibrated only for the supplied OOD calibration examples and imaging conditions.",
            "The model is for educational exploration, not diagnosis or treatment decisions.",
        ],
    }
    REPORT_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Saved model: {OUTPUT_MODEL_PATH}")
    print(f"Saved labels: {LABELS_PATH}")
    print(f"Saved unknown threshold: {THRESHOLD_PATH}")
    print(f"Saved report: {REPORT_PATH}")
    print(f"Test accuracy: {test_accuracy:.4f}; test loss: {test_loss:.4f}")
    print(
        "Unknown gate: threshold={:.4f}, known test coverage={:.1%}, "
        "OOD test rejection={:.1%}".format(
            unknown_threshold,
            float(np.mean(accepted_known)),
            float(np.mean(ood_rejected)),
        )
    )


if __name__ == "__main__":
    main()
