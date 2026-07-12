from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database.connection import get_db
from app.database.models import ChatSession, ChatMessage, KBDocument
from app.database.fallback_store import fallback_sessions
from app.config import settings
from app.auth.security import get_current_user_claims
from shared.schemas.chat import ChatRequest
from typing import Dict, Any
import httpx
import uuid
import logging
import asyncio
from datetime import datetime

logger = logging.getLogger("docubot.chat")
router = APIRouter()

async def save_chat_message(session_id: str, sender: str, text: str, user_id: str, tenant_id: str, db: AsyncSession):
    try:
        session_uuid = uuid.UUID(session_id)
        msg = ChatMessage(session_id=session_uuid, sender=sender, text=text)
        db.add(msg)
        await db.commit()
    except Exception as error:
        logger.warning(f"Database unavailable, storing chat message in memory fallback: {error}")
        session = fallback_sessions.get(session_id)
        if not session:
            session = {
                "id": session_id,
                "tenantId": tenant_id,
                "userId": user_id,
                "messages": [],
                "createdAt": datetime.utcnow().isoformat()
            }
            fallback_sessions[session_id] = session
        session["messages"].append({
            "sender": sender,
            "text": text,
            "createdAt": datetime.utcnow().isoformat()
        })

async def load_chat_history(session_id: str, tenant_id: str, current_message: str, db: AsyncSession):
    try:
        session_uuid = uuid.UUID(session_id)
        # Verify tenant_id in history loader via join
        stmt = (
            select(ChatMessage)
            .join(ChatSession)
            .where(ChatMessage.session_id == session_uuid)
            .where(ChatSession.tenant_id == tenant_id)
            .order_by(ChatMessage.created_at.asc())
        )
        result = await db.execute(stmt)
        messages = result.scalars().all()
        history = []
        for m in messages:
            if m.text == current_message and m.sender == "user":
                continue
            history.append({
                "role": "user" if m.sender == "user" else "assistant",
                "content": m.text
            })
        return history[-10:]
    except Exception as error:
        logger.warning(f"Database unavailable during history load, using memory fallback: {error}")
        session = fallback_sessions.get(session_id)
        if not session or session.get("tenantId") != tenant_id:
            return []
        history = []
        for m in session.get("messages", []):
            if m["text"] == current_message and m["sender"] == "user":
                continue
            history.append({
                "role": "user" if m["sender"] == "user" else "assistant",
                "content": m["text"]
            })
        return history[-10:]

async def simulate_mock_streaming_async(query: str, tenant_id: str, db: AsyncSession):
    context = ""
    try:
        stmt = select(KBDocument).where(KBDocument.tenant_id == tenant_id)
        result = await db.execute(stmt)
        docs = result.scalars().all()
        
        query_words = [w for w in query.lower().split() if len(w) > 2]
        scored_docs = []
        for doc in docs:
            combined = f"{doc.title} {doc.content}".lower()
            score = sum(combined.count(w) for w in query_words)
            scored_docs.append((doc, score))
            
        top_docs = [
            f"Title: {d.title}\nContent: {d.content}"
            for d, s in sorted(scored_docs, key=lambda x: x[1], reverse=True)
            if s > 0 or not query_words
        ][:3]
        context = "\n\n".join(top_docs)
    except Exception as e:
        logger.error(f"Fallback context retrieval failed: {e}")

    lower_query = query.lower()
    if context:
        if "password" in lower_query or "reset" in lower_query:
            response_text = "To reset your password, navigate to the TechSupport Portal, click \"Forgot Password\", and follow the prompts sent to your registered email address. Passwords must be at least 12 characters, include a number and a special character."
        elif "vpn" in lower_query or "connect" in lower_query:
            response_text = "Our company VPN requires the Cisco Secure Client. Download it from the internal tools directory, configure the connection server to vpn.techcorp.com, and authenticate using your corporate active directory credentials and Duo MFA."
        elif "printer" in lower_query or "offline" in lower_query:
            response_text = "If the printer is showing offline, restart the spooler on your Windows machine by running \"net stop spooler\" then \"net start spooler\" in an administrator command prompt, or check if IP address 192.168.1.150 is pingable."
        elif "flu" in lower_query or "sick" in lower_query or "fever" in lower_query:
            response_text = "For simple influenza, get plenty of rest and drink fluids like water and clear broths. Over-the-counter pain relievers like acetaminophen or ibuprofen can help manage body aches and fever. Seek emergency care if you experience difficulty breathing."
        elif "cancel" in lower_query or "appointment" in lower_query:
            response_text = "Appointments at HealthAdvice Inc must be cancelled at least 24 hours in advance to avoid a $25 late cancellation fee. You can cancel online through the patient portal or by calling our hotline."
        elif "diet" in lower_query or "eat" in lower_query or "food" in lower_query:
            response_text = "A balanced diet should emphasize whole grains, vegetables, fruits, lean proteins, and healthy fats. Limit intake of added sugars, saturated fats, and processed foods. Drink at least 8 glasses of water daily."
        else:
            response_text = f"Based on company documents:\n\n{context}"
    else:
        response_text = "Hello! I am your AI assistant. I couldn't find any specific documents relating to your query in your tenant's knowledge base. Please let me know how I can help you, or ask about password resets, VPN, printers, flu care, or appointments."

    words = response_text.split(" ")
    for word in words:
        yield word + " "
        await asyncio.sleep(0.06)

