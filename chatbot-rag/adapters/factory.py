import os
from adapters.base import BaseAIAdapter
from adapters.mock import MockAdapter
from adapters.openai import OpenAIAdapter
from adapters.groq import GroqAdapter
from adapters.anthropic import AnthropicAdapter
from adapters.gemini import GeminiAdapter

def get_ai_adapter() -> BaseAIAdapter:
    provider = os.getenv("LLM_PROVIDER", "mock").lower()
    api_key = os.getenv("LLM_API_KEY")
    model = os.getenv("LLM_MODEL")
    api_url = os.getenv("LLM_API_URL")

    if provider == "openai":
        return OpenAIAdapter(api_key=api_key, model=model, api_url=api_url)
    elif provider == "groq":
        return GroqAdapter(api_key=api_key, model=model)
    elif provider == "anthropic":
        return AnthropicAdapter(api_key=api_key, model=model, api_url=api_url)
    elif provider == "gemini":
        return GeminiAdapter(api_key=api_key, model=model, api_url=api_url)
    else:
        return MockAdapter()
