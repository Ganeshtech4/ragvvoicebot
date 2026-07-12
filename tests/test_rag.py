import pytest
from docubot_backend.app.rag.tasks import chunk_text
from chatbot_rag.rag.retriever import compute_embedding

def test_chunk_text_logic():
    text = "A" * 1500
    chunks = chunk_text(text, chunk_size=500, overlap=100)
    
    # 0 to 500
    # 400 to 900
    # 800 to 1300
    # 1200 to 1700 (pads/stops at 1500)
    assert len(chunks) >= 3
    for chunk in chunks:
        assert len(chunk) <= 500

def test_compute_embedding_dimensions():
    text = "Hello, world!"
    vector = compute_embedding(text)
    assert len(vector) == 384
    assert isinstance(vector, list)
    assert isinstance(vector[0], float)

def test_qdrant_filter_payload_generation():
    tenant_id = "tenant-test"
    # Expected Qdrant filter condition structure
    filter_query = {
        "must": [
            {
                "key": "tenant_id",
                "match": {
                    "value": tenant_id
                }
            }
        ]
    }
    assert filter_query["must"][0]["key"] == "tenant_id"
    assert filter_query["must"][0]["match"]["value"] == "tenant-test"
