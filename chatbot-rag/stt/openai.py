import os
import logging
import httpx
from stt.base import BaseSTTAdapter
from stt.mock import MockSTTAdapter

logger = logging.getLogger("docubot.stt.openai")

class OpenAISTTAdapter(BaseSTTAdapter):
    def __init__(self, api_key: str = None, api_url: str = None, model: str = None):
        self.api_key = api_key or os.getenv("STT_API_KEY") or os.getenv("OPENAI_API_KEY") or "mock"
        self.api_url = api_url or os.getenv("STT_API_URL") or "https://api.openai.com/v1/audio/transcriptions"
        self.model = model or os.getenv("STT_MODEL") or "whisper-1"
        self.fallback = MockSTTAdapter()

    async def transcribe(self, audio_bytes: bytes, mime_type: str) -> str:
        try:
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
            data = {"model": self.model}
            headers = {}
            if self.api_key != "mock":
                headers["Authorization"] = f"Bearer {self.api_key}"

            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(self.api_url, headers=headers, data=data, files=files)
                if resp.status_code != 200:
                    raise Exception(f"STT API returned status {resp.status_code}: {resp.text}")
                res_json = resp.json()
                text = res_json.get("text", "").strip()
                logger.info(f"OpenAI ASR API transcribed: '{text}'")
                return text
        except Exception as e:
            logger.error(f"STT API transcription failed: {e}. Falling back to mock query.")
            return await self.fallback.transcribe(audio_bytes, mime_type)
