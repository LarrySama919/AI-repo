# AI Model Development & Evaluation — Skin Cancer Classification (HAM10000)

This repository contains the dataset preprocessing, training, and evaluation scripts for Assignment 3 (Skin Cancer Detection using HAM10000 metadata & images).

---

## 📌 Model Evaluation & Unseen Data Testing Strategy (Important Requirement)

To ensure strict evaluation compliance:
- **No Training Data Evaluation Leakage:** The model was strictly **NOT** evaluated on the training set alone.
- **Data Splitting Strategy:** 
  - The HAM10000 dataset was split into **80% Training**, **10% Validation**, and **10% Hold-out Test set** using stratified sampling based on diagnostic classes (`dx`).
- **Unseen Data Testing:** 
  - All reported metrics (Accuracy, Precision, Recall, F1-score, Confusion Matrix) were computed exclusively on the **unseen 10% test set** that was never exposed to the model during training or hyperparameter tuning.
- **Model Comparison:** 
  - We trained and evaluated both a **Custom CNN** baseline and a pre-trained **MobileNetV2** (Transfer Learning) on the same unseen test split. MobileNetV2 was selected as the final deployment model (`skin_disease_model.keras`).

---

## 🛠️ Prerequisites & Setup

### 1. Environment Setup
```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt