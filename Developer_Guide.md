# DocuBot — Developer Guide

Comprehensive reference for architecture, code structure, configuration, and testing.

---

## 1. System Architecture & Flow

### End-to-End Execution Flow

```text
User speaks
  │
  ▼  (Client-side MediaRecorder slices audio every 200ms)
WebSocket Binary Stream (/ws → chatbot-rag:5002)
  │
  ▼  (Voice gateway buffers audio until VAD silence / PTT release)
STT — Groq Whisper-large-v3 (via OpenAI-compatible API)
  │
  ▼  (Raw text transcript)
REST POST → docubot-backend:5001/api/v1/chat
  │
  ▼  (Auth + tenant resolution + session persistence)
chatbot-rag — Qdrant semantic search (scoped by tenant_id)
  │
  ▼  (Retrieved context chunks)
LLM Streaming (Gemini / Claude / OpenAI / custom)
  │
  ▼  (Streamed text tokens)
Sentence Boundary Detection
  │
  ▼  (Complete sentences sent to TTS)
TTS — OpenAI TTS-1 / Edge-TTS (base64 audio frames)
  │
  ▼  (Sent over WebSocket)
Client AudioQueue (AnalyserNode → gapless AudioContext playback)
  │
  ▼
🔊 AI speaks + gradient orb pulses in sync
```

---

## 2. Directory Structure & Key Files

```text
ragvvoicebot/
├── .env.example              # All supported environment variables with descriptions
├── .env                      # Local secrets (git-ignored)
├── docker-compose.yml        # Multi-container orchestration
├── README.md                 # Quick-start guide
├── Developer_Guide.md        # This document
├── architecture.md           # Production architecture specification
│
├── docubot-frontend/         # Next.js 16 (Turbopack) Chat UI
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── auth.ts               # Auth.js config — guest credentials provider
│   │   └── (chat)/api/
│   │       ├── chat/route.ts         # POST handler: normalises {message}/{messages}
│   │       │                         #   → forwards to docubot-backend stream
│   │       └── history/route.ts      # Returns paginated {chats, hasMore} for sidebar
│   ├── components/
│   │   ├── VoiceInterface.tsx        # Fullscreen ChatGPT-style voice UI
│   │   │   ├── Gradient orb (pulses with mic + speaker volume via AnalyserNode)
│   │   │   ├── Bottom control pill (Type input, mute, hang-up)
│   │   │   └── Hands-free VAD (1.8 s silence → stopRecording)
│   │   └── chat/
│   │       ├── shell.tsx             # Mounts VoiceInterface as full-viewport overlay
│   │       └── sidebar-history.tsx   # Expects {chats: Chat[], hasMore: boolean}
│   └── lib/
│       └── audioQueue.ts             # AudioQueue — AnalyserNode-wired gapless playback
│                                     #   + getVolumeLevel() for real-time orb animation
│
├── docubot-backend/          # FastAPI — Auth, Sessions, Multi-Tenant Business Logic
│   ├── app/
│   │   ├── auth/
│   │   │   └── security.py           # JWT decode — accepts mock-guest-token (dev bypass)
│   │   └── chat/routes.py            # /api/v1/chat — auth-gated, forwards to chatbot-rag
│
├── chatbot-rag/              # FastAPI — AI Orchestration + Voice Gateway
│   ├── websocket/
│   │   └── connection.py             # WebSocket /ws endpoint
│   │       ├── Auth bypass: mock-guest-token, mock-tech, mock-health
│   │       ├── Audio buffer accumulation + VAD
│   │       ├── STT transcription call
│   │       └── TTS sentence synthesis → base64 audio frames
│   ├── stt/                          # STT adapters (openai / mock)
│   ├── tts/                          # TTS adapters (openai / edge-tts / mock)
│   └── rag/                          # Qdrant retrieval + prompt compilation
│
└── infra/
    ├── nginx/nginx.conf              # Port 80 reverse proxy → frontend / backend / rag
    └── db/init.sql                   # PostgreSQL schema + seed (tenants, users, documents)
```

---

## 3. Environment Variables

Modify the root **`.env`** file. All variables with defaults are optional.

### Auth & Security

| Variable | Description | Default |
|---|---|---|
| `AUTH_SECRET` | Auth.js session encryption secret | *(required)* |
| `JWT_SECRET` | Shared JWT signing key for backend ↔ voice gateway | `super-secret-...` |

### LLM Provider

| Variable | Description | Values |
|---|---|---|
| `LLM_PROVIDER` | Which LLM to call | `mock` \| `gemini` \| `anthropic` \| `openai` \| `custom` |
| `LLM_API_KEY` | API key | — |
| `LLM_API_URL` | Custom endpoint (for `custom`) | — |
| `LLM_MODEL` | Model tag | `gemini-2.5-flash`, `gpt-4o-mini`, etc. |

### STT (Speech-to-Text)

