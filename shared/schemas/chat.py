from pydantic import BaseModel, Field
from typing import Optional, List

class ChatMessageSchema(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str

class ChatRequest(BaseModel):
    message: str
    tenantId: str = Field(..., alias="tenantId")
    userId: str = Field(..., alias="userId")
    sessionId: Optional[str] = Field(None, alias="sessionId")

    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "message": "How do I reset my password?",
                "tenantId": "tenant-tech",
                "userId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                "sessionId": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
            }
        }
