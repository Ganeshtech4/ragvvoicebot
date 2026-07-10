import os
import logging
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import edge_tts

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-service")

app = FastAPI(title="Edge-TTS Service")

class SpeakRequest(BaseModel):
    text: str
    voice: str = None

@app.post("/speak")
async def speak(request: SpeakRequest):
    text = request.text.strip()
    if not text:
        logger.warning("Received empty text for synthesis")
        raise HTTPException(status_code=400, detail="Text cannot be empty")
        
    voice = request.voice or os.getenv("TTS_VOICE", "en-US-AvaNeural")
    logger.info(f"Synthesizing text: '{text[:50]}...' using voice: '{voice}'")
    
    try:
        communicate = edge_tts.Communicate(text, voice)
        
        async def audio_generator():
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
                    
        return StreamingResponse(audio_generator(), media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"TTS synthesis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health():
    return {"status": "ok"}
