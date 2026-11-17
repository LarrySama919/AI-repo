"""Train an educational hair and scalp image classifier from the prepared splits."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET_DIR = PROJECT_DIR / "dataset" / "Hair Diseases"
BASE_MODEL_PATH = PROJECT_DIR / "skin_disease_model.keras"
DEFAULT_MODEL_PATH = PROJECT_DIR / "skin_hair_disease_model.keras"
DEFAULT_REPORT_PATH = PROJECT_DIR / "skin_hair_training_report.json"
DEFAULT_LABELS_PATH = PROJECT_DIR / "skin_hair_labels.json"
IMAGE_SIZE = 128
SEED = 42
SPLITS = ("train", "val", "test")
IMAGE_EXTENSIONS = {".bmp", ".gif", ".jpeg", ".jpg", ".png"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--report-path", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument("--labels-path", type=Path, default=DEFAULT_LABELS_PATH)
    args = parser.parse_args()
    if args.epochs < 1 or args.batch_size < 1:
        parser.error("--epochs and --batch-size must be positive.")
    return args


def load_split(
    split_dir: Path, class_names: list[str], batch_size: int, training: bool
) -> tuple[tf.data.Dataset, dict[str, int]]:
    if not split_dir.is_dir():
        raise FileNotFoundError(f"Dataset split not found: {split_dir}")

    actual_classes = sorted(path.name for path in split_dir.iterdir() if path.is_dir())
    if actual_classes != class_names:
        raise ValueError(
            f"Class folders in {split_dir} do not match the training split."
        )
    counts: dict[str, int] = {}
    for class_name in class_names:
        class_dir = split_dir / class_name
        counts[class_name] = sum(
            path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
            for path in class_dir.rglob("*")
        )
        if counts[class_name] == 0:
            raise ValueError(f"No images found in class folder: {class_dir}")

    dataset = tf.keras.utils.image_dataset_from_directory(
        split_dir,
        labels="inferred",
        label_mode="int",
        class_names=class_names,
        image_size=(IMAGE_SIZE, IMAGE_SIZE),
        batch_size=batch_size,
        shuffle=training,
        seed=SEED if training else None,
    )
    dataset = dataset.map(
        lambda images, labels: (tf.cast(images, tf.float32) / 255.0, labels),
        num_parallel_calls=tf.data.AUTOTUNE,
    )
    return dataset.prefetch(tf.data.AUTOTUNE), counts


def build_model(class_names: list[str]) -> tf.keras.Model:
    if not BASE_MODEL_PATH.is_file():
        raise FileNotFoundError(f"Transfer-learning source not found: {BASE_MODEL_PATH}")

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
        len(class_names), activation="softmax", name="hair_disease_class"
    )(x)
    model = tf.keras.Model(inputs, outputs, name="skinwise_hair_disease_classifier")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def main() -> None:
    args = parse_args()
    tf.keras.utils.set_random_seed(SEED)

    train_dir = args.dataset_dir / "train"
    if not train_dir.is_dir():
        raise FileNotFoundError(f"Training split not found: {train_dir}")
    class_names = sorted(path.name for path in train_dir.iterdir() if path.is_dir())
    if len(class_names) < 2:
        raise ValueError(f"Expected at least two class folders in {train_dir}")

    datasets: dict[str, tf.data.Dataset] = {}
    split_counts: dict[str, dict[str, int]] = {}
    for split in SPLITS:
        datasets[split], split_counts[split] = load_split(
            args.dataset_dir / split,
            class_names,
            args.batch_size,
            training=(split == "train"),
        )
        print(
            f"{split.capitalize()} images: "
            f"{sum(split_counts[split].values()):,}"
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
        datasets["train"],
        validation_data=datasets["val"],
        epochs=args.epochs,
        callbacks=callbacks,
        verbose=1,
    )

    test_loss, test_accuracy = model.evaluate(datasets["test"], verbose=0)
    probabilities = model.predict(datasets["test"], verbose=0)
    true_labels = np.concatenate(
        [labels.numpy() for _, labels in datasets["test"]], axis=0
    )
    predicted_labels = np.argmax(probabilities, axis=1)
    label_indices = list(range(len(class_names)))
    report = classification_report(
        true_labels,
        predicted_labels,
        labels=label_indices,
        target_names=class_names,
        output_dict=True,
        zero_division=0,
    )
    confusion = confusion_matrix(
        true_labels, predicted_labels, labels=label_indices
    ).tolist()

    args.model_path.parent.mkdir(parents=True, exist_ok=True)
    args.report_path.parent.mkdir(parents=True, exist_ok=True)
    args.labels_path.parent.mkdir(parents=True, exist_ok=True)
    model.save(args.model_path)
    args.labels_path.write_text(json.dumps(class_names, indent=2), encoding="utf-8")
    try:
        dataset_reference = str(args.dataset_dir.resolve().relative_to(PROJECT_DIR))
    except ValueError:
        dataset_reference = str(args.dataset_dir.resolve())
    summary = {
        "dataset": dataset_reference,
        "model": str(args.model_path.name),
        "architecture": (
            "Frozen MobileNetV2 feature backbone from skin_disease_model.keras "
            "with a newly trained ten-class hair and scalp classification head"
        ),
        "seed": SEED,
        "image_size": IMAGE_SIZE,
        "class_names": class_names,
        "split_counts": split_counts,
        "epochs_requested": args.epochs,
        "epochs_completed": len(history.history["loss"]),
        "test_loss": float(test_loss),
        "test_accuracy": float(test_accuracy),
        "test_classification_report": report,
        "test_confusion_matrix": confusion,
        "limitations": [
            "Labels come from dataset folder names and are not clinician-confirmed.",
            "The classifier is for educational exploration, not diagnosis or treatment.",
            "Test metrics describe this dataset split and are not clinical validation.",
        ],
    }
    args.report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Saved model: {args.model_path}")
    print(f"Saved labels: {args.labels_path}")
    print(f"Saved report: {args.report_path}")
    print(f"Test accuracy: {test_accuracy:.4f}; test loss: {test_loss:.4f}")


if __name__ == "__main__":
    main()
