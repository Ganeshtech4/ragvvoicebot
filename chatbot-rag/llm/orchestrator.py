from services.prompt_manager import PromptManager
from adapters.factory import get_ai_adapter
from typing import AsyncGenerator, List, Dict
import logging

logger = logging.getLogger("docubot.llm.orchestrator")

prompt_manager = PromptManager()

async def orchestrate_chat_stream(
    message: str,
    context: str,
    history: List[Dict[str, str]],
    is_voice: bool = False
) -> AsyncGenerator[str, None]:
    system_prompt = prompt_manager.build_system_prompt(context, is_voice=is_voice)
    adapter = get_ai_adapter()
    
    logger.info(f"Orchestrating stream (is_voice={is_voice}) via {adapter.__class__.__name__}")
    
    async for chunk in adapter.stream_chat(system_prompt, history, message):
        yield chunk
