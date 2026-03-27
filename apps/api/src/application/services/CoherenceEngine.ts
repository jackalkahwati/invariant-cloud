/**
 * CoherenceEngine, Core Mathematical Reasoning Functions
 *
 * This module implements the incoherence energy Phi(G), coherence score,
 * staleness decay, contradiction scoring, confidence propagation, and
 * action inconsistency score as defined in the formal specification.
 *
 * These functions operate over the world state graph:
 *   G = (V, E, C, D, B)
 *
 * Design principle: This is a deterministic, auditable reasoning core.
 * All functions are pure or near-pure given their inputs.
 * The continuous BPR formulation is documented below but NOT used as the v1 runtime.
 */

import type {
  Claim,
  ClaimWithRelations,
  Constraint,
  ConstraintViolation,
  Contradiction,
  Dependency,
  CoherenceWeights,
  ActionWeights,
  EngineConfig,
} from '../../domain/entities/types.js';

// ============================================================
// 1. STALENESS MODEL
// ============================================================

/**
 * Staleness(k) = 1 - exp(-lambda_s * (t - tau_k))
 *
 * where:
 *   tau_k     = claim timestamp
 *   t         = current time
 *   lambda_s  = decay constant (higher = faster staleness)
 *
 * Returns [0, 1] where 0 = fresh, ~1 = very stale.
 *
 * Note: (t - tau_k) is measured in seconds internally.
 */
export function computeStaleness(claimTimestamp: Date, now: Date, lambdaS: number): number {
  const deltaSeconds = (now.getTime() - claimTimestamp.getTime()) / 1000;
  return 1 - Math.exp(-lambdaS * deltaSeconds);
}

// ============================================================
// 2. CONFIDENCE PROPAGATION
// ============================================================

/**
 * w_k' = sigmoid(
 *     a * SourceTrust(s_k)
 *   + b * Corroboration(k)
 *   - c * ContradictionPressure(k)
 *   - d * Staleness(k)
 * )
 *
 * Constants (tuned for practical range):
 *   a = 2.0, b = 1.5, c = 2.0, d = 1.0
 */
