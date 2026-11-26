# Skinwise project flow

## What the project does

Skinwise is an educational skin and hair image analysis web application. A browser dashboard sends an image to a FastAPI backend, which runs one or more TensorFlow/Keras classifiers and returns informational labels, confidence values, guidance, and (in eligible skincare scans) sample product suggestions. Separate Admin and Moderator screens manage users, products, reviews, and reports through authenticated API routes. It is not a medical device and does not diagnose or rule out disease.

## Main components

| Area | Main files | Purpose |
| --- | --- | --- |
| API and model inference | `main.py` | Starts FastAPI, loads model/catalog artifacts, handles auth and image-analysis endpoints, serves `frontend/`. |
| Database and authentication | `database.py` | Creates verified-TLS TiDB connections, checks the DB, hashes passwords with scrypt, registers/authenticates users, and signs 30-minute bearer tokens. |
| Staff APIs | `admin_api.py` | Admin and moderator authorization, dashboards, user/product/review/report operations, and audit logging. |
| User interface | `frontend/User/` | User dashboard, scan wizard, webcam capture, result display, history, and progress views. |
| Staff interfaces | `frontend/Admin/`, `frontend/Moderator/` | Staff dashboards that call the corresponding protected API endpoints. |
| Model training | `train_model.py`, `train_cosmetic_model.py`, `train_hair_model.py` | Prepare, train, evaluate, and save the three model artifacts and their metadata. |
| Data exploration | `eda.py`, `create_image_dataset_csvs.py` | HAM10000 and optional Amazon Beauty exploratory analysis; generate CSV indexes for image datasets. |
| Product catalog | `skincare_products.json` | Local label-to-concern and sample product mappings used by skin analysis. |

## Datasets and what uses them

### HAM10000

- Expected at `dataset/Skin Cancer MNIST HAM10000/`, with `HAM10000_metadata.csv` and two image folders (`HAM10000_images_part_1/`, `HAM10000_images_part_2/`).
- Contains 10,015 dermatoscopic images in seven lesion categories: `akiec`, `bcc`, `bkl`, `df`, `mel`, `nv`, and `vasc`.
- Trains `skin_disease_model.keras` using `train_model.py`. The script compares a custom CNN with MobileNetV2 using grouped train/validation/test splits, then saves the validation-selected model and evaluation charts/reports.
- Used in condition analysis and as the frozen feature backbone for the hair and cosmetic heads.

### Facial skin concerns

- Expected labeled folders under `dataset/facial_skin_concerns/images/`; separate `unknown_calibration/` and `unknown_test/` folders hold unsupported/OOD examples.
- The project documentation records 4,233 source images, reduced to 4,094 unique, non-conflicting images before split (3,275 train, 409 validation, 410 held-out test). The saved classifier has eight labels: `dark spots`, `inflammatory acne`, `non inflammatory acne black heads`, `non inflammatory acne white heads`, `pigmentation`, `pores`, `Redness`, and `wrinkles`.
- Trains `skin_cosmetic_model.keras` with `train_cosmetic_model.py`; it reuses a frozen MobileNetV2 backbone, writes `skin_cosmetic_labels.json`, a report and a calibrated `skin_cosmetic_threshold.json`.
- The API uses that threshold as a maximum-softmax Unknown/Uncertain heuristic. The README reports 85.1% held-out accuracy; this is dataset performance, not clinical validation.
- Note: the README describes a newer proposed folder setup including separate melasma and other-pigmentation classes. The checked-in label artifact still has the eight classes above, with broad `pigmentation`; those newer classes are not in the active model.

### Hair and scalp

- Prepared splits are under `dataset/Hair Diseases/{train,val,test}/`, with ten matching class folders: Alopecia Areata, Contact Dermatitis, Folliculitis, Head Lice, Lichen Planus, Male Pattern Baldness, Psoriasis, Seborrheic Dermatitis, Telogen Effluvium, and Tinea Capitis.
- Trains `skin_hair_disease_model.keras` using `train_hair_model.py`. It requires every split to have the same class folders, normalizes images, applies training augmentation, reuses a frozen MobileNetV2 backbone, evaluates on test, and writes `skin_hair_labels.json` plus a report.
- This model is loaded for `/api/predict` with mode `hair`.

### Nail images

- `dataset/Nail Disease Detection/data/` exists and contains `train/` and `validation/` folders.
- No nail model artifact, nail training script, or nail inference route is currently wired into the application. Treat this as present data for future work, not an active feature.

### Other analysis data

- `eda.py` can optionally download/use the Amazon Reviews 2023 `All_Beauty` product/review data through Hugging Face datasets for exploratory charts and summaries. It is not locally bundled, not an image classifier dataset, and is not connected to live product recommendations.
- `skincare_products.json` is a small local demonstration catalog, not the Amazon dataset.

