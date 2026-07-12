from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
from rag.retriever import retrieve_context, compute_embedding
from llm.orchestrator import orchestrate_chat_stream
import logging

logger = logging.getLogger("docubot.rag.routes")
router = APIRouter()

class RAGStreamRequest(BaseModel):
    message: str
    tenantId: str = Field(..., alias="tenantId")
    userId: str = Field(..., alias="userId")
    sessionId: Optional[str] = Field(None, alias="sessionId")
    history: List[Dict[str, str]] = []

    class Config:
        populate_by_name = True

class EmbeddingRequest(BaseModel):
    text: str

async def stream_rag_chat_response(message: str, tenant_id: str, history: List[Dict[str, str]]):
    import time
    import json

    t_qdrant_start = time.perf_counter()
    context = await retrieve_context(tenant_id, message)
    qdrant_ms = int((time.perf_counter() - t_qdrant_start) * 1000)

    t_groq_start = time.perf_counter()
    t_first_token = None

    async for chunk in orchestrate_chat_stream(message, context, history, is_voice=False):
        if t_first_token is None:
            t_first_token = time.perf_counter()
        yield chunk

    t_groq_end = time.perf_counter()
    groq_first_token_ms = int((t_first_token - t_groq_start) * 1000) if t_first_token else 0
    groq_total_ms = int((t_groq_end - t_groq_start) * 1000)

    metrics = {
        "qdrant_ms": qdrant_ms,
        "groq_first_token_ms": groq_first_token_ms,
        "groq_total_ms": groq_total_ms
    }
    yield f"\n[LATENCY_METRICS]:{json.dumps(metrics)}"

@router.post("/rag/stream")
@router.post("/api/v1/rag/stream")
async def rag_stream(payload: RAGStreamRequest):
    message = payload.message
    tenant_id = payload.tenantId
    history = payload.history

    logger.info(f"RAG Stream request received for tenant '{tenant_id}': message='{message}'")

    return StreamingResponse(
        stream_rag_chat_response(message, tenant_id, history),
        media_type="text/plain; charset=utf-8"
    )

@router.post("/embeddings")
@router.post("/api/v1/embeddings")
async def get_embeddings_endpoint(payload: EmbeddingRequest):
    vector = compute_embedding(payload.text)
    return {"embedding": vector}

from tts.synthesizer import synthesize_speech
from fastapi import Response
import os

class TTSRequest(BaseModel):
    text: str

@router.post("/tts")
@router.post("/api/v1/tts")
async def tts_endpoint(payload: TTSRequest):
    try:
        audio_content = await synthesize_speech(payload.text)
        provider = os.getenv("TTS_PROVIDER", "mock").lower()
        media_type = "audio/wav" if provider == "mock" else "audio/mpeg"
        return Response(content=audio_content, media_type=media_type)
    except Exception as e:
        logger.error(f"TTS endpoint error: {e}")
        return Response(content=str(e), status_code=500)
