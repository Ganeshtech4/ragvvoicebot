from pydantic import BaseModel, Field

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    userId: str = Field(..., alias="userId")
    username: str
    tenantId: str = Field(..., alias="tenantId")
    tenantName: str = Field(..., alias="tenantName")
    role: str
    accessToken: str = Field(..., alias="accessToken")
    refreshToken: str = Field(..., alias="refreshToken")

    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "userId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                "username": "techuser",
                "tenantId": "tenant-tech",
                "tenantName": "TechSupport Corp",
                "role": "user",
                "accessToken": "eyJhbGciOi...",
                "refreshToken": "eyJhbGciOi..."
            }
        }

class TokenRefreshRequest(BaseModel):
    refreshToken: str = Field(..., alias="refreshToken")

    class Config:
        populate_by_name = True

class TokenRefreshResponse(BaseModel):
    accessToken: str = Field(..., alias="accessToken")
    refreshToken: str = Field(..., alias="refreshToken")

    class Config:
        populate_by_name = True
