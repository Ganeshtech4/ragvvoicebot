from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from config import settings
from observability.logging import setup_logging, LoggingMiddleware
from rag.routes import router as rag_router
from websocket.connection import router as ws_router
from vector_store.factory import get_vector_store
import logging

setup_logging()
logger = logging.getLogger("docubot.rag.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Connecting to Qdrant vector database...")
    try:
        store = get_vector_store()
        await store.connect()
    except Exception as e:
        logger.error(f"Failed to connect to Qdrant vector database: {e}")
        
    logger.info(f"Chatbot RAG service initialized successfully in {settings.ENVIRONMENT} mode.")
    yield
    logger.info("Chatbot RAG service shutting down...")

app = FastAPI(
    title="DocuBot Chatbot RAG Service",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logging middleware
app.add_middleware(LoggingMiddleware)

# Health probes
@app.get("/health")
@app.get("/api/v1/health")
async def health():
    return {
        "status": "ok",
        "service": "chatbot-rag",
        "environment": settings.ENVIRONMENT
    }

# Register routers
app.include_router(rag_router)
app.include_router(ws_router)
