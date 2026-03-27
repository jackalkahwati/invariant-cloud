"""
Tests for invariant._http — transport layer.

Uses respx to mock httpx without making real network calls.
"""

from __future__ import annotations

import pytest
import httpx
import respx
from typing import Optional

from invariant._http import (
    SyncTransport,
    AsyncTransport,
    _build_headers,
    _raise_for_status,
    _should_retry,
)
from invariant.exceptions import (
    AuthenticationError,
    ConflictError,
    InvariantError,
    NotFoundError,
    RateLimitError,
    ServerError,
    TimeoutError as InvariantTimeoutError,
    ConnectionError as InvariantConnectionError,
)


# ── _build_headers ────────────────────────────────────────────────────────────

class TestBuildHeaders:
    def test_always_includes_accept_and_content_type(self):
        headers = _build_headers(None, None)
        assert headers["Accept"] == "application/json"
        assert headers["Content-Type"] == "application/json"

    def test_includes_x_request_id(self):
        headers = _build_headers(None, None)
        assert "X-Request-Id" in headers
        assert len(headers["X-Request-Id"]) > 0

    def test_sets_api_key_header(self):
        headers = _build_headers("inv_test123", None)
        assert headers["X-API-Key"] == "inv_test123"

    def test_sets_bearer_token(self):
        headers = _build_headers(None, "mytoken")
        assert headers["Authorization"] == "Bearer mytoken"

    def test_merges_extra_headers(self):
        headers = _build_headers(None, None, {"Accept": "text/event-stream"})
        assert headers["Accept"] == "text/event-stream"

    def test_no_api_key_when_none(self):
        headers = _build_headers(None, None)
        assert "X-API-Key" not in headers

    def test_no_auth_when_no_token(self):
        headers = _build_headers(None, None)
        assert "Authorization" not in headers


# ── _should_retry ─────────────────────────────────────────────────────────────

class TestShouldRetry:
    def test_retries_get_5xx(self):
        assert _should_retry("GET", 500) is True
        assert _should_retry("GET", 503) is True

    def test_does_not_retry_get_4xx(self):
        assert _should_retry("GET", 404) is False
        assert _should_retry("GET", 401) is False

    def test_does_not_retry_post_5xx(self):
        assert _should_retry("POST", 500) is False
        assert _should_retry("POST", 503) is False

    def test_does_not_retry_post_4xx(self):
        assert _should_retry("POST", 400) is False

    def test_does_not_retry_get_2xx(self):
        assert _should_retry("GET", 200) is False


# ── _raise_for_status ─────────────────────────────────────────────────────────

class TestRaiseForStatus:
    def _make_response(self, status: int, body: dict, request_id: Optional[str] = None):
        """Build a minimal httpx.Response for testing."""
        content = str(body).encode()
        response = httpx.Response(
            status_code=status,
            headers={"X-Request-Id": request_id} if request_id else {},
            content=content,
        )
        # Override json() to return our dict
        response.__dict__["_json"] = body
        return response

    def _make_json_response(self, status: int, body: dict, request_id: Optional[str] = None):
        import json
        content = json.dumps(body).encode()
        response = httpx.Response(
            status_code=status,
            headers={"content-type": "application/json", **({"X-Request-Id": request_id} if request_id else {})},
            content=content,
        )
        return response

    def test_does_not_raise_on_2xx(self):
        response = self._make_json_response(200, {"id": "1"})
        _raise_for_status(response)  # should not raise

    def test_raises_authentication_error_on_401(self):
        response = self._make_json_response(401, {"error": "Unauthorized"}, "req-1")
        with pytest.raises(AuthenticationError) as exc_info:
            _raise_for_status(response)
        assert exc_info.value.status_code == 401
        assert exc_info.value.request_id == "req-1"

    def test_raises_not_found_error_on_404(self):
        response = self._make_json_response(404, {"error": "Not found"})
        with pytest.raises(NotFoundError) as exc_info:
            _raise_for_status(response)
        assert exc_info.value.status_code == 404

    def test_raises_conflict_error_on_409(self):
        response = self._make_json_response(409, {"error": "Conflict"})
        with pytest.raises(ConflictError) as exc_info:
            _raise_for_status(response)
        assert exc_info.value.status_code == 409

    def test_raises_rate_limit_error_on_429(self):
        response = self._make_json_response(429, {"error": "Rate limit exceeded"})
        with pytest.raises(RateLimitError) as exc_info:
            _raise_for_status(response)
        assert exc_info.value.status_code == 429

    def test_rate_limit_error_parses_retry_after(self):
        content = b'{"error": "Rate limit exceeded"}'
        response = httpx.Response(
            status_code=429,
            headers={"content-type": "application/json", "Retry-After": "60"},
            content=content,
        )
        with pytest.raises(RateLimitError) as exc_info:
            _raise_for_status(response)
        assert exc_info.value.retry_after == 60

    def test_raises_server_error_on_500(self):
        response = self._make_json_response(500, {"error": "Internal Server Error"})
        with pytest.raises(ServerError) as exc_info:
            _raise_for_status(response)
        assert exc_info.value.status_code == 500

    def test_raises_server_error_on_503(self):
        response = self._make_json_response(503, {"error": "Service Unavailable"})
        with pytest.raises(ServerError) as exc_info:
            _raise_for_status(response)
        assert exc_info.value.status_code == 503

    def test_raises_invariant_error_on_other_4xx(self):
        response = self._make_json_response(422, {"error": "Unprocessable"})
        with pytest.raises(InvariantError) as exc_info:
            _raise_for_status(response)
        assert exc_info.value.status_code == 422


