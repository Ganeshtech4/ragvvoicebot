import pytest
import uuid
from docubot_backend.app.database.models import ChatSession, ChatMessage

def test_tenant_isolation_mock_scoping():
    # Simulate DB rows for Tenant A and Tenant B
    session_tenant_a = ChatSession(
        id=uuid.uuid4(),
        tenant_id="tenant-A",
        user_id=uuid.uuid4()
    )
    
    session_tenant_b = ChatSession(
        id=uuid.uuid4(),
        tenant_id="tenant-B",
        user_id=uuid.uuid4()
    )

    # Message sent to Tenant A
    msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_tenant_a.id,
        sender="user",
        text="Confidential data A"
    )

    # Test logic mimicking backend session verification
    requested_session_id = session_tenant_a.id
    requesting_tenant = "tenant-B"

    # Enforce policy: If requesting tenant B queries session A, raise unauthorized
    def verify_tenant_access(session, tenant_id):
        if session.tenant_id != tenant_id:
            raise PermissionError("Unauthorized access to this chat session")
        return True

    with pytest.raises(PermissionError):
        verify_tenant_access(session_tenant_a, requesting_tenant)

    # If tenant A queries session A, access should be granted
    assert verify_tenant_access(session_tenant_a, "tenant-A") is True
