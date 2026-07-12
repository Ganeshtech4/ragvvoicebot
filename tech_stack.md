# DocuBot Platform Technology Stack Spec

This document details the exact tech stack used across the three primary components of the DocuBot platform: **Frontend**, **Backend**, and **Chatbot-RAG**.

---

## 1. Frontend Component (`docubot-frontend/Chatbot-Website`)

* **Core Framework**: React 19.2.4 & Next.js 16.2.6 (App Router, Turbopack, TypeScript 5)
* **Styling & Design System**:
  * TailwindCSS v4 & `@tailwindcss/postcss`
  * tw-animate-css (1.4.0)
  * class-variance-authority (0.7.1)
  * clsx (2.1.1) & tailwind-merge (3.6.0)
* **UI Components & Icons**:
  * Radix UI (1.4.3)
  * Lucide React (1.16.0)
  * Shadcn (4.8.0)
* **Animations & Interactive Elements**:
  * Framer Motion (`motion` v12.40.0)
  * Lottie React (2.4.1) for animations
  * Three.js (`three` v0.184.0) & OGL (1.0.11) for WebGL renderings

---

## 2. Backend Component (`docubot-backend`)

* **Language**: Python >= 3.14 (target version config)
* **Web Framework & Server**: FastAPI (>=0.115.0) & Uvicorn (>=0.30.0) with WebSockets support
* **Database & ORM**: PostgreSQL via SQLAlchemy (asyncio >=2.0.0), Asyncpg (>=0.29.0), and Alembic (>=1.13.0) for migrations
* **Authentication, Security & Cryptography**:
  * Python-jose (cryptography backend >=3.3.0)
  * Passlib (argon2 backend >=1.7.4)
  * Cryptography (>=42.0.0) for Fernet API key encryption/decryption
  * Authlib (>=1.3.0) for OAuth (Google + GitHub social login)
* **Caching & Background Tasks**:
  * Redis (hiredis client >=5.0.0)
  * Celery (>=5.3.0)
* **Validation & Email Deliverability**:
  * Pydantic Settings (>=2.3.0) & Python-dotenv
  * Email-validator (>=2.1.0) & FastAPI-Mail (>=1.4.1)
  * Dnspython (>=2.6.0) for MX record validation checks
  * Python-slugify (>=8.0.0)
* **Storage & Clients**:
  * Aioboto3 (>=12.0.0) for async AWS S3 bucket operations
  * Qdrant Client (HTTP client >=1.7.0)

---

## 3. Chatbot-RAG Component (`chatbot-rag`)

* **Language**: Python >= 3.14
* **APIs & AI Clients**:
  * OpenAI SDK (>=2.8.1)
  * Groq SDK (>=0.36.0)
* **Machine Learning & NLP**:
  * PyTorch (>=2.9.0)
  * HuggingFace Transformers (>=4.57.1)
  * Sentence-Transformers (>=5.1.1) for embedding generation
* **Document Processing & Parsing**:
  * PDFplumber (>=0.11.9) & PyMuPDF (`pymupdf` >=1.25.0)
  * EasyOCR (>=1.7.2) for optical character recognition
  * Python-docx (>=1.2.0), Python-pptx (>=1.0.2), Openpyxl (>=3.1.5)
  * Beautiful Soup (`beautifulsoup4` >=4.14.3) for HTML scraping
  * Pandas (>=2.3.3) & NumPy (>=2.3.4)
* **Database, Vector Search & Storage**:
  * Qdrant Client (>=1.16.1) for vector search
  * SQLAlchemy (>=2.0.44) & Psycopg2-binary (>=2.9.11)
  * Redis (>=6.4.0) & Celery (redis backend >=5.6.3)
* **Web UI (Playground & Management)**: Streamlit (>=1.52.2)
* **Development Server & REST APIs**: FastAPI (>=0.127.0) & Uvicorn (>=0.41.0)
