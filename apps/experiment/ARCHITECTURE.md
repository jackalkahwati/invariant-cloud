# Experimental Parallel Coding Runtime — Architecture

**Package:** `@coherence-engine/experiment`
**Status:** Experimental prototype — not production code
**Thesis:** A bounded multi-agent coding system with shared world state, task encapsulation, and pre-execution validation can complete a real multi-feature software task faster and more reliably than a mostly serial coding agent.

---

## Overview

This subsystem implements a minimal but complete parallel coding runtime and a benchmark harness that compares it against serial execution on a realistic scenario:

> *"Add enterprise SSO, audit logging, and admin role management to a realistic web app codebase."*

The system is intentionally simple — no real LLM calls, no filesystem writes, no database. Workers are simulated. The runtime, validation logic, and convergence semantics are real and testable.

---

## Directory Structure

```
apps/experiment/
├── src/
│   ├── state/
│   │   └── store.ts              # Shared world state (canonical in-memory store)
│   ├── tasks/
│   │   └── schema.ts             # TaskPacket schema + benchmark scenario factory
│   ├── validation/
│   │   └── validator.ts          # Pre-execution admissibility validator
│   ├── workers/
│   │   └── worker.ts             # SimulatedWorker + WorkerPool
│   ├── orchestrator/
│   │   └── orchestrator.ts       # TaskOrchestrator (serial + parallel modes)
│   ├── integrator/
│   │   └── integrator.ts         # Integrator + repair loop
│   ├── benchmark/
│   │   ├── harness.ts            # BenchmarkHarness (runs both modes)
│   │   └── metrics.ts            # BenchmarkMetrics + comparison + formatting
│   ├── logger/
│   │   └── logger.ts             # Structured JSON event logger
│   └── cli/
│       └── run.ts                # CLI entrypoint
├── fixture-app/
│   └── src/                      # Realistic web app (benchmark target)
│       ├── app.ts                # Main app entrypoint
│       ├── routes.ts             # Route registry (shared write target)
│       ├── users.ts              # User management
│       ├── roles.ts              # Basic role definitions
│       └── auth/
│           └── auth.ts           # Basic JWT auth (shared write target)
├── tests/
│   ├── state.test.ts             # WorldStateStore unit tests
│   ├── validator.test.ts         # ActionValidator unit tests
│   ├── orchestrator.test.ts      # TaskOrchestrator unit tests
│   ├── integrator.test.ts        # Integrator unit tests
│   └── benchmark.test.ts         # End-to-end benchmark tests
└── results/                      # JSON benchmark artifacts (gitignored)
```

---

## Module Descriptions

### 1. World State Store (`src/state/store.ts`)

**Role:** Single source of truth for all runtime state.

The `WorldStateStore` is an in-memory, event-emitting store that tracks:

| Entity | Description |
|--------|-------------|
| `TaskDefinition` | Registered tasks with status, ownership, outputs |
| `FileOwnership` | Which task holds an exclusive/shared lock on each file |
| `Claim` | Assertions tasks make about what they implement |
| `BranchState` | Git-like branch tracking per task |
| `ContractVersion` | Typed module interfaces with monotonic version numbers |
| `TestResult` | Pass/fail counts per test suite per task |
| `Contradiction` | Detected conflicts between claims |
| `ActionRecord` | Full history of all attempted actions + admissibility |
| `ValidationOutcome` | Audit trail for every validation decision |

Writes are synchronous (JS single-threaded). Reads are O(1)–O(n). Events are emitted for observability.

Key invariants:
- File claims are exclusive by default — only one task can write a file at a time
- Contract versions are monotonically increasing — downgrades are blocked
- Task status transitions follow: `PENDING → ASSIGNED → IN_PROGRESS → COMPLETED | FAILED | BLOCKED`

---

### 2. Task Packet Schema (`src/tasks/schema.ts`)

**Role:** The unit of work. Every worker operates within a `TaskPacket`.

