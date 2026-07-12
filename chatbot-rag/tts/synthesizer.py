import os
import math
import struct
import logging
import asyncio

logger = logging.getLogger("docubot.tts")

def generate_mock_voice_wav(text: str) -> bytes:
    sample_rate = 8000
    duration_ms = min(8000, max(500, len(text) * 70))
    num_samples = int((sample_rate * duration_ms) / 1000)
    
    header_size = 44
    data_size = num_samples
    
    header = bytearray(header_size)
    header[0:4] = b"RIFF"
    struct.pack_into("<I", header, 4, 36 + data_size)
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    struct.pack_into("<I", header, 16, 16)
    struct.pack_into("<H", header, 20, 1)  # PCM format
    struct.pack_into("<H", header, 22, 1)  # Mono
    struct.pack_into("<I", header, 24, sample_rate)
    struct.pack_into("<I", header, 28, sample_rate)
    struct.pack_into("<H", header, 32, 1)
    struct.pack_into("<H", header, 34, 8)  # 8-bit
    header[36:40] = b"data"
    struct.pack_into("<I", header, 40, data_size)
    
    samples = bytearray(data_size)
    freqs = [220, 262, 330, 294, 392, 440, 349]
    for i in range(num_samples):
        t = i / sample_rate
        syllable_index = int(t * 5.5)
        base_freq = freqs[syllable_index % len(freqs)]
        
        vibrato = math.sin(2 * math.pi * 6 * t) * 8
        freq = base_freq + vibrato
        envelope = max(0.0, math.sin(2 * math.pi * 2.75 * t))
        
        val = math.sin(2 * math.pi * freq * t) * 60 * envelope + 128
        val = max(0, min(255, int(val)))
        samples[i] = val
        
    return bytes(header + samples)

async def synthesize_speech(text: str) -> bytes:
    provider = os.getenv("TTS_PROVIDER", "mock").lower()
    
    if provider == "mock":
        return generate_mock_voice_wav(text)

    if provider == "edge-tts":
        try:
            import edge_tts
            voice = os.getenv("TTS_VOICE") or "en-US-EmmaMultilingualNeural"
            communicate = edge_tts.Communicate(text, voice)
            audio_data = bytearray()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_data.extend(chunk["data"])
            if audio_data:
                return bytes(audio_data)
            else:
                raise Exception("Empty audio stream received from Edge TTS")
        except Exception as e:
            logger.error(f"Local Edge TTS synthesis failed: {e}. Falling back to mock synthesizer.")
            return generate_mock_voice_wav(text)

    api_key = os.getenv("TTS_API_KEY") or os.getenv("OPENAI_API_KEY") or "mock"
    api_url = os.getenv("TTS_API_URL") or "https://api.openai.com/v1/audio/speech"
    model_name = os.getenv("TTS_MODEL", "tts-1")
    voice_name = os.getenv("TTS_VOICE") or "alloy"

    try:
        import httpx
        headers = {"Content-Type": "application/json"}
        if provider == "custom":
            payload = {"text": text, "voice": voice_name}
        else:
            headers["Authorization"] = f"Bearer {api_key}"
            payload = {
                "model": model_name,
                "input": text,
                "voice": voice_name,
                "response_format": "mp3"
            }

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(api_url, headers=headers, json=payload)
            if resp.status_code != 200:
                raise Exception(f"TTS API returned status {resp.status_code}: {resp.text}")
            return resp.content
    except Exception as e:
        logger.error(f"TTS API synthesis failed: {e}. Falling back to mock synthesizer.")
        return generate_mock_voice_wav(text)
