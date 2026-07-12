import os
import io
import logging
from typing import BinaryIO

logger = logging.getLogger("docubot.stt")

MOCK_QUERIES = [
    "How do I reset my password?",
    "What is the company VPN configuration?",
    "What should I do if the printer is offline?",
    "How do I take care of myself if I have the flu?",
    "What is the appointment cancellation policy?",
    "What are the healthy diet guidelines?"
]
mock_query_index = 0

def get_next_mock_query() -> str:
    global mock_query_index
    query = MOCK_QUERIES[mock_query_index]
    mock_query_index = (mock_query_index + 1) % len(MOCK_QUERIES)
    return query

_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        provider = os.getenv("STT_PROVIDER", "mock").lower()
        if provider == "faster-whisper":
            try:
                from faster_whisper import WhisperModel
                logger.info("Initializing faster-whisper 'tiny' model on CPU...")
                # Load tiny model with CPU configuration
                _whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")
                logger.info("faster-whisper initialized successfully.")
            except Exception as e:
                logger.error(f"Failed to initialize faster-whisper model: {e}. Falling back to mock/API STT.")
    return _whisper_model

async def transcribe_audio(audio_bytes: bytes, mime_type: str) -> str:
    provider = os.getenv("STT_PROVIDER", "mock").lower()
    
    if provider == "mock":
        return get_next_mock_query()

    if provider == "faster-whisper":
        model = get_whisper_model()
        if model:
            try:
                audio_stream = io.BytesIO(audio_bytes)
                segments, info = model.transcribe(audio_stream, beam_size=5)
                text = "".join([segment.text for segment in segments]).strip()
                logger.info(f"Local faster-whisper transcribed: {text}")
                return text
            except Exception as e:
                logger.error(f"Local faster-whisper transcription failed: {e}. Falling back to mock.")
                return get_next_mock_query()
        else:
            return get_next_mock_query()

    api_key = os.getenv("STT_API_KEY") or os.getenv("OPENAI_API_KEY") or "mock"
    api_url = os.getenv("STT_API_URL") or "https://api.openai.com/v1/audio/transcriptions"
    model_name = os.getenv("STT_MODEL", "whisper-1")

    try:
        import httpx
        ext = "webm"
        if "wav" in mime_type:
            ext = "wav"
        elif "ogg" in mime_type:
            ext = "ogg"
        elif "mp3" in mime_type:
            ext = "mp3"
        elif "m4a" in mime_type:
            ext = "m4a"

        files = {"file": (f"audio.{ext}", audio_bytes, mime_type)}
        data = {"model": model_name}
        headers = {}
        if api_key != "mock":
            headers["Authorization"] = f"Bearer {api_key}"

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(api_url, headers=headers, data=data, files=files)
            if resp.status_code != 200:
                raise Exception(f"STT API returned status {resp.status_code}: {resp.text}")
            res_json = resp.json()
            return res_json.get("text", "").strip()
    except Exception as e:
        logger.error(f"STT API transcription failed: {e}. Falling back to mock query.")
        return get_next_mock_query()
