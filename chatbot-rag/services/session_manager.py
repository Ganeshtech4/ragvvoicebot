from fastapi import WebSocket
from typing import Dict, Any, List

class VoiceSession:
    def __init__(self, connection_id: str, ws: WebSocket, tenant_id: str, user_id: str, session_id: str = None):
        self.connection_id = connection_id
        self.ws = ws
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.session_id = session_id
        self.audio_chunks: List[bytes] = []
        self.is_processing = False

class SessionManager:
    def __init__(self):
        self._sessions: Dict[str, VoiceSession] = {}

    def register(self, connection_id: str, ws: WebSocket, tenant_id: str, user_id: str, session_id: str = None) -> VoiceSession:
        session = VoiceSession(connection_id, ws, tenant_id, user_id, session_id)
        self._sessions[connection_id] = session
        return session

    def get(self, connection_id: str) -> VoiceSession:
        return self._sessions.get(connection_id)

    def remove(self, connection_id: str) -> None:
        if connection_id in self._sessions:
            del self._sessions[connection_id]

    def append_audio(self, connection_id: str, chunk: bytes) -> None:
        session = self.get(connection_id)
        if session:
            session.audio_chunks.append(chunk)

    def clear_audio(self, connection_id: str) -> None:
        session = self.get(connection_id)
        if session:
            session.audio_chunks = []
            session.is_processing = False

session_manager = SessionManager()
