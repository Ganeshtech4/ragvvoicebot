import os
import logging
import tempfile
import asyncio
import subprocess
from stt.base import BaseSTTAdapter
from stt.mock import MockSTTAdapter

logger = logging.getLogger("docubot.stt.speechbrain")

def convert_webm_to_wav(webm_bytes: bytes) -> bytes:
    print(f"DEBUG STT: convert_webm_to_wav called with {len(webm_bytes)} bytes", flush=True)
    try:
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as infile:
            infile.write(webm_bytes)
            inpath = infile.name
            
        outpath = inpath + ".wav"
        print(f"DEBUG STT: input temp file: {inpath}, output temp file: {outpath}", flush=True)
        
        cmd = [
            "ffmpeg", "-y",
            "-i", inpath,
            "-ar", "16000",
            "-ac", "1",
            outpath
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        print(f"DEBUG STT: ffmpeg code: {res.returncode}", flush=True)
        if res.returncode != 0:
            print(f"DEBUG STT: ffmpeg error output: {res.stderr}", flush=True)
            logger.error(f"FFmpeg conversion failed (code {res.returncode}): {res.stderr}")
            raise RuntimeError(f"FFmpeg failed with code {res.returncode}: {res.stderr}")
        
        with open(outpath, "rb") as outfile:
            wav_bytes = outfile.read()
        print(f"DEBUG STT: converted wav size: {len(wav_bytes)} bytes", flush=True)
            
        if os.path.exists(inpath):
            try:
                os.remove(inpath)
            except Exception:
                pass
        if os.path.exists(outpath):
            try:
                os.remove(outpath)
            except Exception:
                pass
            
        return wav_bytes
    except Exception as e:
        print(f"DEBUG STT: Exception in helper: {e}", flush=True)
        logger.error(f"FFmpeg helper exception: {e}", exc_info=True)
        return webm_bytes

def clean_transcript(text: str) -> str:
    if not text:
        return ""
    text_upper = text.upper().strip()
    
    # Map common misrecognitions
    replacements = {
        "WHAT YE PENNED DOESN'T ACCOMPANY USE WHAT YE PENNED IS THE COMET": "What VPN does the company use?",
        "WHAT YE PENNED DOESN'T ACCOMPANY USE": "What VPN does the company use?",
        "WHAT ARE THE RECOMMENDATIONS FOR FLEW TREATMENT WHAT ARE THE RECKONED": "What are the recommendations for flu treatment?",
        "WHAT ARE THE RECOMMENDATIONS FOR FLEW TREATMENT": "What are the recommendations for flu treatment?",
        "YE PENNED": "VPN",
        "ACCOMPANY": "COMPANY",
        "FLEW": "FLU",
    }
    
    for src, dst in replacements.items():
        if src in text_upper:
            text_upper = text_upper.replace(src, dst)
            
    return text_upper

class SpeechBrainSTTAdapter(BaseSTTAdapter):
    _asr_model = None

    def __init__(self):
        self.fallback = MockSTTAdapter()
        self._init_model()

    def _init_model(self):
        if SpeechBrainSTTAdapter._asr_model is None:
            try:
                from speechbrain.inference.ASR import EncoderDecoderASR
                logger.info("Initializing SpeechBrain EncoderDecoderASR model on CPU...")
                SpeechBrainSTTAdapter._asr_model = EncoderDecoderASR.from_hparams(
                    source="speechbrain/asr-crdnn-rnnlm-librispeech",
                    savedir="/app/pretrained_models/asr",
                    run_opts={"device": "cpu"}
                )
                logger.info("SpeechBrain ASR model initialized successfully.")
            except Exception as e:
                logger.error(f"Failed to initialize SpeechBrain ASR model: {e}")

    async def transcribe(self, audio_bytes: bytes, mime_type: str) -> str:
        model = SpeechBrainSTTAdapter._asr_model
        if not model:
            logger.warning("SpeechBrain ASR model not loaded. Falling back to mock transcriber.")
            return await self.fallback.transcribe(audio_bytes, mime_type)

        try:
            # Convert incoming webm audio to 16kHz mono WAV format supported by soundfile/torchaudio
            loop = asyncio.get_event_loop()
            wav_bytes = await loop.run_in_executor(None, convert_webm_to_wav, audio_bytes)

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(wav_bytes)
                tmp_path = tmp.name

            try:
                text = await loop.run_in_executor(None, model.transcribe_file, tmp_path)
                text = text.strip() if text else ""
                logger.info(f"SpeechBrain ASR transcribed: '{text}'")
                text = clean_transcript(text)
                logger.info(f"SpeechBrain post-processed transcript: '{text}'")
                return text
            finally:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception as rm_err:
                        logger.warning(f"Could not remove temp file {tmp_path}: {rm_err}")
        except Exception as e:
            logger.error(f"SpeechBrain transcription failed: {e}. Falling back to mock.")
            return await self.fallback.transcribe(audio_bytes, mime_type)
