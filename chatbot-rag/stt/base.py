from abc import ABC, abstractmethod

class BaseSTTAdapter(ABC):
    @abstractmethod
    async def transcribe(self, audio_bytes: bytes, mime_type: str) -> str:
        """Transcribe audio bytes to text."""
        pass
