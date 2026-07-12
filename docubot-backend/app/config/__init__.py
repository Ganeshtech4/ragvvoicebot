import os

env = os.getenv("ENVIRONMENT", "development").lower()

if env == "production":
    from app.config.production import settings
elif env == "staging":
    from app.config.staging import settings
else:
    from app.config.development import settings
