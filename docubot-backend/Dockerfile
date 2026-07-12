FROM python:3.12-slim

WORKDIR /app

# Install system packages for building C extensions (such as for asyncpg/psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY docubot-backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source and shared directories
COPY docubot-backend/ /app/
COPY shared/ /app/shared/

# Export PYTHONPATH to resolve shared library imports
ENV PYTHONPATH=/app

EXPOSE 5001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5001"]