async def chat_stream_generator(message: str, tenant_id: str, user_id: str, session_id: str, db: AsyncSession):
    history = await load_chat_history(session_id, tenant_id, message, db)

    payload = {
        "message": message,
        "tenantId": tenant_id,
        "userId": user_id,
        "sessionId": session_id,
        "history": history
    }

    full_assistant_response = ""
    chatbot_rag_url = f"{settings.CHATBOT_RAG_URL}/api/v1/rag/stream"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            async with client.stream("POST", chatbot_rag_url, json=payload) as resp:
                if resp.status_code != 200:
                    error_text = await resp.aread()
                    logger.error(f"chatbot-rag returned error status {resp.status_code}: {error_text.decode('utf-8')}")
                    async for chunk in simulate_mock_streaming_async(message, tenant_id, db):
                        full_assistant_response += chunk
                        yield chunk
                else:
                    async for chunk in resp.aiter_text():
                        full_assistant_response += chunk
                        yield chunk
    except Exception as e:
        logger.error(f"Failed to stream from chatbot-rag: {e}, falling back to mock streaming")
        async for chunk in simulate_mock_streaming_async(message, tenant_id, db):
            full_assistant_response += chunk
            yield chunk

    if full_assistant_response:
        await save_chat_message(session_id, "assistant", full_assistant_response, user_id, tenant_id, db)

@router.post("/chat")
@router.post("/api/v1/chat")
async def chat(
    payload: ChatRequest, 
    db: AsyncSession = Depends(get_db),
    claims: Dict[str, Any] = Depends(get_current_user_claims)
):
    message = payload.message
    # Enforce tenant and user ID derived from secure JWT claims
    tenant_id = claims.get("tenantId")
    user_id = claims.get("sub")
    session_id = payload.sessionId

    if session_id:
        # Validate that session_id belongs to the current tenant
        try:
            session_uuid = uuid.UUID(session_id)
            session_stmt = select(ChatSession).where(ChatSession.id == session_uuid)
            session_result = await db.execute(session_stmt)
            existing_session = session_result.scalars().first()
            
            if existing_session and existing_session.tenant_id != tenant_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized access to this chat session"
                )
        except ValueError:
            # Fallback memory session lookup verification
            fallback_sess = fallback_sessions.get(session_id)
            if fallback_sess and fallback_sess.get("tenantId") != tenant_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized access to this chat session"
                )
    else:
        # Create a new session
        try:
            user_uuid = uuid.UUID(user_id) if isinstance(user_id, str) and "-" in user_id else None
            new_session = ChatSession(tenant_id=tenant_id, user_id=user_uuid)
            db.add(new_session)
            await db.commit()
            await db.refresh(new_session)
            session_id = str(new_session.id)
        except Exception as e:
            logger.warning(f"Database error creating chat session, using fallback: {e}")
            session_id = f"fallback-{int(datetime.utcnow().timestamp())}"

    # Cache session tenant mapping in Redis
    try:
        import redis.asyncio as aioredis
        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await redis_client.set(f"session:{session_id}:tenant", tenant_id, ex=3600)
        await redis_client.close()
    except Exception as re_err:
        logger.warning(f"Redis cache sync failed (optional): {re_err}")

    # Save user message
    await save_chat_message(session_id, "user", message, user_id, tenant_id, db)

    return StreamingResponse(
        chat_stream_generator(message, tenant_id, user_id, session_id, db),
        media_type="text/plain; charset=utf-8",
        headers={"X-Session-ID": session_id}
    )

from pydantic import BaseModel
from fastapi import Response

class TTSRequest(BaseModel):
    text: str

@router.post("/tts")
@router.post("/api/v1/tts")
async def tts_endpoint(
    payload: TTSRequest,
    claims: Dict[str, Any] = Depends(get_current_user_claims)
):
    chatbot_rag_url = f"{settings.CHATBOT_RAG_URL}/api/v1/tts"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(chatbot_rag_url, json={"text": payload.text})
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="TTS generation failed")
            
            media_type = resp.headers.get("content-type", "audio/mpeg")
            return Response(content=resp.content, media_type=media_type)
    except Exception as e:
        logger.error(f"Failed to fetch TTS from chatbot-rag: {e}")
        raise HTTPException(status_code=500, detail=str(e))
