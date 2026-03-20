# Invariant, the coherence layer for AI agents

> Validate actions, track world state, detect contradictions. One API your agents call before they act.

**[Website](https://invariant.me) · [API Docs](https://invariant-engine.vercel.app/docs) · [Local Docs](http://localhost:3000/docs)**

---

## Why Invariant?

- **Tool-call gating**, agents ask before they act; Invariant blocks actions that would violate constraints or amplify contradictions
- **Shared world state**, every agent and human writes to the same state graph; no more conflicting parallel writes
- **Audit trail**, every claim, action, and contradiction is logged with provenance so you can replay and debug any session

---

## Quickstart (under 15 min)

### 1. Start the stack

```bash
cp .env.example .env          # fill in secrets
docker compose up             # starts postgres + api on :3000
```

Swagger UI: http://localhost:3000/docs

### 2. Get an API key

Register via the API or dashboard:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{ "email": "you@example.com", "password": "secret" }'

# Then create a workspace API key from the dashboard or /workspace/keys
```

### 3. Install the SDK

```bash
# TypeScript / Node
npm install invariant-sdk

# Python
pip install invariant-sdk
```

### 4. Validate your first action

```ts
import { InvariantClient } from 'invariant-sdk';

const client = new InvariantClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
});

const result = await client.actions.validate({
  operation: 'deploy_to_production',
  impactedEntityIds: ['service-payments'],
});

if (result.admissibility === 'BLOCKED') {
  console.log('Blocked:', result.reasons);
  // Never call the tool, let Invariant stop you here
}
```

---

## SDK Examples

**TypeScript**

```ts
import { InvariantClient } from 'invariant-sdk';

const client = new InvariantClient({ baseUrl: 'http://localhost:3000', apiKey: 'your-key' });

// Assert a claim about an entity
await client.claims.create({
  entityId: 'battery-bp1',
  predicate: 'temperature_celsius',
  value: 95,
  sourceId: 'sensor-array-3',
});

// Validate an action before executing it
const result = await client.actions.validate({
  operation: 'proceed_to_launch',
  impactedEntityIds: ['launch-review-lr1'],
});

if (result.admissibility === 'BLOCKED') {
  console.log('Action blocked:', result.reasons);
}
```

**Python**

```python
from invariant_sdk import InvariantClient

client = InvariantClient(base_url="http://localhost:3000", api_key="your-key")

# Assert a claim
client.claims.create(
    entity_id="battery-bp1",
    predicate="temperature_celsius",
    value=95,
    source_id="sensor-array-3",
)

# Validate an action
result = client.actions.validate(
    operation="proceed_to_launch",
    impacted_entity_ids=["launch-review-lr1"],
)

if result.admissibility == "BLOCKED":
    print("Action blocked:", result.reasons)
```

---

## Key Concepts

| Concept | Description |
|---------|-------------|
| **World state** | A persistent graph of entities, claims, constraints, and dependencies shared across all agents |
| **Claims** | Typed, sourced assertions about an entity (`temperature = 95`, `status = "ready"`) |
| **Contradictions** | Detected inconsistencies between claims, logged, branched, and surfaced to agents |
| **Coherence score (Φ)** | A single 0–100 score reflecting how consistent the current world state is |
| **Action validation** | Before a tool call runs, Invariant checks whether it would degrade coherence or violate constraints |

### Action validation response

```json
{
  "admissibility": "BLOCKED",
  "deltaPhi": 7.2,
  "psiScore": 0.82,
  "constraintViolationRisk": 0.9,
  "reasons": ["Constraint THERMAL_LIMIT violated", "Dependency REQUIRES broken"]
}
```

`admissibility` is one of: `VALID | RISKY | BLOCKED | BRANCH_DEPENDENT`

---

## Cloud pricing (pre-launch)

- **Free**, self-host the open-source engine (no platform fee).  
- **Starter**, managed cloud from **$79/mo** (14-day trial): `STRIPE_STARTER_PRICE_ID`.  
- **Team**, **$199/mo** (14-day trial): `STRIPE_TEAM_PRICE_ID`.  
- **Enterprise**, **contact sales** (VPC, SSO, compliance programs).

Billing is **subscription + included billable units** (not raw per-API-call). Limits are **soft** until metering is live. Policy and unit definitions: **`docs/billing-pricing.md`**. Stripe Price IDs and MCP notes: **`docs/stripe-setup.md`**.

---

## API Reference

Full interactive reference: **https://invariant-engine.vercel.app/docs**

Local (after `docker compose up`): http://localhost:3000/docs

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/actions/validate` | Validate an action before execution |
| `POST` | `/actions/simulate` | Dry-run validate without persisting the proposal |
| `GET` | `/world/coherence` | Current Φ and coherence score |
| `GET` | `/world/snapshot` | Full world state summary |
| `POST` | `/world/settle` | Trigger settling loop manually |
| `POST` | `/claims` | Assert a claim about an entity |
| `POST` | `/observations` | Ingest raw input and extract claims |
| `GET` | `/contradictions` | List detected contradictions |
| `GET` | `/entities/:id/state` | Current entity state |
| `GET` | `/branches` | List alternative coherent branches |

---

## Self-Host

```bash
git clone https://github.com/your-org/invariant
cd invariant
cp .env.example .env
docker compose up
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string (required) |
| `API_KEY` | - | Master API key for the instance (required) |
| `PORT` | `3000` | Port the API listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `ACTION_BUDGET` | `5.0` | Max ΔΦ allowed for a `VALID` action |
| `ACTION_EPSILON` | `0.6` | Max Ψ score for a `VALID` action |
| `CONTRADICTION_THRESHOLD` | `0.5` | Score above which a contradiction is flagged |
| `BRANCH_THRESHOLD` | `0.7` | Score above which a new branch is created |
| `COHERENCE_K_SCALE` | `2.0` | Scaling constant for coherence score curve |

See `.env.example` for the full list of tuning parameters.

---

## Project Structure

```
invariant/
├── apps/
│   └── api/                    # Fastify REST API
│       └── src/
│           ├── domain/         # Types, interfaces (no infra deps)
│           ├── application/    # Engine, services, validators
│           ├── infrastructure/ # Prisma repositories, config, DI
│           └── interfaces/     # HTTP routes (Fastify + OpenAPI)
├── packages/
│   ├── sdk/                    # TypeScript agent SDK (invariant-sdk)
│   └── python-sdk/             # Python client (invariant-sdk)
├── prisma/
│   └── schema.prisma           # PostgreSQL schema
├── docs/
│   ├── api-examples.md         # REST API usage examples
│   ├── billing-pricing.md      # Pre-launch billing policy & meters (v0)
│   └── roadmap.md              # Future extensions
└── docker-compose.yml          # Local development stack
```

---

## License

Apache 2.0, free to use, self-host, and build on.
