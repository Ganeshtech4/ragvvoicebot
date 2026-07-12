from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database.connection import get_db
from app.database.models import ChatSession
from app.database.fallback_store import fallback_sessions
from app.auth.security import get_current_user_claims
from typing import Dict, Any
import uuid
import logging

logger = logging.getLogger("docubot.sessions")
router = APIRouter()

@router.get("/sessions/{userId}")
@router.get("/api/v1/sessions/{userId}")
async def get_sessions(
    userId: str, 
    db: AsyncSession = Depends(get_db),
    claims: Dict[str, Any] = Depends(get_current_user_claims)
):
    # Tenant resolution check
    auth_user_id = claims.get("sub")
    tenant_id = claims.get("tenantId")

    # Only allow users to fetch their own sessions (unless they are admin role)
    if auth_user_id != userId and claims.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized to access another user's session history"
        )

    try:
        try:
            user_uuid = uuid.UUID(userId)
            # Query scoped to current tenant
            stmt = (
                select(ChatSession)
                .where(ChatSession.user_id == user_uuid)
                .where(ChatSession.tenant_id == tenant_id)
                .order_by(ChatSession.created_at.desc())
            )
            result = await db.execute(stmt)
            sessions = result.scalars().all()
            return [{"id": str(s.id), "created_at": s.created_at.isoformat()} for s in sessions]
        except ValueError:
            logger.info(f"Invalid UUID '{userId}' for database search, querying memory fallback...")
            raise Exception("Fallback lookup triggered")
    except Exception as e:
        logger.warning(f"Database error or fallback lookup for sessions: {e}")
        fallback_list = []
        for session_id, session in fallback_sessions.items():
            if session.get("userId") == userId and session.get("tenantId") == tenant_id:
                fallback_list.append({
                    "id": session_id,
                    "created_at": session.get("createdAt")
                })
        return fallback_list
