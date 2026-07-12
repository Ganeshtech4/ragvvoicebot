from adapters.base import BaseAIAdapter
from typing import AsyncGenerator, List, Dict
import os
import httpx
import json
import logging

logger = logging.getLogger("docubot.adapters.gemini")

class GeminiAdapter(BaseAIAdapter):
    def __init__(self, api_key: str = None, model: str = None, api_url: str = None):
        self.api_key = api_key or os.getenv("LLM_API_KEY") or os.getenv("GEMINI_API_KEY") or "mock"
        self.model = model or os.getenv("LLM_MODEL") or "gemini-2.5-flash"
        self.api_url = api_url or os.getenv("LLM_API_URL")

    async def stream_chat(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        prompt: str
    ) -> AsyncGenerator[str, None]:
        url = self.api_url or f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:streamGenerateContent?alt=sse&key={self.api_key}"
        
        contents = []
        for msg in history:
            contents.append({
                "role": "model" if msg["role"] == "assistant" else "user",
                "parts": [{"text": msg["content"]}]
            })
        contents.append({
            "role": "user",
            "parts": [{"text": prompt}]
        })

        payload = {
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            },
            "contents": contents,
            "generationConfig": {
                "responseMimeType": "text/plain"
            }
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                async with client.stream("POST", url, json=payload) as response:
                    if response.status_code != 200:
                        error_text = await response.aread()
                        raise Exception(f"Gemini error (Status {response.status_code}): {error_text.decode('utf-8')}")
                    
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        
                        if line.startswith("data: "):
                            try:
                                data = json.loads(line[6:])
                                if "error" in data:
                                    raise Exception(f"Gemini API Error: {data['error'].get('message')}")
                                
                                chunk = data["candidates"][0]["content"]["parts"][0].get("text", "")
                                if chunk:
                                    yield chunk
                            except Exception as e:
                                if "Gemini API Error" in str(e):
                                    raise e
        except Exception as e:
            logger.error(f"Gemini streaming error: {e}")
            raise
