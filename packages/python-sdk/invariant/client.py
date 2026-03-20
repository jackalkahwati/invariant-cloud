"""
invariant.client
~~~~~~~~~~~~~~~~
Sync and async Invariant API clients.

Usage (sync):
    from invariant import InvariantClient

    client = InvariantClient(base_url="https://api.invariant.me", api_key="inv_...")
    score = client.world.get_coherence()
    print(score["coherenceScore"])

Usage (async):
    from invariant import AsyncInvariantClient
    import asyncio

    async def main():
        async with AsyncInvariantClient(base_url="...", api_key="...") as client:
            score = await client.world.get_coherence()

    asyncio.run(main())
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Generator, List, Optional

from ._http import AsyncTransport, SyncTransport


# ─────────────────────────────────────────────────────────────────────────────
# Resource base classes
# ─────────────────────────────────────────────────────────────────────────────


class _SyncResource:
    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def _get(self, path: str, **params: Any) -> Any:
        return self._t.request("GET", path, params=params)

    def _post(self, path: str, body: Any = None) -> Any:
        return self._t.request("POST", path, json_body=body)

    def _patch(self, path: str, body: Any = None) -> Any:
        return self._t.request("PATCH", path, json_body=body)

    def _delete(self, path: str) -> Any:
        return self._t.request("DELETE", path)

    def _put(self, path: str, body: Any = None) -> Any:
        return self._t.request("PUT", path, json_body=body)


class _AsyncResource:
    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def _get(self, path: str, **params: Any) -> Any:
        return await self._t.request("GET", path, params=params)

    async def _post(self, path: str, body: Any = None) -> Any:
        return await self._t.request("POST", path, json_body=body)

    async def _patch(self, path: str, body: Any = None) -> Any:
        return await self._t.request("PATCH", path, json_body=body)

    async def _delete(self, path: str) -> Any:
        return await self._t.request("DELETE", path)

    async def _put(self, path: str, body: Any = None) -> Any:
        return await self._t.request("PUT", path, json_body=body)


# ─────────────────────────────────────────────────────────────────────────────
# Sync resource implementations
# ─────────────────────────────────────────────────────────────────────────────


class ObservationsResource(_SyncResource):
    def create(
        self,
        content: str,
        source_id: Optional[str] = None,
        entity_ids: Optional[List[str]] = None,
        type: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._post("/observations", {
            "content": content,
            "sourceId": source_id,
            "entityIds": entity_ids,
            "type": type,
        })

    def get(self, id: str) -> Dict[str, Any]:
        return self._get(f"/observations/{id}")


class ClaimsResource(_SyncResource):
    def create(
        self,
        entity_id: str,
        predicate: str,
        value: Any,
        confidence: Optional[float] = None,
        source_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._post("/claims", {
            "entityId": entity_id,
            "predicate": predicate,
            "value": value,
            "confidence": confidence,
            "sourceId": source_id,
        })

    def get(self, id: str) -> Dict[str, Any]:
        return self._get(f"/claims/{id}")

    def supersede(self, id: str, reason: str) -> Dict[str, Any]:
        return self._post(f"/claims/{id}/supersede", {"reason": reason})


class EntitiesResource(_SyncResource):
    def list(
        self,
        type: Optional[str] = None,
        active: Optional[bool] = True,
    ) -> List[Dict[str, Any]]:
        return self._get("/entities", type=type, active=active)

    def get(self, id: str) -> Dict[str, Any]:
        return self._get(f"/entities/{id}")

    def get_state(self, id: str) -> Dict[str, Any]:
        return self._get(f"/entities/{id}/state")

    def get_history(self, id: str) -> Dict[str, Any]:
        return self._get(f"/entities/{id}/history")

    def create(
        self,
        name: str,
        type: str,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._post("/entities", {
            "name": name,
            "type": type,
            "description": description,
        })


class ContradictionsResource(_SyncResource):
    def list(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._get("/contradictions", status=status)

    def get(self, id: str) -> Dict[str, Any]:
        return self._get(f"/contradictions/{id}")

    def resolve(self, id: str, resolution: str) -> Dict[str, Any]:
        return self._post(f"/contradictions/{id}/resolve", {"resolution": resolution})


class BranchesResource(_SyncResource):
    def list(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._get("/branches", status=status)

    def get(self, id: str) -> Dict[str, Any]:
        return self._get(f"/branches/{id}")

    def resolve(self, id: str, status: str) -> Dict[str, Any]:
        return self._post(f"/branches/{id}/resolve", {"status": status})

    def create(self, name: str, description: Optional[str] = None) -> Dict[str, Any]:
        return self._post("/branches", {"name": name, "description": description})


class ConstraintsResource(_SyncResource):
    def list(self, active: Optional[bool] = None) -> List[Dict[str, Any]]:
        return self._get("/constraints", active=active)

    def create(
        self,
        name: str,
        type: str,
        expression: str,
        entity_ids: Optional[List[str]] = None,
        weight: Optional[float] = None,
    ) -> Dict[str, Any]:
        return self._post("/constraints", {
            "name": name,
            "type": type,
            "expression": expression,
            "entityIds": entity_ids,
            "weight": weight,
        })

    def violations(self) -> List[Dict[str, Any]]:
        return self._get("/constraints/violations")


class DependenciesResource(_SyncResource):
    def list(
        self,
        from_entity_id: Optional[str] = None,
        to_entity_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self._get("/dependencies", fromEntityId=from_entity_id, toEntityId=to_entity_id)

    def create(
        self,
        from_id: str,
        to_id: str,
        type: str,
        weight: Optional[float] = None,
    ) -> Dict[str, Any]:
        return self._post("/dependencies", {
            "fromId": from_id,
            "toId": to_id,
            "type": type,
            "weight": weight,
        })

    def remove(self, id: str) -> None:
        return self._delete(f"/dependencies/{id}")


class ActionsResource(_SyncResource):
    def _action_body(
        self,
        operation: str,
        impacted_entity_ids: List[str],
        description: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {
            "operation": operation,
            "impactedEntityIds": impacted_entity_ids,
            "description": description,
            "parameters": parameters,
        }

    def propose(
        self,
        operation: str,
        impacted_entity_ids: List[str],
        description: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._post("/actions/propose", self._action_body(operation, impacted_entity_ids, description, parameters))

    def validate(
        self,
        operation: str,
        impacted_entity_ids: List[str],
        description: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._post("/actions/validate", self._action_body(operation, impacted_entity_ids, description, parameters))

    def simulate(
        self,
        operation: str,
        impacted_entity_ids: List[str],
        description: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._post("/actions/simulate", self._action_body(operation, impacted_entity_ids, description, parameters))

    def get(self, id: str) -> Dict[str, Any]:
        return self._get(f"/actions/{id}")

    def get_impact(self, id: str) -> Dict[str, Any]:
        return self._get(f"/actions/{id}/impact")

    def override(self, id: str, reason: str) -> Dict[str, Any]:
        return self._post(f"/actions/{id}/override", {"reason": reason})

    def list(
        self,
        limit: Optional[int] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self._get("/actions", limit=limit, status=status)


class WorldResource(_SyncResource):
    def get_coherence(self) -> Dict[str, Any]:
        return self._get("/world/coherence")

    def get_snapshot(self) -> Dict[str, Any]:
        return self._get("/world/snapshot")

    def settle(self) -> Dict[str, Any]:
        return self._post("/world/settle")

    def get_history(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        return self._get("/world/history", limit=limit)

    def search(
        self,
        query: str,
        type: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._get("/search", q=query, type=type)

    def subscribe_to_coherence(
        self,
        callback: Callable[[Dict[str, Any]], None],
        entity_id: Optional[str] = None,
    ) -> None:
        """
        Subscribe to the /world/stream SSE endpoint, calling *callback* for
        every event received.  Blocks until the connection is closed or an
        exception is raised.
        """
        params: Dict[str, Any] = {}
        if entity_id:
            params["entityId"] = entity_id
        for event in self._t.stream_sse("/world/stream", params=params):
            callback(event)

    def stream(
        self,
        entity_id: Optional[str] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        """Yield raw SSE event dicts from /world/stream."""
        params: Dict[str, Any] = {}
        if entity_id:
            params["entityId"] = entity_id
        yield from self._t.stream_sse("/world/stream", params=params)


class AuditResource(_SyncResource):
    def list(
        self,
        limit: Optional[int] = None,
        type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self._get("/audit", limit=limit, type=type)

    def get(self, id: str) -> Dict[str, Any]:
        return self._get(f"/audit/{id}")


class PolicyResource(_SyncResource):
    def list_rules(self) -> List[Dict[str, Any]]:
        return self._get("/policy/rules")

    def create_rule(
        self,
        name: str,
        trigger: str,
        action: str,
        conditions: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._post("/policy/rules", {
            "name": name,
            "trigger": trigger,
            "action": action,
            "conditions": conditions,
        })

    def list_approvals(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._get("/policy/approvals", status=status)

    def request_approval(self, action_id: str, reason: str) -> Dict[str, Any]:
        return self._post("/policy/approvals", {"actionId": action_id, "reason": reason})

    def approve(self, id: str, comment: Optional[str] = None) -> Dict[str, Any]:
        return self._post(f"/policy/approvals/{id}/approve", {"comment": comment})

    def reject(self, id: str, reason: str) -> Dict[str, Any]:
        return self._post(f"/policy/approvals/{id}/reject", {"reason": reason})

    def list_escalations(self) -> List[Dict[str, Any]]:
        return self._get("/policy/escalations")

    def create_escalation(self, name: str, chain: List[Any]) -> Dict[str, Any]:
        return self._post("/policy/escalations", {"name": name, "chain": chain})


class TraceResource(_SyncResource):
    def create_session(
        self,
        name: str,
        description: Optional[str] = None,
        entity_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return self._post("/trace/sessions", {
            "name": name,
            "description": description,
            "entityIds": entity_ids,
        })

    def list_sessions(self, active: Optional[bool] = None) -> List[Dict[str, Any]]:
        return self._get("/trace/sessions", active=active)

    def get_session(self, id: str) -> Dict[str, Any]:
        return self._get(f"/trace/sessions/{id}")

    def end_session(self, id: str) -> Dict[str, Any]:
        return self._post(f"/trace/sessions/{id}/end")

    def append_event(
        self,
        session_id: str,
        type: str,
        data: Optional[Dict[str, Any]] = None,
        entity_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return self._post(f"/trace/sessions/{session_id}/events", {
            "type": type,
            "data": data,
            "entityIds": entity_ids,
        })

    def get_events(self, session_id: str) -> List[Dict[str, Any]]:
        return self._get(f"/trace/sessions/{session_id}/events")

    def replay(self, session_id: str) -> Dict[str, Any]:
        return self._post(f"/trace/sessions/{session_id}/replay")

    def get_timeline(
        self,
        entity_id: str,
        since: Optional[str] = None,
        until: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self._get(f"/trace/timeline/{entity_id}", since=since, until=until)

    def diff(self, session_id_1: str, session_id_2: str) -> Dict[str, Any]:
        return self._get(f"/trace/diff", sessionId1=session_id_1, sessionId2=session_id_2)


class PlansResource(_SyncResource):
    def list(self) -> List[Dict[str, Any]]:
        return self._get("/plans")

    def create(
        self,
        name: str,
        description: Optional[str] = None,
        goal: str = "",
        entity_ids: Optional[List[str]] = None,
        steps: Optional[List[Any]] = None,
    ) -> Dict[str, Any]:
        return self._post("/plans", {
            "name": name,
            "description": description,
            "goal": goal,
            "entityIds": entity_ids,
            "steps": steps,
        })

    def get(self, id: str) -> Dict[str, Any]:
        return self._get(f"/plans/{id}")

    def decompose(self, id: str) -> Dict[str, Any]:
        return self._post(f"/plans/{id}/decompose")

    def execute(self, id: str) -> Dict[str, Any]:
        return self._post(f"/plans/{id}/execute")

    def coherence_analysis(self, id: str) -> Dict[str, Any]:
        return self._get(f"/plans/{id}/coherence")

    def update_task_status(self, plan_id: str, task_id: str, status: str) -> Dict[str, Any]:
        return self._patch(f"/plans/{plan_id}/tasks/{task_id}", {"status": status})


class WorkspaceResource(_SyncResource):
    def info(self) -> Dict[str, Any]:
        return self._get("/workspace")

    def create_api_key(self, name: str) -> Dict[str, Any]:
        return self._post("/workspace/api-keys", {"name": name})

    def list_api_keys(self) -> List[Dict[str, Any]]:
        return self._get("/workspace/api-keys")

    def revoke_api_key(self, id: str) -> None:
        return self._delete(f"/workspace/api-keys/{id}")

    def get_usage(self) -> Dict[str, Any]:
        return self._get("/workspace/usage")


class AuthResource(_SyncResource):
    def login(self, email: str, password: str) -> Dict[str, Any]:
        return self._post("/auth/login", {"email": email, "password": password})

    def register(self, email: str, password: str, name: str) -> Dict[str, Any]:
        return self._post("/auth/register", {"email": email, "password": password, "name": name})

    def me(self) -> Dict[str, Any]:
        return self._get("/auth/me")


# ─────────────────────────────────────────────────────────────────────────────
# Async resource implementations
# ─────────────────────────────────────────────────────────────────────────────


class AsyncObservationsResource(_AsyncResource):
    async def create(
        self,
        content: str,
        source_id: Optional[str] = None,
        entity_ids: Optional[List[str]] = None,
        type: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._post("/observations", {
            "content": content,
            "sourceId": source_id,
            "entityIds": entity_ids,
            "type": type,
        })

    async def get(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/observations/{id}")


class AsyncClaimsResource(_AsyncResource):
    async def create(
        self,
        entity_id: str,
        predicate: str,
        value: Any,
        confidence: Optional[float] = None,
        source_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._post("/claims", {
            "entityId": entity_id,
            "predicate": predicate,
            "value": value,
            "confidence": confidence,
            "sourceId": source_id,
        })

    async def get(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/claims/{id}")

    async def supersede(self, id: str, reason: str) -> Dict[str, Any]:
        return await self._post(f"/claims/{id}/supersede", {"reason": reason})


class AsyncEntitiesResource(_AsyncResource):
    async def list(
        self,
        type: Optional[str] = None,
        active: Optional[bool] = True,
    ) -> List[Dict[str, Any]]:
        return await self._get("/entities", type=type, active=active)

    async def get(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/entities/{id}")

    async def get_state(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/entities/{id}/state")

    async def get_history(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/entities/{id}/history")

    async def create(
        self,
        name: str,
        type: str,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._post("/entities", {
            "name": name,
            "type": type,
            "description": description,
        })


class AsyncContradictionsResource(_AsyncResource):
    async def list(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        return await self._get("/contradictions", status=status)

    async def get(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/contradictions/{id}")

    async def resolve(self, id: str, resolution: str) -> Dict[str, Any]:
        return await self._post(f"/contradictions/{id}/resolve", {"resolution": resolution})


class AsyncBranchesResource(_AsyncResource):
    async def list(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        return await self._get("/branches", status=status)

    async def get(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/branches/{id}")

    async def resolve(self, id: str, status: str) -> Dict[str, Any]:
        return await self._post(f"/branches/{id}/resolve", {"status": status})

    async def create(self, name: str, description: Optional[str] = None) -> Dict[str, Any]:
        return await self._post("/branches", {"name": name, "description": description})


class AsyncConstraintsResource(_AsyncResource):
    async def list(self, active: Optional[bool] = None) -> List[Dict[str, Any]]:
        return await self._get("/constraints", active=active)

    async def create(
        self,
        name: str,
        type: str,
        expression: str,
        entity_ids: Optional[List[str]] = None,
        weight: Optional[float] = None,
    ) -> Dict[str, Any]:
        return await self._post("/constraints", {
            "name": name,
            "type": type,
            "expression": expression,
            "entityIds": entity_ids,
            "weight": weight,
        })

    async def violations(self) -> List[Dict[str, Any]]:
        return await self._get("/constraints/violations")


class AsyncDependenciesResource(_AsyncResource):
    async def list(
        self,
        from_entity_id: Optional[str] = None,
        to_entity_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return await self._get("/dependencies", fromEntityId=from_entity_id, toEntityId=to_entity_id)

    async def create(
        self,
        from_id: str,
        to_id: str,
        type: str,
        weight: Optional[float] = None,
    ) -> Dict[str, Any]:
        return await self._post("/dependencies", {
            "fromId": from_id,
            "toId": to_id,
            "type": type,
            "weight": weight,
        })

    async def remove(self, id: str) -> None:
        return await self._delete(f"/dependencies/{id}")


class AsyncActionsResource(_AsyncResource):
    def _action_body(
        self,
        operation: str,
        impacted_entity_ids: List[str],
        description: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {
            "operation": operation,
            "impactedEntityIds": impacted_entity_ids,
            "description": description,
            "parameters": parameters,
        }

    async def propose(
        self,
        operation: str,
        impacted_entity_ids: List[str],
        description: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self._post("/actions/propose", self._action_body(operation, impacted_entity_ids, description, parameters))

    async def validate(
        self,
        operation: str,
        impacted_entity_ids: List[str],
        description: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self._post("/actions/validate", self._action_body(operation, impacted_entity_ids, description, parameters))

    async def simulate(
        self,
        operation: str,
        impacted_entity_ids: List[str],
        description: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self._post("/actions/simulate", self._action_body(operation, impacted_entity_ids, description, parameters))

    async def get(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/actions/{id}")

    async def get_impact(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/actions/{id}/impact")

    async def override(self, id: str, reason: str) -> Dict[str, Any]:
        return await self._post(f"/actions/{id}/override", {"reason": reason})

    async def list(
        self,
        limit: Optional[int] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return await self._get("/actions", limit=limit, status=status)


class AsyncWorldResource(_AsyncResource):
    async def get_coherence(self) -> Dict[str, Any]:
        return await self._get("/world/coherence")

    async def get_snapshot(self) -> Dict[str, Any]:
        return await self._get("/world/snapshot")

    async def settle(self) -> Dict[str, Any]:
        return await self._post("/world/settle")

    async def get_history(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        return await self._get("/world/history", limit=limit)

    async def search(
        self,
        query: str,
        type: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._get("/search", q=query, type=type)

    async def stream(
        self,
        entity_id: Optional[str] = None,
    ):
        """Async generator yielding SSE events from /world/stream."""
        params: Dict[str, Any] = {}
        if entity_id:
            params["entityId"] = entity_id
        async for event in self._t.stream_sse("/world/stream", params=params):
            yield event


class AsyncAuditResource(_AsyncResource):
    async def list(
        self,
        limit: Optional[int] = None,
        type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return await self._get("/audit", limit=limit, type=type)

    async def get(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/audit/{id}")


class AsyncPolicyResource(_AsyncResource):
    async def list_rules(self) -> List[Dict[str, Any]]:
        return await self._get("/policy/rules")

    async def create_rule(
        self,
        name: str,
        trigger: str,
        action: str,
        conditions: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self._post("/policy/rules", {
            "name": name,
            "trigger": trigger,
            "action": action,
            "conditions": conditions,
        })

    async def list_approvals(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        return await self._get("/policy/approvals", status=status)

    async def request_approval(self, action_id: str, reason: str) -> Dict[str, Any]:
        return await self._post("/policy/approvals", {"actionId": action_id, "reason": reason})

    async def approve(self, id: str, comment: Optional[str] = None) -> Dict[str, Any]:
        return await self._post(f"/policy/approvals/{id}/approve", {"comment": comment})

    async def reject(self, id: str, reason: str) -> Dict[str, Any]:
        return await self._post(f"/policy/approvals/{id}/reject", {"reason": reason})

    async def list_escalations(self) -> List[Dict[str, Any]]:
        return await self._get("/policy/escalations")

    async def create_escalation(self, name: str, chain: List[Any]) -> Dict[str, Any]:
        return await self._post("/policy/escalations", {"name": name, "chain": chain})


class AsyncTraceResource(_AsyncResource):
    async def create_session(
        self,
        name: str,
        description: Optional[str] = None,
        entity_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return await self._post("/trace/sessions", {
            "name": name,
            "description": description,
            "entityIds": entity_ids,
        })

    async def list_sessions(self, active: Optional[bool] = None) -> List[Dict[str, Any]]:
        return await self._get("/trace/sessions", active=active)

    async def get_session(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/trace/sessions/{id}")

    async def end_session(self, id: str) -> Dict[str, Any]:
        return await self._post(f"/trace/sessions/{id}/end")

    async def append_event(
        self,
        session_id: str,
        type: str,
        data: Optional[Dict[str, Any]] = None,
        entity_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return await self._post(f"/trace/sessions/{session_id}/events", {
            "type": type,
            "data": data,
            "entityIds": entity_ids,
        })

    async def get_events(self, session_id: str) -> List[Dict[str, Any]]:
        return await self._get(f"/trace/sessions/{session_id}/events")

    async def replay(self, session_id: str) -> Dict[str, Any]:
        return await self._post(f"/trace/sessions/{session_id}/replay")

    async def get_timeline(
        self,
        entity_id: str,
        since: Optional[str] = None,
        until: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return await self._get(f"/trace/timeline/{entity_id}", since=since, until=until)

    async def diff(self, session_id_1: str, session_id_2: str) -> Dict[str, Any]:
        return await self._get("/trace/diff", sessionId1=session_id_1, sessionId2=session_id_2)


class AsyncPlansResource(_AsyncResource):
    async def list(self) -> List[Dict[str, Any]]:
        return await self._get("/plans")

    async def create(
        self,
        name: str,
        description: Optional[str] = None,
        goal: str = "",
        entity_ids: Optional[List[str]] = None,
        steps: Optional[List[Any]] = None,
    ) -> Dict[str, Any]:
        return await self._post("/plans", {
            "name": name,
            "description": description,
            "goal": goal,
            "entityIds": entity_ids,
            "steps": steps,
        })

    async def get(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/plans/{id}")

    async def decompose(self, id: str) -> Dict[str, Any]:
        return await self._post(f"/plans/{id}/decompose")

    async def execute(self, id: str) -> Dict[str, Any]:
        return await self._post(f"/plans/{id}/execute")

    async def coherence_analysis(self, id: str) -> Dict[str, Any]:
        return await self._get(f"/plans/{id}/coherence")

    async def update_task_status(self, plan_id: str, task_id: str, status: str) -> Dict[str, Any]:
        return await self._patch(f"/plans/{plan_id}/tasks/{task_id}", {"status": status})


class AsyncWorkspaceResource(_AsyncResource):
    async def info(self) -> Dict[str, Any]:
        return await self._get("/workspace")

    async def create_api_key(self, name: str) -> Dict[str, Any]:
        return await self._post("/workspace/api-keys", {"name": name})

    async def list_api_keys(self) -> List[Dict[str, Any]]:
        return await self._get("/workspace/api-keys")

    async def revoke_api_key(self, id: str) -> None:
        return await self._delete(f"/workspace/api-keys/{id}")

    async def get_usage(self) -> Dict[str, Any]:
        return await self._get("/workspace/usage")


class AsyncAuthResource(_AsyncResource):
    async def login(self, email: str, password: str) -> Dict[str, Any]:
        return await self._post("/auth/login", {"email": email, "password": password})

    async def register(self, email: str, password: str, name: str) -> Dict[str, Any]:
        return await self._post("/auth/register", {"email": email, "password": password, "name": name})

    async def me(self) -> Dict[str, Any]:
        return await self._get("/auth/me")


# ─────────────────────────────────────────────────────────────────────────────
# Top-level client classes
# ─────────────────────────────────────────────────────────────────────────────


class InvariantClient:
    """
    Synchronous Invariant API client.

    Example::

        from invariant import InvariantClient

        client = InvariantClient(
            base_url="https://api.invariant.me",
            api_key="inv_abc123",
        )
        score = client.world.get_coherence()
        print(score["coherenceScore"])
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = 30.0,
        retries: int = 3,
        backoff_base: float = 0.3,
    ) -> None:
        transport = SyncTransport(
            base_url=base_url,
            api_key=api_key,
            token=token,
            timeout=timeout,
            retries=retries,
            backoff_base=backoff_base,
        )
        self._transport = transport

        self.observations = ObservationsResource(transport)
        self.claims = ClaimsResource(transport)
        self.entities = EntitiesResource(transport)
        self.contradictions = ContradictionsResource(transport)
        self.branches = BranchesResource(transport)
        self.constraints = ConstraintsResource(transport)
        self.dependencies = DependenciesResource(transport)
        self.actions = ActionsResource(transport)
        self.world = WorldResource(transport)
        self.audit = AuditResource(transport)
        self.policy = PolicyResource(transport)
        self.trace = TraceResource(transport)
        self.plans = PlansResource(transport)
        self.workspace = WorkspaceResource(transport)
        self.auth = AuthResource(transport)

    def health(self) -> Dict[str, Any]:
        return self._transport.request("GET", "/health")

    def subscribe_to_coherence(
        self,
        callback: Callable[[Dict[str, Any]], None],
        entity_id: Optional[str] = None,
    ) -> None:
        """Block and call *callback* for each SSE coherence event."""
        self.world.subscribe_to_coherence(callback, entity_id=entity_id)

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> "InvariantClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


