"""Exploratory data analysis for HAM10000 and Amazon All_Beauty."""

import ast
import json
import unicodedata
from collections.abc import Iterable, Mapping
from collections import Counter
from pathlib import Path
from typing import Any, Iterator

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns


PROJECT_DIR = Path(__file__).resolve().parent
DATASET_DIR = PROJECT_DIR / "dataset"
HAM_DATASET_DIR = DATASET_DIR / "Skin Cancer MNIST HAM10000"
HAM_METADATA_PATH = HAM_DATASET_DIR / "HAM10000_metadata.csv"
HAM_IMAGE_DIRS = (
    HAM_DATASET_DIR / "HAM10000_images_part_1",
    HAM_DATASET_DIR / "HAM10000_images_part_2",
)
CHARTS_DIR = PROJECT_DIR / "charts"
TOP_ITEMS = 10

AMAZON_DATASET_NAME = "McAuley-Lab/Amazon-Reviews-2023"
AMAZON_REVIEWS_CONFIG = "raw_review_All_Beauty"
AMAZON_PRODUCTS_CONFIG = "raw_meta_All_Beauty"

HAM_DIAGNOSIS_LABELS = {
    "akiec": "Actinic keratoses / intraepithelial carcinoma",
    "bcc": "Basal cell carcinoma",
    "bkl": "Benign keratosis-like lesions",
    "df": "Dermatofibroma",
    "mel": "Melanoma",
    "nv": "Melanocytic nevi",
    "vasc": "Vascular lesions",
}

COLUMN_ALIASES = {
    "diagnosis": ("dx", "diagnosis", "diagnostic_class", "class"),
    "age": ("age",),
    "image_id": ("image_id",),
    "sex": ("sex", "gender"),
    "localization": ("localization", "location", "body_location", "anatomical_site"),
    "rating": (
        "rating",
        "average_rating",
        "product_rating",
        "review_rating",
        "stars",
        "score",
    ),
    "review_text": ("text", "review_text", "content", "review"),
    "review_title": ("title", "review_title", "summary"),
    "verified_purchase": ("verified_purchase", "verified", "is_verified_purchase"),
    "helpful_votes": ("helpful_vote", "helpful_votes", "helpful"),
    "brand": ("brand", "brand_name", "brandname", "store"),
    "categories": ("categories", "category", "main_category"),
    "asin": ("parent_asin", "asin", "product_id"),
}

sns.set_theme(style="whitegrid")


def find_column(data: pd.DataFrame, role: str) -> str | None:
    """Find a column by common dataset-specific names, ignoring case."""
    normalized = {str(column).strip().casefold(): column for column in data.columns}
    for candidate in COLUMN_ALIASES[role]:
        if candidate.casefold() in normalized:
            return normalized[candidate.casefold()]
    return None


def inspect_dataset(data: pd.DataFrame, title: str) -> None:
    """Print a consistent overview of a loaded dataset."""
    print(f"\n{'=' * 78}\n{title}: LOAD AND INSPECT\n{'=' * 78}")
    print(f"Shape (rows, columns): {data.shape}")
    print("\nColumns and data types:")
    data.info()
    print("\nFirst five rows:")
    print(data.head().to_string(index=False))
    print("\nDescriptive statistics:")
    summary_data = data.copy()
    for column in summary_data.select_dtypes(include=["object", "string"]).columns:
        summary_data[column] = summary_data[column].map(
            lambda value: repr(value)
            if isinstance(value, (dict, list, tuple, set))
            else value
        )
    # print(summary_data.describe(include="all").T.to_string())
    print(summary_data.describe().T.to_string())


