"""
invariant.types
~~~~~~~~~~~~~~~
Pydantic models for all Invariant API request and response payloads.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────────────────────────────
# Shared enumerations (as string literals — no Enum overhead)
# ─────────────────────────────────────────────────────────────────────────────

EntityType = str   # PERSON | PROJECT | REQUIREMENT | FILE | TASK | SUBSYSTEM | COMPONENT | EXPERIMENT | AGENT | HYPOTHESIS | CONSTRAINT_TARGET | ENVIRONMENT_STATE | GENERIC
SourceType = str   # AGENT | HUMAN | TOOL | SYSTEM | SENSOR
ClaimStatus = str  # ACTIVE | SUPERSEDED | DISPUTED | INVALIDATED | BRANCH_SPECIFIC
ConstraintType = str  # NUMERIC_RANGE | STATUS_DEPENDENCY | VERIFICATION_REQUIRED | MUTUAL_EXCLUSION | COMPLETENESS | CUSTOM
DependencyType = str  # SUPPORTS | REQUIRES | IMPLIES | INVALIDATES | BLOCKS | PRECEDES | FOLLOWS | RELATED
ActionStatus = str    # PROPOSED | VALIDATED | SIMULATED | APPROVED | REJECTED | EXECUTED | OVERRIDDEN
ContradictionStatus = str  # OPEN | RESOLVED | IGNORED
BranchStatus = str    # OPEN | MERGED | ABANDONED


# ─────────────────────────────────────────────────────────────────────────────
# Observations
# ─────────────────────────────────────────────────────────────────────────────

class CreateObservationRequest(BaseModel):
    content: str
    source_id: Optional[str] = None
    entity_ids: Optional[List[str]] = None
    type: Optional[str] = None


class Observation(BaseModel):
    id: str
    content: str
    source_id: Optional[str] = None
    entity_ids: Optional[List[str]] = None
    type: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Claims
# ─────────────────────────────────────────────────────────────────────────────

class CreateClaimRequest(BaseModel):
    entity_id: str
    predicate: str
    value: Any
    confidence: Optional[float] = None
    source_id: Optional[str] = None


class SupersedeClaimRequest(BaseModel):
    reason: str


class Claim(BaseModel):
    id: str
    entity_id: str
    predicate: str
    value: Any
    confidence: Optional[float] = None
    status: Optional[ClaimStatus] = None
    source_id: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Entities
# ─────────────────────────────────────────────────────────────────────────────

class CreateEntityRequest(BaseModel):
    name: str
    type: EntityType
    description: Optional[str] = None


class Entity(BaseModel):
    id: str
    name: str
    type: EntityType
    description: Optional[str] = None
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


class EntityState(BaseModel):
    entity_id: str
    claims: Optional[List[Claim]] = None
    model_config = {"extra": "allow"}


class EntityHistory(BaseModel):
    entity_id: str
    history: Optional[List[Any]] = None
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Contradictions
# ─────────────────────────────────────────────────────────────────────────────

class ResolveContradictionRequest(BaseModel):
    resolution: str


class Contradiction(BaseModel):
    id: str
    status: Optional[ContradictionStatus] = None
    resolution: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Branches
# ─────────────────────────────────────────────────────────────────────────────

class CreateBranchRequest(BaseModel):
    name: str
    description: Optional[str] = None


class ResolveBranchRequest(BaseModel):
    status: BranchStatus


class Branch(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    status: Optional[BranchStatus] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Constraints
# ─────────────────────────────────────────────────────────────────────────────

class CreateConstraintRequest(BaseModel):
    name: str
    type: ConstraintType
    expression: str
    entity_ids: Optional[List[str]] = None
    weight: Optional[float] = None


class Constraint(BaseModel):
    id: str
    name: str
    type: ConstraintType
    expression: str
    entity_ids: Optional[List[str]] = None
    weight: Optional[float] = None
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


class ConstraintViolation(BaseModel):
    id: str
    constraint_id: Optional[str] = None
    entity_ids: Optional[List[str]] = None
    severity: Optional[float] = None
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Dependencies
# ─────────────────────────────────────────────────────────────────────────────

class CreateDependencyRequest(BaseModel):
    from_id: str
    to_id: str
    type: DependencyType
    weight: Optional[float] = None


class Dependency(BaseModel):
    id: str
    from_entity_id: str
    to_entity_id: str
    type: DependencyType
    weight: Optional[float] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Actions
# ─────────────────────────────────────────────────────────────────────────────

class ActionRequest(BaseModel):
    operation: str
    impacted_entity_ids: List[str]
    description: str
    parameters: Optional[Dict[str, Any]] = None


class Action(BaseModel):
    id: str
    operation: str
    impacted_entity_ids: Optional[List[str]] = None
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    status: Optional[ActionStatus] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


class ActionImpact(BaseModel):
    action_id: str
    impact: Optional[Any] = None
    model_config = {"extra": "allow"}


class OverrideActionRequest(BaseModel):
    reason: str


# ─────────────────────────────────────────────────────────────────────────────
# World
# ─────────────────────────────────────────────────────────────────────────────

class CoherenceScore(BaseModel):
    coherence_score: Optional[float] = None
    phi: Optional[float] = None
    breakdown: Optional[Dict[str, Any]] = None
    weights: Optional[Dict[str, Any]] = None
    formula: Optional[str] = None
    coherence_formula: Optional[str] = None
    timestamp: Optional[datetime] = None
    model_config = {"extra": "allow"}


class WorldSnapshot(BaseModel):
    coherence_score: Optional[float] = None
    phi: Optional[float] = None
    entity_count: Optional[int] = None
    active_claim_count: Optional[int] = None
    total_claim_count: Optional[int] = None
    model_config = {"extra": "allow"}


class SettleResult(BaseModel):
    rounds: Optional[int] = None
    converged: Optional[bool] = None
    phi_before: Optional[float] = None
    phi_after: Optional[float] = None
    model_config = {"extra": "allow"}


class SearchResult(BaseModel):
    entities: Optional[List[Entity]] = None
    claims: Optional[List[Claim]] = None
    model_config = {"extra": "allow"}


class CoherenceStreamEvent(BaseModel):
    coherence_score: float
    phi: float
    timestamp: str
    entity_id: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Audit
# ─────────────────────────────────────────────────────────────────────────────

class AuditEvent(BaseModel):
    id: str
    type: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Policy
# ─────────────────────────────────────────────────────────────────────────────

class CreatePolicyRuleRequest(BaseModel):
    name: str
    trigger: str
    action: str
    conditions: Optional[Dict[str, Any]] = None


class PolicyRule(BaseModel):
    id: str
    name: str
    trigger: str
    action: str
    conditions: Optional[Dict[str, Any]] = None
    model_config = {"extra": "allow"}


class RequestApprovalRequest(BaseModel):
    action_id: str
    reason: str


class ApprovalDecisionRequest(BaseModel):
    comment: Optional[str] = None


class RejectApprovalRequest(BaseModel):
    reason: str


class Approval(BaseModel):
    id: str
    action_id: Optional[str] = None
    status: Optional[str] = None
    model_config = {"extra": "allow"}


class CreateEscalationRequest(BaseModel):
    name: str
    chain: List[Any]


class Escalation(BaseModel):
    id: str
    name: str
    chain: Optional[List[Any]] = None
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Trace
# ─────────────────────────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    name: str
    description: Optional[str] = None
    entity_ids: Optional[List[str]] = None


class TraceSession(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    entity_ids: Optional[List[str]] = None
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


class AppendEventRequest(BaseModel):
    session_id: str
    type: str
    data: Optional[Dict[str, Any]] = None
    entity_ids: Optional[List[str]] = None


class TraceEvent(BaseModel):
    id: str
    session_id: str
    type: str
    data: Optional[Dict[str, Any]] = None
    entity_ids: Optional[List[str]] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


class TimelineEntry(BaseModel):
    model_config = {"extra": "allow"}


class DiffResult(BaseModel):
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Plans
# ─────────────────────────────────────────────────────────────────────────────

class CreatePlanRequest(BaseModel):
    name: str
    description: Optional[str] = None
    goal: str
    entity_ids: Optional[List[str]] = None
    steps: Optional[List[Any]] = None


class Plan(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    goal: str
    entity_ids: Optional[List[str]] = None
    steps: Optional[List[Any]] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


class UpdateTaskStatusRequest(BaseModel):
    status: str


# ─────────────────────────────────────────────────────────────────────────────
# Workspace
# ─────────────────────────────────────────────────────────────────────────────

class WorkspaceInfo(BaseModel):
    model_config = {"extra": "allow"}


class CreateApiKeyRequest(BaseModel):
    name: str


class ApiKey(BaseModel):
    id: str
    name: str
    key: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"extra": "allow"}


class UsageInfo(BaseModel):
    model_config = {"extra": "allow"}


# ─────────────────────────────────────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class AuthResponse(BaseModel):
    token: Optional[str] = None
    user: Optional[Dict[str, Any]] = None
    model_config = {"extra": "allow"}


class UserInfo(BaseModel):
    id: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    model_config = {"extra": "allow"}
