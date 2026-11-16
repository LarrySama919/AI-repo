import io
import json
from pathlib import Path
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
import tensorflow as tf

app = FastAPI(title="Skinwise AI API", version="1.0")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define class names (Update these if your HAM10000 classes differ)
CLASS_NAMES = ['akiec', 'bcc', 'bkl', 'df', 'mel', 'nv', 'vasc']
COSMETIC_CLASS_NAMES = [
    "Redness",
    "dark spots",
    "inflammatory acne",
    "non inflammatory acne black heads",
    "non inflammatory acne white heads",
    "pigmentation",
    "pores",
    "wrinkles",
]

# Load the trained Keras model
MODEL_PATH = Path(__file__).resolve().parent / "skin_disease_model.keras"
model = None
cosmetic_model = None

try:
    if MODEL_PATH.is_file():
        # Load model without compiling optimizer to avoid version mismatches
        model = tf.keras.models.load_model(MODEL_PATH, compile=False)
        print(f"Successfully loaded model from {MODEL_PATH}")
    else:
        print(f"Warning: Model file not found at {MODEL_PATH}")
except Exception as e:
    print(f"Error loading model: {e}")

COSMETIC_MODEL_PATH = Path(__file__).resolve().parent / "skin_cosmetic_model.keras"
try:
    if COSMETIC_MODEL_PATH.is_file():
        cosmetic_model = tf.keras.models.load_model(COSMETIC_MODEL_PATH, compile=False)
        labels_path = Path(__file__).resolve().parent / "skin_cosmetic_labels.json"
        if labels_path.is_file():
            COSMETIC_CLASS_NAMES = json.loads(labels_path.read_text(encoding="utf-8"))
        print(f"Successfully loaded cosmetic model from {COSMETIC_MODEL_PATH}")
    else:
        print(f"Cosmetic model not found at {COSMETIC_MODEL_PATH}")
except Exception as e:
    print(f"Error loading cosmetic model: {e}")

@app.get("/")
def read_root():
    return {"message": "Skinwise AI Backend is running!", "model_loaded": model is not None}

@app.post("/api/predict")
async def predict_skin(file: UploadFile = File(...), mode: str = Form("condition")):
    if mode not in {"condition", "skincare"}:
        raise HTTPException(status_code=422, detail="Mode must be 'condition' or 'skincare'.")
    active_model = cosmetic_model if mode == "skincare" else model
    active_class_names = COSMETIC_CLASS_NAMES if mode == "skincare" else CLASS_NAMES
    if active_model is None:
        raise HTTPException(status_code=503, detail=f"The {mode} model is not loaded on the server.")
    
    try:
        # Read image file bytes
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        # Resize to match training configuration (128x128)
        image = image.resize((128, 128))
        image_array = np.array(image, dtype=np.float32)
        
        # Both saved Keras models include their [0, 1] to [-1, 1] rescaling layer.
        image_array = image_array / 255.0
        
        # Add batch dimension: shape (1, 128, 128, 3)
        input_tensor = np.expand_dims(image_array, axis=0)
        
        # Run inference
        predictions = active_model.predict(input_tensor)
        predicted_index = int(np.argmax(predictions[0]))
        confidence = float(np.max(predictions[0]))
        
        predicted_class = active_class_names[predicted_index] if predicted_index < len(active_class_names) else "unknown"
        
        return {
            "success": True,
            "mode": mode,
            "predicted_class": predicted_class,
            "confidence": confidence,
            "all_probabilities": {active_class_names[i]: float(predictions[0][i]) for i in range(len(active_class_names))}
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image processing failed: {str(e)}")

# Optional: Serve frontend static files directly if needed
frontend_path = Path(__file__).resolve().parent / "frontend"
if frontend_path.is_dir():
    app.mount("/frontend", StaticFiles(directory=str(frontend_path)), name="frontend")