```typescript
interface TaskPacket {
  task_id: string;
  parent_objective_id?: string;
  objective: string;
  feature: string;

  // Scope boundaries
  allowed_paths: string[];      // Only these paths may be written
  forbidden_paths: string[];    // These paths are always off-limits

  // Dependency graph
  dependencies: string[];       // task_ids that must complete first

  // Contract requirements
  required_contract_versions: Record<string, number>;

  // Verification
  acceptance_criteria: AcceptanceCriterion[];
  validation_rules: ValidationRule[];
  escalation_rules: EscalationRule[];

  assigned_worker_id: string | null;
  status: TaskStatus;
  priority: number;
  retry_count: number;
  max_retries: number;
}
```

The `createBenchmarkTaskPackets()` factory returns 10 task packets for the benchmark scenario:

| Task ID | Feature | Shared Files |
|---------|---------|--------------|
| `sso-provider` | SSO | — |
| `sso-middleware` | SSO | `auth/auth.ts` |
| `sso-routes` | SSO | `routes.ts` |
| `audit-logger` | AuditLogging | — |
| `audit-middleware` | AuditLogging | `auth/auth.ts` |
| `audit-routes` | AuditLogging | `routes.ts` |
| `roles-schema` | AdminRoles | — |
| `roles-enforcement` | AdminRoles | `auth/auth.ts` |
| `admin-routes` | AdminRoles | `routes.ts` |
| `integration-wiring` | Integration | `app.ts`, `routes.ts` |

`auth/auth.ts` and `routes.ts` are intentionally shared across features to create realistic integration challenges.

---

### 3. Pre-Execution Validator (`src/validation/validator.ts`)

**Role:** Admissibility gate. Every action passes through this before execution.

```
validate(action, task, action_id) → ValidationResult {
  admissibility: VALID | RISKY | BLOCKED
  reasons: string[]
  metadata: Record<string, unknown>
  conflicting_claims: string[]
  stale_state: boolean
}
```

Checks performed (in order):

| Check | Severity | Description |
|-------|----------|-------------|
| Task is active | BLOCK | Task must be IN_PROGRESS or ASSIGNED |
| Dependencies satisfied | BLOCK | All `dependencies` must be COMPLETED |
| Forbidden path | BLOCK | Path must not match `forbidden_paths` |
| Allowed path | BLOCK | Path must be in `allowed_paths` |
| File ownership | BLOCK (exclusive) / WARN (shared) | No other task holds exclusive lock |
| Stale contract state | WARN | Required version < current version |
| Contract downgrade | BLOCK | New version < current version |
| Dangerous shell command | BLOCK | Matches destructive regex patterns |
| Conflicting claims | WARN | Active claims on same subject from other tasks |
| Merge admissibility | BLOCK | Source branch must be open, no unresolved contradictions |

All validation outcomes are recorded in the store for audit.

---

### 4. Simulated Worker (`src/workers/worker.ts`)

**Role:** Executes a `TaskPacket`. Simulates realistic coding behavior without touching the filesystem.

Execution flow:
1. Mark task `IN_PROGRESS`
2. Generate action sequence (claim files, write implementations, update contracts)
3. For each action: validate → record → apply (or block)
4. Run test suite
5. Release file claims
6. Mark task `COMPLETED` or `FAILED`

Workers are configurable with `action_delay_ms` and `jitter_factor` to simulate real coding time.

The `WorkerPool` manages a fixed set of workers and tracks which are busy.

---

### 5. Task Orchestrator (`src/orchestrator/orchestrator.ts`)

**Role:** Manages the lifecycle of all tasks across one or more workers.

**Serial mode:**
- Topologically sorts tasks by dependency order
- Executes one at a time with a single worker
- No concurrency — simple, predictable baseline

**Parallel mode:**
- Maintains a `WorkerPool`
- Continuously finds tasks whose dependencies are satisfied
- Assigns ready tasks to available workers
- Runs multiple tasks concurrently up to `max_workers`
- Detects deadlocks (no progress + pending tasks) and marks them BLOCKED

The dependency graph supports arbitrary DAG topologies. Cycles are detected and produce BLOCKED tasks rather than infinite loops.

---

### 6. Integrator (`src/integrator/integrator.ts`)

**Role:** Merges completed task outputs. Detects conflicts. Generates repair tasks.

