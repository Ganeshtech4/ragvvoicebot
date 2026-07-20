FROM python:3.12-slim

WORKDIR /app

# Install system packages for audio manipulation (ffmpeg, libsndfile1)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY chatbot-rag/requirements.txt .
RUN pip install --no-cache-dir --default-timeout=1000 torch torchaudio torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --default-timeout=1000 -r requirements.txt

# Pre-cache SentenceTransformer model weights at build-time to avoid boot-up network delays
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# SpeechBrain ASR is disabled in favor of Groq Whisper API (openai adapter)

# Copy source and shared libraries
COPY chatbot-rag/ /app/
COPY shared/ /app/shared/

ENV PYTHONPATH=/app

EXPOSE 5002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5002"]