class AsyncInvariantClient:
    """
    Asynchronous Invariant API client.

    Example::

        from invariant import AsyncInvariantClient
        import asyncio

        async def main():
            async with AsyncInvariantClient(
                base_url="https://api.invariant.me",
                api_key="inv_abc123",
            ) as client:
                score = await client.world.get_coherence()
                print(score["coherenceScore"])

        asyncio.run(main())
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = 30.0,
        retries: int = 3,
        backoff_base: float = 0.3,
    ) -> None:
        transport = AsyncTransport(
            base_url=base_url,
            api_key=api_key,
            token=token,
            timeout=timeout,
            retries=retries,
            backoff_base=backoff_base,
        )
        self._transport = transport

        self.observations = AsyncObservationsResource(transport)
        self.claims = AsyncClaimsResource(transport)
        self.entities = AsyncEntitiesResource(transport)
        self.contradictions = AsyncContradictionsResource(transport)
        self.branches = AsyncBranchesResource(transport)
        self.constraints = AsyncConstraintsResource(transport)
        self.dependencies = AsyncDependenciesResource(transport)
        self.actions = AsyncActionsResource(transport)
        self.world = AsyncWorldResource(transport)
        self.audit = AsyncAuditResource(transport)
        self.policy = AsyncPolicyResource(transport)
        self.trace = AsyncTraceResource(transport)
        self.plans = AsyncPlansResource(transport)
        self.workspace = AsyncWorkspaceResource(transport)
        self.auth = AsyncAuthResource(transport)

    async def health(self) -> Dict[str, Any]:
        return await self._transport.request("GET", "/health")

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def __aenter__(self) -> "AsyncInvariantClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()
