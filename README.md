# Coherence Engine

> The coherence layer for agents

A shared world-state and truth-maintenance engine that sits underneath agents and humans. It ingests observations, claims, tool outputs, and actions, reconciles them into a persistent state graph, detects contradictions, preserves conflicting branches, propagates implications, tracks uncertainty, and validates whether proposed actions are still consistent with current state.

---

## Architecture

```
coherence-engine/
├── apps/
│   └── api/                    # Fastify REST API
│       └── src/
│           ├── domain/         # Types, interfaces (no deps on infra)
│           ├── application/    # Reasoning engine, services
│           ├── infrastructure/ # Prisma repositories, config, DI
│           └── interfaces/     # HTTP routes (Fastify)
├── packages/
│   └── sdk/                    # Agent SDK (fetch-based client)
├── prisma/
│   └── schema.prisma           # PostgreSQL schema
├── docs/
│   ├── equations.md            # Math → code mapping
│   ├── api-examples.md         # REST API usage examples
│   └── roadmap.md              # Future extensions
└── docker-compose.yml
```

### Clean Architecture Layers

```
interfaces (HTTP) → application (services) → domain (types/ports)
                                          ↑
                       infrastructure (Prisma, config)
```

- **Domain layer**: pure TypeScript types, repository interfaces. Zero infra deps.
- **Application layer**: CoherenceEngine, SettlingService, ContradictionDetector, ActionValidationService.
- **Infrastructure layer**: Prisma repositories, config, DI container.
- **Interfaces layer**: Fastify routes, OpenAPI schemas.

---

## Core Concepts

### World State Graph
```
G = (V, E, C, D, B)
  V = entities
  E = claims/assertions
  C = constraints
  D = signed dependencies
  B = branches
```

### Incoherence Energy
```
Phi(G) = λ_c·Vc + λ_k·Vk + λ_d·Vd + λ_u·Vu + λ_b·Vb
```

### Coherence Score
```
CoherenceScore(G) = 100 · exp(-k · Phi_norm(G))
```

### Settling Loop (Discrete Fixed-Point)
```
G^(r+1) = T(G^(r))   until   G^(r+1) = G^(r)
```
T performs: detect contradictions → create branches → propagate deps → evaluate constraints → recompute confidence.

**Monotonicity invariant**: `Phi(G^(r+1)) <= Phi(G^(r))` for all ordinary reconciliation passes. Tested in `tests/unit/Monotonicity.test.ts`.

---

## Quick Start

### Prerequisites
- Node.js 20+
- Docker and Docker Compose

### 1. Local dev with Docker

```bash
cp .env.example .env
docker-compose up -d postgres
cd apps/api
npm install
npx prisma migrate dev --name init
npm run dev
```

API: http://localhost:3000
Swagger: http://localhost:3000/docs

### 2. Seed the engineering scenario

```bash
npm run seed
```

This seeds:
- 7 entities (Project Atlas, Requirement R-42, Thermal Test T-7, Battery Pack BP-1, Launch Readiness Review, Task TK-19, Agent Planner-1)
- 10 claims with contradictions baked in
- 4 constraints
- 5 signed dependencies
- Runs settling and shows coherence degradation
- Validates and blocks `proceed_to_launch` action

### 3. Full Docker stack

```bash
docker-compose up
```

---

## Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/world/coherence` | Current Phi and CoherenceScore |
| `GET` | `/world/snapshot` | Full world state summary |
| `POST` | `/world/settle` | Trigger settling loop manually |
| `POST` | `/observations` | Ingest observation + extract claims |
| `POST` | `/claims` | Assert a claim about an entity |
| `GET` | `/entities/:id/state` | Current entity state |
| `GET` | `/contradictions` | List contradictions |
| `GET` | `/branches` | List branches |
| `POST` | `/actions/validate` | Validate action before execution |
| `GET` | `/search?q=` | Search entities and claims |
| `GET` | `/docs` | Swagger UI |

---

## Signed Dependency Types

| Type | Semantics |
|------|-----------|
| `SUPPORTS` | A being valid strengthens B (positive consensus) |
| `REQUIRES` | A requires B to hold |
| `IMPLIES` | A being true logically implies B |
| `INVALIDATES` | A being true invalidates B |
| `EXCLUDES` | A and B cannot coexist |
| `MUTEX` | A and B are mutually exclusive states |
| `IMPLIES_NOT` | A implies B is false |

---

## Action Validation

Every action proposal returns:

```json
{
  "admissibility": "BLOCKED",
  "deltaPhi": 7.2,
  "psiScore": 0.82,
  "constraintViolationRisk": 0.9,
  "dependencyBreakageRisk": 0.7,
  "contradictionAmplification": 0.6,
  "uncertaintyExposure": 0.3,
  "provenanceFragility": 0.4,
  "impactedEntityIds": [...],
  "reasons": [...]
}
```

`admissibility` is one of: `VALID | RISKY | BLOCKED | BRANCH_DEPENDENT`

---

## Running Tests

```bash
cd apps/api
npm test
```

Tests cover:
- `CoherenceEngine.test.ts` — Phi, CoherenceScore, Staleness, Confidence, ContradictionScore, Psi
- `ContradictionDetector.test.ts` — All 4 detection plugins + registry
- `ConstraintChecker.test.ts` — NUMERIC_RANGE, STATUS_DEPENDENCY, MUTUAL_EXCLUSION
- `Monotonicity.test.ts` — `Phi(G_next) <= Phi(G_current)` invariant across simulated settling rounds

---

## Configuration

All weights and thresholds are configurable via environment variables:

```bash
COHERENCE_LAMBDA_C=1.0   # Constraint violation weight
COHERENCE_LAMBDA_K=1.5   # Contradiction weight
COHERENCE_LAMBDA_D=0.8   # Dependency mismatch weight
COHERENCE_LAMBDA_U=0.5   # Staleness/uncertainty weight
COHERENCE_LAMBDA_B=0.7   # Unresolved branch weight
COHERENCE_K_SCALE=2.0    # Coherence score scaling

STALENESS_LAMBDA=0.001           # Decay constant (per second)
CONTRADICTION_THRESHOLD=0.5      # Flag threshold
BRANCH_THRESHOLD=0.7             # Branch creation threshold
ACTION_BUDGET=5.0                # Max DeltaPhi for valid action
ACTION_EPSILON=0.6               # Max Psi for valid action
```

---

## See Also

- [docs/equations.md](docs/equations.md) — Math to code mapping
- [docs/api-examples.md](docs/api-examples.md) — Full API examples
- [docs/roadmap.md](docs/roadmap.md) — Future extensions including continuous BPR
