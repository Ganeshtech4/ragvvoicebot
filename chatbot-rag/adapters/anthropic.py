from adapters.base import BaseAIAdapter
from typing import AsyncGenerator, List, Dict
import os
import httpx
import json
import logging

logger = logging.getLogger("docubot.adapters.anthropic")

class AnthropicAdapter(BaseAIAdapter):
    def __init__(self, api_key: str = None, model: str = None, api_url: str = None):
        self.api_key = api_key or os.getenv("LLM_API_KEY") or os.getenv("ANTHROPIC_API_KEY") or "mock"
        self.model = model or os.getenv("LLM_MODEL") or "claude-3-5-sonnet-latest"
        self.api_url = api_url or os.getenv("LLM_API_URL") or "https://api.anthropic.com/v1/messages"

    async def stream_chat(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        prompt: str
    ) -> AsyncGenerator[str, None]:
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01"
        }
        
        messages = []
        for msg in history:
            messages.append({
                "role": "assistant" if msg["role"] == "assistant" else "user",
                "content": msg["content"]
            })
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "system": system_prompt,
            "messages": messages,
            "stream": True,
            "max_tokens": 1024
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                async with client.stream("POST", self.api_url, headers=headers, json=payload) as response:
                    if response.status_code != 200:
                        error_text = await response.aread()
                        raise Exception(f"Anthropic error (Status {response.status_code}): {error_text.decode('utf-8')}")
                    
                    current_event = ""
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        
                        if line.startswith("event: "):
                            current_event = line[7:]
                        elif line.startswith("data: "):
                            try:
                                data = json.loads(line[6:])
                                if current_event == "content_block_delta" and "delta" in data:
                                    text = data["delta"].get("text", "")
                                    if text:
                                        yield text
                            except Exception:
                                pass
        except Exception as e:
            logger.error(f"Anthropic streaming error: {e}")
            raise
