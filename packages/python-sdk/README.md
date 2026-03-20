# invariant-sdk

Python SDK for the [Invariant Coherence Engine](https://invariant.me), a shared world-state and truth-maintenance engine for AI agents.

## Installation

```bash
pip install invariant-sdk
```

Requires Python 3.9+ and installs `httpx` and `pydantic` automatically.

## Quickstart

### Sync client

```python
from invariant import InvariantClient

client = InvariantClient(
    base_url="https://api.invariant.me",
    api_key="inv_abc123",
)

# Health check
print(client.health())

# Create an entity
entity = client.entities.create(name="Reactor Core", type="COMPONENT", description="Main reactor")
print(entity["id"])

# Post an observation
obs = client.observations.create(
    content="Temperature reading: 42°C",
    entity_ids=[entity["id"]],
    type="SENSOR",
)

# Make a claim
claim = client.claims.create(
    entity_id=entity["id"],
    predicate="temperature",
    value=42,
    confidence=0.95,
)

# Get world coherence score
score = client.world.get_coherence()
print(f"Coherence: {score['coherenceScore']:.1f}")

# Search
results = client.world.search("reactor", type="entity")

# Close when done (or use as context manager)
client.close()
```

### Context manager

```python
with InvariantClient(base_url="...", api_key="...") as client:
    entities = client.entities.list(type="COMPONENT")
```

### Async client

```python
import asyncio
from invariant import AsyncInvariantClient

async def main():
    async with AsyncInvariantClient(
        base_url="https://api.invariant.me",
        api_key="inv_abc123",
    ) as client:
        score = await client.world.get_coherence()
        print(score["coherenceScore"])

        # Async SSE streaming
        async for event in client.world.stream():
            print(event["coherenceScore"])

asyncio.run(main())
```

### SSE Streaming (sync)

```python
def on_event(event):
    print(f"Coherence: {event['coherenceScore']} at {event['timestamp']}")

# Block and call the callback for each event
client.subscribe_to_coherence(on_event)

# Or iterate manually
for event in client.world.stream(entity_id="some-entity-id"):
    print(event)
```

## Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `base_url` | `str` | required | API base URL (no trailing slash) |
| `api_key` | `str` | `None` | `X-API-Key` header value |
| `token` | `str` | `None` | Bearer token (`Authorization` header) |
| `timeout` | `float` | `30.0` | Request timeout in seconds |
| `retries` | `int` | `3` | Max retries for GET + 5xx responses |
| `backoff_base` | `float` | `0.3` | Exponential backoff base in seconds |

## Error handling

```python
from invariant import InvariantClient, InvariantError, RateLimitError, NotFoundError

client = InvariantClient(base_url="...", api_key="...")

try:
    entity = client.entities.get("nonexistent-id")
except NotFoundError:
    print("Entity not found")
except RateLimitError as e:
    print(f"Rate limited, retry after {e.retry_after}s")
except InvariantError as e:
    print(f"API error {e.status_code}: {e.message} (request_id={e.request_id})")
```

## Available resources

| `client.<resource>` | Methods |
|---------------------|---------|
| `observations` | `create`, `get` |
| `claims` | `create`, `get`, `supersede` |
| `entities` | `list`, `get`, `get_state`, `get_history`, `create` |
| `contradictions` | `list`, `get`, `resolve` |
| `branches` | `list`, `get`, `resolve`, `create` |
| `constraints` | `list`, `create`, `violations` |
| `dependencies` | `list`, `create`, `remove` |
| `actions` | `propose`, `validate`, `simulate`, `get`, `get_impact`, `override`, `list` |
| `world` | `get_coherence`, `get_snapshot`, `settle`, `get_history`, `search`, `stream`, `subscribe_to_coherence` |
| `audit` | `list`, `get` |
| `policy` | `list_rules`, `create_rule`, `list_approvals`, `request_approval`, `approve`, `reject`, `list_escalations`, `create_escalation` |
| `trace` | `create_session`, `list_sessions`, `get_session`, `end_session`, `append_event`, `get_events`, `replay`, `get_timeline`, `diff` |
| `plans` | `list`, `create`, `get`, `decompose`, `execute`, `coherence_analysis`, `update_task_status` |
| `workspace` | `info`, `create_api_key`, `list_api_keys`, `revoke_api_key`, `get_usage` |
| `auth` | `login`, `register`, `me` |
| *(top-level)* | `health()`, `subscribe_to_coherence(callback)` |

## License

MIT
