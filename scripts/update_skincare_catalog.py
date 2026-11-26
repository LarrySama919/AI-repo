#!/usr/bin/env python3
"""Enrich the Skinwise demo catalog from a beauty dataset export or HF sample.

The HF sample is licensed CC BY-NC 4.0. Use this enrichment only where that
license permits. This script adds catalog metadata only; it does not download
images or assert that dataset products are clinically appropriate.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "skincare_products.json"
DATASET_ID = "thebeautyapi/beautyproducts"
IMAGE_BASE = "https://huggingface.co/datasets/thebeautyapi/beautyproducts/resolve/main/images/"
BUCKETS = ("acne", "oily_skin", "dryness", "hyperpigmentation", "sensitive_skin", "general")
FALLBACKS = {
    "Cleanser": "/frontend/assets/products/cleanser.svg",
    "Moisturizer": "/frontend/assets/products/moisturizer.svg",
    "Sun protection": "/frontend/assets/products/sunscreen.svg",
    "Treatment": "/frontend/assets/products/hydration.svg",
    "Other": "/frontend/assets/products/default-product.svg",
}
NOISY_METADATA = re.compile(
    r"incorrect[- ]product[- ]type|non[- ]food[- ]products?|open[- ]beauty[- ]facts(?:[- ]item)?",
    re.IGNORECASE,
)
LEGACY_SOURCE_DESCRIPTION = re.compile(
    r"\bitem\. Check the product label for ingredients and directions\.$",
    re.IGNORECASE,
)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8-sig") as stream:
        for number, line in enumerate(stream, 1):
            if line.strip():
                value = json.loads(line)
                if isinstance(value, dict):
                    rows.append(value)
                else:
                    raise ValueError(f"JSONL row {number} is not an object")
    return rows


def read_csv(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def load_rows(source: Path | None) -> list[dict[str, Any]]:
    if source is not None:
        if source.suffix.casefold() == ".csv":
            return read_csv(source)
        if source.suffix.casefold() in {".jsonl", ".ndjson"}:
            return read_jsonl(source)
        value = json.loads(source.read_text(encoding="utf-8-sig"))
        return value if isinstance(value, list) else value.get("data", [])

    try:
        from datasets import load_dataset
    except ImportError as exc:
        raise RuntimeError(
            "Install the optional 'datasets' package, or pass --source with a local CSV/JSONL/JSON export."
        ) from exc
    try:
        dataset = load_dataset(DATASET_ID, split="train")
    except Exception as exc:
        raise RuntimeError(
            f"Could not load {DATASET_ID} from Hugging Face ({exc}). "
            "Check network access or pass --source with a local CSV/JSONL/JSON export."
        ) from exc
    return [dict(row) for row in dataset]


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def first_value(row: dict[str, Any], *keys: str) -> str:
    """Read the first non-empty value across common dataset field names."""
    normalized = {str(key).casefold().replace("-", "_"): value for key, value in row.items()}
    for key in keys:
        value = text(normalized.get(key.casefold().replace("-", "_"))).strip()
        if value and value.casefold() not in {"nan", "none", "null"}:
            return value
    return ""


def joined_values(row: dict[str, Any], *keys: str) -> str:
    values = []
    for key in keys:
        value = first_value(row, key)
        if value and value not in values:
            values.append(value)
    return " ".join(values)


def classify(row: dict[str, Any]) -> list[str]:
    category_group = first_value(row, "category_group", "category", "product_category").casefold()
    category_detail = joined_values(row, "subcategory", "categories", "categories_tags", "labels", "labels_tags")
    name = first_value(row, "product_name", "name", "title", "product_title", "generic_name")
    description = joined_values(row, "description", "product_description", "benefits", "generic_name", "tags")
    ingredients = first_value(row, "ingredients_raw", "ingredients_text", "ingredients", "ingredient_list")
    all_text = " ".join((category_group, category_detail, name, description, ingredients)).casefold()

    # These labels are data-source/import boilerplate, not product attributes.
    if NOISY_METADATA.search(all_text):
        return []

    # Open Beauty Facts has broad groups (e.g. Hygiene and Makeup) and a few
    # miscategorized rows, so require skincare context and explicitly skip
    # non-facial or non-skincare product types.
    category_text = f"{category_group} {category_detail}".casefold().replace("_", "-")
    is_skincare = bool(re.search(r"skin\s*care|skincare|skin-care|facial skin|face care|face-care|suncare|sun care", category_text))
    if not is_skincare:
        return []
    excluded = r"nail polish|nail varnish|nail remover|polish remover|shampoo|conditioner|hair care|haircare|perfume|eau de (?:parfum|toilette)|deodorant|toothpaste|oral care|shower gel|body wash|bath product|lipstick|mascara|foundation|eyeshadow"
    if re.search(excluded, all_text):
        return []
    if first_value(row, "obsolete").casefold() in {"1", "true", "yes"}:
        return []
    if re.search(r"prescription|medicated|medicinal|drug product", all_text):
        return []

    # Every accepted facial-care item is also a general routine option; more
    # specific buckets are added only when the source text supports them.
    buckets: list[str] = []
    if re.search(r"acne|blemish|pimple|comed|spot treatment|salicylic acid|benzoyl peroxide|anti[- ]?acne", all_text):
        buckets.append("acne")
    if re.search(r"oil control|oily|mattif|sebum|pore|charcoal|kaolin|clay mask", all_text):
        buckets.append("oily_skin")
    if re.search(r"dry|dehydrat|hydrating|moisturi[sz]|barrier|cream|hyaluronic acid|glycerin", all_text):
        buckets.append("dryness")
    if re.search(r"hyperpigment|dark spot|brighten|discolor|uneven tone|vitamin c|niacinamide|glycolic acid", all_text):
        buckets.append("hyperpigmentation")

    hypoallergenic = first_value(row, "is_hypoallergenic", "hypoallergenic").casefold() in {"1", "true", "yes"}
    fragrance_free = first_value(row, "fragrance_free", "is_fragrance_free").casefold() in {"1", "true", "yes"}
    if hypoallergenic or fragrance_free or re.search(
        r"fragrance[- ]free|without perfume|sensitive skin", all_text
    ):
        buckets.append("sensitive_skin")

    # General catches gentle daily cleansers, micellar waters, masks, and other
    # face-care maintenance products even when no concern label is supplied.
    buckets.append("general")
    return list(dict.fromkeys(buckets))


def slug(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return result[:72].strip("-") or "beauty-product"


def product_from_row(row: dict[str, Any], used_ids: set[str]) -> dict[str, Any] | None:
    name = " ".join(first_value(row, "product_name", "name", "title", "product_title", "generic_name").split())
    if not name:
        return None
    brand = " ".join(first_value(row, "brands", "brand", "manufacturer").split())
    base = slug(f"{brand}-{name}" if brand else name)
    product_id = base
    suffix = 2
    while product_id in used_ids:
        product_id = f"{base}-{suffix}"
        suffix += 1
    category_text = " ".join(filter(None, (
        first_value(row, "subcategory", "categories"),
        first_value(row, "category_group", "category", "product_category"),
    )))
    category_lower = category_text.casefold()
    if re.search(r"sunscreen|sun protection|suncare|spf", category_lower + " " + name.casefold()):
        category = "Sun protection"
    elif re.search(r"cleanser|face wash|micellar|cleansing", category_lower + " " + name.casefold()):
        category = "Cleanser"
    elif re.search(r"moistur|cream|lotion", category_lower + " " + name.casefold()):
        category = "Moisturizer"
    elif re.search(r"serum|toner|essence", category_lower + " " + name.casefold()):
        category = "Treatment"
    else:
        category = "Face care"
    english_descriptions = {
        "Cleanser": "Face cleanser for everyday cleansing. Check the product label for ingredients and directions.",
        "Moisturizer": "Face moisturizer for a simple daily skincare routine. Check the product label for ingredients and directions.",
        "Sun protection": "Facial sun protection for daytime use. Follow the product label and reapplication directions.",
        "Treatment": "Facial skincare treatment. Check the product label for ingredients and directions.",
        "Face care": "Facial skincare product for a simple routine. Check the product label for ingredients and directions.",
    }
    description = english_descriptions[category]
    image_url = first_value(row, "image_front_url", "image_url", "image", "image_name")
    parsed_image_url = urlparse(image_url)
    if parsed_image_url.scheme in {"https", "http"} and parsed_image_url.netloc:
        image = image_url
    elif image_url and Path(image_url).name == image_url:
        image = IMAGE_BASE + quote(image_url)
    elif category == "Sun protection":
        image = FALLBACKS["Sun protection"]
    elif category == "Cleanser":
        image = FALLBACKS["Cleanser"]
    elif category == "Moisturizer":
        image = FALLBACKS["Moisturizer"]
    elif category == "Treatment":
        image = FALLBACKS["Treatment"]
    else:
        image = FALLBACKS["Other"]
    return {
        "id": product_id,
        "name": f"{brand} {name}".strip(),
        "category": category,
        "description": description,
        "image": image,
        "concerns": [],
    }


def enrich(rows: Iterable[dict[str, Any]], catalog: dict[str, Any], per_bucket: int) -> tuple[list[dict[str, Any]], dict[str, int]]:
    products = list(catalog["products"])
    used_ids = {product["id"] for product in products}
    counts = {bucket: 0 for bucket in BUCKETS}
    signatures = {text(product.get("name")).casefold() for product in products}
    for row in rows:
        buckets = classify(row)
        if not buckets or all(counts[bucket] >= per_bucket for bucket in buckets):
            continue
        item = product_from_row(row, used_ids)
        if item is None:
            continue
        signature = item["name"].casefold()
        if signature in signatures:
            continue
        assigned = [bucket for bucket in buckets if counts[bucket] < per_bucket]
        if not assigned:
            continue
        item["concerns"] = assigned
        products.append(item)
        used_ids.add(item["id"])
        signatures.add(signature)
        for bucket in assigned:
            counts[bucket] += 1
    return products, counts


def remove_legacy_noisy_products(products: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Drop only old rows emitted with source-language/category boilerplate."""
    kept = []
    removed = 0
    for product in products:
        description = text(product.get("description"))
        product_text = " ".join(text(product.get(key)) for key in ("name", "category", "description"))
        is_noisy = bool(NOISY_METADATA.search(product_text) or LEGACY_SOURCE_DESCRIPTION.search(description))
        if is_noisy:
            removed += 1
        else:
            kept.append(product)
    return kept, removed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Local CSV, JSONL/NDJSON, or JSON export")
    parser.add_argument("--catalog", type=Path, default=CATALOG_PATH)
    parser.add_argument("--per-concern", type=int, default=5, help="Maximum new products assigned to each concern")
    parser.add_argument("--dry-run", action="store_true", help="Report counts without writing the catalog")
    args = parser.parse_args()
    if args.per_concern < 1:
        parser.error("--per-concern must be positive")
    for asset in FALLBACKS.values():
        asset_path = ROOT / "frontend" / asset.removeprefix("/frontend/")
        if not asset_path.is_file() or asset_path.stat().st_size == 0:
            raise ValueError(f"Missing or empty fallback product image: {asset_path}")

    catalog = json.loads(args.catalog.read_text(encoding="utf-8-sig"))
    if set(catalog) != {"label_to_concern", "products", "disclaimer"}:
        raise ValueError("Catalog top-level structure must remain label_to_concern, products, disclaimer")
    original_mappings = dict(catalog["label_to_concern"])
    original_disclaimer = catalog["disclaimer"]
    catalog["products"], removed_noisy = remove_legacy_noisy_products(catalog["products"])
    original_ids = {item["id"] for item in catalog["products"]}
    rows = load_rows(args.source)
    products, counts = enrich(rows, catalog, args.per_concern)
    catalog["products"] = products
    assert catalog["label_to_concern"] == original_mappings
    assert catalog["disclaimer"] == original_disclaimer
    ids = [item["id"] for item in products]
    assert len(ids) == len(set(ids)), "Product IDs must be unique"
    for item in products:
        assert set(item) == {"id", "name", "category", "description", "image", "concerns"}
        assert item["concerns"] and set(item["concerns"]).issubset(BUCKETS)

    encoded = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    # Verify UTF-8 JSON before replacing the source file.
    json.loads(encoded.encode("utf-8").decode("utf-8"))
    if not args.dry_run:
        args.catalog.write_text(encoded, encoding="utf-8", newline="\n")
    print(f"Source rows read: {len(rows)}")
    print(f"Legacy noisy products removed: {removed_noisy}")
    print(f"Products added: {sum(1 for item in products if item['id'] not in original_ids)}")
    print("Added per concern bucket:")
    for bucket in BUCKETS:
        print(f"  {bucket}: {counts[bucket]}")
    print(f"UTF-8 JSON verification: OK ({len(products)} products)")
    if args.dry_run:
        print("Dry run: catalog not written")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
