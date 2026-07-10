import os
import tempfile
import logging
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("whisper-service")

app = FastAPI(title="Faster-Whisper STT Service")

# Model configuration
model_size = os.getenv("WHISPER_MODEL", "tiny")
# CPU float32 is the safest default choice for local CPU inference in Docker
compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "float32")

logger.info(f"Initializing Faster-Whisper model '{model_size}' on CPU with compute type '{compute_type}'...")
try:
    model = WhisperModel(model_size, device="cpu", compute_type=compute_type)
    logger.info("Faster-Whisper model loaded successfully.")
except Exception as e:
    logger.error(f"Failed to load Faster-Whisper model: {e}")
    raise e

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")
        
    logger.info(f"Received transcription request for file: {file.filename}")
    
    try:
        suffix = os.path.splitext(file.filename)[1] if file.filename else ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name

        try:
            logger.info("Starting transcription...")
            segments, info = model.transcribe(temp_path, beam_size=5)
            text = "".join(segment.text for segment in segments).strip()
            logger.info(f"Transcription completed. Result: '{text}'")
            return {"text": text}
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    except Exception as e:
        logger.error(f"Error during transcription: {e}")
        return JSONResponse(status_code=500, content={"detail": f"Transcription error: {str(e)}"})

@app.get("/health")
def health():
    return {"status": "ok", "model": model_size}

