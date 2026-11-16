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