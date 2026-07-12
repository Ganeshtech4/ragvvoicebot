import os

env = os.getenv("ENVIRONMENT", "development").lower()

if env == "production":
    from config.production import settings
elif env == "staging":
    from config.staging import settings
else:
    from config.development import settings
