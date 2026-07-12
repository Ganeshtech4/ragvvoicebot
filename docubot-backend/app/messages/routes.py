from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database.connection import get_db
from app.database.models import ChatMessage, ChatSession
from app.database.fallback_store import fallback_sessions
from app.auth.security import get_current_user_claims
from typing import Dict, Any
import uuid
import logging

logger = logging.getLogger("docubot.messages")
router = APIRouter()

@router.get("/messages/{sessionId}")
@router.get("/api/v1/messages/{sessionId}")
async def get_messages(
    sessionId: str, 
    db: AsyncSession = Depends(get_db),
    claims: Dict[str, Any] = Depends(get_current_user_claims)
):
    tenant_id = claims.get("tenantId")

    try:
        try:
            session_uuid = uuid.UUID(sessionId)
            # Enforce tenant isolation via SQL join
            stmt = (
                select(ChatMessage)
                .join(ChatSession)
                .where(ChatMessage.session_id == session_uuid)
                .where(ChatSession.tenant_id == tenant_id)
                .order_by(ChatMessage.created_at.asc())
            )
            result = await db.execute(stmt)
            messages = result.scalars().all()
            return [{
                "sender": m.sender,
                "text": m.text,
                "created_at": m.created_at.isoformat()
            } for m in messages]
        except ValueError:
            logger.info(f"Invalid UUID '{sessionId}' for database search, querying memory fallback...")
            raise Exception("Fallback lookup triggered")
    except Exception as e:
        logger.warning(f"Database error or fallback lookup for messages: {e}")
        session = fallback_sessions.get(sessionId)
        if not session or session.get("tenantId") != tenant_id:
            return []
        return [{
            "sender": m["sender"],
            "text": m["text"],
            "created_at": m["createdAt"]
        } for m in session.get("messages", [])]
