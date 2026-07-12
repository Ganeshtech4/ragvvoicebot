from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Dict, Any

class BaseAIAdapter(ABC):
    @abstractmethod
    async def stream_chat(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        prompt: str
    ) -> AsyncGenerator[str, None]:
        pass