export function computeConfidence(params: {
  sourceTrust: number;          // [0,1] source trust score
  corroboration: number;        // [0,1] ratio of supporting claims
  contradictionPressure: number; // [0,1] normalized contradiction load
  staleness: number;            // [0,1] staleness score
}): number {
  const a = 2.0, b = 1.5, c = 2.0, d = 1.0;
  const logit =
    a * params.sourceTrust
    + b * params.corroboration
    - c * params.contradictionPressure
    - d * params.staleness;
  return sigmoid(logit);
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ============================================================
// 3. CONTRADICTION SCORING
// ============================================================

/**
 * ContradictionScore(p, q) = overlap(p,q) * incompatibility(p,q) * min(w_p, w_q)
 *
 * Components:
 *   overlap(p,q)         = 1.0 if same entity + predicate, 0.5 if same entity only
 *   incompatibility(p,q) = how incompatible the values are (type-specific logic)
 *   min(w_p, w_q)        = minimum confidence of the two claims
 *
 * Returns [0, 1]. Score > CONTRADICTION_THRESHOLD → flag. Score > BRANCH_THRESHOLD → branch.
 */
export function computeContradictionScore(
  claimA: Pick<Claim, 'entityId' | 'predicate' | 'value' | 'confidence'>,
  claimB: Pick<Claim, 'entityId' | 'predicate' | 'value' | 'confidence'>,
): number {
  const overlap = computeOverlap(claimA, claimB);
  if (overlap === 0) return 0;

  const incompatibility = computeIncompatibility(claimA.value, claimB.value);
  const minConfidence = Math.min(claimA.confidence, claimB.confidence);

  return overlap * incompatibility * minConfidence;
}

/**
 * Overlap function: how much do two claims reference the same state?
 *   1.0 = same entity + same predicate (direct conflict)
 *   0.5 = same entity, different predicate (may still conflict via constraint)
 *   0.0 = different entities
 */
function computeOverlap(
  a: Pick<Claim, 'entityId' | 'predicate'>,
  b: Pick<Claim, 'entityId' | 'predicate'>,
): number {
  if (a.entityId !== b.entityId) return 0;
  if (a.predicate === b.predicate) return 1.0;
  return 0.5;
}

/**
 * Incompatibility: how incompatible are the two values?
 * Handles numeric, string/status, boolean, and null cases.
 */
export function computeIncompatibility(valueA: unknown, valueB: unknown): number {
  // Both null/undefined, not incompatible
  if (valueA == null && valueB == null) return 0;
  if (valueA == null || valueB == null) return 0.3;

  // Boolean conflict
  if (typeof valueA === 'boolean' && typeof valueB === 'boolean') {
    return valueA !== valueB ? 1.0 : 0;
  }

  // Numeric conflict, use relative difference
  if (typeof valueA === 'number' && typeof valueB === 'number') {
    const range = Math.abs(valueA) + Math.abs(valueB);
    if (range === 0) return 0;
    const relDiff = Math.abs(valueA - valueB) / (range / 2);
    return Math.min(relDiff, 1.0);
  }

  // String/status conflict
  if (typeof valueA === 'string' && typeof valueB === 'string') {
    return valueA.toLowerCase() === valueB.toLowerCase() ? 0 : 1.0;
  }

  // Object comparison, stringify fallback
  const sa = JSON.stringify(valueA);
  const sb = JSON.stringify(valueB);
  return sa === sb ? 0 : 1.0;
}

// ============================================================
// 4. INCOHERENCE ENERGY  Phi(G)
// ============================================================

/**
 * Phi(G) = lambda_c * Vc(G)
 *         + lambda_k * Vk(G)
 *         + lambda_d * Vd(G)
 *         + lambda_u * Vu(G)
 *         + lambda_b * Vb(G)
 *
 * Where:
 *   Vc(G) = weighted constraint violation count (scaled by severity)
 *   Vk(G) = sum of contradiction scores for open contradictions
 *   Vd(G) = count of violated dependency relations
 *   Vu(G) = mean staleness across active claims (uncertainty penalty)
 *   Vb(G) = count of open unresolved branches
 *
 * The result is an unbounded non-negative real number.
 * Monotonicity invariant for ordinary settling passes:
 *   Phi(G^(r+1)) <= Phi(G^(r))
 */
export function computePhi(
  params: {
    activeViolations: Pick<ConstraintViolation, 'severity' | 'constraintId'>[];
    openContradictions: Pick<Contradiction, 'score'>[];
    violatedDependencies: number;
    activeClaims: Pick<Claim, 'timestamp'>[];
    openBranches: number;
  },
  weights: CoherenceWeights,
  now: Date,
  lambdaS: number,
): number {
  // Vc(G): constraint violation penalty (sum of severities)
  const Vc = params.activeViolations.reduce((sum, v) => sum + v.severity, 0);

  // Vk(G): contradiction penalty (sum of contradiction scores)
  const Vk = params.openContradictions.reduce((sum, c) => sum + c.score, 0);

  // Vd(G): dependency mismatch count
  const Vd = params.violatedDependencies;

  // Vu(G): mean staleness over active claims
  const Vu = params.activeClaims.length > 0
    ? params.activeClaims.reduce(
        (sum, c) => sum + computeStaleness(c.timestamp, now, lambdaS),
        0
      ) / params.activeClaims.length
    : 0;

  // Vb(G): unresolved branch burden
  const Vb = params.openBranches;

  return (
    weights.lambdaC * Vc
    + weights.lambdaK * Vk
    + weights.lambdaD * Vd
    + weights.lambdaU * Vu
    + weights.lambdaB * Vb
  );
}

// ============================================================
// 5. COHERENCE SCORE
// ============================================================

/**
 * CoherenceScore(G) = 100 * exp(-k * Phi_norm(G))
 *
 * where Phi_norm is Phi normalized to [0,1] using a reference maximum.
 * We use the raw Phi divided by a reference value (default 10.0) to normalize.
 *
 * Returns [0, 100] where 100 = perfectly coherent, 0 = maximally incoherent.
 */
export function computeCoherenceScore(phi: number, kScale: number, phiRef = 10.0): number {
  const phiNorm = phi / phiRef;
  return 100 * Math.exp(-kScale * phiNorm);
}

// ============================================================
// 6. ACTION INCONSISTENCY SCORE  Psi(a, G)
// ============================================================

/**
 * Psi(a, G) =
 *     mu_1 * ConstraintViolationRisk(a, G)      , direct constraint violations on impacted entities
 *   + mu_2 * DependencyBreakageRisk(a, G)        , direct dependency breakage
 *   + mu_3 * ContradictionAmplification(a, G)    , direct contradiction amplification
 *   + mu_4 * UncertaintyExposure(a, G)           , staleness / confidence uncertainty
 *   + mu_5 * ProvenanceFragility(a, G)           , provenance chain fragility
 *   + mu_6 * PropagatedRisk(a, G)                , transitive risk via dependency graph (Phase 1)
 *
 * Each component is [0,1]. mu6 defaults to 0.20 if not set.
 */
export function computePsi(
  components: {
    constraintViolationRisk: number;
    dependencyBreakageRisk: number;
    contradictionAmplification: number;
    uncertaintyExposure: number;
    provenanceFragility: number;
    propagatedRisk?: number;  // graph-propagated transitive risk (Phase 1)
  },
  weights: ActionWeights,
): number {
  const mu6 = weights.mu6 ?? 0.20;
  return (
    weights.mu1 * components.constraintViolationRisk
    + weights.mu2 * components.dependencyBreakageRisk
    + weights.mu3 * components.contradictionAmplification
    + weights.mu4 * components.uncertaintyExposure
    + weights.mu5 * components.provenanceFragility
    + mu6 * (components.propagatedRisk ?? 0)
  );
}

// ============================================================
// 7. ACTION ADMISSIBILITY
// ============================================================

/**
 * Classify action admissibility.
 *
 * Classification rules (in priority order):
 *   1. BRANCH_DEPENDENT if validity differs by active branch
 *   2. BLOCKED if propagatedRisk alone exceeds the global threshold θ_global
 *      (transitive hard-constraint violations trigger this even with low local risk)
 *   3. BLOCKED if DeltaPhi > budget OR Psi > epsilon by more than the RISKY band
 *   4. RISKY   if slightly above thresholds (within 50%)
 *   5. VALID   otherwise
 *
 * The key addition is rule 2: propagated risk can trigger BLOCKED independently
 * of local Psi, addressing the root cause of BLOCKED under-classification.
 */
export function classifyActionAdmissibility(
  deltaPhi: number,
  psi: number,
  config: Pick<EngineConfig, 'actionBudget' | 'actionEpsilon' | 'propagatedRiskGlobalThreshold'>,
  hasBranchDependence: boolean,
  propagatedRisk = 0,
): 'VALID' | 'RISKY' | 'BLOCKED' | 'BRANCH_DEPENDENT' {
  if (hasBranchDependence) return 'BRANCH_DEPENDENT';

  // Rule 2: propagated risk alone can trigger BLOCKED
  // Default threshold θ_global = 0.70
  const thetaGlobal = config.propagatedRiskGlobalThreshold ?? 0.70;
  if (propagatedRisk > thetaGlobal) return 'BLOCKED';

  const phiOk = deltaPhi <= config.actionBudget;
  const psiOk = psi <= config.actionEpsilon;

  if (phiOk && psiOk) return 'VALID';

  // "Slightly above" = within 50% of threshold
  const phiRisky = deltaPhi <= config.actionBudget * 1.5;
  const psiRisky = psi <= config.actionEpsilon * 1.5;

  if (phiRisky && psiRisky) return 'RISKY';

  return 'BLOCKED';
}

// ============================================================
// 8. CONTRADICTION SEVERITY CLASSIFICATION
// ============================================================

export function classifyContradictionSeverity(
  score: number,
): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 0.8) return 'CRITICAL';
  if (score >= 0.6) return 'HIGH';
  if (score >= 0.4) return 'MEDIUM';
  return 'LOW';
}

