import os
import uuid
import logging
from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("seed_qdrant")

DOCUMENTS = [
    # tenant-tech documents
    {
        "tenant_id": "tenant-tech",
        "title": "Reset Password Policy",
        "content": "To reset your password, navigate to the TechSupport Portal, click \"Forgot Password\", and follow the prompts sent to your registered email address. Passwords must be at least 12 characters, include a number and a special character."
    },
    {
        "tenant_id": "tenant-tech",
        "title": "VPN Configuration",
        "content": "Our company VPN requires the Cisco Secure Client. Download it from the internal tools directory, configure the connection server to vpn.techcorp.com, and authenticate using your corporate active directory credentials and Duo MFA. TechSupport Corp uses WireGuard as its default VPN protocol. Employees must connect to the corporate VPN using the domain vpn.techsupport.local."
    },
    {
        "tenant_id": "tenant-tech",
        "title": "Printer Issues Guide",
        "content": "If the printer is showing offline, restart the spooler on your Windows machine by running \"net stop spooler\" then \"net start spooler\" in an administrator command prompt, or check if IP address 192.168.1.150 is pingable."
    },
    # tenant-health documents
    {
        "tenant_id": "tenant-health",
        "title": "General Flu Care",
        "content": "For simple influenza, get plenty of rest and drink fluids like water and clear broths. Over-the-counter pain relievers like acetaminophen or ibuprofen can help manage body aches and fever. Seek emergency care if you experience difficulty breathing."
    },
    {
        "tenant_id": "tenant-health",
        "title": "Appointment Cancellation Policy",
        "content": "Appointments at HealthAdvice Inc must be cancelled at least 24 hours in advance to avoid a $25 late cancellation fee. You can cancel online through the patient portal or by calling our hotline."
    },
    {
        "tenant_id": "tenant-health",
        "title": "Healthy Diet Guidelines",
        "content": "A balanced diet should emphasize whole grains, vegetables, fruits, lean proteins, and healthy fats. Limit intake of added sugars, saturated fats, and processed foods. Drink at least 8 glasses of water daily."
    }
]

def main():
    qdrant_host = os.getenv("QDRANT_HOST", "qdrant")
    qdrant_port = int(os.getenv("QDRANT_PORT", "6333"))
    client = QdrantClient(host=qdrant_host, port=qdrant_port)
    
    collection_name = "kb_documents"
    collections = client.get_collections().collections
    collection_names = [c.name for c in collections]
    
    if collection_name not in collection_names:
        logger.info(f"Creating collection '{collection_name}'...")
        client.create_collection(
            collection_name=collection_name,
            vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE)
        )
    else:
        logger.info(f"Collection '{collection_name}' already exists.")
        
    logger.info("Initializing SentenceTransformer...")
    model = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")
    
    points = []
    for doc in DOCUMENTS:
        doc_id = str(uuid.uuid4())
        logger.info(f"Processing doc: {doc['title']} for tenant {doc['tenant_id']}")
        
        vector = model.encode(doc["content"]).tolist()
        
        points.append(
            models.PointStruct(
                id=str(uuid.uuid4()),
                vector=vector,
                payload={
                    "tenant_id": doc["tenant_id"],
                    "document_id": doc_id,
                    "title": doc["title"],
                    "content": doc["content"],
                    "chunk_index": 0
                }
            )
        )
        
    logger.info(f"Upserting {len(points)} points into Qdrant...")
    client.upsert(collection_name=collection_name, points=points)
    logger.info("Seeding completed successfully!")

if __name__ == "__main__":
    main()
