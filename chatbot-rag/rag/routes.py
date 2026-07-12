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
    context = await retrieve_context(tenant_id, message)
    async for chunk in orchestrate_chat_stream(message, context, history, is_voice=False):
        yield chunk

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
