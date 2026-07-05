# Voice Interaction Layer for Multi-Tenant RAG Chatbot

This project implements a Voice Interaction Layer for a Multi-Tenant RAG Chatbot. It enables real-time, low-latency audio capture and playback, Speech-to-Text (STT) and Text-to-Speech (TTS) integration, client-side silence detection (hands-free conversational flow), and assistant interruption (barge-in).

The entire system is containerized with Docker, proxied by Nginx, and isolates database records per tenant.

---

## 1. High-Level Architecture

```text
       Browser (Next.js Frontend)
        ├── Chat UI (Text Entry / Stream response display)
        ├── Voice Hub (PTT / Hands-Free mode controllers)
        ├── Canvas Wave Visualizer (HTML5 Web Audio API)
        └── Audio Queue Playback Manager (Gapless streaming)
                     │
            HTTP / WebSockets (/ws)
                     │
                     ▼
             Nginx Proxy (Port 80)
           ┌─────────┴─────────┐
           ▼                   ▼
    Voice Gateway (5002)    Chatbot API (5001)
     ├── STT Adapter         ├── PG Database Client
     ├── TTS Adapter         ├── Redis Cache Client
     └── Streaming Engine    ├── Multi-Tenant Auth
                             └── RAG Document Search
```

---

## 2. Directory Layout

- `frontend/`: Next.js App Router project styled with Tailwind CSS. Includes audio recorders and canvas visualizers.
- `voice-gateway/`: Express WebSocket server handling audio chunk aggregation, STT (OpenAI Whisper), and sentence-by-sentence streaming TTS.
- `chatbot-api/`: Express API simulating the main business logic (Authentication, sessions, Postgres/Redis connection, and multi-tenant RAG matches).
- `infra/`:
  - `nginx/nginx.conf`: Routing rules mapping frontend, API, and socket gateways.
  - `db/init.sql`: SQL database schema seeding isolated knowledge bases for `TechSupport Corp` and `HealthAdvice Inc`.

---

## 3. Getting Started

### Prerequisites
- [Docker & Docker Compose](https://www.docker.com/) installed.
- (Optional) An [OpenAI API Key](https://platform.openai.com/) to test real AI voice and transcriptions. (The system runs automatically in a fully functional **Mock Mode** if no key is supplied, enabling local offline testing).

### Running the Application

1. Create a `.env` file at the root directory of the project and add your OpenAI API Key (if you wish to test real AI models):
   ```env
   OPENAI_API_KEY=your-openai-api-key-here
   ```
   *If you do not create a `.env` file, the system defaults to "mock" mode, which uses local synthesized synthesizer sounds and rotates RAG test questions automatically.*

2. Start the services using Docker Compose:
   ```bash
   docker-compose up --build
   ```

3. Open your browser and navigate to:
   ```text
   http://localhost
   ```

---

## 4. Verification and Testing Flow

### Multi-Tenant RAG Isolation Test
1. At the login gate, click **TechSupport Corp** (logs in as `techuser` under `tenant-tech`).
2. Ask a question via voice or text: "How do I reset my password?" or "What is the VPN?"
3. The chatbot will retrieve context from the **TechSupport** database and answer.
4. Log out and click **HealthAdvice Inc** (logs in as `healthuser` under `tenant-health`).
5. Ask: "How do I care for the flu?"
6. The chatbot will retrieve context from the **HealthAdvice** database and answer.
7. Try asking HealthAdvice about "VPN configurations" — it will politely inform you that no documents match in its database. This confirms **strict tenant isolation**.

### Hands-Free Conversation Flow
1. Toggle the Voice Mode switch to **Hands-Free**.
2. Click the microphone button to start a session.
3. Speak your question. When you stop speaking, the client-side **Silence Detection** will notice you are quiet for 1.8 seconds, stop recording, and automatically send the audio.
4. The bot will speak the response. Once the bot finishes speaking, the client will automatically start recording again, allowing a continuous, hands-free voice conversation.

### Assistant Interruption (Barge-In)
1. While the assistant is in the middle of speaking its response, either start speaking (in Hands-Free mode) or press the **Interrupt Assistant** button (or hold the PTT button).
2. The browser's active audio queue will instantly halt, and the backend will cancel transcription generation to free up resources.
