from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database.connection import get_db
from app.database.models import KBDocument
from app.auth.security import get_current_user_claims
from app.rag.tasks import process_document_ingestion
from qdrant_client import QdrantClient
from qdrant_client.http import models
from typing import Dict, Any
import os
import uuid
import logging

logger = logging.getLogger("docubot.rag")
router = APIRouter()

UPLOAD_DIR = "/app/storage/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/rag/upload", status_code=status.HTTP_202_ACCEPTED)
@router.post("/api/v1/rag/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    file: UploadFile = File(...),
    claims: Dict[str, Any] = Depends(get_current_user_claims)
):
    tenant_id = claims.get("tenantId")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant ID missing from token claims")

    # Validate file type
    filename = file.filename
    ext = os.path.splitext(filename)[1].lower()
    if ext not in [".pdf", ".docx", ".doc", ".txt", ".md"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file format. Please upload PDF, DOCX, TXT, or MD."
        )

    # Save file locally
    doc_id = uuid.uuid4()
    file_path = os.path.join(UPLOAD_DIR, f"{doc_id}{ext}")
    try:
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
    except Exception as e:
        logger.error(f"Failed to write file locally: {e}")
        raise HTTPException(status_code=500, detail="Failed to save file locally")

    # Trigger Celery Background Processing
    process_document_ingestion.delay(tenant_id, str(doc_id), file_path, filename)

    return {
        "documentId": str(doc_id),
        "status": "processing",
        "message": "Document uploaded successfully and queued for background ingestion."
    }

@router.delete("/rag/documents/{documentId}")
@router.delete("/api/v1/rag/documents/{documentId}")
async def delete_document(
    documentId: str,
    db: AsyncSession = Depends(get_db),
    claims: Dict[str, Any] = Depends(get_current_user_claims)
):
    tenant_id = claims.get("tenantId")
    try:
        doc_uuid = uuid.UUID(documentId)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid document ID format")

    # Fetch document from DB to check ownership (Tenant Isolation)
    stmt = select(KBDocument).where(KBDocument.id == doc_uuid)
    result = await db.execute(stmt)
    db_doc = result.scalars().first()

    if not db_doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if db_doc.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized access to this document"
        )

    # 1. Delete from Qdrant
    try:
        qdrant_host = os.getenv("QDRANT_HOST", "qdrant")
        qdrant_port = int(os.getenv("QDRANT_PORT", "6333"))
        client = QdrantClient(host=qdrant_host, port=qdrant_port)
        
        client.delete(
            collection_name="kb_documents",
            points_selector=models.Filter(
                must=[
                    models.FieldCondition(
                        key="document_id",
                        match=models.MatchValue(value=documentId)
                    )
                ]
            )
        )
    except Exception as q_err:
        logger.error(f"Failed to delete points from Qdrant: {q_err}")

    # 2. Delete from PostgreSQL
    await db.delete(db_doc)
    await db.commit()

    return {
        "documentId": documentId,
        "status": "deleted",
        "message": "Document successfully deleted from Postgres and vector database."
    }
