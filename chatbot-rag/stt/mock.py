from stt.base import BaseSTTAdapter

MOCK_QUERIES = [
    "How do I reset my password?",
    "What is the company VPN configuration?",
    "What should I do if the printer is offline?",
    "How do I take care of myself if I have the flu?",
    "What is the appointment cancellation policy?",
    "What are the healthy diet guidelines?"
]

class MockSTTAdapter(BaseSTTAdapter):
    def __init__(self):
        self.mock_query_index = 0

    async def transcribe(self, audio_bytes: bytes, mime_type: str) -> str:
        query = MOCK_QUERIES[self.mock_query_index]
        self.mock_query_index = (self.mock_query_index + 1) % len(MOCK_QUERIES)
        return query
