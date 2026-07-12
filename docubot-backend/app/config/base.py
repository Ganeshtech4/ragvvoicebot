import os
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    PORT: int = 5001
    DATABASE_URL: str = "postgresql+asyncpg://voice_rag_user:voice_rag_password@postgres:5432/voice_rag_db"
    REDIS_URL: str = "redis://redis:6379"
    SECRET_KEY: str = "your-default-secret-key-for-jwt-tokens-here"
    CHATBOT_RAG_URL: str = "http://chatbot-rag:5002"
    ENVIRONMENT: str = "development"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

# Instantiate default settings
settings = Settings()
