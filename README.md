# DocuBot — Voice RAG Chatbot

A production-ready, multi-tenant AI chatbot with a **fullscreen voice interface**, RAG-powered knowledge retrieval, real-time streaming, and Docker-based microservice orchestration.

---

## 1. High-Level Architecture

```text
       Browser (Next.js 16 — docubot-frontend)
        ├── Chat UI  (streaming text, message history)
        ├── Voice Interface (fullscreen ChatGPT-style orb)
        │     ├── Pulsing gradient orb (reacts to mic & speaker volume)
        │     └── Bottom control pill (Type, Mute, Hang-Up)
        └── Audio Queue (gapless AnalyserNode-driven playback)
                     │
          HTTP (REST) / WebSocket (/ws)
                     │
             Nginx Reverse Proxy (:80)
           ┌──────────┴──────────┐
           ▼                     ▼
  docubot-backend (:5001)   chatbot-rag (:5002)
   ├── FastAPI REST API       ├── WebSocket voice gateway
   ├── JWT Auth + RBAC        ├── STT  (Groq Whisper-large-v3)
   ├── PostgreSQL sessions    ├── TTS  (OpenAI TTS-1 / Edge-TTS)
   ├── Redis rate-limiting    ├── LLM orchestration
   └── Celery background      └── Qdrant semantic search
```

---

## 2. Directory Layout

| Path | Description |
|---|---|
| `docubot-frontend/` | Next.js 16 App Router UI with Turbopack |
| `docubot-backend/` | FastAPI gateway — auth, sessions, PostgreSQL, Celery |
| `chatbot-rag/` | AI orchestration — WebSocket voice, STT, TTS, Qdrant |
| `infra/` | Nginx config, PostgreSQL init SQL |
| `docker-compose.yml` | Orchestrates all services |
| `.env` | Local secrets (not committed) — copy from `.env.example` |

---

## 3. Getting Started

### Prerequisites
- [Docker & Docker Compose](https://www.docker.com/) (Desktop or Engine)
- Optionally an API key for a real LLM, STT (Groq), or TTS provider

### Quick Start

```bash
# 1. Copy environment template
cp .env.example .env
# Edit .env with your API keys (or leave as-is for mock mode)

# 2. Start all services
docker compose up --build

# 3. Open in browser
http://localhost:3000
```

### Guest Login
The app ships with a zero-config guest login — click **"Login as Guest"** on the auth screen. No user setup required for development.

---

## 4. Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `AUTH_SECRET` | Next.js Auth.js session secret |
| `JWT_SECRET` | Shared JWT signing secret (backend ↔ voice gateway) |
| `LLM_PROVIDER` | `mock` \| `gemini` \| `openai` \| `anthropic` \| `custom` |
| `LLM_API_KEY` | API key for the LLM provider |
| `STT_PROVIDER` | `mock` \| `openai` — uses Groq-compatible Whisper endpoint |
| `STT_API_KEY` | Groq or OpenAI key for transcription |
| `STT_API_URL` | Override STT base URL (e.g. `https://api.groq.com/openai/v1/audio/transcriptions`) |
| `TTS_PROVIDER` | `mock` \| `openai` \| `custom` |
| `TTS_VOICE` | `alloy` \| `echo` \| `fable` \| `onyx` \| `nova` \| `shimmer` |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |

---

## 5. Voice Interface

Click the **microphone icon** in the chat input bar to open the fullscreen voice interface:

- A large **blue-purple gradient orb** pulses and glows in real time — in sync with your microphone input while you speak, and with the assistant's synthesized audio while it responds.
- **Bottom control pill**: `+` button | text `Type` input | red mic toggle | black ✕ hang-up.
- Supports **hands-free** conversation with client-side VAD (1.8 s silence detection).
- Tap the red mic button to mute/unmute or retry after a mic permission error.

### Authentication Flow (Dev Mode)
The voice WebSocket gateway accepts the following development tokens without a full JWT:
- `mock-guest-token` / `mock-guest` → guest user (`tenant-tech`)
- `mock-tech` → tech tenant user
- `mock-health` → health tenant user

---

## 6. Running Tests

```bash
# End-to-end Playwright tests
cd docubot-frontend && npx playwright test

# Backend unit tests
cd docubot-backend && pytest
```

---

## 7. License

MIT — see [LICENSE](LICENSE).
