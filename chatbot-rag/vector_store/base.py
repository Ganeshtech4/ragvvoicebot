from abc import ABC, abstractmethod
from typing import List, Dict, Any

class BaseVectorStore(ABC):
    @abstractmethod
    async def connect(self) -> None:
        pass

    @abstractmethod
    async def search(self, tenant_id: str, query_vector: List[float], top_k: int = 3) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    async def insert(self, tenant_id: str, doc_id: str, vector: List[float], payload: Dict[str, Any]) -> None:
        pass
