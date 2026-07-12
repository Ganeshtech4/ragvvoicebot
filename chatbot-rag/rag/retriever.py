import os
import logging
import numpy as np
from sentence_transformers import SentenceTransformer
from vector_store.factory import get_vector_store

logger = logging.getLogger("docubot.rag")

_embedding_model = None

def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        try:
            logger.info("Initializing SentenceTransformer 'all-MiniLM-L6-v2'...")
            _embedding_model = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")
            logger.info("SentenceTransformer initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to load sentence-transformers model: {e}")
            _embedding_model = None
    return _embedding_model

def compute_embedding(text: str) -> list:
    model = get_embedding_model()
    if model:
        try:
            embedding = model.encode(text)
            return embedding.tolist()
        except Exception as e:
            logger.error(f"Failed to encode text: {e}")
            
    mock_vector = np.zeros(384)
    mock_vector[0] = float(len(text) % 100) / 100.0
    return mock_vector.tolist()

async def retrieve_context(tenant_id: str, query: str, top_k: int = 3) -> str:
    query_vector = compute_embedding(query)
    
    store = get_vector_store()
    await store.connect()
    
    hits = await store.search(tenant_id, query_vector, top_k=top_k)
    
    if not hits:
        logger.info("No documents found in Qdrant for this tenant.")
        return ""
        
    formatted = []
    for hit in hits:
        formatted.append(f"Title: {hit.get('title')}\nContent: {hit.get('content')}")
        
    return "\n\n".join(formatted)
