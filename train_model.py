"""Train and evaluate two image classifiers on the HAM10000 dataset.

Install the required packages with:
    pip install tensorflow pandas scikit-learn matplotlib

Run from the project root with:
    python train_model.py
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GroupShuffleSplit


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET_DIR = PROJECT_DIR / "dataset" / "Skin Cancer MNIST HAM10000"
DEFAULT_IMAGE_DIRS = (
    DEFAULT_DATASET_DIR / "HAM10000_images_part_1",
    DEFAULT_DATASET_DIR / "HAM10000_images_part_2",
)
IMAGE_SIZE = 128
SEED = 42


def parse_args() -> argparse.Namespace:
    """Parse paths and training settings from the command line."""
    parser = argparse.ArgumentParser(
        description="Train and compare CNN and MobileNetV2 models on HAM10000."
    )
    parser.add_argument(
        "--metadata",
        type=Path,
        default=DEFAULT_DATASET_DIR / "HAM10000_metadata.csv",
        help="Path to HAM10000_metadata.csv.",
    )
    parser.add_argument(
        "--image-dirs",
        type=Path,
        nargs="+",
        default=list(DEFAULT_IMAGE_DIRS),
        help="One or more directories containing the dataset JPEG images.",
    )
    parser.add_argument("--image-size", type=int, default=IMAGE_SIZE)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument(
        "--charts-dir",
        type=Path,
        default=PROJECT_DIR / "evaluation_charts",
        help="Directory for training plots and confusion matrices.",
    )
    parser.add_argument(
        "--model-path",
        type=Path,
        default=PROJECT_DIR / "skin_disease_model.keras",
        help="Path where the best validation-selected model is saved.",
    )
    parser.add_argument(
        "--mobilenet-weights",
        choices=("imagenet", "none"),
        default="imagenet",
        help="Use ImageNet-pretrained MobileNetV2 weights, or initialize randomly.",
    )
    args = parser.parse_args()
    if args.image_size < 32:
        parser.error("--image-size must be at least 32 pixels.")
    if args.epochs < 1:
        parser.error("--epochs must be at least 1.")
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1.")
    return args


def load_metadata(
    metadata_path: Path, image_dirs: list[Path]
) -> tuple[pd.DataFrame, list[str]]:
    """Load metadata, impute ages, and resolve every record to a local JPEG."""
    if not metadata_path.is_file():
        raise FileNotFoundError(f"HAM10000 metadata file not found: {metadata_path}")

    metadata = pd.read_csv(metadata_path)
    required_columns = {"image_id", "dx", "lesion_id"}
    missing_columns = required_columns.difference(metadata.columns)
    if missing_columns:
        raise ValueError(
            "Metadata is missing required column(s): "
            + ", ".join(sorted(missing_columns))
        )

    metadata = metadata.dropna(subset=["image_id", "dx", "lesion_id"]).copy()
    metadata["image_id"] = metadata["image_id"].astype(str)
    metadata["dx"] = metadata["dx"].astype(str)
    metadata["lesion_id"] = metadata["lesion_id"].astype(str)
    if metadata.empty:
        raise ValueError("No rows with image_id, dx, and lesion_id were found.")

    if "age" in metadata.columns:
        metadata["age"] = pd.to_numeric(metadata["age"], errors="coerce")
        missing_age_count = int(metadata["age"].isna().sum())
        median_age = metadata["age"].median()
        if math.isnan(median_age):
            median_age = 0.0
            print("All ages are missing; filling age with 0.0.")
        metadata["age"] = metadata["age"].fillna(median_age)
        print(
            f"Age preprocessing: filled {missing_age_count:,} missing or invalid "
            f"value(s) with {median_age:.1f}."
        )
    else:
        print("Age preprocessing: metadata has no age column; continuing without it.")

    image_lookup: dict[str, Path] = {}
    for image_dir in image_dirs:
        if not image_dir.is_dir():
            raise FileNotFoundError(f"HAM10000 image directory not found: {image_dir}")
        for image_path in image_dir.glob("*.jpg"):
            image_lookup.setdefault(image_path.stem, image_path)

    metadata["image_path"] = metadata["image_id"].map(image_lookup)
    missing_images = metadata["image_path"].isna()
    if missing_images.any():
        sample_ids = metadata.loc[missing_images, "image_id"].head(5).tolist()
        raise FileNotFoundError(
            f"{int(missing_images.sum()):,} metadata image(s) were not found in "
            f"--image-dirs. Example image_id values: {sample_ids}"
        )

    metadata = metadata.reset_index(drop=True)
    class_names = sorted(metadata["dx"].unique().tolist())
    metadata["label"] = pd.Categorical(
        metadata["dx"], categories=class_names
    ).codes.astype(np.int32)
    print(
        f"Loaded {len(metadata):,} images across {len(class_names)} classes "
        f"and {metadata['lesion_id'].nunique():,} unique lesions."
    )
    return metadata, class_names


def group_train_validation_test_split(
    metadata: pd.DataFrame, seed: int
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Split by lesion so images of one lesion never cross dataset partitions."""
    indices = np.arange(len(metadata))
    groups = metadata["lesion_id"].to_numpy()
    labels = metadata["label"].to_numpy()

    test_splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)
    train_validation_indices, test_indices = next(
        test_splitter.split(indices, labels, groups)
    )

    validation_splitter = GroupShuffleSplit(
        n_splits=1, test_size=0.2, random_state=seed + 1
    )
    train_relative, validation_relative = next(
        validation_splitter.split(
            train_validation_indices,
            labels[train_validation_indices],
            groups[train_validation_indices],
        )
    )
    train_indices = train_validation_indices[train_relative]
    validation_indices = train_validation_indices[validation_relative]

    train = metadata.iloc[train_indices].reset_index(drop=True)
    validation = metadata.iloc[validation_indices].reset_index(drop=True)
    test = metadata.iloc[test_indices].reset_index(drop=True)

    train_groups = set(train["lesion_id"])
    validation_groups = set(validation["lesion_id"])
    test_groups = set(test["lesion_id"])
    if (
        train_groups & validation_groups
        or train_groups & test_groups
        or validation_groups & test_groups
    ):
        raise RuntimeError("Lesion leakage detected between data splits.")

    expected_labels = set(metadata["label"].unique())
    for split_name, split in (
        ("training", train),
        ("validation", validation),
        ("test", test),
    ):
        absent_labels = expected_labels.difference(split["label"].unique())
        if absent_labels:
            absent_classes = [
                metadata.loc[metadata["label"] == label, "dx"].iloc[0]
                for label in sorted(absent_labels)
            ]
            raise ValueError(
                f"The {split_name} split is missing class(es) {absent_classes}. "
                "The lesion-group split cannot evaluate all classes; check the "
                "dataset or adjust the split proportions."
            )
        print(f"{split_name.capitalize()} records: {len(split):,}")
    return train, validation, test


