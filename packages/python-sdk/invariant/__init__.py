"""
invariant — Python SDK for the Invariant Coherence Engine
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Quick start::

    from invariant import InvariantClient

    client = InvariantClient(
        base_url="https://api.invariant.me",
        api_key="inv_abc123",
    )

    # World coherence score
    score = client.world.get_coherence()
    print(score["coherenceScore"])

    # Create an entity
    entity = client.entities.create(name="Reactor Core", type="COMPONENT")

    # Subscribe to live coherence stream
    client.subscribe_to_coherence(lambda ev: print(ev["coherenceScore"]))

Async usage::

    from invariant import AsyncInvariantClient
    import asyncio

    async def main():
        async with AsyncInvariantClient(base_url="...", api_key="...") as client:
            entities = await client.entities.list()

    asyncio.run(main())
"""

from .client import AsyncInvariantClient, InvariantClient
from .exceptions import (
    AuthenticationError,
    ConflictError,
    InvariantError,
    NotFoundError,
    RateLimitError,
    ServerError,
)
from .types import (
    Action,
    ActionRequest,
    ApiKey,
    Approval,
    AuditEvent,
    AuthResponse,
    Branch,
    Claim,
    CoherenceScore,
    CoherenceStreamEvent,
    Constraint,
    ConstraintViolation,
    CreateBranchRequest,
    CreateClaimRequest,
    CreateConstraintRequest,
    CreateDependencyRequest,
    CreateEntityRequest,
    CreateEscalationRequest,
    CreateObservationRequest,
    CreatePlanRequest,
    CreatePolicyRuleRequest,
    CreateSessionRequest,
    Dependency,
    DiffResult,
    Entity,
    EntityHistory,
    EntityState,
    Escalation,
    LoginRequest,
    Observation,
    Plan,
    PolicyRule,
    RegisterRequest,
    ResolveBranchRequest,
    ResolveContradictionRequest,
    SettleResult,
    TimelineEntry,
    TraceEvent,
    TraceSession,
    UpdateTaskStatusRequest,
    UserInfo,
    WorkspaceInfo,
    WorldSnapshot,
)

__version__ = "0.1.0"
__all__ = [
    # Clients
    "InvariantClient",
    "AsyncInvariantClient",
    # Exceptions
    "InvariantError",
    "RateLimitError",
    "AuthenticationError",
    "NotFoundError",
    "ConflictError",
    "ServerError",
    # Request/Response types
    "CreateObservationRequest",
    "Observation",
    "CreateClaimRequest",
    "Claim",
    "CreateEntityRequest",
    "Entity",
    "EntityState",
    "EntityHistory",
    "ResolveContradictionRequest",
    "CreateBranchRequest",
    "ResolveBranchRequest",
    "Branch",
    "CreateConstraintRequest",
    "Constraint",
    "ConstraintViolation",
    "CreateDependencyRequest",
    "Dependency",
    "ActionRequest",
    "Action",
    "CoherenceScore",
    "WorldSnapshot",
    "SettleResult",
    "CoherenceStreamEvent",
    "AuditEvent",
    "CreatePolicyRuleRequest",
    "PolicyRule",
    "Approval",
    "CreateEscalationRequest",
    "Escalation",
    "CreateSessionRequest",
    "TraceSession",
    "TraceEvent",
    "TimelineEntry",
    "DiffResult",
    "CreatePlanRequest",
    "Plan",
    "UpdateTaskStatusRequest",
    "WorkspaceInfo",
    "ApiKey",
    "LoginRequest",
    "RegisterRequest",
    "AuthResponse",
    "UserInfo",
]
