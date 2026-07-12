from adapters.base import BaseAIAdapter
from groq import AsyncGroq
from typing import AsyncGenerator, List, Dict
import os
import logging

logger = logging.getLogger("docubot.adapters.groq")

class GroqAdapter(BaseAIAdapter):
    def __init__(self, api_key: str = None, model: str = None):
        self.api_key = api_key or os.getenv("LLM_API_KEY") or os.getenv("GROQ_API_KEY") or "mock"
        self.model = model or os.getenv("LLM_MODEL") or "llama-3.1-8b-instant"
        self.client = AsyncGroq(api_key=self.api_key)

    async def stream_chat(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        prompt: str
    ) -> AsyncGenerator[str, None]:
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": prompt})

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True
            )
            async for chunk in response:
                content = chunk.choices[0].delta.content
                if content:
                    yield content
        except Exception as e:
            logger.error(f"Groq streaming error: {e}")
            raise
