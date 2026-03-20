# Coherence Engine, Mathematical Formulation

This document maps each mathematical equation from the specification to its
concrete implementation in the codebase.

---

## 1. World State Graph

```
G_t = (V_t, E_t, C_t, D_t, B_t)
```

| Symbol | Meaning | Implementation |
|--------|---------|----------------|
| V_t | Entities | `entities` table, `IEntityRepository` |
| E_t | Claims/assertions | `claims` table, `IClaimRepository` |
| C_t | Constraints | `constraints` table, `IConstraintRepository` |
| D_t | Signed dependencies | `dependencies` table, `IDependencyRepository` |
| B_t | Active branches | `branches` table, `IBranchRepository` |

---

## 2. Incoherence Energy Phi(G)

```
Phi(G) = lambda_c * Vc(G)
       + lambda_k * Vk(G)
       + lambda_d * Vd(G)
       + lambda_u * Vu(G)
       + lambda_b * Vb(G)
```

**Implementation:** `src/application/services/CoherenceEngine.ts :: computePhi()`

| Component | Meaning | v1 Computation |
|-----------|---------|----------------|
| Vc(G) | Constraint violation penalty | Sum of `severity` across active `constraint_violations` |
| Vk(G) | Contradiction penalty | Sum of `score` across OPEN contradictions |
| Vd(G) | Dependency mismatch penalty | Count of REQUIRES deps where `toEntity` has no claims |
| Vu(G) | Staleness/uncertainty penalty | Mean staleness across all active claims |
| Vb(G) | Unresolved branch burden | Count of OPEN branches |

**Default weights** (configurable via env):
```
COHERENCE_LAMBDA_C=1.0   # Constraint violations
COHERENCE_LAMBDA_K=1.5   # Contradictions (higher weight, more critical)
COHERENCE_LAMBDA_D=0.8   # Dependency mismatches
COHERENCE_LAMBDA_U=0.5   # Staleness
COHERENCE_LAMBDA_B=0.7   # Unresolved branches
```

---

## 3. Coherence Score

```
CoherenceScore(G) = 100 * exp(-k * Phi_norm(G))
```

**Implementation:** `src/application/services/CoherenceEngine.ts :: computeCoherenceScore()`

- `Phi_norm = Phi / phi_ref` where `phi_ref = 10.0` (reference incoherence level)
- `k = COHERENCE_K_SCALE` (default 2.0)
- Returns [0, 100] where 100 = perfectly coherent

---

## 4. Staleness Model

```
Staleness(k) = 1 - exp(-lambda_s * (t - tau_k))
```

**Implementation:** `src/application/services/CoherenceEngine.ts :: computeStaleness()`

- `tau_k` = claim timestamp (from `claims.timestamp`)
- `t` = current wall time
- `lambda_s = STALENESS_LAMBDA` (default 0.001 per second)
- Returns [0, 1] where 0 = fresh, ~1 = very stale

At default lambda, a claim is 50% stale after ~693 seconds (~11.5 minutes).

---

## 5. Confidence Propagation

```
w_k' = sigmoid(
    a * SourceTrust(s_k)
  + b * Corroboration(k)
  - c * ContradictionPressure(k)
  - d * Staleness(k)
)
```

**Implementation:** `src/application/services/CoherenceEngine.ts :: computeConfidence()`

Constants: `a=2.0, b=1.5, c=2.0, d=1.0`

| Input | Source |
|-------|--------|
| SourceTrust | `sources.trustScore` [0,1] |
| Corroboration | Ratio of claims that agree with this claim for same entity+predicate |
| ContradictionPressure | `min(1, contradictions_involving_claim * 0.3)` |
| Staleness | `computeStaleness(claim.timestamp, now, lambda_s)` |

---

## 6. Contradiction Score

```
ContradictionScore(p, q) = overlap(p,q) * incompatibility(p,q) * min(w_p, w_q)
```

**Implementation:** `src/application/services/CoherenceEngine.ts :: computeContradictionScore()`

**overlap(p, q):**
- `1.0` if same entityId + same predicate (direct conflict)
- `0.5` if same entityId, different predicate
- `0.0` if different entities

