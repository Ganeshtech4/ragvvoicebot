# Edge-TTS Text-To-Speech Service

This is a local, lightweight FastAPI service wrapping the Microsoft `edge-tts` speech synthesis engine.

## API Endpoints

### 1. Synthesize Speech
* **Endpoint**: `POST /speak`
* **Content-Type**: `application/json`
* **Input**:
  ```json
  {
    "text": "Hello world",
    "voice": "en-US-AvaNeural"
  }
  ```
* **Output**: `audio/mpeg` (Binary MP3 stream)

### 2. Health Check
* **Endpoint**: `GET /health`
* **Output**:
  ```json
  {
    "status": "ok"
  }
  ```

## Local Testing

1. Create a Python virtual environment and install packages:
   ```bash
   pip install -r requirements.txt
   ```
2. Run the application:
   ```bash
   uvicorn app:app --port 8002
   ```