def save_chart(figure_path: Path) -> None:
    """Save the current chart under the requested project chart directory."""
    figure_path.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(figure_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved chart: {figure_path}")


def report_ham_images(data: pd.DataFrame) -> None:
    """Report how many metadata image IDs are available in the local image folders."""
    image_column = find_column(data, "image_id")
    if image_column is None:
        print("\nHAM10000 image check skipped: no image_id column was found.")
        return

    image_ids: set[str] = set()
    folder_counts: dict[Path, int] = {}
    for folder in HAM_IMAGE_DIRS:
        if not folder.is_dir():
            print(f"\nHAM10000 image folder not found: {folder}")
            continue
        image_paths = list(folder.glob("*.jpg"))
        folder_counts[folder] = len(image_paths)
        image_ids.update(path.stem for path in image_paths)

    metadata_ids = set(data[image_column].dropna().astype(str))
    matched = len(metadata_ids & image_ids)
    print("\nHAM10000 local image coverage:")
    for folder, count in folder_counts.items():
        print(f"- {folder.name}: {count:,} JPEG images")
    print(
        f"- Unique metadata image IDs matched to local files: {matched:,} "
        f"of {len(metadata_ids):,}"
    )


def analyze_ham(data: pd.DataFrame) -> dict[str, Any]:
    """Inspect HAM10000 metadata, impute missing ages, and create three charts."""
    inspect_dataset(data, "PART 1 — HAM10000 metadata")
    diagnosis = find_column(data, "diagnosis")
    age = find_column(data, "age")
    sex = find_column(data, "sex")
    localization = find_column(data, "localization")

    if diagnosis is None:
        raise ValueError(
            "Could not identify the HAM10000 diagnosis column. "
            "Expected a column such as 'dx' or 'diagnosis'."
        )

    print("\nHAM10000 metadata quality:")
    print(f"- Duplicate rows: {int(data.duplicated().sum()):,}")
    print("- Missing values by column:")
    missing = data.isna().sum()
    if missing.any():
        print(missing[missing > 0].to_string())
    else:
        print("None")

    if age is not None:
        numeric_age = pd.to_numeric(data[age], errors="coerce")
        missing_age_count = int(numeric_age.isna().sum())
        if numeric_age.notna().any():
            median_age = float(numeric_age.median())
            data[age] = numeric_age.fillna(median_age)
            print(
                f"\nAge handling: {missing_age_count:,} missing or non-numeric "
                f"value(s) filled with the median age ({median_age:.1f} years)."
            )
        else:
            print(
                "\nAge handling: no numeric age values are available; "
                "age imputation and charting are skipped."
            )

    print("\nAvailable medical metadata fields:")
    print(f"- Diagnosis/target: {diagnosis}")
    print(f"- Patient age: {age or 'not present'}")
    print(f"- Patient sex: {sex or 'not present'}")
    print(f"- Lesion localization: {localization or 'not present'}")
    report_ham_images(data)

    class_counts = data[diagnosis].astype("string").fillna("<Missing>").value_counts()
    class_labels = [
        f"{HAM_DIAGNOSIS_LABELS.get(str(value).casefold(), str(value))} ({value})"
        for value in class_counts.index
    ]
    plt.figure(figsize=(11, 6))
    sns.barplot(x=class_counts.values, y=class_labels, color="indianred")
    plt.title("HAM10000 Diagnostic Class Distribution")
    plt.xlabel("Number of images / metadata records")
    plt.ylabel("Diagnostic class")
    save_chart(CHARTS_DIR / "ham10000" / "diagnostic_class_distribution.png")

    if age is not None and pd.to_numeric(data[age], errors="coerce").notna().any():
        ages = pd.to_numeric(data[age], errors="coerce").dropna()
        plt.figure(figsize=(9, 5))
        sns.histplot(ages, bins=20, kde=True, color="steelblue")
        plt.title("HAM10000 Patient Age Distribution (Median-Imputed)")
        plt.xlabel("Age (years)")
        plt.ylabel("Number of records")
        save_chart(CHARTS_DIR / "ham10000" / "age_distribution.png")
        print(
            f"- Age summary after imputation: mean {ages.mean():.1f}, "
            f"median {ages.median():.1f}, range {ages.min():.1f}–{ages.max():.1f} years."
        )
    else:
        print("- Age distribution chart skipped: no usable age column or values.")

    if localization is not None:
        site_counts = (
            data[localization].astype("string").fillna("<Missing>").value_counts()
        )
        if not site_counts.empty:
            plt.figure(figsize=(10, 6))
            sns.barplot(
                x=site_counts.values,
                y=site_counts.index.astype(str),
                color="darkseagreen",
            )
            plt.title("HAM10000 Lesion Localization Distribution")
            plt.xlabel("Number of images / metadata records")
            plt.ylabel("Body-site location")
            save_chart(CHARTS_DIR / "ham10000" / "localization_distribution.png")
            print(
                f"- Most frequent localization: {site_counts.index[0]} "
                f"({site_counts.iloc[0]:,} records)."
            )
    else:
        print("- Localization chart skipped: no localization column was found.")

    dominant_class = str(class_counts.index[0])
    dominant_share = float(class_counts.iloc[0] / class_counts.sum())
    print(
        f"- Most frequent diagnosis: "
        f"{HAM_DIAGNOSIS_LABELS.get(dominant_class.casefold(), dominant_class)} "
        f"({class_counts.iloc[0]:,} records; {dominant_share:.1%})."
    )
    return {
        "class_counts": class_counts,
        "dominant_class": dominant_class,
        "dominant_share": dominant_share,
    }


def load_amazon_table(config: str, title: str, columns: tuple[str, ...]) -> pd.DataFrame:
    """Load an Amazon-Reviews-2023 full split, retaining only relevant columns."""
    try:
        from datasets import load_dataset
    except ImportError as error:
        raise ImportError(
            "Amazon EDA requires Hugging Face's 'datasets' package. "
            "Install it with: python -m pip install datasets"
        ) from error

    print(f"\nLoading {title} from {AMAZON_DATASET_NAME} ({config}, split='full')...")
    dataset = load_dataset(AMAZON_DATASET_NAME, config, split="full", trust_remote_code=True)
    available_columns = set(dataset.column_names)
    selected_columns = [column for column in columns if column in available_columns]
    if not selected_columns:
        raise ValueError(
            f"No expected {title} columns were found. "
            f"Available columns: {dataset.column_names}"
        )
    data = dataset.select_columns(selected_columns).to_pandas()
    if data.empty:
        raise ValueError(f"{title} contains no rows.")
    inspect_dataset(data, title)
    return data


def iter_attribute_values(value: Any) -> Iterator[str]:
    """Flatten nested metadata into clean, human-readable attribute values."""
    if isinstance(value, Mapping):
        preferred_keys = {
            "category",
            "category_name",
            "display_name",
            "label",
            "main_category",
            "name",
            "title",
        }
        identifier_keys = {
            "asin",
            "category_id",
            "id",
            "node_id",
            "parent_asin",
            "uuid",
        }
        preferred_values = [
            nested_value
            for key, nested_value in value.items()
            if str(key).strip().casefold().replace(" ", "_") in preferred_keys
        ]
        if preferred_values:
            for nested_value in preferred_values:
                yield from iter_attribute_values(nested_value)
            return

        nested_values = [
            nested_value
            for key, nested_value in value.items()
            if str(key).strip().casefold().replace(" ", "_") not in identifier_keys
        ]
        found_value = False
        for nested_value in nested_values:
            cleaned_values = list(iter_attribute_values(nested_value))
            if cleaned_values:
                found_value = True
                yield from cleaned_values
        if not found_value:
            for key in value:
                if str(key).strip().casefold().replace(" ", "_") not in identifier_keys:
                    yield from iter_attribute_values(key)
        return
    if isinstance(value, Iterable) and not isinstance(value, (str, bytes, bytearray)):
        for nested_value in value:
            yield from iter_attribute_values(nested_value)
        return
    if value is None or value is pd.NA:
        return
    if not isinstance(value, (dict, list, tuple, set)):
        try:
            if bool(pd.isna(value)):
                return
        except (TypeError, ValueError):
            pass
    text = unicodedata.normalize("NFKC", str(value))
    if text.startswith(("[", "{")) and text.endswith(("]", "}")):
        for parser in (json.loads, ast.literal_eval):
            try:
                parsed = parser(text)
            except (ValueError, SyntaxError, TypeError):
                continue
            if not isinstance(parsed, str):
                yield from iter_attribute_values(parsed)
                return

    text = "".join(
        character
        for character in text
        if character.isspace()
        or not unicodedata.category(character).startswith("C")
        and character != "\ufffd"
    )
    text = " ".join(text.split())
    if text and any(character.isalpha() for character in text):
        yield text


def save_top_attribute_chart(
    counts: Counter[str], title: str, filename: str, ylabel: str
) -> bool:
    """Plot a ranked attribute count with explicit, readable tick labels."""
    top_counts = pd.Series(dict(counts)).sort_values(ascending=False).head(TOP_ITEMS)
    if top_counts.empty:
        print(f"- {ylabel} chart skipped: no usable values were found.")
        return False

    plt.figure(figsize=(10, 6))
    axis = plt.gca()
    positions = range(len(top_counts))
    axis.barh(positions, top_counts.to_numpy(), color="darkseagreen")
    axis.set_yticks(positions, labels=[str(label) for label in top_counts.index])
    axis.invert_yaxis()
    axis.set_title(title)
    axis.set_xlabel("Number of products")
    axis.set_ylabel(ylabel)
    save_chart(CHARTS_DIR / "amazon_beauty" / filename)
    print(f"- Top {ylabel.lower()}: {top_counts.index[0]} ({top_counts.iloc[0]:,} products).")
    return True


def plot_top_attribute(
    data: pd.DataFrame, column: str | None, title: str, filename: str, ylabel: str
) -> bool:
    """Plot the most frequent values of a product attribute when available."""
    if column is None:
        print(f"- {ylabel} chart skipped: product metadata has no matching column.")
        return False

    counts: Counter[str] = Counter()
    for value in data[column]:
        counts.update(iter_attribute_values(value))
    if not counts:
        print(f"- {ylabel} chart skipped: {column!r} contains no usable values.")
        return False
    return save_top_attribute_chart(counts, title, filename, ylabel)


def plot_top_categories(
    data: pd.DataFrame,
    categories_column: str | None,
    main_category_column: str | None,
) -> bool:
    """Count readable categories per product, falling back to main_category."""
    if categories_column is None and main_category_column is None:
        print("- Category chart skipped: no category fields were found.")
        return False

    counts: Counter[str] = Counter()
    for _, row in data.iterrows():
        names = (
            list(iter_attribute_values(row[categories_column]))
            if categories_column is not None
            else []
        )
        if not names and main_category_column is not None:
            names = list(iter_attribute_values(row[main_category_column]))
        counts.update(dict.fromkeys(names, 1))

    if not counts:
        print("- Category chart skipped: category fields contain no readable names.")
        return False
    return save_top_attribute_chart(
        counts,
        "Amazon All_Beauty Top Categories by Product Count",
        "top_categories.png",
        "Category",
    )


def analyze_amazon_reviews(data: pd.DataFrame) -> pd.Series:
    """Summarize review ratings and text, and save rating/statistics charts."""
    rating = find_column(data, "rating")
    review_text = find_column(data, "review_text")
    review_title = find_column(data, "review_title")
    verified = find_column(data, "verified_purchase")
    helpful = find_column(data, "helpful_votes")
    product_id = find_column(data, "asin")

    print("\nAmazon All_Beauty review insights:")
    print(f"- Review rows: {len(data):,}")
    print(f"- Product identifier field: {product_id or 'not present'}")
    if rating is None:
        raise ValueError(
            "Amazon review data has no recognized rating field; "
            f"available fields: {list(data.columns)}"
        )

    ratings = pd.to_numeric(data[rating], errors="coerce")
    valid_ratings = ratings.dropna()
    invalid_count = int((data[rating].notna() & ratings.isna()).sum())
    print(f"- Numeric ratings: {len(valid_ratings):,}; unparseable ratings: {invalid_count:,}")
    if valid_ratings.empty:
        raise ValueError("Amazon review data contains no numeric ratings.")
    print(
        f"- Rating summary: mean {valid_ratings.mean():.2f}, "
        f"median {valid_ratings.median():.2f}, "
        f"range {valid_ratings.min():g}–{valid_ratings.max():g}."
    )
    print("- Rating counts:")
    print(valid_ratings.value_counts().sort_index().to_string())

    rating_counts = valid_ratings.value_counts().sort_index()
    plt.figure(figsize=(9, 5))
    sns.barplot(x=rating_counts.index.astype(str), y=rating_counts.values, color="cornflowerblue")
    plt.title("Amazon All_Beauty Rating Distribution")
    plt.xlabel("Rating (stars)")
    plt.ylabel("Number of reviews")
    save_chart(CHARTS_DIR / "amazon_beauty" / "rating_distribution.png")

    text_lengths = pd.Series(0, index=data.index, dtype="int64")
    text_coverage = pd.Series(False, index=data.index)
    for column in (review_title, review_text):
        if column is not None:
            text = data[column].fillna("").astype("string")
            text_lengths += text.str.len().fillna(0).astype("int64")
            text_coverage |= text.str.strip().ne("").fillna(False)
    if review_text is not None or review_title is not None:
        observed_lengths = text_lengths[text_coverage]
        print(
            f"- Reviews with text or title: {len(observed_lengths):,} "
            f"({text_coverage.mean():.1%}); mean combined length: "
            f"{observed_lengths.mean():.1f} characters."
        )
        if not observed_lengths.empty:
            upper_limit = float(observed_lengths.quantile(0.99))
            chart_lengths = observed_lengths.clip(upper=upper_limit)
            plt.figure(figsize=(9, 5))
            sns.histplot(chart_lengths, bins=40, color="teal")
            plt.title("Amazon All_Beauty Review Length (99th Percentile Capped)")
            plt.xlabel("Title and review text length (characters)")
            plt.ylabel("Number of reviews")
            save_chart(
                CHARTS_DIR / "amazon_beauty" / "review_length_distribution.png"
            )
        else:
            print("- Review-length chart skipped: no non-empty review text is available.")
    elif helpful is not None:
        helpful_votes = pd.to_numeric(data[helpful], errors="coerce").dropna()
        if not helpful_votes.empty:
            plt.figure(figsize=(9, 5))
            sns.histplot(helpful_votes, bins=30, color="teal")
            plt.title("Amazon All_Beauty Helpful Votes per Review")
            plt.xlabel("Helpful votes")
            plt.ylabel("Number of reviews")
            save_chart(CHARTS_DIR / "amazon_beauty" / "review_statistics.png")
        else:
            print("- Review-statistics chart skipped: helpful-vote values are unavailable.")
    else:
        print("- Review-statistics chart skipped: no text or helpful-vote field was found.")

    if verified is not None:
        print(f"- Verified-purchase field coverage: {data[verified].notna().mean():.1%}")
        print(f"- Verified-purchase value counts:\n{data[verified].value_counts(dropna=False).to_string()}")
    if helpful is not None:
        helpful_votes = pd.to_numeric(data[helpful], errors="coerce")
        print(
            f"- Helpful votes: median {helpful_votes.median():.1f}; "
            f"{int(helpful_votes.notna().sum()):,} numeric values."
        )
    return valid_ratings


def analyze_amazon_products(data: pd.DataFrame) -> None:
    """Inspect product metadata and chart the available brand/category attributes."""
    brand = find_column(data, "brand")
    categories = next(
        (column for column in data.columns if str(column).strip().casefold() == "categories"),
        None,
    )
    main_category = next(
        (
            column
            for column in data.columns
            if str(column).strip().casefold() == "main_category"
        ),
        None,
    )
    product_id = find_column(data, "asin")
    rating = find_column(data, "rating")
    print("\nAmazon All_Beauty product metadata insights:")
    print(f"- Product metadata rows: {len(data):,}")
    if product_id is not None:
        print(f"- Unique product identifiers: {data[product_id].nunique(dropna=True):,}")
    if rating is not None:
        product_ratings = pd.to_numeric(data[rating], errors="coerce").dropna()
        if not product_ratings.empty:
            print(
                f"- Metadata rating summary: mean {product_ratings.mean():.2f}, "
                f"median {product_ratings.median():.2f}."
            )
    print(f"- Brand field: {brand or 'not present'}")
    print(
        f"- Category fields: categories={categories or 'not present'}, "
        f"main_category={main_category or 'not present'}"
    )
    plot_top_attribute(
        data,
        brand,
        "Amazon All_Beauty Top Brands by Product Count",
        "top_brands.png",
        "Brand",
    )
    plot_top_categories(data, categories, main_category)


def main() -> None:
    """Run EDA for the two project datasets."""
    if not HAM_METADATA_PATH.is_file():
        raise FileNotFoundError(
            f"HAM10000 metadata file not found: {HAM_METADATA_PATH}"
        )
    ham_metadata = pd.read_csv(HAM_METADATA_PATH, low_memory=False)
    if ham_metadata.empty:
        raise ValueError(f"HAM10000 metadata contains no rows: {HAM_METADATA_PATH}")
    ham_results = analyze_ham(ham_metadata)

    print(f"\n{'=' * 78}\nPART 2 — AMAZON ALL_BEAUTY\n{'=' * 78}")
    reviews = load_amazon_table(
        AMAZON_REVIEWS_CONFIG,
        "Amazon All_Beauty reviews",
        (
            "rating",
            "title",
            "text",
            "parent_asin",
            "asin",
            "verified_purchase",
            "helpful_vote",
            "timestamp",
        ),
    )
    ratings = analyze_amazon_reviews(reviews)

    products = load_amazon_table(
        AMAZON_PRODUCTS_CONFIG,
        "Amazon All_Beauty product metadata",
        (
            "parent_asin",
            "asin",
            "title",
            "brand",
            "categories",
            "main_category",
            "price",
            "average_rating",
            "rating_number",
            "store",
        ),
    )
    analyze_amazon_products(products)

    print(f"\n{'=' * 78}\nSUMMARY: EDA FINDINGS\n{'=' * 78}")
    print(
        f"- HAM10000: {len(ham_metadata):,} metadata records; "
        f"{ham_results['dominant_class']} is the most common diagnosis "
        f"({ham_results['dominant_share']:.1%})."
    )
    print(
        f"- Amazon All_Beauty: {len(reviews):,} reviews with "
        f"{len(ratings):,} usable numeric ratings; mean rating {ratings.mean():.2f}."
    )
    print(
        "- The clinical lesion-classification and consumer-review datasets support "
        "separate analyses; product-review ratings are not clinical evidence or "
        "a substitute for medical diagnosis."
    )


if __name__ == "__main__":
    main()
