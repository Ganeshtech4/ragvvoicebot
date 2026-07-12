import pytest
from datetime import timedelta
from docubot_backend.app.auth.security import create_access_token, create_refresh_token, decode_token
from shared.schemas.auth import LoginRequest

def test_jwt_generation_and_decoding():
    payload = {
        "sub": "user-123",
        "tenantId": "tenant-abc",
        "role": "user"
    }
    
    access_token = create_access_token(payload, expires_delta=timedelta(minutes=5))
    assert access_token is not None
    
    decoded = decode_token(access_token)
    assert decoded["sub"] == "user-123"
    assert decoded["tenantId"] == "tenant-abc"
    assert decoded["role"] == "user"
    assert decoded["type"] == "access"

def test_refresh_token_generation():
    payload = {
        "sub": "user-123",
        "tenantId": "tenant-abc",
        "role": "user"
    }
    
    refresh_token = create_refresh_token(payload, expires_delta=timedelta(days=1))
    assert refresh_token is not None
    
    decoded = decode_token(refresh_token)
    assert decoded["type"] == "refresh"

def test_login_request_schema():
    req = LoginRequest(username="techuser", password="password123")
    assert req.username == "techuser"
    assert req.password == "password123"
