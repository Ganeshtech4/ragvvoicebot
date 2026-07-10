FROM python:3.10-slim

WORKDIR /app

# Install system dependencies (build-essential needed for some C libraries)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY services/whisper-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/whisper-service/app.py ./app.py

EXPOSE 8001

ENV WHISPER_MODEL=tiny
ENV WHISPER_COMPUTE_TYPE=float32

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
