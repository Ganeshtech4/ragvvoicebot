from app.config.base import Settings

class StagingSettings(Settings):
    ENVIRONMENT: str = "staging"

settings = StagingSettings()
