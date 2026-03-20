"""
invariant.exceptions
~~~~~~~~~~~~~~~~~~~~
All exception types raised by the Invariant SDK.
"""

from __future__ import annotations

from typing import Any


class InvariantError(Exception):
    """Base exception for all Invariant API errors."""

    def __init__(
        self,
        status_code: int,
        message: str,
        body: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.body = body
        self.request_id = request_id

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}("
            f"status_code={self.status_code}, "
            f"message={self.message!r}, "
            f"request_id={self.request_id!r})"
        )


class RateLimitError(InvariantError):
    """Raised when the API responds with HTTP 429 Too Many Requests."""

    def __init__(
        self,
        message: str = "Rate limit exceeded",
        retry_after: int | None = None,
        body: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(429, message, body, request_id)
        self.retry_after = retry_after


class AuthenticationError(InvariantError):
    """Raised on HTTP 401 Unauthorized."""

    def __init__(
        self,
        message: str = "Invalid or missing API key",
        body: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(401, message, body, request_id)


class NotFoundError(InvariantError):
    """Raised on HTTP 404 Not Found."""

    def __init__(
        self,
        message: str = "Resource not found",
        body: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(404, message, body, request_id)


class ConflictError(InvariantError):
    """Raised on HTTP 409 Conflict."""

    def __init__(
        self,
        message: str = "Conflict",
        body: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(409, message, body, request_id)


class ServerError(InvariantError):
    """Raised on HTTP 5xx Server Errors."""

    def __init__(
        self,
        status_code: int = 500,
        message: str = "Internal server error",
        body: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(status_code, message, body, request_id)


class TimeoutError(InvariantError):
    """Raised when a request exceeds the configured timeout."""

    def __init__(self, message: str = "Request timed out") -> None:
        super().__init__(408, message)


class ConnectionError(InvariantError):
    """Raised when a network connection cannot be established."""

    def __init__(self, message: str = "Connection error") -> None:
        super().__init__(0, message)
