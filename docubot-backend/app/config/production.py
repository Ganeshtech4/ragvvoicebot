from app.config.base import Settings

class ProductionSettings(Settings):
    ENVIRONMENT: str = "production"

settings = ProductionSettings()
