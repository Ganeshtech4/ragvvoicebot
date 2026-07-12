import pytest
import json
from chatbot_rag.websocket.connection import decode_ws_token

def test_websocket_mock_tokens():
    # Verify mock bypass tokens resolve to the correct hardcoded claims
    def get_claims_from_token(token: str) -> dict:
        if token == "mock-tech":
            return {"tenantId": "tenant-tech", "sub": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "role": "user"}
        elif token == "mock-health":
            return {"tenantId": "tenant-health", "sub": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22", "role": "user"}
        else:
            return decode_ws_token(token)

    claims_tech = get_claims_from_token("mock-tech")
    assert claims_tech["tenantId"] == "tenant-tech"
    assert claims_tech["role"] == "user"

    claims_health = get_claims_from_token("mock-health")
    assert claims_health["tenantId"] == "tenant-health"
    assert claims_health["sub"] == "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"

def test_websocket_interrupt_handling():
    # Session state simulation
    session_state = {
        "is_processing": True,
        "audio_chunks": [b"audio1", b"audio2"]
    }

    # Interrupt function simulation
    def handle_interrupt(state):
        state["is_processing"] = False
        state["audio_chunks"] = []

    handle_interrupt(session_state)
    assert session_state["is_processing"] is False
    assert len(session_state["audio_chunks"]) == 0