def make_dataset(
    data: pd.DataFrame,
    image_size: int,
    batch_size: int,
    training: bool = False,
    seed: int = SEED,
) -> tf.data.Dataset:
    """Create a streaming image dataset with resized RGB pixels in [0, 1]."""
    paths = data["image_path"].astype(str).to_numpy()
    labels = data["label"].to_numpy(dtype=np.int32)
    dataset = tf.data.Dataset.from_tensor_slices((paths, labels))

    def load_image(path: tf.Tensor, label: tf.Tensor) -> tuple[tf.Tensor, tf.Tensor]:
        image_bytes = tf.io.read_file(path)
        image = tf.io.decode_jpeg(image_bytes, channels=3)
        image = tf.image.resize(image, [image_size, image_size])
        image = tf.cast(image, tf.float32) / 255.0
        return image, label

    if training:
        dataset = dataset.shuffle(
            buffer_size=len(data), seed=seed, reshuffle_each_iteration=True
        )
    return (
        dataset.map(load_image, num_parallel_calls=tf.data.AUTOTUNE)
        .batch(batch_size)
        .prefetch(tf.data.AUTOTUNE)
    )


def build_cnn(num_classes: int, image_size: int) -> tf.keras.Model:
    """Build the custom CNN baseline."""
    inputs = tf.keras.Input(shape=(image_size, image_size, 3), name="image")
    x = inputs
    for filters in (32, 64, 128):
        x = tf.keras.layers.Conv2D(filters, 3, padding="same", use_bias=False)(x)
        x = tf.keras.layers.BatchNormalization()(x)
        x = tf.keras.layers.Activation("relu")(x)
        x = tf.keras.layers.MaxPooling2D()(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.35)(x)
    outputs = tf.keras.layers.Dense(num_classes, activation="softmax")(x)
    model = tf.keras.Model(inputs, outputs, name="custom_cnn")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def build_mobilenet(
    num_classes: int, image_size: int, weights: str
) -> tf.keras.Model:
    """Build a MobileNetV2 transfer-learning classifier."""
    imagenet_weights = "imagenet" if weights == "imagenet" else None
    inputs = tf.keras.Input(shape=(image_size, image_size, 3), name="image")
    # MobileNetV2 expects input values scaled to [-1, 1].
    x = tf.keras.layers.Rescaling(scale=2.0, offset=-1.0)(inputs)
    backbone = tf.keras.applications.MobileNetV2(
        input_shape=(image_size, image_size, 3),
        include_top=False,
        weights=imagenet_weights,
    )
    backbone.trainable = False
    x = backbone(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.Dense(num_classes, activation="softmax")(x)
    model = tf.keras.Model(inputs, outputs, name="mobilenetv2_transfer")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def plot_history(history: tf.keras.callbacks.History, name: str, charts_dir: Path) -> None:
    """Save loss and accuracy curves for a model's training run."""
    figure, axes = plt.subplots(1, 2, figsize=(12, 4))
    for axis, metric, title in (
        (axes[0], "loss", "Loss"),
        (axes[1], "accuracy", "Accuracy"),
    ):
        axis.plot(history.history[metric], label="Training")
        axis.plot(history.history[f"val_{metric}"], label="Validation")
        axis.set_title(f"{name}: {title}")
        axis.set_xlabel("Epoch")
        axis.set_ylabel(title)
        axis.legend()
    figure.tight_layout()
    output_path = charts_dir / f"{name.lower()}_training_history.png"
    figure.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(figure)
    print(f"Saved training history: {output_path}")


def evaluate_model(
    model: tf.keras.Model,
    dataset: tf.data.Dataset,
    class_names: list[str],
    model_name: str,
    charts_dir: Path,
) -> dict[str, float]:
    """Evaluate a model and save its test-set confusion matrix."""
    true_labels = np.concatenate([labels.numpy() for _, labels in dataset])
    probabilities = model.predict(dataset, verbose=0)
    predicted_labels = np.argmax(probabilities, axis=1)
    labels = list(range(len(class_names)))
    scores = {
        "accuracy": accuracy_score(true_labels, predicted_labels),
        "precision_macro": precision_score(
            true_labels, predicted_labels, labels=labels, average="macro", zero_division=0
        ),
        "recall_macro": recall_score(
            true_labels, predicted_labels, labels=labels, average="macro", zero_division=0
        ),
        "f1_macro": f1_score(
            true_labels, predicted_labels, labels=labels, average="macro", zero_division=0
        ),
    }
    matrix = confusion_matrix(true_labels, predicted_labels, labels=labels)

    figure_size = max(8, len(class_names) * 1.1)
    figure, axis = plt.subplots(figsize=(figure_size, figure_size))
    image = axis.imshow(matrix, interpolation="nearest", cmap="Blues")
    figure.colorbar(image, ax=axis, fraction=0.046, pad=0.04)
    axis.set(
        xticks=labels,
        yticks=labels,
        xticklabels=class_names,
        yticklabels=class_names,
        xlabel="Predicted label",
        ylabel="True label",
        title=f"{model_name} — Test Confusion Matrix",
    )
    plt.setp(axis.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")
    threshold = matrix.max() / 2 if matrix.size else 0
    for row in range(matrix.shape[0]):
        for column in range(matrix.shape[1]):
            axis.text(
                column,
                row,
                f"{matrix[row, column]:,}",
                ha="center",
                va="center",
                color="white" if matrix[row, column] > threshold else "black",
            )
    figure.tight_layout()
    output_path = charts_dir / f"{model_name.lower()}_confusion_matrix.png"
    figure.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(figure)
    print(f"Saved confusion matrix: {output_path}")
    return scores


def main() -> None:
    args = parse_args()
    tf.keras.utils.set_random_seed(args.seed)
    args.charts_dir.mkdir(parents=True, exist_ok=True)
    args.model_path.parent.mkdir(parents=True, exist_ok=True)

    metadata, class_names = load_metadata(args.metadata, args.image_dirs)
    train_data, validation_data, test_data = group_train_validation_test_split(
        metadata, args.seed
    )
    train_dataset = make_dataset(
        train_data, args.image_size, args.batch_size, training=True, seed=args.seed
    )
    validation_dataset = make_dataset(
        validation_data, args.image_size, args.batch_size
    )
    test_dataset = make_dataset(test_data, args.image_size, args.batch_size)

    models = [
        ("CNN", build_cnn(len(class_names), args.image_size)),
        (
            "MobileNetV2",
            build_mobilenet(len(class_names), args.image_size, args.mobilenet_weights),
        ),
    ]
    results: dict[str, dict[str, float]] = {}
    validation_scores: dict[str, tuple[float, float]] = {}

    for name, model in models:
        print(f"\nTraining {name}...")
        early_stopping = tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=4,
            restore_best_weights=True,
            verbose=1,
        )
        reduce_lr = tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=2, min_lr=1e-6, verbose=1
        )
        history = model.fit(
            train_dataset,
            validation_data=validation_dataset,
            epochs=args.epochs,
            callbacks=[early_stopping, reduce_lr],
            verbose=1,
        )
        plot_history(history, name, args.charts_dir)
        best_epoch = int(np.argmin(history.history["val_loss"]))
        validation_scores[name] = (
            float(history.history["val_accuracy"][best_epoch]),
            float(history.history["val_loss"][best_epoch]),
        )
        results[name] = evaluate_model(
            model, test_dataset, class_names, name, args.charts_dir
        )

    best_model_name = max(
        validation_scores,
        key=lambda name: (validation_scores[name][0], -validation_scores[name][1]),
    )
    best_model = dict(models)[best_model_name]
    best_model.save(args.model_path)

    print("\nTest-set evaluation (macro-averaged precision, recall, and F1):")
    for name, scores in results.items():
        print(
            f"{name}: accuracy={scores['accuracy']:.4f}, "
            f"precision={scores['precision_macro']:.4f}, "
            f"recall={scores['recall_macro']:.4f}, "
            f"F1={scores['f1_macro']:.4f}"
        )
    print(
        f"\nSaved {best_model_name} as the best validation-selected model: "
        f"{args.model_path}"
    )
    print(
        "\nInterpretation and limitations:\n"
        "- The saved model is selected using validation accuracy (validation loss "
        "breaks ties); the test set is reserved for final evaluation.\n"
        "- HAM10000 is class-imbalanced, so accuracy alone can hide poor performance "
        "on rare diagnoses. Macro-averaged metrics and confusion matrices help, but "
        "per-class sensitivity should still be reviewed.\n"
        "- Lesion-group splitting prevents duplicate-lesion leakage, but does not "
        "remove patient, device, or acquisition-site biases.\n"
        "- Results depend on the split, image quality, and (for MobileNetV2) access "
        "to ImageNet weights. This educational classifier is not a medical "
        "diagnosis tool.\n"
        "- Missing ages are median-imputed for metadata preprocessing; the "
        "image-only models do not use age as an input."
    )


if __name__ == "__main__":
    main()
