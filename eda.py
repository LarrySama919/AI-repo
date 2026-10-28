"""
Assignment 2: EDA for the AI Skin Health project.

Expected defaults:
    dataset/Skin Cancer MNIST HAM10000/HAM10000_metadata.csv
    dataset/Sephora Products and Skincare Reviews/product_info.csv

Edit the paths below to match the files downloaded for the project. If Sephora
reviews are stored separately, set SEPHORA_REVIEWS_PATH; otherwise ratings are
read from the product file when that column is available.
"""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns


# --------------------------- User configuration ---------------------------
DATASET_DIR = Path("dataset")

HAM_METADATA_PATH = DATASET_DIR / "Skin Cancer MNIST HAM10000" / "HAM10000_metadata.csv"
SEPHORA_PRODUCTS_PATH = DATASET_DIR / "Sephora Products and Skincare Reviews" / "product_info.csv"
SEPHORA_REVIEWS_PATH: Path | None = None

CHARTS_DIR = Path("charts")
TOP_BRANDS = 10
# -------------------------------------------------------------------------


sns.set_theme(style="whitegrid")

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
    "sex": ("sex", "gender"),
    "localization": ("localization", "location", "body_location", "anatomical_site"),
    "price": ("price_usd", "price", "sale_price", "list_price"),
    "ingredients": ("ingredients", "ingredient_list"),
    "rating": ("rating", "product_rating", "review_rating", "stars", "score"),
    "brand": ("brand_name", "brand", "brandname"),
    "skin_type": ("skin_type", "skin type", "skintype"),
}


def find_column(data: pd.DataFrame, role: str) -> str | None:
    """Find a column by common dataset-specific names, ignoring case."""
    normalized = {str(column).strip().casefold(): column for column in data.columns}
    for candidate in COLUMN_ALIASES[role]:
        if candidate.casefold() in normalized:
            return normalized[candidate.casefold()]
    return None


def require_file(path: Path, dataset_name: str) -> None:
    """Raise an actionable error when a configured input file is unavailable."""
    if not path.is_file():
        raise FileNotFoundError(
            f"{dataset_name} file not found: {path.resolve()}\n"
            "Update its path in the user configuration section at the top of eda.py."
        )


def load_csv(path: Path, dataset_name: str) -> pd.DataFrame:
    """Load a CSV and reject empty tables with a clear message."""
    require_file(path, dataset_name)
    data = pd.read_csv(path, low_memory=False)
    if data.empty:
        raise ValueError(f"{dataset_name} CSV contains no data rows: {path.resolve()}")
    return data


def inspect_dataset(data: pd.DataFrame, title: str) -> None:
    """Print the standard first-look inspection requested in the assignment."""
    print(f"\n{'=' * 78}\n{title}: LOAD AND INSPECT\n{'=' * 78}")
    print("\nFirst five rows:")
    print(data.head())
    print(f"\nShape (rows, columns): {data.shape}")
    print("\nColumn names and data types:")
    data.info()
    print("\nDescriptive statistics:")
    print(data.describe(include="all").T)


def check_data_quality(
    data: pd.DataFrame, title: str, critical_columns: list[str | None]
) -> int:
    """Report missing data and exact duplicate rows without cleaning the data."""
    print(f"\n{'=' * 78}\n{title}: DATA QUALITY\n{'=' * 78}")
    missing = data.isna().sum().sort_values(ascending=False)
    if missing.any():
        print("\nMissing values by column:")
        print(missing[missing > 0].to_string())
    else:
        print("\nNo missing values found.")

    duplicates = int(data.duplicated().sum())
    print(f"\nDuplicate rows: {duplicates}")
    print("\nMissing values in critical columns:")
    for column in critical_columns:
        if column is None:
            continue
        count = int(data[column].isna().sum())
        print(f"- {column}: {count} missing ({count / len(data):.1%})")
    return duplicates


def explain_columns(
    data: pd.DataFrame,
    title: str,
    target: str | None,
    proposed_features: list[str | None],
    descriptions: dict[str, str],
) -> list[str]:
    """Print available project features, omitting absent optional columns."""
    features = [
        column
        for column in proposed_features
        if column is not None and column in data.columns and column != target
    ]
    print(f"\n{'=' * 78}\n{title}: FEATURES AND TARGET / USE-CASE\n{'=' * 78}")
    print(f"Target: {target if target else 'Not detected in this table'}")
    print(f"Input features available: {features or 'No listed features detected'}")
    for column in features:
        print(f"- {column}: {descriptions.get(column, 'Candidate model input feature.')}")
    if target is not None:
        print(
            f"- {target}: outcome to predict or analyze; confirm that its definition "
            "matches the project objective."
        )
    return features


