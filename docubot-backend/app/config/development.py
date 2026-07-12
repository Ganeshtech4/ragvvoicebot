from app.config.base import Settings

class DevelopmentSettings(Settings):
    ENVIRONMENT: str = "development"

settings = DevelopmentSettings()
