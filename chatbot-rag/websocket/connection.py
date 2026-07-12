import json
import uuid
import base64
import re
import os
import logging
import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import jwt, JWTError
from services.session_manager import session_manager
from stt.transcriber import transcribe_audio
from tts.synthesizer import synthesize_speech

logger = logging.getLogger("docubot.websocket")
router = APIRouter()

SENTENCE_SPLIT_REGEX = re.compile(r"([.?!。？！\n])\s*")

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-production-key-change-me")
JWT_ALGORITHM = "HS256"

def decode_ws_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise Exception("Invalid token type")
        return payload
    except JWTError as e:
        raise Exception(f"Token verification failed: {e}")

@router.websocket("/ws")
@router.websocket("/api/v1/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connection_id = str(uuid.uuid4())
    logger.info(f"WebSocket client connected: {connection_id}")

    active_session_id = None

    try:
        while True:
            message = await ws.receive()
            
            # Handle binary frames (microphone audio)
            if "bytes" in message:
                audio_chunk = message["bytes"]
                if active_session_id:
                    session_manager.append_audio(active_session_id, audio_chunk)
                continue

            # Handle text control messages (JSON)
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                except Exception as parse_err:
                    logger.warning(f"Failed to parse text frame as JSON: {parse_err}")
                    continue

                event_type = data.get("type")

                if event_type == "start":
                    token = data.get("token")
                    session_id = data.get("sessionId")

                    if not token:
                        await ws.send_json({"type": "error", "message": "token is required to establish connection"})
                        continue

                    try:
                        # Support mock bypass tokens for developers
                        if token == "mock-tech":
                            claims = {
                                "tenantId": "tenant-tech",
                                "sub": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                                "role": "user"
                            }
                        elif token == "mock-health":
                            claims = {
                                "tenantId": "tenant-health",
                                "sub": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
                                "role": "user"
                            }
                        else:
                            claims = decode_ws_token(token)
                    except Exception as auth_err:
                        logger.warning(f"WebSocket auth failed: {auth_err}")
                        await ws.send_json({"type": "error", "message": f"Auth failed: {auth_err}"})
                        continue

                    tenant_id = claims.get("tenantId")
                    user_id = claims.get("sub")

                    active_session_id = connection_id
                    session = session_manager.register(connection_id, ws, tenant_id, user_id, session_id)
                    session.events = ["CONNECTED", "READY"]
                    await ws.send_json({"type": "status", "status": "ready"})
                    logger.info(f"Session registered securely for user {user_id}, tenant {tenant_id}")

                elif event_type == "stop":
                    if not active_session_id:
                        await ws.send_json({"type": "error", "message": "No active session"})
                        continue

                    session = session_manager.get(active_session_id)
                    if not session or not session.audio_chunks:
                        await ws.send_json({"type": "status", "status": "ready"})
                        continue

                    session.is_processing = True
                    await ws.send_json({"type": "status", "status": "processing"})

                    import time
                    t_loop_start = time.perf_counter()

                    audio_bytes = b"".join(session.audio_chunks)
                    session.audio_chunks = []

                    logger.info(f"Processing audio stream ({len(audio_bytes)} bytes)")
                    
                    t_asr_start = time.perf_counter()
                    user_transcript = await transcribe_audio(audio_bytes, "audio/webm")
                    t_asr_end = time.perf_counter()
                    
                    stt_ms = int((t_asr_end - t_asr_start) * 1000)
                    session.events.append("FINAL_TRANSCRIPT")

                    if not session.is_processing:
                        logger.info("Session interrupted during STT. Aborting.")
                        continue

                    logger.info(f"STT Transcript: '{user_transcript}'")

                    await ws.send_json({
                        "type": "transcript",
                        "sender": "user",
                        "text": user_transcript,
                        "isFinal": True
                    })

                    if not user_transcript.strip():
                        await ws.send_json({"type": "status", "status": "ready"})
                        session.is_processing = False
                        continue

                    docubot_backend_url = os.getenv("DOCUBOT_BACKEND_URL", "http://docubot-backend:5001")
                    chat_url = f"{docubot_backend_url}/api/v1/chat"

                    payload = {
                        "message": user_transcript,
                        "tenantId": session.tenant_id,
                        "userId": session.user_id,
                        "sessionId": session.session_id
                    }

                    # Propagate WebSocket auth token to API Gateway request
                    import time
                    exp_time = int(time.time() + 3600)
                    claims_payload = {
                        "sub": session.user_id,
                        "username": "ws-session",
                        "tenantId": session.tenant_id,
                        "role": "user",
                        "type": "access",
                        "exp": exp_time
                    }
                    temp_token = jwt.encode(claims_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
                    headers = {"Authorization": f"Bearer {temp_token}"}

                    sentence_buffer = ""
                    full_text = ""
                    await ws.send_json({"type": "status", "status": "playing"})

                    qdrant_ms = 0
                    groq_first_token_ms = 0
                    groq_total_ms = 0
                    t_tts_start = time.perf_counter()
                    t_tts_first = None
                    total_audio_bytes = 0

                    try:
                        async with httpx.AsyncClient(timeout=30.0) as client:
                            async with client.stream("POST", chat_url, json=payload, headers=headers) as resp:
                                if resp.status_code != 200:
                                    err_content = await resp.aread()
                                    raise Exception(f"API gateway error: Status {resp.status_code}")

                                returned_session_id = resp.headers.get("X-Session-ID")
                                if returned_session_id and not session.session_id:
                                    session.session_id = returned_session_id
                                    await ws.send_json({
                                        "type": "session_created",
                                        "sessionId": returned_session_id
                                    })

                                async for chunk in resp.aiter_text():
                                    if not session.is_processing:
                                        logger.info("User interrupted assistant stream (Barge-in).")
                                        break

                                    full_text += chunk
                                    sentence_buffer += chunk

                                    # Prevent streaming metric tags to client transcript
                                    display_text = chunk
                                    if "[LATENCY_METRICS]" in display_text or "LATENCY" in display_text:
                                        continue

                                    if "ASSISTANT_PARTIAL" not in session.events:
                                        session.events.append("ASSISTANT_PARTIAL")

                                    await ws.send_json({
                                        "type": "transcript",
                                        "sender": "assistant",
                                        "text": display_text,
                                        "isFinal": False
                                    })

                                    last_index = 0
                                    for match in SENTENCE_SPLIT_REGEX.finditer(sentence_buffer):
                                        sentence = sentence_buffer[last_index:match.end()].strip()
                                        last_index = match.end()

                                        # Strip metrics marker from sentences
                                        latency_marker = "\n[LATENCY_METRICS]:"
                                        if latency_marker in sentence:
                                            sentence = sentence.split(latency_marker)[0].strip()

                                        if len(sentence) > 2:
                                            logger.info(f"Synthesizing chunk: '{sentence}'")
                                            try:
                                                audio_chunk = await synthesize_speech(sentence)
                                                if session.is_processing:
                                                    if t_tts_first is None:
                                                        t_tts_first = time.perf_counter()
                                                        session.events.append("AUDIO_START")
                                                    
                                                    total_audio_bytes += len(audio_chunk)
                                                    base64_audio = base64.b64encode(audio_chunk).decode("utf-8")
                                                    await ws.send_json({
                                                        "type": "audio",
                                                        "data": base64_audio,
                                                        "text": sentence
                                                    })
                                            except Exception as synth_err:
                                                logger.error(f"Failed synthesizing chunk: {synth_err}")

                                    sentence_buffer = sentence_buffer[last_index:]

                        latency_marker = "\n[LATENCY_METRICS]:"
                        if sentence_buffer.strip() and session.is_processing:
                            final_sentence = sentence_buffer.split(latency_marker)[0].strip()
                            if final_sentence:
                                logger.info(f"Synthesizing final fragment: '{final_sentence}'")
                                try:
                                    audio_chunk = await synthesize_speech(final_sentence)
                                    if t_tts_first is None:
                                        t_tts_first = time.perf_counter()
                                        session.events.append("AUDIO_START")
                                    
                                    total_audio_bytes += len(audio_chunk)
                                    base64_audio = base64.b64encode(audio_chunk).decode("utf-8")
                                    await ws.send_json({
                                        "type": "audio",
                                        "data": base64_audio,
                                        "text": final_sentence
                                    })
                                except Exception as synth_err:
                                    logger.error(f"Failed synthesizing final fragment: {synth_err}")

                        # Extract metrics
                        if latency_marker in full_text:
                            parts = full_text.split(latency_marker)
                            metrics_str = parts[1].strip()
                            try:
                                m_data = json.loads(metrics_str)
                                qdrant_ms = m_data.get("qdrant_ms", 0)
                                groq_first_token_ms = m_data.get("groq_first_token_ms", 0)
                                groq_total_ms = m_data.get("groq_total_ms", 0)
                            except Exception as e:
                                logger.error(f"Error parsing latency metrics: {e}")

                    except Exception as chat_err:
                        logger.error(f"Error calling API gateway: {chat_err}")
                        await ws.send_json({"type": "error", "message": "Failed to get response from assistant"})

                    t_loop_end = time.perf_counter()
                    session.events.append("AUDIO_END")
                    session.events.append("ASSISTANT_FINAL")

                    tts_ms = int((t_loop_end - t_tts_start) * 1000)
                    total_ms = int((t_loop_end - t_loop_start) * 1000)

                    stats = {
                        "stt_ms": stt_ms,
                        "qdrant_ms": qdrant_ms,
                        "groq_first_token_ms": groq_first_token_ms,
                        "groq_total_ms": groq_total_ms,
                        "tts_ms": tts_ms,
                        "total_ms": total_ms,
                        "audio_size_bytes": total_audio_bytes
                    }

                    # Propagate latency to client
                    await ws.send_json({
                        "type": "latency",
                        "stats": stats
                    })

                    # Write structured session trace and benchmark metrics
                    try:
                        import datetime
                        os.makedirs("benchmarks/voice", exist_ok=True)
                        session_data = {
                            "session_id": session.session_id or active_session_id,
                            "tenant_id": session.tenant_id,
                            "user_id": session.user_id,
                            "events": session.events,
                            "stats": stats,
                            "timestamp": datetime.datetime.utcnow().isoformat()
                        }
                        with open("benchmarks/voice-session.json", "w") as f:
                            json.dump(session_data, f, indent=2)

                        timestamp_str = datetime.datetime.utcnow().strftime("%Y-%m-%d_%H-%M-%S")
                        benchmark_path = f"benchmarks/voice/{timestamp_str}_{session_data['session_id']}.json"
                        with open(benchmark_path, "w") as f:
                            json.dump(session_data, f, indent=2)
                        
                        logger.info(f"Saved session trace and benchmark to benchmarks/voice")
                    except Exception as log_err:
                        logger.error(f"Failed to write structured latency log: {log_err}")

                    await ws.send_json({
                        "type": "transcript",
                        "sender": "assistant",
                        "text": "",
                        "isFinal": True
                    })

                    await ws.send_json({"type": "status", "status": "ready"})
                    session.is_processing = False

                elif event_type == "interrupt":
                    if active_session_id:
                        logger.info(f"Interrupting session: {active_session_id}")
                        session_manager.clear_audio(active_session_id)
                        await ws.send_json({"type": "status", "status": "ready"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected: {connection_id}")
    except Exception as ws_err:
        logger.error(f"WebSocket runtime error: {ws_err}")
    finally:
        if active_session_id:
            session_manager.remove(active_session_id)
