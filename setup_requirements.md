# System Setup & Running Requirements

This document outlines the prerequisites, environmental configurations, and steps required to run, test, and deploy the DocuBot Voice RAG platform on your local machine or server.

---

## 1. System Prerequisites

Before running the application, make sure your host machine has the following tools installed:

| Prerequisite | Recommended Version | Purpose |
| :--- | :--- | :--- |
| **Docker & Docker Compose** | Docker 24.x+ / Compose v2.x+ | Orchestrating all 8 microservices and databases |
| **Node.js** | Node 18.x or 20.x LTS | Optional (only required to run Playwright E2E tests locally) |
| **Python** | Python 3.10+ | Optional (only required to run local python seed scripts) |
| **Microphone & Audio** | Functional Mic/Audio Device | Necessary for testing live voice capture & speech playback |

---

## 2. Configuration Setup (`.env`)

Create a `.env` file in the root directory of the project. A template of key configuration values is shown below:

```ini
# General Environment
ENVIRONMENT=development

# Postgres Database
DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/docubot
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=docubot

# Redis & Celery
REDIS_URL=redis://redis:6379/0

# Qdrant Vector DB
QDRANT_HOST=qdrant
QDRANT_PORT=6333

# Chatbot RAG Configuration
CHATBOT_RAG_URL=http://chatbot-rag:5002
LLM_PROVIDER=mock
GROQ_API_KEY=your_groq_api_key_here

# Speech-to-Text (STT) & Text-to-Speech (TTS)
STT_PROVIDER=speechbrain
TTS_PROVIDER=edge-tts
TTS_VOICE=en-US-EmmaMultilingualNeural

# JWT Authentication
JWT_SECRET=super_secret_jwt_generation_key_32_bytes_or_more
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
```

---

## 3. Running the Project

Follow these steps to build and start the entire service stack:

### Step 1: Start the Docker Containers
In the root directory (where `docker-compose.yml` is located), run:
```bash
docker compose up -d --build
```
This command builds the frontend, backend, and Celery images, and spins up Nginx, PostgreSQL, Redis, and Qdrant in the background.

### Step 2: Seed the Databases
To register the default demo profiles (`techuser` for TechSupport Corp and `healthuser` for HealthAdvice Inc) and index their sample documents in Qdrant:
1. Open a terminal on your host machine.
2. Run the seeding command inside the `chatbot-rag` container:
   ```bash
   docker compose exec chatbot-rag python seed_qdrant.py
   ```

### Step 3: Access the Application
Open your browser and navigate to:
*   **Web Portal (via Nginx Port 80)**: [http://localhost/](http://localhost/)
*   **Demo User Logins**:
    *   **TechSupport**: `techuser` / `password123`
    *   **HealthAdvice**: `healthuser` / `password123`

---

## 4. How to Run Validation Tests (E2E)

Automated testing is configured using **Playwright**. To execute the test suite:

### Step 1: Install Playwright Dependencies
Navigate to the frontend folder and install the Node packages:
```bash
cd docubot-frontend
npm install
npx playwright install chromium
```

### Step 2: Execute the Tests
Ensure the Docker containers are running, then launch the E2E script from the `docubot-frontend` folder. Pass a mock audio `.wav` file (e.g., `speech_tech.wav`) via the `VOICE_FILE` environment variable:

*   **Windows (PowerShell)**:
    ```powershell
    $env:VOICE_FILE="../speech_tech.wav"; npx playwright test e2e/voice.spec.ts
    ```
*   **macOS / Linux (Bash)**:
    ```bash
    VOICE_FILE="../speech_tech.wav" npx playwright test e2e/voice.spec.ts
    ```
*   **Playwright UI Mode** (to watch the test step-by-step in a browser):
    ```bash
    npx playwright test e2e/voice.spec.ts --ui
    ```
