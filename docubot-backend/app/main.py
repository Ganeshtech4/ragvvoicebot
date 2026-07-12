from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.config import settings
from app.observability.logging import setup_logging, LoggingMiddleware
from app.auth.routes import router as auth_router
from app.chat.routes import router as chat_router
from app.sessions.routes import router as sessions_router
from app.messages.routes import router as messages_router
from app.rag.routes import router as rag_router
import logging

setup_logging()
logger = logging.getLogger("docubot.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"DocuBot Backend API Gateway starting in {settings.ENVIRONMENT} mode...")
    yield
    logger.info("DocuBot Backend API Gateway shutting down...")

app = FastAPI(
    title="DocuBot Backend API Gateway",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request ID and structured logging middleware
app.add_middleware(LoggingMiddleware)

# Health probes
@app.get("/health")
@app.get("/api/v1/health")
async def health():
    return {
        "status": "ok",
        "service": "docubot-backend",
        "environment": settings.ENVIRONMENT
    }

# Include routers
app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(sessions_router)
app.include_router(messages_router)
app.include_router(rag_router)
