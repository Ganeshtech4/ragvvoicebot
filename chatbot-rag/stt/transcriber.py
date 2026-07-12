import logging
from stt.factory import get_stt_adapter

logger = logging.getLogger("docubot.stt.transcriber")

async def transcribe_audio(audio_bytes: bytes, mime_type: str) -> str:
    """Entry point for transcribing audio, delegating to the configured STT provider."""
    adapter = get_stt_adapter()
    return await adapter.transcribe(audio_bytes, mime_type)
