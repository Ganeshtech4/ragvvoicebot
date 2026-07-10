# Faster-Whisper Speech-To-Text Service

This is a local, lightweight FastAPI service wrapping the `faster-whisper` transcription engine.

## API Endpoints

### 1. Transcribe Audio
* **Endpoint**: `POST /transcribe`
* **Content-Type**: `multipart/form-data`
* **Input**: An audio file in form data key `file`.
* **Output**:
  ```json
  {
    "text": "Hello world"
  }
  ```

### 2. Health Check
* **Endpoint**: `GET /health`
* **Output**:
  ```json
  {
    "status": "ok",
    "model": "tiny"
  }
  ```

## Local Testing

1. Create a Python virtual environment and install packages:
   ```bash
   pip install -r requirements.txt
   ```
2. Run the application:
   ```bash
   uvicorn app:app --port 8001
   ```
