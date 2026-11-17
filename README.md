# Skinwise

Skinwise is an educational skin-image project with two separate classifiers and a browser dashboard. It is not a medical device and does not diagnose conditions.

## Run locally (Windows PowerShell)

TensorFlow officially supports Python 3.10–3.13. Python 3.12 is a good choice for a clean setup.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Open the dashboard at <http://127.0.0.1:8000/frontend/User/dashboard.html>. The API status is at <http://127.0.0.1:8000/>. The root-level model files `skin_disease_model.keras` and `skin_cosmetic_model.keras` are loaded separately by the API.

## TiDB database connection

Install dependencies from `requirements.txt`. Copy `.env.example` to `.env`
if it does not already exist. Fill `DB_USER` with the full TiDB username
(including its prefix), and `DB_PASSWORD` with the generated password.
Keep passwords quoted in `.env`; environment variables override this file.

Download the CA certificate from TiDB's Connect dialog. Set `DB_SSL_CA` to
its absolute path (use forward slashes on Windows), or place it at
`certs/isrgrootx1.pem`. Relative paths resolve from the repository root.
The connection verifies the CA and server hostname and requires TLS.
`.env` files and `certs/` are ignored by Git. Never put secrets in frontend JS.

Read-only connection check, without loading TensorFlow models:

```powershell
.\.venv\Scripts\python.exe database.py
```

After starting the API, `GET /api/health/database` returns a generic health
response (503 on failure). Restart the API after editing `.env`.
Offline checks: `python -m unittest test_database -v`.

Use `database_connection()` in synchronous backend routes; it closes and rolls
back uncommitted work on exit. Writes need an explicit `connection.commit()`.
Use parameterized SQL (`cursor.execute(sql, params)`). No tables are created or
changed automatically. Prediction history, login and reviews are not yet wired
to database persistence. Before comparison writes are added, validate that the
before/after analyses differ and belong to the requesting user; the TiDB schema
does not have `chk_comparison_different`.

## Datasets and models

The project has **2 image datasets used to train 2 classifier artifacts**:

1. **HAM10000** — 10,015 dermatoscopic images across 7 lesion classes. It backs `skin_disease_model.keras` for the condition-analysis path.
2. **Facial Skin (Acne, Pigmentation, Pores, Wrinkles)** — 4,233 labeled images downloaded from Kaggle under the dataset's listed Apache 2.0 license. Exact duplicate images were removed before splitting; 4,094 unique images remained after removing duplicates and conflicting-label copies. These were split into 3,275 training, 409 validation and 410 held-out test images. It backs `skin_cosmetic_model.keras`, a separate 8-class classifier. The trained model scored 82.9% accuracy on that held-out split; this is not clinical validation.

The cosmetic model reuses the frozen MobileNetV2 feature backbone contained in the existing lesion model and trains a new classification head. The saved training report records its class counts, split sizes, per-class metrics and held-out test results.

The cosmetic dataset includes separate `black heads`, `dark spots` and `pigmentation` folder labels. Its `pigmentation` label is broad, not melasma-specific. Folder labels are not clinician-confirmed diagnoses, so the model is for educational exploration only. Its class confidence is not a medical risk percentage.

Amazon Beauty is an optional source in `eda.py` for product and review analysis. It is not an image dataset, is not stored locally in this project, and was not used to train either classifier.

## Train the models

HAM10000 model training and comparison:

```powershell
python train_model.py
```

This compares a custom CNN with MobileNetV2 and saves the validation-selected model to `skin_disease_model.keras`. It expects HAM10000 metadata and images in `dataset/Skin Cancer MNIST HAM10000/`.

Cosmetic image classifier:

```powershell
python train_cosmetic_model.py --epochs 12 --batch-size 64
```

The script uses `dataset/facial_skin_concerns/images/`, normalizes mixed image formats to RGB, removes exact duplicates and exact images with conflicting folder labels, creates stratified train/validation/test splits, trains the classifier and writes `skin_cosmetic_model.keras`, `skin_cosmetic_labels.json` and `skin_cosmetic_training_report.json`.

## Safety and scope

- The cosmetic classifier's labels reflect its dataset folders, not medical diagnoses. Pigmentation is not a melasma-only category.
- The seven-class lesion model's confidence is not a calibrated cancer probability. The interface must not display it as cancer risk.
- Neither model should be used to choose medical treatment or delay professional care. Seek a qualified clinician for changing, bleeding, painful or concerning skin areas.
- The dashboard stores report summaries in this browser's local storage. It currently has no accounts, cloud history, or connected product/review database; product listings and reviews are sample demo content.
