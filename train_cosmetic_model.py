"""Train an educational facial skin-concern classifier from folder labels."""

from __future__ import annotations

import argparse
import hashlib
import json
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
BASE_MODEL_PATH = PROJECT_DIR / "skin_disease_model.keras"
OUTPUT_MODEL_PATH = PROJECT_DIR / "skin_cosmetic_model.keras"
REPORT_PATH = PROJECT_DIR / "skin_cosmetic_training_report.json"
LABELS_PATH = PROJECT_DIR / "skin_cosmetic_labels.json"
IMAGE_SIZE = 128
SEED = 42
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    if args.epochs < 1 or args.batch_size < 1:
        parser.error("--epochs and --batch-size must be positive.")
    return args


def collect_images() -> tuple[
    list[str], list[int], list[str], dict[str, int], dict[str, int], dict[str, int]
]:
    if not SOURCE_DATASET_DIR.is_dir():
        raise FileNotFoundError(f"Dataset image folder not found: {SOURCE_DATASET_DIR}")
    for source_class_dir in sorted(
        path for path in SOURCE_DATASET_DIR.iterdir() if path.is_dir()
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
    probabilities = model.predict(test_data, verbose=0)
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

    model.save(OUTPUT_MODEL_PATH)
    LABELS_PATH.write_text(json.dumps(class_names, indent=2), encoding="utf-8")
    summary = {
        "dataset": "Kaggle Facial Skin (Acne, Pigmentation, Pores, Wrinkles)",
        "dataset_url": "https://www.kaggle.com/datasets/shijo96john/facial-skin-acne-pigmentation-pores-wrinkles",
        "dataset_license": "Apache-2.0 (publisher metadata)",
        "model": str(OUTPUT_MODEL_PATH.name),
        "architecture": "MobileNetV2 ImageNet feature backbone from the existing HAM10000 model; frozen backbone with a newly trained eight-class head",
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
        "test_classification_report": report,
        "test_confusion_matrix": confusion,
        "limitations": [
            "Folder labels are broad dataset labels, not clinician-confirmed diagnoses.",
            "The pigmentation class is not a melasma-specific label.",
            "The model is for educational exploration, not diagnosis or treatment decisions.",
        ],
    }
    REPORT_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Saved model: {OUTPUT_MODEL_PATH}")
    print(f"Saved labels: {LABELS_PATH}")
    print(f"Saved report: {REPORT_PATH}")
    print(f"Test accuracy: {test_accuracy:.4f}; test loss: {test_loss:.4f}")


if __name__ == "__main__":
    main()
