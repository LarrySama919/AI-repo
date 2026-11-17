# Skinwise

Skinwise is an educational image project with three separate classifiers and a browser dashboard. It is not a medical device and does not diagnose conditions.

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

The password in the credential screenshot should be considered exposed. Ask the
database owner to reset it before connecting, then use only the rotated value.
Install dependencies from `requirements.txt` and copy the placeholder template:

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force certs
```

Fill `.env` using the fresh TiDB connection details. Use the full TiDB username
(including its prefix) and keep the password quoted because it may contain
special characters. `.env` is ignored by Git; do not share or commit it.

Download the CA certificate from TiDB's Connect dialog. Set `DB_SSL_CA` to
its absolute path (use forward slashes on Windows), or place it at
`certs/isrgrootx1.pem`. Relative paths resolve from the repository root.
The connection verifies the CA and server hostname and requires TLS.
`.env` files and `certs/` are ignored by Git. Never put secrets in frontend JS.
If the connection is rejected, ask the database owner to confirm that this
computer's public IP is allowed by the TiDB cluster's network access settings.

### User registration and login

Set `AUTH_TOKEN_SECRET` in `.env` to a new random value (at least 32 bytes); do
not reuse the database password. Generate one with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

The API exposes `POST /api/auth/register` with JSON `{ "full_name": "...",
"email": "...", "password": "..." }` and `POST /api/auth/login` with
`{ "email": "...", "password": "..." }`. Passwords must be 12–128
characters. Passwords are stored as scrypt hashes; the API uses parameterized
SQL and the existing verified TLS connection. New accounts use the database
defaults (`role=user`, `email_verified=0`, `account_status=active`); clients
cannot choose their role. Successful responses include a 30-minute bearer
token and public user fields, never the password hash. Duplicate registration
returns 409; invalid login returns a generic 401. Email verification and
rate-limiting are not implemented yet. Do not expose these endpoints publicly
until you add rate limiting and email verification.

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

The project has **3 image datasets used to train 3 classifier artifacts**:

1. **HAM10000** — 10,015 dermatoscopic images across 7 lesion classes. It backs `skin_disease_model.keras` for the condition-analysis path.
2. **Facial Skin (Acne, Pigmentation, Pores, Wrinkles)** — 4,233 labeled images downloaded from Kaggle under the dataset's listed Apache 2.0 license. Exact duplicate images were removed before splitting; 4,094 unique images remained after removing duplicates and conflicting-label copies. These were split into 3,275 training, 409 validation and 410 held-out test images. It backs `skin_cosmetic_model.keras`, a separate 8-class classifier. The current saved report records 85.1% accuracy on that held-out split; this is not clinical validation.

The cosmetic model reuses the frozen MobileNetV2 feature backbone contained in the existing lesion model and trains a new classification head. The saved training report records its class counts, split sizes, per-class metrics and held-out test results.

The cosmetic dataset includes separate blackheads, dark spots and broad pigmentation labels. The old `pigmentation` images must not be copied or randomly divided into melasma/non-melasma classes. Review them individually: put confirmed cases in `melasma`, confirmed non-melasma cases in `other pigmentation`, and leave uncertain images out of the training folders. If both a new `melasma` folder and the old broad `pigmentation` folder remain, the training script stops with an explanation. MEMI-DS is a research melasma segmentation dataset with 716 annotated images; its masks are useful for locating regions, but it is not a ready-made melasma-vs-other classifier. Review access and license terms before use. Folder labels are not a substitute for clinical validation.

Use this structure for the facial concern data. The class folder names become the model labels. Keep the out-of-distribution (OOD) examples separate from the class folders; they are only used to tune and evaluate the Unknown/Uncertain gate.

```text
dataset/facial_skin_concerns/
  images/
    dark spots/
    inflammatory acne/
    non inflammatory acne black heads/   # add more verified blackhead photos here
    non inflammatory acne white heads/
    melasma/                              # only verified melasma examples
    other pigmentation/                   # only reviewed, non-melasma examples
    pores/
    Redness/
    wrinkles/
    _unreviewed_pigmentation/             # excluded; never treated as a class
  unknown_calibration/                    # representative unsupported/OOD images
  unknown_test/                           # separate OOD examples for final evaluation
```

The `images/` class set should not contain both the legacy broad `pigmentation/` class and `melasma/`. The script ignores class folders starting with `_`, so unreviewed data can be retained there while it is awaiting reliable labels. Add only images whose labels and usage rights are clear. For stronger evaluation, keep images from the same person/source together in a single split; do not let near-duplicates cross splits.

If using MEMI-DS, keep its source photos and segmentation masks outside the class folders. The current classifier loader treats every image under a class folder as a separate classification photograph; it would incorrectly learn from mask files placed there. To train a classifier from MEMI-DS, first create documented image-level labels and suitable non-melasma examples. To use the masks for region localization, build and evaluate a separate segmentation model.

Amazon Beauty is an optional source in `eda.py` for product and review analysis. It is not an image dataset, is not stored locally in this project, and was not used to train either classifier.

## Train the models

HAM10000 model training and comparison:

```powershell
python train_model.py
```

This compares a custom CNN with MobileNetV2 and saves the validation-selected model to `skin_disease_model.keras`. It expects HAM10000 metadata and images in `dataset/Skin Cancer MNIST HAM10000/`.

Cosmetic image classifier:

```powershell
python train_cosmetic_model.py --epochs 15 --batch-size 32 --max-ood-accept-rate 0.05
```

The script uses `dataset/facial_skin_concerns/images/`, normalizes mixed image formats to RGB, removes exact duplicates and conflicting-label copies, creates stratified train/validation/test splits, trains the classifier and writes the model, labels, report, and `skin_cosmetic_threshold.json`. It requires separate `unknown_calibration/` and `unknown_test/` images. Use diverse unsupported inputs from the same intended camera workflow, such as normal skin, untrained skin conditions, non-skin photos, and unusable/blurry images. The threshold is chosen on the known validation and OOD calibration sets to limit the observed OOD acceptance rate (default target 5%) while retaining as many known validation images as possible. The untouched OOD test folder reports how often the gate rejects unsupported images. Generated normalized image caches stay under `dataset/facial_skin_concerns/` and are rebuilt by the script.

At inference, the cosmetic API returns `predicted_class: "unknown"` when its top softmax score is below the calibrated threshold; `candidate_class` preserves the model's top label for explanation. This maximum-softmax gate is a heuristic: it only measures behavior on the supplied OOD examples and cannot guarantee that every unfamiliar image will be rejected. The condition/lesion model still needs its own separately calibrated OOD threshold before it can make an equivalent Unknown/Uncertain claim.

## Safety and scope

- The cosmetic classifier's labels reflect its dataset folders, not medical diagnoses. Melasma should only appear as its own class after reliable per-image labeling; do not split the old broad pigmentation folder by guesswork.
- The seven-class lesion model's confidence is not a calibrated cancer probability. The interface must not display it as cancer risk.
- No model should be used to choose medical treatment or delay professional care. Seek a qualified clinician for concerning skin, hair or scalp symptoms.
- The dashboard stores report summaries in this browser's local storage. It currently has no accounts, cloud history, or connected product/review database; product listings and reviews are sample demo content.
