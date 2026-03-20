# Coherence Engine, Eval & Ablation Design

## Thesis Under Test

> For tasks that require persistent truth maintenance under change, explicit
> coherence-first architectures with branching and fixed-point settling
> outperform standard prompt-and-retrieval agent stacks.

This is a falsifiable claim. We test it with adversarial benchmarks designed to
expose failure modes where standard stacks should fail for exactly the reasons
BPR theory predicts.

---

## Architecture

```
apps/evals/
├── src/
│   ├── scenarios/
│   │   ├── types.ts           # Scenario schema + EvaluationResult + Metrics
│   │   └── generator.ts       # Parameterized benchmark generators
│   ├── baselines/
│   │   ├── prompts.ts         # Prompt constructors for A/B/C/D
│   │   └── evaluators.ts      # LLM evaluators (Anthropic SDK)
│   ├── engine/
│   │   ├── harness.ts         # In-process engine runner (namespace-isolated)
│   │   └── evaluators.ts      # Full engine + 6 ablation evaluators
│   ├── scoring/
│   │   ├── metrics.ts         # All hard metric computations
│   │   └── report.ts          # Console tables + JSON output
│   └── runner/
│       └── runner.ts          # Orchestrator (concurrency, batching)
└── tests/
    ├── scorer.test.ts         # Pure unit tests for scoring functions
    └── generator.test.ts      # Scenario structure validation
```

---

## Scenario Design

Each scenario specifies:
1. **Initial world state**, entities, claims, constraints, dependencies
2. **Optional update sequence**, for drift/long-horizon scenarios
3. **Proposed action**, what the evaluator must validate
4. **Ground truth**, the correct answer, determined independently

Ground truth is adversarial to all systems including our own engine.

### Scenario Categories

| Category | What It Tests | BPR Prediction of Failure Mode |
|----------|--------------|-------------------------------|
| `action_safety` | Does it block locally plausible but globally invalid actions? | Standard stacks miss multi-hop constraint violations |
| `contradiction` | Does it detect incompatible claims? | Prompt-only stacks may not detect all conflicts |
| `multi_hop` | Can it propagate invalidations beyond one edge? | Single-hop rule checks miss downstream effects |
| `branch_sensitive` | Does it preserve ambiguity instead of hallucinating one answer? | Memory stores collapse conflicts into one state |
| `stale_state` | Does it discount old claims correctly? | RAG may retrieve stale high-relevance facts |
| `long_horizon` | Does it stay coherent after many updates? | LLM context stacking loses early contradictions |

---

## Baseline Designs

### Baseline A: Plain LLM
All facts in a single prompt. Fair prompt, full context.
**Predicted failure**: Multi-hop invalidation, stale state conflation.

### Baseline B: LLM + RAG
Top-k retrieved facts relevant to the impacted entities.
**Predicted failure**: Misses global contradictions not near the impacted entities.

### Baseline C: LLM + Memory Store
Current entity state only (most recent claim per predicate, no history).
**Predicted failure**: Entirely misses conflicting claims from different sources.
This is the "Baseline C is blind to history" failure.

### Baseline D: Rules Without Settling
Same graph structure, but:
- No branch creation
- Single-hop rule check only
- No coherence budget
- No provenance scoring
**Predicted failure**: Misses multi-hop chains, no branch reasoning.

---

## Ablation Matrix

Each ablation removes exactly one architectural ingredient:

| Ablation ID | What Is Removed | Research Question |
|-------------|----------------|-------------------|
| `no_branching` | Branch creation (contradictions flagged only) | Does explicit branching improve correctness? |
| `no_settling` | Iterative settling (single pass only) | Does fixed-point convergence improve multi-hop? |
| `unsigned_deps` | Signed dep types (all become SUPPORTS) | Do INVALIDATES/REQUIRES/IMPLIES add value? |
| `no_provenance` | Provenance fragility scoring (mu5=0) | Does provenance reduce unsafe recommendations? |
| `no_staleness` | Staleness decay (lambda_s=0) | Does temporal decay improve state truthfulness? |
| `no_budget` | DeltaPhi budget (Infinity) | Does coherence cost add decision structure? |

