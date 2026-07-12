import os
from vector_store.base import BaseVectorStore
from vector_store.qdrant import QdrantVectorStore

def get_vector_store() -> BaseVectorStore:
    host = os.getenv("QDRANT_HOST", "qdrant")
    try:
        port = int(os.getenv("QDRANT_PORT", "6333"))
    except ValueError:
        port = 6333
    
    return QdrantVectorStore(host=host, port=port)
