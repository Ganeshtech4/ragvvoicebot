from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models
from vector_store.base import BaseVectorStore
from typing import List, Dict, Any
import logging

logger = logging.getLogger("docubot.qdrant")

class QdrantVectorStore(BaseVectorStore):
    def __init__(self, host: str = "qdrant", port: int = 6333, collection_name: str = "kb_documents"):
        self.host = host
        self.port = port
        self.collection_name = collection_name
        self.client = None

    async def connect(self) -> None:
        try:
            self.client = AsyncQdrantClient(host=self.host, port=self.port)
            collections = await self.client.get_collections()
            collection_names = [col.name for col in collections.collections]
            if self.collection_name not in collection_names:
                await self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE)
                )
            logger.info("Connected to Qdrant via AsyncQdrantClient.")
        except Exception as e:
            logger.error(f"Failed to connect to Qdrant: {e}")
            self.client = None

    async def search(self, tenant_id: str, query_vector: List[float], top_k: int = 3) -> List[Dict[str, Any]]:
        if not self.client:
            logger.warning("Qdrant client not initialized, skipping search.")
            return []
        try:
            filter_query = models.Filter(
                must=[
                    models.FieldCondition(
                        key="tenant_id",
                        match=models.MatchValue(value=tenant_id)
                    )
                ]
            )
            results = await self.client.search(
                collection_name=self.collection_name,
                query_vector=query_vector,
                query_filter=filter_query,
                limit=top_k
            )
            return [
                {
                    "title": hit.payload.get("title", ""),
                    "content": hit.payload.get("content", ""),
                    "score": hit.score
                }
                for hit in results
            ]
        except Exception as e:
            logger.error(f"Qdrant search failed: {e}")
            return []

    async def insert(self, tenant_id: str, doc_id: str, vector: List[float], payload: Dict[str, Any]) -> None:
        if not self.client:
            logger.warning("Qdrant client not initialized, skipping insert.")
            return
        try:
            payload["tenant_id"] = tenant_id
            await self.client.upsert(
                collection_name=self.collection_name,
                points=[
                    models.PointStruct(
                        id=doc_id,
                        vector=vector,
                        payload=payload
                    )
                ]
            )
        except Exception as e:
            logger.error(f"Qdrant upsert failed: {e}")