Integration phases:
1. **File conflict detection** — find files modified by multiple tasks
2. **Contract version consistency** — detect version mismatches
3. **Claim contradiction check** — find competing assertions on the same subject
4. **Acceptance criteria verification** — check test pass rate threshold (≥90%)
5. **Repair task generation** — create repair tasks for fixable conflicts
6. **Escalation** — log unresolvable conflicts for human review

Repair tasks are standard `TaskPacket`s — they enter the same runtime as the original tasks. They have `priority: 1` (high) and `max_retries: 1`.

---

### 7. Benchmark Harness (`src/benchmark/harness.ts`)

**Role:** Runs controlled serial vs parallel comparison and computes thesis verdict.

Each mode runs in a fresh `WorldStateStore` (complete isolation).

Metrics collected:

| Metric | Description |
|--------|-------------|
| `wall_clock_ms` | Total execution time |
| `task_completion_rate` | Completed / total |
| `invalid_actions_blocked` | Actions stopped by validator |
| `block_rate` | Blocked / attempted |
| `merge_conflicts_encountered` | File/contract conflicts at integration |
| `repair_tasks_generated` | Repair tasks the integrator created |
| `contradictions_escalated` | Unresolvable conflicts |
| `final_test_pass_rate` | Latest test suite results |
| `human_interventions_required` | Failed/blocked tasks needing manual fix |
| `feature_completeness` | Features with all tasks completed (0–3) |

**Thesis verdict logic:**
```
thesis_supported = (
  speedup_factor > 1.2 AND
  parallel_quality >= serial_quality - 0.05 AND
  invalid_actions_blocked > 0
)
```

---

## Data Flow

```
CLI
 └─ BenchmarkHarness.run()
      ├─ [serial] TaskOrchestrator(mode=serial)
      │    └─ SimulatedWorker × 1
      │         └─ ActionValidator → WorldStateStore
      └─ [parallel] TaskOrchestrator(mode=parallel)
           └─ SimulatedWorker × N (concurrent)
                └─ ActionValidator → WorldStateStore

      ├─ Integrator.integrate(completed_tasks)
      │    ├─ detectFileConflicts()
      │    ├─ detectContractConflicts()
      │    ├─ detectClaimContradictions()
      │    ├─ verifyAcceptanceCriteria()
      │    └─ generateRepairTasks()

      └─ computeMetrics() → compareMetrics() → BenchmarkOutput
```

---

## Running the Benchmark

```bash
# From repo root
cd apps/experiment

# Install dependencies
npm install

# Run full comparison (serial + parallel)
npm run run:both

# Run only parallel mode
npm run run:parallel

# Write JSON artifact
npm run bench
# → results/latest.json

# Custom options
tsx src/cli/run.ts --mode both --workers 6 --delay 10

# Run tests
npm test
```

---

## Design Decisions

**Why in-memory state?**
No DB setup required. The semantics are identical — the store is the canonical source of truth. For a production version, replace `WorldStateStore` with a Redis or PostgreSQL backend.

**Why simulated workers?**
The thesis is about the *runtime architecture* (validation, bounded scoping, dependency tracking, integration), not about LLM quality. Simulating workers lets us control timing precisely and make the benchmark reproducible.

**Why Zod schemas?**
Runtime validation of task packets catches misconfigured tasks before they reach workers. Same pattern as the production API.

**Why emit events from the store?**
Observability without coupling. The orchestrator, integrator, and CLI can all subscribe to state changes independently.

**Why topological sort for serial mode?**
Guarantees that the serial baseline is as good as it can be — it never executes a task before its dependencies are met, which would be a strawman comparison.

---

## Known Limitations (Prototype)

1. **No real LLM** — workers simulate actions deterministically. Real parallel gains depend on LLM quality and task decomposition.

2. **No filesystem writes** — files are "claimed" and "written" in world state only. A real system would write to a temp git branch.

3. **Single process** — true parallelism would require worker processes or network boundaries. This uses JS async concurrency (cooperative multitasking).

4. **No retry execution** — repair tasks are generated but not automatically re-executed in the benchmark loop. A production system would feed them back through the orchestrator.

5. **Timing is simulated** — `action_delay_ms` controls the simulation. Real speedup depends on actual LLM API latency and file operation costs.
