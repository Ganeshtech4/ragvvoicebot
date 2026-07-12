from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database.connection import get_db
from app.database.models import User, Tenant
from app.auth.security import create_access_token, create_refresh_token, decode_token
from shared.schemas.auth import LoginRequest, LoginResponse, TokenRefreshRequest, TokenRefreshResponse
import logging

logger = logging.getLogger("docubot.auth")
router = APIRouter()

FALLBACK_USERS = {
    "techuser": {
        "userId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "passwordHash": "password123",
        "tenantId": "tenant-tech",
        "tenantName": "TechSupport Corp",
        "role": "user"
    },
    "healthuser": {
        "userId": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        "passwordHash": "password123",
        "tenantId": "tenant-health",
        "tenantName": "HealthAdvice Inc",
        "role": "user"
    }
}

@router.post("/auth/login", response_model=LoginResponse)
@router.post("/api/v1/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    username = payload.username
    password = payload.password
    user_meta = None

    try:
        stmt = select(User).where(User.username == username)
        result = await db.execute(stmt)
        user = result.scalars().first()

        if not user:
            fallback = FALLBACK_USERS.get(username)
            if not fallback or fallback["passwordHash"] != password:
                raise HTTPException(status_code=401, detail="Invalid username or password")
            user_meta = fallback
        else:
            if user.password_hash != password:
                raise HTTPException(status_code=401, detail="Invalid username or password")

            tenant_stmt = select(Tenant).where(Tenant.id == user.tenant_id)
            tenant_result = await db.execute(tenant_stmt)
            tenant = tenant_result.scalars().first()
            tenant_name = tenant.name if tenant else "Unknown Tenant"

            user_meta = {
                "userId": str(user.id),
                "username": user.username,
                "tenantId": user.tenant_id,
                "tenantName": tenant_name,
                "role": user.role
            }
    except Exception as e:
        logger.warning(f"Database error during login, using fallback auth: {e}")
        fallback = FALLBACK_USERS.get(username)
        if not fallback or fallback["passwordHash"] != password:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        user_meta = fallback

    claims = {
        "sub": user_meta["userId"],
        "username": user_meta["username"],
        "tenantId": user_meta["tenantId"],
        "role": user_meta["role"]
    }
    
    access_token = create_access_token(claims)
    refresh_token = create_refresh_token(claims)

    return LoginResponse(
        userId=user_meta["userId"],
        username=user_meta["username"],
        tenantId=user_meta["tenantId"],
        tenantName=user_meta["tenantName"],
        role=user_meta["role"],
        accessToken=access_token,
        refreshToken=refresh_token
    )

@router.post("/auth/refresh", response_model=TokenRefreshResponse)
@router.post("/api/v1/auth/refresh", response_model=TokenRefreshResponse)
async def refresh_tokens(payload: TokenRefreshRequest):
    try:
        claims = decode_token(payload.refreshToken)
        if claims.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        
        new_claims = {
            "sub": claims["sub"],
            "username": claims["username"],
            "tenantId": claims["tenantId"],
            "role": claims["role"]
        }
        
        new_access = create_access_token(new_claims)
        new_refresh = create_refresh_token(new_claims)
        
        return TokenRefreshResponse(
            accessToken=new_access,
            refreshToken=new_refresh
        )
    except Exception as e:
        logger.warning(f"Token refresh failed: {e}")
        raise HTTPException(status_code=401, detail="Could not refresh token")