| Variable | Description | Values |
|---|---|---|
| `STT_PROVIDER` | Transcription provider | `mock` \| `openai` |
| `STT_API_KEY` | API key (Groq or OpenAI) | — |
| `STT_API_URL` | Endpoint URL | `https://api.groq.com/openai/v1/audio/transcriptions` |
| `STT_MODEL` | Whisper model | `whisper-large-v3`, `whisper-1` |

> **Recommended**: Use Groq for STT — it is free, extremely fast, and fully OpenAI-compatible. Set `STT_PROVIDER=openai`, `STT_API_URL=https://api.groq.com/openai/v1/audio/transcriptions`, and `STT_MODEL=whisper-large-v3`.

### TTS (Text-to-Speech)

| Variable | Description | Values |
|---|---|---|
| `TTS_PROVIDER` | Speech synthesizer | `mock` \| `openai` \| `custom` |
| `TTS_API_KEY` | API key | — |
| `TTS_VOICE` | Voice | `alloy` \| `echo` \| `fable` \| `onyx` \| `nova` \| `shimmer` |

---

## 4. Running the Application

### One-Command Start

```bash
docker compose up --build
```

Access at `http://localhost:3000`.

### Restart a Single Service

```bash
docker compose restart frontend       # Next.js
docker compose restart backend        # FastAPI
docker compose restart chatbot-rag    # Voice gateway
```

---

## 5. Development Mode Auth (Mock Tokens)

For local development, the system ships with two auth bypass layers:

### A. Next.js Guest Login (`docubot-frontend/app/(auth)/auth.ts`)
The "Login as Guest" button issues a session with `accessToken = "mock-guest-token"`.

### B. FastAPI Backend (`docubot-backend/app/auth/security.py`)
`mock-guest-token` is decoded into:
```json
{ "sub": "a0eebc99-...", "tenantId": "tenant-tech", "role": "guest" }
```

### C. Voice WebSocket Gateway (`chatbot-rag/websocket/connection.py`)
The following token strings bypass JWT verification:

| Token | Claims |
|---|---|
| `mock-guest-token`, `mock-guest` | tenant-tech, role=guest |
| `mock-tech` | tenant-tech, role=user |
| `mock-health` | tenant-health, role=user |

> ⚠️ **These bypasses must be disabled or gated behind `NODE_ENV !== "production"` before any public deployment.**

---

## 6. Voice Interface — Implementation Notes

### VoiceInterface.tsx
- Fullscreen overlay (`fixed inset-0`) — completely replaces the old popup modal.
- Orb animation uses `requestAnimationFrame` to poll `AnalyserNode` every frame:
  - While listening → reads user mic RMS volume via the `analyserRef`.
  - While speaking → reads assistant audio RMS via `AudioQueue.getVolumeLevel()`.
  - While idle → gentle sinusoidal breathing animation.
- Mic button (`handleMicButton`) has three states:
  - **Recording** → click to mute.
  - **Muted** → click to unmute + restart.
  - **Idle / error** → click to retry `startRecording()` (handles post-permission-grant retry).

### AudioQueue.ts
- New `analyser: AnalyserNode` wired into the assistant playback graph.
- New `getVolumeLevel(): number` — returns RMS of currently playing assistant audio.
- All sources now route: `source → analyser → destination`.

### chat/route.ts — Payload Normalisation
The AI SDK `DefaultChatTransport` sends two different body shapes:
- Normal message: `{ message: {...}, id }` (singular)
- Tool continuation: `{ messages: [...], id }` (plural)

The route normalises both into a `messages[]` array. All error responses return `Response.json(...)` to prevent `"Unexpected token 'C'..."` parse errors in the browser.

---

## 7. Testing Playbook

### Feature A: Text Chat
1. Open `http://localhost:3000` → Login as Guest.
2. Type any message and press Enter.
3. **Expected**: Assistant streams a response from the RAG knowledge base.

### Feature B: Voice Interface
1. Click the microphone icon in the chat input bar.
2. **Expected**: Fullscreen voice interface opens with the pulsing gradient orb.
3. Grant microphone permission when prompted.
4. Speak a question. After 1.8 s of silence, the orb transitions to "Thinking..." state.
5. **Expected**: Assistant speaks the response; the orb pulses in sync with the audio.
6. Click the black ✕ button to close the voice session.

### Feature C: Multi-Tenant RAG Isolation
1. Log in as Guest (maps to `tenant-tech`).
2. Ask: *"What is the VPN?"*  
   **Expected**: Correct answer from TechSupport knowledge base.
3. Ask: *"How do I treat the flu?"*  
   **Expected**: Chatbot says no matching documents found (health KB not accessible).

### Feature D: Mic Error Recovery
1. Open the voice interface with mic permission denied.
2. **Expected**: Red banner shows *"No microphone found"* or *"Access denied"* with specific guidance.
3. Grant permission in browser settings, click the red mic button.
4. **Expected**: Recording starts immediately without reopening the interface.