// ============================================================
// 9. DEPENDENCY VIOLATION DETECTION
// ============================================================

/**
 * Check if a set of claims violates a signed dependency.
 *
 * Returns true if the dependency relation is violated given the provided
 * claim map (entityId → predicate → value).
 */
export function isDependencyViolated(
  dep: Dependency,
  claimMap: Map<string, Map<string, unknown>>,
): boolean {
  const fromClaims = claimMap.get(dep.fromEntityId);
  const toClaims = claimMap.get(dep.toEntityId);

  switch (dep.type) {
    case 'REQUIRES':
      // from requires to: if from exists and to is missing/invalid → violated
      return (fromClaims !== undefined && fromClaims.size > 0)
          && (toClaims === undefined || toClaims.size === 0);

    case 'INVALIDATES':
      // from invalidates to: if both exist → violated (to should not exist)
      return (fromClaims !== undefined && fromClaims.size > 0)
          && (toClaims !== undefined && toClaims.size > 0);

    case 'EXCLUDES':
    case 'MUTEX':
      // both cannot coexist
      return (fromClaims !== undefined && fromClaims.size > 0)
          && (toClaims !== undefined && toClaims.size > 0);

    case 'SUPPORTS':
    case 'IMPLIES':
    case 'IMPLIES_NOT':
      // These are checked contextually, not here
      return false;

    default:
      return false;
  }
}

// ============================================================
// 10. CONSTRAINT VIOLATION CHECKING
// ============================================================

/**
 * Check whether a set of claims violates a constraint.
 * Returns a violation description or null if no violation.
 */
