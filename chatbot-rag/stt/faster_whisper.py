import os
import io
import logging
import asyncio
from stt.base import BaseSTTAdapter
from stt.mock import MockSTTAdapter

logger = logging.getLogger("docubot.stt.faster_whisper")

class FasterWhisperSTTAdapter(BaseSTTAdapter):
    _whisper_model = None

    def __init__(self):
        self.fallback = MockSTTAdapter()
        self._init_model()

    def _init_model(self):
        if FasterWhisperSTTAdapter._whisper_model is None:
            try:
                from faster_whisper import WhisperModel
                logger.info("Initializing faster-whisper 'tiny' model on CPU...")
                FasterWhisperSTTAdapter._whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")
                logger.info("faster-whisper initialized successfully.")
            except Exception as e:
                logger.error(f"Failed to initialize faster-whisper model: {e}")

    async def transcribe(self, audio_bytes: bytes, mime_type: str) -> str:
        model = FasterWhisperSTTAdapter._whisper_model
        if not model:
            logger.warning("faster-whisper model not loaded. Falling back to mock transcriber.")
            return await self.fallback.transcribe(audio_bytes, mime_type)

        try:
            def run_inference():
                audio_stream = io.BytesIO(audio_bytes)
                segments, info = model.transcribe(audio_stream, beam_size=5)
                return "".join([segment.text for segment in segments]).strip()

            loop = asyncio.get_event_loop()
            text = await loop.run_in_executor(None, run_inference)
            logger.info(f"Local faster-whisper transcribed: '{text}'")
            return text
        except Exception as e:
            logger.error(f"Local faster-whisper transcription failed: {e}. Falling back to mock.")
            return await self.fallback.transcribe(audio_bytes, mime_type)