# ── SyncTransport ─────────────────────────────────────────────────────────────

class TestSyncTransport:
    @respx.mock
    def test_get_returns_json_body(self):
        respx.get("https://api.example.com/entities").mock(
            return_value=httpx.Response(200, json=[{"id": "1"}])
        )
        transport = SyncTransport(base_url="https://api.example.com", api_key="test-key")
        result = transport.request("GET", "/entities")
        assert result == [{"id": "1"}]
        transport.close()

    @respx.mock
    def test_post_sends_json_body(self):
        route = respx.post("https://api.example.com/entities").mock(
            return_value=httpx.Response(201, json={"id": "new"})
        )
        transport = SyncTransport(base_url="https://api.example.com", api_key="test-key")
        result = transport.request("POST", "/entities", json_body={"name": "Test", "type": "AGENT"})
        assert result["id"] == "new"
        assert route.called
        transport.close()

    @respx.mock
    def test_returns_none_on_204(self):
        respx.delete("https://api.example.com/entities/1").mock(
            return_value=httpx.Response(204)
        )
        transport = SyncTransport(base_url="https://api.example.com", api_key="test-key")
        result = transport.request("DELETE", "/entities/1")
        assert result is None
        transport.close()

    @respx.mock
    def test_raises_not_found_on_404(self):
        respx.get("https://api.example.com/entities/x").mock(
            return_value=httpx.Response(404, json={"error": "Not found"})
        )
        transport = SyncTransport(base_url="https://api.example.com", api_key="test-key", retries=0)
        with pytest.raises(NotFoundError):
            transport.request("GET", "/entities/x")
        transport.close()

    @respx.mock
    def test_retries_get_on_5xx(self):
        # First call fails with 500, second succeeds
        route = respx.get("https://api.example.com/entities").mock(
            side_effect=[
                httpx.Response(500, json={"error": "oops"}),
                httpx.Response(200, json=[]),
            ]
        )
        transport = SyncTransport(
            base_url="https://api.example.com",
            api_key="test-key",
            retries=2,
            backoff_base=0.001,
        )
        result = transport.request("GET", "/entities")
        assert result == []
        assert route.call_count == 2
        transport.close()

    @respx.mock
    def test_does_not_retry_post_on_5xx(self):
        route = respx.post("https://api.example.com/entities").mock(
            return_value=httpx.Response(500, json={"error": "oops"})
        )
        transport = SyncTransport(
            base_url="https://api.example.com",
            api_key="test-key",
            retries=3,
            backoff_base=0.001,
        )
        with pytest.raises(ServerError):
            transport.request("POST", "/entities", json_body={"name": "x"})
        assert route.call_count == 1
        transport.close()

    @respx.mock
    def test_sends_api_key_header(self):
        route = respx.get("https://api.example.com/entities").mock(
            return_value=httpx.Response(200, json=[])
        )
        transport = SyncTransport(base_url="https://api.example.com", api_key="inv_abc123")
        transport.request("GET", "/entities")
        assert route.calls[0].request.headers["X-API-Key"] == "inv_abc123"
        transport.close()

    @respx.mock
    def test_passes_query_params(self):
        route = respx.get("https://api.example.com/entities").mock(
            return_value=httpx.Response(200, json=[])
        )
        transport = SyncTransport(base_url="https://api.example.com", api_key="key")
        transport.request("GET", "/entities", params={"type": "AGENT", "active": True})
        assert "type=AGENT" in str(route.calls[0].request.url)
        transport.close()

    @respx.mock
    def test_strips_none_params(self):
        route = respx.get("https://api.example.com/entities").mock(
            return_value=httpx.Response(200, json=[])
        )
        transport = SyncTransport(base_url="https://api.example.com", api_key="key")
        transport.request("GET", "/entities", params={"type": None, "active": True})
        url_str = str(route.calls[0].request.url)
        assert "type" not in url_str
        assert "active=" in url_str  # httpx lowercases True → true
        transport.close()

    def test_raises_timeout_error_on_httpx_timeout(self):
        with respx.mock:
            respx.get("https://api.example.com/entities").mock(
                side_effect=httpx.TimeoutException("timed out")
            )
            transport = SyncTransport(
                base_url="https://api.example.com", api_key="key", retries=0
            )
            with pytest.raises(InvariantTimeoutError):
                transport.request("GET", "/entities")
            transport.close()

    def test_raises_connection_error_on_httpx_connect_error(self):
        with respx.mock:
            respx.get("https://api.example.com/entities").mock(
                side_effect=httpx.ConnectError("connection refused")
            )
            transport = SyncTransport(
                base_url="https://api.example.com", api_key="key", retries=0
            )
            with pytest.raises(InvariantConnectionError):
                transport.request("GET", "/entities")
            transport.close()

    def test_context_manager(self):
        with respx.mock:
            respx.get("https://api.example.com/health").mock(
                return_value=httpx.Response(200, json={"status": "ok"})
            )
            with SyncTransport(base_url="https://api.example.com", api_key="key") as transport:
                result = transport.request("GET", "/health")
            assert result["status"] == "ok"


