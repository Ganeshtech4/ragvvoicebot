# Voice RAG Chatbot Gateway - Developer Guide

This document provides a comprehensive overview of the architecture, codebase structure, configuration variables, and running/testing instructions for the **Multi-Tenant Voice RAG Chatbot**.

---

## 1. System Architecture & Flow

The system coordinates real-time audio capture, streaming transcription, RAG database context retrieval, LLM response stream parsing, and sentence-by-sentence text-to-speech generation.

### End-to-End Execution Flow

```text
User speaks
  │
  ▼ (Client-side MediaRecorder slices audio every 200ms)
WebSocket Binary Stream (/ws)
  │
  ▼ (Voice Gateway collects audio buffer until silence/PTT release)
STT (Whisper API / Mock Fallback)
  │
  ▼ (Raw Text Transcript generated)
REST Post Request (/api/chat)
  │
  ▼ (Chatbot API receives query + Tenant context ID)
PostgreSQL RAG Match
  │
  ▼ (Retrieves isolated documentation matching Tenant ID)
LLM Streaming API (Gemini / Claude / OpenAI)
  │
  ▼ (Streams text response chunks)
Sentence Boundary Detection
  │
  ▼ (Voice Gateway aggregates text chunks into sentences)
TTS (OpenAI TTS-1 / Mock Synth Fallback)
  │
  ▼ (Generates base64 audio frame for each completed sentence)
WebSocket Audio Stream
  │
  ▼ (Client-side AudioQueue schedules gapless playback on AudioContext timeline)
🔊 AI Speaks response
```

---

## 2. Directory Structure & Key Files

```text
ragvvoicebot/
├── .env.example             # Template file showing all configuration options
├── .env                     # Local environment settings (ignored by Git)
├── docker-compose.yml       # Orchestrates and links all microservice containers
├── README.md                # Quickstart instructions
├── Developer_Guide.md       # This guide
│
├── chatbot-api/             # Chatbot API service (Auth, RAG, LLM calls)
│   ├── src/
│   │   ├── db/
│   │   │   ├── pg.ts        # PostgreSQL database connections
│   │   │   └── redis.ts     # Redis session tracking client
│   │   ├── services/
│   │   │   ├── rag.ts       # RAG context lookup matches (isolated by Tenant)
│   │   │   └── llm.ts       # Handles streaming response endpoints (Gemini, Claude, OpenAI)
│   │   └── server.ts        # Express REST API definition
│   ├── Dockerfile
│   └── package.json
│
├── voice-gateway/           # Voice Streaming Gateway service (STT / TTS / WebSockets)
│   ├── src/
│   │   ├── adapters/
│   │   │   ├── stt.ts       # Transcribes speech (OpenAI Whisper or local rotation)
│   │   │   └── tts.ts       # Synthesizes speech (OpenAI TTS-1 or retro robotic synth)
│   │   ├── services/
│   │   │   └── sessionManager.ts # Manages user audio state
│   │   └── server.ts        # WebSocket upgrade listener and streaming logic
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                # Next.js Frontend Dashboard (UI / Recorders / Audio Playback)
│   ├── src/
│   │   ├── app/
│   │   │   ├── globals.css  # Global Tailwind styles
│   │   │   ├── layout.tsx   # Document layout
│   │   │   └── page.tsx     # Dashboard container (auth gate, tabs, text input)
│   │   ├── components/
│   │   │   └── VoiceInterface.tsx # Canvas wave animation, mic capture, and silence detection
│   │   └── utils/
│   │       └── audioQueue.ts # Low-latency gapless scheduled audio buffer player
│   ├── Dockerfile
│   └── package.json
│
└── infra/                   # Configuration configurations for background dependencies
    ├── db/
    │   └── init.sql         # Seeds PostgreSQL tables (tenants, users, documents)
    └── nginx/
        └── nginx.conf       # Reverse proxy routing rules mapping traffic to port 80
```

---

## 3. Configuration variables (.env)

Modify the root **`.env`** file to select your providers and plug in API keys.

