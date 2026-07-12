from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PORT: int = 5002
    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333
    LLM_PROVIDER: str = "mock"
    LLM_API_KEY: str = "mock"
    LLM_API_URL: str = ""
    LLM_MODEL: str = ""
    STT_PROVIDER: str = "mock"
    TTS_PROVIDER: str = "mock"
    ENVIRONMENT: str = "development"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()