**incompatibility(p, q):**
- Booleans: `1.0` if different, `0` if same
- Numbers: relative difference `|a-b| / ((|a|+|b|)/2)` clamped to [0,1]
- Strings: `1.0` if different, `0` if same (case-insensitive)

**Thresholds:**
```
CONTRADICTION_THRESHOLD=0.5  # flag as contradiction
BRANCH_THRESHOLD=0.7         # create branch
```

---

## 7. Action Inconsistency Score Psi

```
Psi(a, G_t) =
    mu_1 * ConstraintViolationRisk(a, G_t)
  + mu_2 * DependencyBreakageRisk(a, G_t)
  + mu_3 * ContradictionAmplification(a, G_t)
  + mu_4 * UncertaintyExposure(a, G_t)
  + mu_5 * ProvenanceFragility(a, G_t)
```

**Implementation:** `src/application/services/ActionValidationService.ts`
**Formula:** `src/application/services/CoherenceEngine.ts :: computePsi()`

Default weights: `mu1=mu2=0.25, mu3=0.20, mu4=mu5=0.15`

| Component | Computation |
|-----------|-------------|
| ConstraintViolationRisk | Max severity of constraint violations on impacted entities |
| DependencyBreakageRisk | Max risk from REQUIRES/INVALIDATES deps on impacted entities |
| ContradictionAmplification | Mean score of contradictions involving impacted entities |
| UncertaintyExposure | Mean staleness × (1 - mean confidence) of impacted claims |
| ProvenanceFragility | 1 - mean confidence of provenance chain |

---

## 8. Action Coherence Cost DeltaPhi

```
DeltaPhi(a) = Phi(G_t after applying action a hypothetically) - Phi(G_t)
```

**Implementation:** `src/application/services/ActionValidationService.ts :: computeDeltaPhi()`

In v1, this is a forward-looking estimate based on:
- Existing violation load on impacted entities
- Current Phi fraction relative to reference

In v2, this would simulate the full action and recompute Phi exactly.

---

## 9. Action Admissibility

```
VALID           if DeltaPhi <= budget AND Psi <= epsilon
RISKY           if DeltaPhi <= budget*1.5 AND Psi <= epsilon*1.5
BLOCKED         otherwise
BRANCH_DEPENDENT if open branches involve impacted entities
```

**Implementation:** `src/application/services/CoherenceEngine.ts :: classifyActionAdmissibility()`

Config:
```
ACTION_BUDGET=5.0   # max acceptable DeltaPhi
ACTION_EPSILON=0.6  # max acceptable Psi
```

---

## 10. Discrete Settling Operator

```
G^(r+1) = T(G^(r))
```

Convergence: `G^(r+1) = G^(r)` (no further changes)

**Implementation:** `src/application/services/SettlingService.ts :: settle()`

Pass T performs, in order:
1. Detect contradictions via `ContradictionDetectorRegistry`
2. Create branches if `score >= BRANCH_THRESHOLD`
3. Propagate `INVALIDATES` dependency effects
4. Reevaluate all active constraints
5. Recompute confidence for all active claims
6. Take snapshot on convergence

---

## 11. Monotonicity Invariant

```
Phi(G^(r+1)) <= Phi(G^(r))
```

Except during intentional branch expansion, which temporarily increases
representational complexity but preserves truth (both conflicting claims
are represented, not overwritten).

**Tests:** `tests/unit/Monotonicity.test.ts`

The invariant holds because T only:
- Resolves contradictions (decreases Vk)
- Fixes constraint violations (decreases Vc)
- Resolves dependency mismatches (decreases Vd)
- Updates confidence (does not increase Phi directly)
- Creates branches to contain irresolvable contradictions

---

## Future: Continuous BPR Formulation (v2)

The Boundary Phase Resonance formulation treats world state as a latent
vector field where contradictions are phase misalignments:

```
dG/dt = -grad_G Phi(G) + noise(t)
```

This would require:
- Learned entity state embeddings
- Differentiable constraint functions
- Continuous-time optimization loop
- Convergence via d(Phi)/dt → 0

This is preserved as a v2 roadmap target. v1 uses deterministic
discrete reconciliation for auditability and predictability.
