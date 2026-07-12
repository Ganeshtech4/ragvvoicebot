import os
import logging
from stt.base import BaseSTTAdapter
from stt.mock import MockSTTAdapter
from stt.speechbrain import SpeechBrainSTTAdapter
from stt.faster_whisper import FasterWhisperSTTAdapter
from stt.openai import OpenAISTTAdapter

logger = logging.getLogger("docubot.stt.factory")

_stt_adapter = None

def get_stt_adapter() -> BaseSTTAdapter:
    global _stt_adapter
    if _stt_adapter is None:
        provider = os.getenv("STT_PROVIDER", "mock").lower()
        logger.info(f"Instantiating STT provider: {provider}")
        if provider == "speechbrain":
            _stt_adapter = SpeechBrainSTTAdapter()
        elif provider == "faster-whisper":
            _stt_adapter = FasterWhisperSTTAdapter()
        elif provider == "openai":
            _stt_adapter = OpenAISTTAdapter()
        else:
            _stt_adapter = MockSTTAdapter()
    return _stt_adapter