# ── AsyncTransport ────────────────────────────────────────────────────────────

class TestAsyncTransport:
    @pytest.mark.asyncio
    @respx.mock
    async def test_get_returns_json_body(self):
        respx.get("https://api.example.com/entities").mock(
            return_value=httpx.Response(200, json=[{"id": "e1"}])
        )
        transport = AsyncTransport(base_url="https://api.example.com", api_key="test-key")
        result = await transport.request("GET", "/entities")
        assert result == [{"id": "e1"}]
        await transport.aclose()

    @pytest.mark.asyncio
    @respx.mock
    async def test_post_sends_json_body(self):
        route = respx.post("https://api.example.com/entities").mock(
            return_value=httpx.Response(201, json={"id": "new"})
        )
        async with AsyncTransport(base_url="https://api.example.com", api_key="key") as transport:
            result = await transport.request("POST", "/entities", json_body={"name": "x"})
        assert result["id"] == "new"
        assert route.called

    @pytest.mark.asyncio
    @respx.mock
    async def test_retries_get_on_5xx(self):
        route = respx.get("https://api.example.com/entities").mock(
            side_effect=[
                httpx.Response(500, json={"error": "oops"}),
                httpx.Response(200, json=[]),
            ]
        )
        async with AsyncTransport(
            base_url="https://api.example.com",
            api_key="key",
            retries=2,
            backoff_base=0.001,
        ) as transport:
            result = await transport.request("GET", "/entities")
        assert result == []
        assert route.call_count == 2

    @pytest.mark.asyncio
    @respx.mock
    async def test_raises_authentication_error_on_401(self):
        respx.get("https://api.example.com/entities").mock(
            return_value=httpx.Response(401, json={"error": "Unauthorized"})
        )
        async with AsyncTransport(
            base_url="https://api.example.com", api_key="key", retries=0
        ) as transport:
            with pytest.raises(AuthenticationError):
                await transport.request("GET", "/entities")

    @pytest.mark.asyncio
    @respx.mock
    async def test_returns_none_on_204(self):
        respx.delete("https://api.example.com/claims/1").mock(
            return_value=httpx.Response(204)
        )
        async with AsyncTransport(base_url="https://api.example.com", api_key="key") as transport:
            result = await transport.request("DELETE", "/claims/1")
        assert result is None

    @pytest.mark.asyncio
    async def test_raises_timeout_error(self):
        with respx.mock:
            respx.get("https://api.example.com/entities").mock(
                side_effect=httpx.TimeoutException("timed out")
            )
            async with AsyncTransport(
                base_url="https://api.example.com", api_key="key", retries=0
            ) as transport:
                with pytest.raises(InvariantTimeoutError):
                    await transport.request("GET", "/entities")