**Interpretation guide:**
- Drop > 10%: **CRITICAL**, this ingredient is load-bearing
- Drop 5–10%: **IMPORTANT**, meaningful contribution
- Drop 2–5%: **MARGINAL**, some benefit
- Drop < 2%: **MINIMAL**, may need more scenarios to detect signal

---

## Metrics

### Per-Scenario
| Metric | Formula | What It Measures |
|--------|---------|-----------------|
| `contradictionRecall` | GT detected / GT total | Fraction of real contradictions caught |
| `contradictionPrecision` | Correct detections / All detections | False positive rate |
| `contradictionF1` | Harmonic mean | Overall contradiction quality |
| `branchPrecision` | 1 if correct branch decision | Branch correctness |
| `actionCorrect` | Exact match with GT admissibility | Primary correctness metric |
| `actionWithinRisk` | Within one tier (VALID↔RISKY↔BLOCKED) | Soft correctness |
| `invalidationRecall` | GT entities caught / total | Dependency propagation |
| `reasoningKeywordCoverage` | GT keywords found in explanation | Reasoning quality |
| `overallScore` | 0.35·action + 0.25·contradF1 + 0.20·branchF1 + 0.10·invalF1 + 0.10·reasoning | Composite |

### Aggregate
- `meanOverallScore`, primary headline metric
- `actionAccuracy`, fraction with exact action classification
- `actionWithinRiskRate`, fraction within one tier
- `byCategory`, breakdown per scenario type
- `byDifficulty`, breakdown per difficulty level

---

## Atlas Benchmark (Primary Test)

~35 parameterized variations of the Project Atlas scenario.

Parameters varied:
- `testStatus`: not_started / in_progress / complete
- `batteryMass`: below / slightly over / over / way over limit
- `launchStatus`: green / red / amber
- `conflictingLaunchStatus`: creates two-source conflict (branch trigger)
- `requirementStatus`: complete / in_progress
- `verificationStatus`: complete / not_started / in_progress
- `ageSecondsForLaunch`: staleness of launch claim
- `difficulty`: easy / medium / hard

This covers the full space of failure modes from the spec.

---

## Running the Evals

```bash
cd apps/evals
npm install

# Fast: engine + ablations only (no API cost)
npm run eval:fast

# Atlas only
npm run eval:atlas

# Full run with LLM baselines (requires ANTHROPIC_API_KEY)
ANTHROPIC_API_KEY=sk-ant-... npm run eval

# Ablations only
npm run eval:ablations
```

---

## What Counts as Evidence for BPR

Strong evidence (positive result):
- Full engine outperforms best baseline by > 10% overall score
- `no_branching` ablation shows > 10% drop on `branch_sensitive` scenarios
- `no_settling` ablation shows > 10% drop on `multi_hop` scenarios
- `unsigned_deps` ablation shows > 5% drop on `action_safety` scenarios

Moderate evidence:
- Full engine outperforms best baseline by 5–10%
- Individual ablations show meaningful drops (5–10%)

Weak / inconclusive:
- Gap < 5% overall (may need more scenarios or harder ones)
- Ablations show < 2% drops (ingredients may be redundant at this scale)

---

## What Would NOT Yet Be Proven

Even strong positive results would not prove:
- That a fully learned BPR-native model is superior to transformers
- That continuous phase-space dynamics are necessary
- That transformers should be replaced

It would prove: **BPR-inspired coherence mechanisms improve stateful reasoning systems.**

That is the right first result to establish.

---

## Next Steps After Positive Results

1. **Phase 2A**: Train a small learned module for contradiction scoring and
   branch merge ranking, keeping the graph engine underneath.

2. **Phase 2B**: Create a benchmark where a smaller BPR-hybrid system beats
   a stronger LLM baseline on coherence-heavy tasks.

3. **Phase 3**: Implement the continuous BPR formulation as a learned reconciler
   and compare against the discrete v1 engine.
