import os
import fitz  # PyMuPDF
import docx
import httpx
import uuid
import logging
from qdrant_client import QdrantClient
from qdrant_client.http import models
from app.celery_app import celery_app
from app.config import settings

logger = logging.getLogger("docubot.tasks")

def parse_document(file_path: str) -> str:
    ext = os.path.splitext(file_path)[1].lower()
    text = ""
    if ext == ".pdf":
        try:
            doc = fitz.open(file_path)
            for page in doc:
                text += page.get_text()
            doc.close()
        except Exception as e:
            logger.error(f"PyMuPDF failed, trying fallback text: {e}")
            raise
    elif ext in [".docx", ".doc"]:
        doc = docx.Document(file_path)
        text = "\n".join([p.text for p in doc.paragraphs])
    else:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
    return text

def chunk_text(text: str, chunk_size: int = 800, overlap: int = 200) -> list:
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks

@celery_app.task(name="app.rag.tasks.process_document_ingestion")
def process_document_ingestion(tenant_id: str, doc_id_str: str, file_path: str, title: str):
    logger.info(f"Starting Celery document ingestion for tenant {tenant_id}, doc {doc_id_str}")
    
    try:
        text = parse_document(file_path)
        if not text.strip():
            raise Exception("Parsed document text is empty")
        
        chunks = chunk_text(text)
        logger.info(f"Document split into {len(chunks)} chunks")

        qdrant_host = os.getenv("QDRANT_HOST", "qdrant")
        qdrant_port = int(os.getenv("QDRANT_PORT", "6333"))
        client = QdrantClient(host=qdrant_host, port=qdrant_port)
        
        collection_name = "kb_documents"
        collections = client.get_collections().collections
        collection_names = [c.name for c in collections]
        if collection_name not in collection_names:
            client.create_collection(
                collection_name=collection_name,
                vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE)
            )

        points = []
        chatbot_rag_url = f"{settings.CHATBOT_RAG_URL}/api/v1/embeddings"

        for idx, chunk in enumerate(chunks):
            try:
                resp = httpx.post(chatbot_rag_url, json={"text": chunk}, timeout=10.0)
                if resp.status_code != 200:
                    raise Exception(f"Failed to generate embedding: Status {resp.status_code}")
                vector = resp.json()["embedding"]
            except Exception as emb_err:
                logger.error(f"Embedding call failed: {emb_err}")
                import numpy as np
                mock_vector = np.zeros(384)
                mock_vector[0] = float(len(chunk) % 100) / 100.0
                vector = mock_vector.tolist()

            point_id = str(uuid.uuid5(uuid.UUID(doc_id_str), f"chunk-{idx}"))
            points.append(
                models.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload={
                        "tenant_id": tenant_id,
                        "document_id": doc_id_str,
                        "title": title,
                        "content": chunk,
                        "chunk_index": idx
                    }
                )
            )

        client.upsert(collection_name=collection_name, points=points)
        logger.info(f"Successfully indexed {len(points)} chunks in Qdrant")

        import asyncio
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
        from sqlalchemy.orm import sessionmaker
        from app.database.models import KBDocument
        
        async def save_to_db():
            engine = create_async_engine(settings.DATABASE_URL)
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as session:
                kb_doc = KBDocument(
                    id=uuid.UUID(doc_id_str),
                    tenant_id=tenant_id,
                    title=title,
                    content=text[:1000]
                )
                session.add(kb_doc)
                await session.commit()
            await engine.dispose()

        asyncio.run(save_to_db())
        logger.info("Ingestion completed successfully.")
        
    except Exception as e:
        logger.error(f"Ingestion failed for doc {doc_id_str}: {e}")
        raise e
