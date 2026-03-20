"""
invariant._http
~~~~~~~~~~~~~~~
HTTP transport layer for the Invariant SDK.

Provides both synchronous (SyncTransport) and asynchronous (AsyncTransport)
implementations backed by httpx.  Retry logic (exponential back-off) is
applied on GET requests and 5xx responses only.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any, Dict, Generator, Optional

import httpx

from .exceptions import (
    AuthenticationError,
    ConflictError,
    ConnectionError as InvariantConnectionError,
    InvariantError,
    NotFoundError,
    RateLimitError,
    ServerError,
    TimeoutError as InvariantTimeoutError,
)

_DEFAULT_TIMEOUT = 30.0
_DEFAULT_RETRIES = 3
_DEFAULT_BACKOFF_BASE = 0.3  # seconds


def _build_headers(
    api_key: Optional[str],
    token: Optional[str],
    extra: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    headers: Dict[str, str] = {
        "X-Request-Id": str(uuid.uuid4()),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if api_key:
        headers["X-API-Key"] = api_key
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if extra:
        headers.update(extra)
    return headers


def _raise_for_status(response: httpx.Response) -> None:
    """Convert an error HTTP response into the appropriate SDK exception."""
    if response.status_code < 400:
        return

    request_id: Optional[str] = response.headers.get("X-Request-Id")

    try:
        body = response.json()
        message: str = body.get("error") or body.get("message") or response.text
    except Exception:
        body = response.text
        message = response.text or f"HTTP {response.status_code}"

    status = response.status_code

    if status == 401:
        raise AuthenticationError(message, body, request_id)
    if status == 404:
        raise NotFoundError(message, body, request_id)
    if status == 409:
        raise ConflictError(message, body, request_id)
    if status == 429:
        retry_after: Optional[int] = None
        try:
            retry_after = int(response.headers.get("Retry-After", 0))
        except ValueError:
            pass
        raise RateLimitError(message, retry_after, body, request_id)
    if status >= 500:
        raise ServerError(status, message, body, request_id)

    raise InvariantError(status, message, body, request_id)


def _should_retry(method: str, status: int) -> bool:
    return method.upper() == "GET" and status >= 500


# ─────────────────────────────────────────────────────────────────────────────
# Sync Transport
# ─────────────────────────────────────────────────────────────────────────────


class SyncTransport:
    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = _DEFAULT_TIMEOUT,
        retries: int = _DEFAULT_RETRIES,
        backoff_base: float = _DEFAULT_BACKOFF_BASE,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._token = token
        self._timeout = timeout
        self._retries = retries
        self._backoff_base = backoff_base
        self._client = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "SyncTransport":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Any] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        headers = _build_headers(self._api_key, self._token, extra_headers)

        attempt = 0
        last_exc: Exception = RuntimeError("unreachable")

        while attempt <= self._retries:
            try:
                response = self._client.request(
                    method,
                    url,
                    headers=headers,
                    params={k: v for k, v in (params or {}).items() if v is not None},
                    json=json_body,
                )
            except httpx.TimeoutException as exc:
                raise InvariantTimeoutError(str(exc)) from exc
            except httpx.ConnectError as exc:
                raise InvariantConnectionError(str(exc)) from exc

            if _should_retry(method, response.status_code) and attempt < self._retries:
                delay = self._backoff_base * (2 ** attempt)
                time.sleep(delay)
                attempt += 1
                continue

            _raise_for_status(response)

            if response.status_code == 204 or not response.content:
                return None

            return response.json()

        raise last_exc  # pragma: no cover

    def stream_sse(
        self,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        """Yield parsed SSE data objects from a streaming endpoint."""
        url = f"{self._base_url}{path}"
        headers = _build_headers(self._api_key, self._token, {"Accept": "text/event-stream"})
        headers["Content-Type"] = "application/json"

        with self._client.stream(
            "GET",
            url,
            headers=headers,
            params={k: v for k, v in (params or {}).items() if v is not None},
        ) as response:
            _raise_for_status(response)
            for line in response.iter_lines():
                if line.startswith("data:"):
                    raw = line[len("data:"):].strip()
                    if raw:
                        try:
                            yield json.loads(raw)
                        except json.JSONDecodeError:
                            yield {"raw": raw}


# ─────────────────────────────────────────────────────────────────────────────
# Async Transport
# ─────────────────────────────────────────────────────────────────────────────


class AsyncTransport:
    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = _DEFAULT_TIMEOUT,
        retries: int = _DEFAULT_RETRIES,
        backoff_base: float = _DEFAULT_BACKOFF_BASE,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._token = token
        self._timeout = timeout
        self._retries = retries
        self._backoff_base = backoff_base
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> "AsyncTransport":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Any] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        import asyncio

        url = f"{self._base_url}{path}"
        headers = _build_headers(self._api_key, self._token, extra_headers)
        client = self._get_client()

        attempt = 0
        last_exc: Exception = RuntimeError("unreachable")

        while attempt <= self._retries:
            try:
                response = await client.request(
                    method,
                    url,
                    headers=headers,
                    params={k: v for k, v in (params or {}).items() if v is not None},
                    json=json_body,
                )
            except httpx.TimeoutException as exc:
                raise InvariantTimeoutError(str(exc)) from exc
            except httpx.ConnectError as exc:
                raise InvariantConnectionError(str(exc)) from exc

            if _should_retry(method, response.status_code) and attempt < self._retries:
                delay = self._backoff_base * (2 ** attempt)
                await asyncio.sleep(delay)
                attempt += 1
                continue

            _raise_for_status(response)

            if response.status_code == 204 or not response.content:
                return None

            return response.json()

        raise last_exc  # pragma: no cover

    async def stream_sse(
        self,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ):
        """Async generator yielding parsed SSE data objects."""
        url = f"{self._base_url}{path}"
        headers = _build_headers(self._api_key, self._token, {"Accept": "text/event-stream"})
        headers["Content-Type"] = "application/json"
        client = self._get_client()

        async with client.stream(
            "GET",
            url,
            headers=headers,
            params={k: v for k, v in (params or {}).items() if v is not None},
        ) as response:
            _raise_for_status(response)
            async for line in response.aiter_lines():
                if line.startswith("data:"):
                    raw = line[len("data:"):].strip()
                    if raw:
                        try:
                            yield json.loads(raw)
                        except json.JSONDecodeError:
                            yield {"raw": raw}
