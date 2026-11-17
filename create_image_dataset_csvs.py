"""Create CSV indexes for image datasets arranged in split/class folders."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET_DIR = PROJECT_DIR / "dataset" / "Hair Diseases"
SPLIT_NAMES = ("train", "val", "validation", "test")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def create_csvs(dataset_dir: Path) -> None:
    """Write an image-path and label CSV for each split found in the dataset."""
    split_dirs = [
        dataset_dir / split
        for split in SPLIT_NAMES
        if (dataset_dir / split).is_dir()
    ]
    if not split_dirs or split_dirs[0].name != "train":
        raise FileNotFoundError(
            f"Expected a train split directory inside dataset: {dataset_dir}"
        )
    if "val" in {path.name for path in split_dirs} and "validation" in {
        path.name for path in split_dirs
    }:
        raise ValueError("Dataset cannot contain both 'val' and 'validation' splits.")

    split_classes: dict[str, set[str]] = {}
    split_rows: dict[str, list[tuple[str, str]]] = {}

    for split_dir in split_dirs:
        class_dirs = sorted(path for path in split_dir.iterdir() if path.is_dir())
        if not class_dirs:
            raise ValueError(f"No class directories found in {split_dir}")

        rows: list[tuple[str, str]] = []
        for class_dir in class_dirs:
            images = sorted(
                path
                for path in class_dir.iterdir()
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
            )
            if not images:
                raise ValueError(f"No supported images found in {class_dir}")
            rows.extend(
                (image.relative_to(dataset_dir).as_posix(), class_dir.name)
                for image in images
            )

        split_classes[split_dir.name] = {path.name for path in class_dirs}
        split_rows[split_dir.name] = rows

    expected_classes = split_classes["train"]
    for split, classes in split_classes.items():
        if classes != expected_classes:
            raise ValueError(
                f"Class directories in {split!r} do not match the training split."
            )

    for split, rows in split_rows.items():
        output_path = dataset_dir / f"{split}.csv"
        with output_path.open("w", newline="", encoding="utf-8") as csv_file:
            writer = csv.writer(csv_file)
            writer.writerow(("image_path", "label"))
            writer.writerows(rows)
        print(f"Wrote {len(rows):,} rows to {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create split CSVs from image folders arranged by class."
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=DEFAULT_DATASET_DIR,
        help="Directory containing train/val/test or train/validation folders.",
    )
    args = parser.parse_args()
    create_csvs(args.dataset_dir)


if __name__ == "__main__":
    main()