| Variable | Description | Allowed Values |
| :--- | :--- | :--- |
| **`LLM_PROVIDER`** | Which LLM service to call for chat answers | `mock`, `gemini`, `anthropic`, `openai`, `custom` |
| **`LLM_API_KEY`** | API authorization key for the chosen LLM | *Your API Key* |
| **`LLM_API_URL`** | Custom endpoint (only for `custom` OpenAI-compatible) | *e.g., http://localhost:11434/v1/chat/completions* |
| **`LLM_MODEL`** | Model tag requested | *e.g., `gemini-2.5-flash`, `claude-3-5-sonnet-latest`, `gpt-4o-mini`* |
| **`STT_PROVIDER`** | Speech-to-Text transcription provider | `mock`, `openai`, `custom` |
| **`STT_API_KEY`** | Authorization key for STT | *Your API Key* |
| **`STT_API_URL`** | Custom STT endpoint (if not using OpenAI) | *e.g., custom Whisper API URL* |
| **`STT_MODEL`** | Model tag for transcription | *e.g., `whisper-1`* |
| **`TTS_PROVIDER`** | Text-to-Speech audio synthesizer | `mock`, `openai`, `custom` |
| **`TTS_API_KEY`** | Authorization key for TTS | *Your API Key* |
| **`TTS_API_URL`** | Custom TTS endpoint | *e.g., custom speech generator URL* |
| **`TTS_MODEL`** | Model tag for audio synthesis | *e.g., `tts-1`* |
| **`TTS_VOICE`** | Model voice signature | `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer` |

---

## 4. Running the Application

### Steps

1. **Verify Docker Status**: Make sure Docker Desktop is launched and running.
2. **Build and Run**: In your terminal at `E:\temp\bindu`, run:
   ```bash
   docker-compose up --build
   ```
   *This command fetches external PostgreSQL/Redis images, builds the Next.js, Voice Gateway, and Chatbot API node modules inside containers, mounts the database storage volumes, and links them via Nginx.*
3. **Access application**:
   Open browser and go to `http://localhost`.

---

## 5. Verification & Testing Playbook

Here is how to demonstrate and verify each feature:

### Feature A: Multi-Tenant RAG Isolation
1. Go to the login screen at `http://localhost`.
2. Click **TechSupport Corp** (signs in username: `techuser`, tenant: `tenant-tech`).
3. Ask (via voice or text): *"How do I reset my password?"* or *"What is the VPN?"*
4. **Expected Result**: The response fetches context from the TechSupport knowledge base and answers correctly.
5. Log out and sign in as **HealthAdvice Inc** (username: `healthuser`, tenant: `tenant-health`).
6. Ask the same question: *"What is the VPN?"*
7. **Expected Result**: The chatbot will respond that it cannot find any matching documentation. (This is because the RAG queries are restricted solely to the logged-in user's tenant).
8. Now ask HealthAdvice: *"How do I treat the flu?"* or *"What is the cancelation policy?"*
9. **Expected Result**: The chatbot retrieves context from the HealthAdvice health portal and answers.

### Feature B: Hands-Free Voice Conversation
1. Select the **Hands-Free** toggle switch in the Voice Control Hub.
2. Click the microphone button and grant permission.
3. Speak your question.
4. **Expected Result**: As you speak, the canvas waveform will bounce. Once you stop speaking for 1.8 seconds, the client-side Silence Detector will automatically stop recording, freeze the visualizer, and transmit the audio chunk.
5. The AI response is generated, transcribed, and spoken.
6. **Expected Result**: Immediately after the voice response finishes playing, the frontend automatically resumes recording, enabling a fluid, hands-free conversational loop.

### Feature C: Assistant Interruption (Barge-In)
1. Initiate a voice conversation.
2. While the AI is actively speaking a long answer, start speaking or click the **Interrupt Assistant** button.
3. **Expected Result**: The browser's audio queue immediately stops, clearing all pending buffers in the `AudioContext` timeline. The Voice Gateway cancels further sentence generation to conserve network resources.