export function checkConstraintViolation(
  constraint: Constraint,
  claims: ClaimWithRelations[],
): { violated: boolean; severity: number; description: string } | null {
  const expr = constraint.expression;

  switch (expr.type) {
    case 'NUMERIC_RANGE': {
      const relevant = claims.filter(
        c => c.predicate === expr.predicate && c.entityId === (expr.entityIds?.[0] ?? c.entityId)
      );
      for (const claim of relevant) {
        const val = typeof claim.value === 'number' ? claim.value : null;
        if (val === null) continue;
        if (expr.max !== undefined && val > expr.max) {
          const excess = val - expr.max;
          return {
            violated: true,
            severity: Math.min(1, excess / (expr.max * 0.5 || 1)),
            description: `${claim.entity.name}.${claim.predicate} = ${val} exceeds max ${expr.max}`,
          };
        }
        if (expr.min !== undefined && val < expr.min) {
          return {
            violated: true,
            severity: 0.8,
            description: `${claim.entity.name}.${claim.predicate} = ${val} below min ${expr.min}`,
          };
        }
      }
      return null;
    }

    case 'STATUS_DEPENDENCY': {
      // If ifPredicate == ifValue then requiresPredicate must == requiresValue
      const triggerClaims = claims.filter(
        c => c.predicate === expr.ifPredicate
          && JSON.stringify(c.value) === JSON.stringify(expr.ifValue)
          && c.status === 'ACTIVE'
      );
      if (triggerClaims.length === 0) return null;

      for (const trigger of triggerClaims) {
        const reqClaims = claims.filter(
          c => c.entityId === trigger.entityId
            && c.predicate === expr.requiresPredicate
            && c.status === 'ACTIVE'
        );
        const reqSatisfied = reqClaims.some(
          c => JSON.stringify(c.value) === JSON.stringify(expr.requiresValue)
        );
        if (!reqSatisfied) {
          return {
            violated: true,
            severity: 0.9,
            description: `${trigger.entity.name}: ${expr.ifPredicate}=${JSON.stringify(expr.ifValue)} requires ${expr.requiresPredicate}=${JSON.stringify(expr.requiresValue)} but not satisfied`,
          };
        }
      }
      return null;
    }

    case 'MUTUAL_EXCLUSION': {
      // No two claims for the entities should have the excluded combination
      if (!expr.excludedValues || !Array.isArray(expr.excludedValues)) return null;
      const relevant = claims.filter(
        c => c.predicate === expr.predicate && c.status === 'ACTIVE'
      );
      const values = relevant.map(c => c.value);
      const hasAll = (expr.excludedValues as unknown[]).every(
        ev => values.some(v => JSON.stringify(v) === JSON.stringify(ev))
      );
      if (hasAll) {
        return {
          violated: true,
          severity: 1.0,
          description: `Mutual exclusion violated: ${expr.predicate} has both ${expr.excludedValues.join(' and ')}`,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// ============================================================
// 11. PHI COMPONENT HELPERS (for explanations)
// ============================================================

export interface PhiBreakdown {
  phi: number;
  coherenceScore: number;
  Vc: number;
  Vk: number;
  Vd: number;
  Vu: number;
  Vb: number;
  lambdaC: number;
  lambdaK: number;
  lambdaD: number;
  lambdaU: number;
  lambdaB: number;
}

export function computePhiBreakdown(
  params: Parameters<typeof computePhi>[0],
  weights: CoherenceWeights,
  now: Date,
  lambdaS: number,
): PhiBreakdown {
  const Vc = params.activeViolations.reduce((s, v) => s + v.severity, 0);
  const Vk = params.openContradictions.reduce((s, c) => s + c.score, 0);
  const Vd = params.violatedDependencies;
  const Vu = params.activeClaims.length > 0
    ? params.activeClaims.reduce((s, c) => s + computeStaleness(c.timestamp, now, lambdaS), 0)
      / params.activeClaims.length
    : 0;
  const Vb = params.openBranches;

  const phi = weights.lambdaC * Vc
    + weights.lambdaK * Vk
    + weights.lambdaD * Vd
    + weights.lambdaU * Vu
    + weights.lambdaB * Vb;

  const coherenceScore = computeCoherenceScore(phi, weights.kScale);

  return { phi, coherenceScore, Vc, Vk, Vd, Vu, Vb, ...weights };
}

/*
 * ============================================================
 * FUTURE: CONTINUOUS BPR FORMULATION (v2 reference)
 * ============================================================
 *
 * The continuous Boundary Phase Resonance formulation treats the world state
 * as a latent vector field where contradictions are phase misalignments and
 * settling is gradient descent toward a minimum-energy configuration.
 *
 * Conceptual form (NOT v1 runtime):
 *   dG/dt = -grad_G Phi(G) + noise(t)
 *
 * In practice this would require:
 *   - Learned embeddings for entity states
 *   - Differentiable constraint functions
 *   - Continuous-time optimization loop
 *   - Convergence monitoring via d(Phi)/dt -> 0
 *
 * For v1, we use discrete fixed-point reconciliation (SettlingService).
 * The BPR formulation is preserved here as a roadmap target.
 * ============================================================
 */