def numeric_series(series: pd.Series, role: str) -> pd.Series:
    """Parse numeric values for analysis without modifying the source DataFrame."""
    values = series
    if role == "price":
        values = values.astype("string").str.replace(r"[$,]", "", regex=True)
    return pd.to_numeric(values, errors="coerce").dropna()


def save_chart(figure_path: Path) -> None:
    """Format and save the current plot."""
    figure_path.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(figure_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved chart: {figure_path}")


def analyze_ham(data: pd.DataFrame) -> dict[str, object]:
    """Inspect HAM10000 metadata, check quality, and chart diagnosis classes."""
    inspect_dataset(data, "PART 1 — HAM10000 metadata")
    diagnosis = find_column(data, "diagnosis")
    age = find_column(data, "age")
    sex = find_column(data, "sex")
    localization = find_column(data, "localization")

    check_data_quality(data, "HAM10000 metadata", [diagnosis, age, sex, localization])
    explain_columns(
        data,
        "HAM10000",
        diagnosis,
        [age, sex, localization],
        {
            age: "Patient age; a demographic feature that may support clinical risk analysis.",
            sex: "Recorded patient sex; a demographic feature, subject to dataset limitations.",
            localization: "Body-site label; lesion location may be informative for screening.",
        },
    )

    if diagnosis is None:
        raise ValueError(
            "Could not identify the HAM10000 diagnosis column. Expected a column "
            "such as 'dx' or 'diagnosis'; update COLUMN_ALIASES if your file differs."
        )

    labels = data[diagnosis].astype("string").fillna("<Missing>")
    counts = labels.value_counts()
    display_labels = [
        f"{HAM_DIAGNOSIS_LABELS.get(str(value).casefold(), str(value))} ({value})"
        for value in counts.index
    ]
    plt.figure(figsize=(11, 6))
    sns.barplot(x=counts.values, y=display_labels, color="indianred")
    plt.title("HAM10000 Diagnostic Class Distribution")
    plt.xlabel("Number of images / metadata records")
    plt.ylabel("Diagnostic class")
    save_chart(CHARTS_DIR / "ham10000" / "diagnostic_class_distribution.png")

    largest_class = str(counts.index[0])
    largest_share = float(counts.iloc[0] / counts.sum())
    interpretation = (
        f"The most frequent class is {HAM_DIAGNOSIS_LABELS.get(largest_class.casefold(), largest_class)} "
        f"({largest_class}), representing {largest_share:.1%} of metadata records. "
        "A large difference between class counts indicates potential class imbalance, "
        "which should be considered when splitting data and evaluating a screening model."
    )
    print(f"\nDiagnostic-class chart interpretation:\n{interpretation}")
    return {
        "class_counts": counts,
        "diagnosis_column": diagnosis,
        "largest_class": largest_class,
        "largest_class_share": largest_share,
    }


def analyze_sephora_products(data: pd.DataFrame) -> dict[str, object]:
    """Inspect products, assess quality, and create price and brand visualizations."""
    inspect_dataset(data, "PART 2 — Sephora products")
    price = find_column(data, "price")
    ingredients = find_column(data, "ingredients")
    brand = find_column(data, "brand")
    skin_type = find_column(data, "skin_type")
    product_rating = find_column(data, "rating")

    check_data_quality(data, "Sephora products", [price, ingredients, product_rating])
    product_features = explain_columns(
        data,
        "Sephora products",
        product_rating,
        [price, brand, skin_type, ingredients],
        {
            price: "Product cost; useful for budget-aware product recommendations.",
            brand: "Brand identity; may support brand preference and product comparisons.",
            skin_type: "Skin compatibility information, when supplied; potentially relevant "
            "to personalized recommendations.",
            ingredients: "Formula composition; useful for ingredient-aware recommendations "
            "and compatibility checks.",
        },
    )
    print(
        "Use-case: analyze or predict product ratings and build personalized "
        "skincare recommendations using product attributes and review evidence."
    )

    if price is not None:
        prices = numeric_series(data[price], "price")
        if prices.empty:
            print(f"\nSkipping price histogram: {price!r} has no parseable numeric values.")
        else:
            plt.figure(figsize=(9, 5))
            sns.histplot(prices, bins=30, kde=True, color="teal")
            plt.title("Distribution of Sephora Product Prices")
            plt.xlabel("Price (USD or source currency)")
            plt.ylabel("Number of products")
            save_chart(CHARTS_DIR / "sephora" / "price_histogram.png")
            interpretation = (
                f"Product prices have a median of {prices.median():.2f} and a mean of "
                f"{prices.mean():.2f}. The distribution is "
                f"{'right-skewed' if prices.skew() > 0.5 else 'left-skewed' if prices.skew() < -0.5 else 'approximately symmetric'}, "
                "so use robust summaries and consider budget segments when preparing "
                "recommendations."
            )
            print(f"\nPrice-histogram interpretation:\n{interpretation}")
    else:
        prices = pd.Series(dtype=float)
        print("\nPrice histogram not created: no recognized price column was found.")

    return {
        "brand_column": brand,
        "features": product_features,
        "ingredients_column": ingredients,
        "price_column": price,
        "prices": prices,
        "product_rating_column": product_rating,
        "skin_type_column": skin_type,
    }


def analyze_sephora_ratings(
    data: pd.DataFrame, ratings_source: str, quality_checked: bool = False
) -> dict[str, object]:
    """Check rating quality and create a ratings box plot."""
    rating = find_column(data, "rating")
    if rating is None:
        print(
            f"\nNo recognized rating column was found in the {ratings_source} table. "
            "The ratings box plot and rating-based finding will be skipped."
        )
        return {"rating_column": None, "ratings": pd.Series(dtype=float)}

    print(f"\nRating source: {ratings_source} table, column {rating!r}")
    if not quality_checked:
        check_data_quality(data, f"Sephora {ratings_source} ratings", [rating])
    ratings = numeric_series(data[rating], "rating")
    if ratings.empty:
        print(f"\nSkipping ratings box plot: {rating!r} has no numeric values.")
        return {"rating_column": rating, "ratings": ratings}

    plt.figure(figsize=(8, 4))
    sns.boxplot(x=ratings, color="cornflowerblue")
    plt.title("Distribution of Sephora Product Ratings")
    plt.xlabel("Rating")
    plt.ylabel("Distribution")
    save_chart(CHARTS_DIR / "sephora" / "ratings_box_plot.png")
    q1, median, q3 = (float(value) for value in ratings.quantile([0.25, 0.5, 0.75]))
    outliers = int(
        (
            (ratings < q1 - 1.5 * (q3 - q1))
            | (ratings > q3 + 1.5 * (q3 - q1))
        ).sum()
    )
    interpretation = (
        f"The median rating is {median:.2f}, and the middle half of ratings spans "
        f"{q1:.2f} to {q3:.2f}. The box plot flags {outliers} potential outlier rating(s); "
        "inspect their records and rating scale before using ratings as a model target."
    )
    print(f"\nRatings-box-plot interpretation:\n{interpretation}")
    return {"rating_column": rating, "ratings": ratings}


def analyze_sephora_brands(data: pd.DataFrame, brand: str | None) -> dict[str, object]:
    """Plot the most represented brands and report their share."""
    if brand is None:
        print("\nTop-brand chart not created: no recognized brand column was found.")
        return {"brand_counts": pd.Series(dtype="int64")}

    names = data[brand].astype("string").fillna("<Missing>")
    counts = names.value_counts().head(TOP_BRANDS)
    if counts.empty:
        print("\nTop-brand chart not created: the brand column has no values.")
        return {"brand_counts": counts}

    plt.figure(figsize=(10, 6))
    sns.barplot(x=counts.values, y=counts.index.astype(str), color="darkseagreen")
    plt.title(f"Top {len(counts)} Sephora Brands by Product Count")
    plt.xlabel("Number of products")
    plt.ylabel("Brand")
    save_chart(CHARTS_DIR / "sephora" / "top_brands.png")
    total_products = max(int(names.notna().sum()), 1)
    share = float(counts.iloc[0] / total_products)
    interpretation = (
        f"{counts.index[0]} has the most products in the displayed top-{len(counts)} "
        f"brands ({counts.iloc[0]} products, about {share:.1%} of rows). "
        "Brand representation can affect recommendation coverage, so compare brand "
        "frequency with product diversity and user preference data."
    )
    print(f"\nTop-brands chart interpretation:\n{interpretation}")
    return {"brand_counts": counts, "top_brand_share": share}


def report_overall_findings(
    ham: dict[str, object],
    sephora_products: dict[str, object],
    sephora_ratings: dict[str, object],
    sephora_brands: dict[str, object],
) -> None:
    """Summarize three observations across both sources and their next-stage use."""
    print(f"\n{'=' * 78}\nSUMMARY: FINDINGS AND NEXT STEPS\n{'=' * 78}")

    class_counts = ham["class_counts"]
    assert isinstance(class_counts, pd.Series)
    class_share = float(ham["largest_class_share"])
    print(
        f"1. HAM10000 class distribution: {ham['largest_class']} is the largest "
        f"diagnostic class ({class_share:.1%} of records). Next: use a stratified split "
        "where appropriate, and select class-aware metrics and imbalance handling "
        "during screening-model training."
    )

    prices = sephora_products["prices"]
    assert isinstance(prices, pd.Series)
    if prices.empty:
        print(
            "2. Sephora price coverage: no usable numeric price values were found. "
            "Next: verify the source price column and normalize its format before "
            "budget-aware recommendation modeling."
        )
    else:
        skew = float(prices.skew())
        spread = (
            "right-skewed"
            if skew > 0.5
            else "left-skewed"
            if skew < -0.5
            else "approximately symmetric"
        )
        print(
            f"2. Sephora price distribution: median price is {prices.median():.2f} "
            f"and prices are {spread} (skewness {skew:.2f}). Next: inspect currency "
            "and extreme values, then consider robust scaling or price bands."
        )

    ratings = sephora_ratings["ratings"]
    assert isinstance(ratings, pd.Series)
    if not ratings.empty:
        print(
            f"3. Sephora ratings: {len(ratings)} numeric ratings are available, with "
            f"median {ratings.median():.2f} and standard deviation "
            f"{ratings.std():.2f}. Next: inspect rating sparsity and distribution, "
            "then define a rating-prediction or ranking target."
        )
    else:
        ingredients = sephora_products["ingredients_column"]
        brand_counts = sephora_brands["brand_counts"]
        assert isinstance(brand_counts, pd.Series)
        if not brand_counts.empty:
            print(
                f"3. Sephora brand coverage: {brand_counts.index[0]} is the most "
                "represented brand among the displayed products. Next: assess brand "
                "imbalance and confirm sufficient product and user-rating data for "
                "personalized recommendations."
            )
        elif ingredients is not None:
            print(
                "3. Sephora recommendation inputs: ingredients are available as a "
                "product feature, but numeric ratings were not found. Next: verify "
                "whether a separate review table supplies user feedback."
            )
        else:
            print(
                "3. Sephora review evidence: no numeric rating column or brand summary "
                "was available. Next: verify the products/reviews files and their "
                "column names before modeling recommendations."
            )

    print(
        "\nThe HAM10000 and Sephora datasets serve different tasks and should be "
        "preprocessed and modeled separately. A shared system can connect their "
        "outputs at the application layer, but product recommendations are not a "
        "substitute for medical diagnosis or clinical advice."
    )


def main() -> None:
    """Run the complete two-source dataset exploration pipeline."""
    ham_metadata = load_csv(HAM_METADATA_PATH, "HAM10000 metadata")
    sephora_products = load_csv(SEPHORA_PRODUCTS_PATH, "Sephora products")
    sephora_reviews = (
        load_csv(SEPHORA_REVIEWS_PATH, "Sephora reviews")
        if SEPHORA_REVIEWS_PATH is not None
        else None
    )

    ham_results = analyze_ham(ham_metadata)
    product_results = analyze_sephora_products(sephora_products)

    if sephora_reviews is not None:
        inspect_dataset(sephora_reviews, "PART 2 — Sephora reviews")
        review_rating = find_column(sephora_reviews, "rating")
        review_critical = [review_rating]
        check_data_quality(sephora_reviews, "Sephora reviews", review_critical)
        review_features = [
            find_column(sephora_reviews, "skin_type"),
            find_column(sephora_reviews, "rating"),
        ]
        explain_columns(
            sephora_reviews,
            "Sephora reviews",
            review_rating,
            review_features,
            {
                review_rating: "User feedback; it can support rating prediction or "
                "product ranking.",
                find_column(sephora_reviews, "skin_type"): "Reviewer skin type, if "
                "recorded; potentially useful for personalization.",
            },
        )
        rating_results = analyze_sephora_ratings(
            sephora_reviews, "reviews", quality_checked=True
        )
        if rating_results["rating_column"] is None:
            rating_results = analyze_sephora_ratings(sephora_products, "products")
    else:
        rating_results = analyze_sephora_ratings(sephora_products, "products")

    brand_results = analyze_sephora_brands(
        sephora_products, product_results["brand_column"]
    )
    report_overall_findings(
        ham_results, product_results, rating_results, brand_results
    )


if __name__ == "__main__":
    main()
