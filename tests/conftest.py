import os
import sys

# Inject app paths for imports to resolve successfully
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "docubot-backend")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "chatbot-rag")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
