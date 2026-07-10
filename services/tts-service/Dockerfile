FROM python:3.10-slim

WORKDIR /app

COPY services/tts-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/tts-service/app.py ./app.py

EXPOSE 8002

ENV TTS_VOICE=en-US-AvaNeural

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"]