## Training flow

1. Put source images and metadata in the expected dataset folders. Folder names define labels for the directory-based loaders; verify labels and usage rights before training.
2. Run the relevant training script. HAM10000 compares architectures; cosmetic training removes exact duplicates/conflicting copies, creates stratified splits, and calibrates its Unknown gate with OOD calibration images; hair training consumes prepared splits.
3. Each script evaluates on a held-out test set and writes a `.keras` model plus label/report files (and threshold for cosmetic training).
4. `main.py` loads available model files at process startup. Restart the API after replacing artifacts. The dataset itself is not needed for inference.

## Runtime flow: user scan

1. The user opens `frontend/User/dashboard.html`. The dashboard's `user.js` drives mode selection, image upload or webcam capture, scan progress, result rendering, history, and progress tracking.
2. For hair mode, the browser posts multipart image data and mode `hair` to `POST /api/predict`. For skin, it posts to `POST /api/analyze-skin` with mode `skincare` or `condition`.
3. The API reads the image, converts it to RGB, resizes to 128×128, scales pixels to `[0,1]`, and adds a batch dimension. The serialized models contain their own MobileNet rescaling where applicable.
4. The selected Keras model returns class scores. The API picks the largest score. Cosmetic predictions are accepted only when the score meets the calibrated threshold; otherwise the displayed class becomes `unknown` while the candidate is retained. Lesion predictions are marked Unknown/uncertain because no disease threshold is currently bundled. Hair predictions currently return the highest-scoring class without an OOD threshold.
5. `/api/analyze-skin` runs both lesion and cosmetic models. It flags lesion candidates `mel`, `bcc`, or `akiec` for professional review and suppresses product tips/recommendations in condition mode, for uncertain cosmetic output, or for those lesion candidates. Otherwise it maps the cosmetic label to general tips and matching entries in `skincare_products.json`.
6. The dashboard displays the response and saves scan summaries in browser `localStorage` under `skinwise.scans`. This history is device/browser-local; scan images and history are not currently persisted to TiDB.

## Runtime flow: accounts and staff

1. `POST /api/auth/register` validates name/email/password, hashes the password with scrypt, inserts a user row, and returns a signed bearer token. `POST /api/auth/login` verifies the stored hash and active status, then returns a token. Tokens expire after 30 minutes.
2. The API uses `database.py` to connect to TiDB with TLS 1.2+, CA and hostname verification, parameterized SQL, and short-lived per-operation connections. `.env` supplies credentials and the token secret; the API can start when TiDB is unavailable, while DB health reports failure.
3. Admin and Moderator frontends send bearer tokens to `/api/admin/...` and `/api/moderator/...`. `admin_api.py` verifies token signatures/expiry and role before returning or modifying staff data. Admin endpoints cover overview, users, moderators, products, scans/analysis summaries, issues, support/review reports, logs, profile, and product reviews. Moderator routes provide a narrower subset.

The repository does not automatically create or migrate database tables. The connected TiDB schema must already exist. Although staff routes support database-backed scan/report/review summaries and product management, the end-user scan flow does not write scan history to the database. User scan history is local storage.

## Important API routes

| Route | Role |
| --- | --- |
| `GET /` | API/model load status. |
| `GET /api/health/database` | Read-only TiDB/TLS health check. |
| `POST /api/auth/register`, `POST /api/auth/login` | Account creation and login. |
| `POST /api/analyze-skin` | Combined skin-condition and cosmetic analysis, tips, optional catalog matches. |
| `POST /api/predict` | Single condition, skincare, or hair classifier prediction. |
| `/api/admin/*` | Protected admin management and reporting. |
| `/api/moderator/*` | Protected moderator workflows. |

FastAPI also serves the browser application at `/frontend/...`. Run locally with `python -m uvicorn main:app --reload`, then open `/frontend/User/dashboard.html`.

## Limitations and project status

- Predictions are educational image-model outputs, not diagnoses, probabilities of cancer, or treatment advice.
- Cosmetic OOD rejection is a heuristic calibrated on supplied examples. The lesion model has no calibrated Unknown threshold, and hair does not yet expose one.
- Dataset folder labels and benchmark metrics do not establish clinical validity.
- The older `/api/predict` endpoint performs less defensive image validation than `/api/analyze-skin`; the main dashboard's skin flow uses `/api/analyze-skin`.
- Email verification and rate limiting are not implemented for account endpoints; do not expose registration/login publicly without adding them.
- The Admin UI includes a dataset-management view, but that should not be confused with a live training pipeline unless connected to backend functionality.

