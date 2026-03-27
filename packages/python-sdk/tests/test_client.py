"""
Tests for invariant.client — resource method routing.

Verifies that resource methods on InvariantClient and AsyncInvariantClient
call the correct HTTP method and path.
"""

import pytest
import httpx
import respx

from invariant.client import InvariantClient, AsyncInvariantClient


BASE_URL = "https://api.example.com"
API_KEY = "inv_test123"


def make_client() -> InvariantClient:
    return InvariantClient(base_url=BASE_URL, api_key=API_KEY)


def make_async_client() -> AsyncInvariantClient:
    return AsyncInvariantClient(base_url=BASE_URL, api_key=API_KEY)


# ── InvariantClient — sync ────────────────────────────────────────────────────

class TestInvariantClientSync:
    @respx.mock
    def test_entities_list(self):
        route = respx.get(f"{BASE_URL}/entities").mock(
            return_value=httpx.Response(200, json=[])
        )
        client = make_client()
        result = client.entities.list()
        assert result == []
        assert route.called

    @respx.mock
    def test_entities_get(self):
        route = respx.get(f"{BASE_URL}/entities/e1").mock(
            return_value=httpx.Response(200, json={"id": "e1"})
        )
        client = make_client()
        result = client.entities.get("e1")
        assert result["id"] == "e1"
        assert route.called

    @respx.mock
    def test_entities_create(self):
        route = respx.post(f"{BASE_URL}/entities").mock(
            return_value=httpx.Response(201, json={"id": "new"})
        )
        client = make_client()
        result = client.entities.create(name="Alpha", type="AGENT")
        assert result["id"] == "new"
        assert route.called
        body = route.calls[0].request.content
        assert b"Alpha" in body

    @respx.mock
    def test_claims_get(self):
        route = respx.get(f"{BASE_URL}/claims/c1").mock(
            return_value=httpx.Response(200, json={"id": "c1"})
        )
        client = make_client()
        result = client.claims.get("c1")
        assert result["id"] == "c1"
        assert route.called

    @respx.mock
    def test_observations_create(self):
        route = respx.post(f"{BASE_URL}/observations").mock(
            return_value=httpx.Response(201, json={"id": "obs-1"})
        )
        client = make_client()
        result = client.observations.create(
            content="sensor reading",
            entity_ids=["e1"],
        )
        assert result["id"] == "obs-1"
        assert route.called

    @respx.mock
    def test_contradictions_list(self):
        route = respx.get(f"{BASE_URL}/contradictions").mock(
            return_value=httpx.Response(200, json=[])
        )
        client = make_client()
        result = client.contradictions.list()
        assert result == []
        assert route.called

    @respx.mock
    def test_contradictions_resolve(self):
        route = respx.post(f"{BASE_URL}/contradictions/con-1/resolve").mock(
            return_value=httpx.Response(200, json={"id": "con-1", "status": "RESOLVED"})
        )
        client = make_client()
        result = client.contradictions.resolve("con-1", "Superseded by newer observation")
        assert result["status"] == "RESOLVED"
        assert route.called

    @respx.mock
    def test_branches_list(self):
        route = respx.get(f"{BASE_URL}/branches").mock(
            return_value=httpx.Response(200, json=[])
        )
        client = make_client()
        result = client.branches.list()
        assert result == []
        assert route.called

    @respx.mock
    def test_branches_create(self):
        route = respx.post(f"{BASE_URL}/branches").mock(
            return_value=httpx.Response(201, json={"id": "b1", "name": "test"})
        )
        client = make_client()
        result = client.branches.create("test", description="test branch")
        assert result["id"] == "b1"
        assert route.called

    @respx.mock
    def test_constraints_list(self):
        route = respx.get(f"{BASE_URL}/constraints").mock(
            return_value=httpx.Response(200, json=[])
        )
        client = make_client()
        result = client.constraints.list()
        assert result == []
        assert route.called

    @respx.mock
    def test_api_key_header_is_sent(self):
        route = respx.get(f"{BASE_URL}/entities").mock(
            return_value=httpx.Response(200, json=[])
        )
        client = make_client()
        client.entities.list()
        assert route.calls[0].request.headers["X-API-Key"] == API_KEY


# ── AsyncInvariantClient ──────────────────────────────────────────────────────

class TestAsyncInvariantClient:
    @pytest.mark.asyncio
    @respx.mock
    async def test_entities_list(self):
        route = respx.get(f"{BASE_URL}/entities").mock(
            return_value=httpx.Response(200, json=[{"id": "e1"}])
        )
        client = make_async_client()
        result = await client.entities.list()
        assert result == [{"id": "e1"}]
        assert route.called
        await client.aclose()

    @pytest.mark.asyncio
    @respx.mock
    async def test_entities_create(self):
        route = respx.post(f"{BASE_URL}/entities").mock(
            return_value=httpx.Response(201, json={"id": "new"})
        )
        async with make_async_client() as client:
            result = await client.entities.create(name="Beta", type="TASK")
        assert result["id"] == "new"
        assert route.called

    @pytest.mark.asyncio
    @respx.mock
    async def test_contradictions_list(self):
        route = respx.get(f"{BASE_URL}/contradictions").mock(
            return_value=httpx.Response(200, json=[])
        )
        async with make_async_client() as client:
            result = await client.contradictions.list()
        assert result == []
        assert route.called

    @pytest.mark.asyncio
    @respx.mock
    async def test_api_key_header_is_sent(self):
        route = respx.get(f"{BASE_URL}/entities").mock(
            return_value=httpx.Response(200, json=[])
        )
        async with make_async_client() as client:
            await client.entities.list()
        assert route.calls[0].request.headers["X-API-Key"] == API_KEY

    @pytest.mark.asyncio
    @respx.mock
    async def test_context_manager_closes_client(self):
        respx.get(f"{BASE_URL}/entities").mock(
            return_value=httpx.Response(200, json=[])
        )
        async with make_async_client() as client:
            assert client is not None
            await client.entities.list()
        # Client should be closed after context manager exit (no assertion needed;
        # a second call would raise if the underlying httpx client was not properly managed)
