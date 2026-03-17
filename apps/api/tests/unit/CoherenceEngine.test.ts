/**
 * Unit tests for the CoherenceEngine core functions.
 * Tests Phi, CoherenceScore, Staleness, ContradictionScore, Confidence, Psi.
 */

import { describe, it, expect } from 'vitest';
import {
  computeStaleness,
  computeConfidence,
  computeContradictionScore,
  computeIncompatibility,
  computePhi,
  computeCoherenceScore,
  computePsi,
  classifyActionAdmissibility,
  classifyContradictionSeverity,
  sigmoid,
} from '../../src/application/services/CoherenceEngine.js';
import type { CoherenceWeights, ActionWeights, EngineConfig } from '../../src/domain/entities/types.js';

const weights: CoherenceWeights = {
  lambdaC: 1.0,
  lambdaK: 1.5,
  lambdaD: 0.8,
  lambdaU: 0.5,
  lambdaB: 0.7,
  kScale: 2.0,
};

const actionWeights: ActionWeights = {
  mu1: 0.25,
  mu2: 0.25,
  mu3: 0.20,
  mu4: 0.15,
  mu5: 0.15,
  mu6: 0.20,  // propagated risk weight
};

const config: Pick<EngineConfig, 'actionBudget' | 'actionEpsilon' | 'propagatedRiskGlobalThreshold'> = {
  actionBudget: 5.0,
  actionEpsilon: 0.6,
  propagatedRiskGlobalThreshold: 0.70,
};

// ── Staleness ─────────────────────────────────────────────────

describe('computeStaleness', () => {
  it('returns 0 for a claim with timestamp = now', () => {
    const now = new Date();
    const staleness = computeStaleness(now, now, 0.001);
    expect(staleness).toBe(0);
  });

  it('returns value in [0,1)', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 3600_000); // 1 hour ago
    const s = computeStaleness(old, now, 0.001);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('increases monotonically with time', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 1000);
    const t2 = new Date(now.getTime() - 3600_000);
    const s1 = computeStaleness(t1, now, 0.001);
    const s2 = computeStaleness(t2, now, 0.001);
    expect(s2).toBeGreaterThan(s1);
  });

  it('converges toward 1 for very old claims', () => {
    const now = new Date();
    const veryOld = new Date(now.getTime() - 1_000_000_000); // ~11.5 days with fast lambda
    const s = computeStaleness(veryOld, now, 0.01);
    expect(s).toBeGreaterThan(0.99);
  });
});

// ── Sigmoid ───────────────────────────────────────────────────

describe('sigmoid', () => {
  it('returns 0.5 for input 0', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5);
  });

  it('returns > 0.5 for positive inputs', () => {
    expect(sigmoid(1)).toBeGreaterThan(0.5);
  });

  it('returns < 0.5 for negative inputs', () => {
    expect(sigmoid(-1)).toBeLessThan(0.5);
  });

  it('approaches 1 for large positive inputs', () => {
    expect(sigmoid(100)).toBeCloseTo(1);
  });

  it('approaches 0 for large negative inputs', () => {
    expect(sigmoid(-100)).toBeCloseTo(0);
  });
});

// ── Confidence ────────────────────────────────────────────────

describe('computeConfidence', () => {
  it('returns value in (0,1)', () => {
    const c = computeConfidence({
      sourceTrust: 0.8,
      corroboration: 0.5,
      contradictionPressure: 0.2,
      staleness: 0.1,
    });
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(1);
  });

  it('higher source trust increases confidence', () => {
    const c1 = computeConfidence({ sourceTrust: 0.3, corroboration: 0, contradictionPressure: 0, staleness: 0 });
    const c2 = computeConfidence({ sourceTrust: 0.9, corroboration: 0, contradictionPressure: 0, staleness: 0 });
    expect(c2).toBeGreaterThan(c1);
  });

  it('higher contradiction pressure decreases confidence', () => {
    const c1 = computeConfidence({ sourceTrust: 0.8, corroboration: 0, contradictionPressure: 0, staleness: 0 });
    const c2 = computeConfidence({ sourceTrust: 0.8, corroboration: 0, contradictionPressure: 0.9, staleness: 0 });
    expect(c1).toBeGreaterThan(c2);
  });

  it('higher staleness decreases confidence', () => {
    const c1 = computeConfidence({ sourceTrust: 0.8, corroboration: 0, contradictionPressure: 0, staleness: 0 });
    const c2 = computeConfidence({ sourceTrust: 0.8, corroboration: 0, contradictionPressure: 0, staleness: 0.9 });
    expect(c1).toBeGreaterThan(c2);
  });
});

// ── Incompatibility ───────────────────────────────────────────

describe('computeIncompatibility', () => {
  it('returns 0 for equal strings', () => {
    expect(computeIncompatibility('done', 'done')).toBe(0);
  });

  it('returns 1 for different strings', () => {
    expect(computeIncompatibility('done', 'blocked')).toBe(1.0);
  });

  it('returns 0 for equal numbers', () => {
    expect(computeIncompatibility(14.2, 14.2)).toBe(0);
  });

  it('returns proportional value for different numbers', () => {
    const v = computeIncompatibility(10, 20);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('returns 1 for booleans true vs false', () => {
    expect(computeIncompatibility(true, false)).toBe(1.0);
  });

  it('returns 0 for booleans true vs true', () => {
    expect(computeIncompatibility(true, true)).toBe(0);
  });
});

// ── ContradictionScore ────────────────────────────────────────

describe('computeContradictionScore', () => {
  const baseA = { entityId: 'e1', predicate: 'status', value: 'done', confidence: 0.9 };
  const baseB = { entityId: 'e1', predicate: 'status', value: 'blocked', confidence: 0.8 };

  it('returns 0 for different entities', () => {
    const score = computeContradictionScore(
      { ...baseA, entityId: 'e1' },
      { ...baseB, entityId: 'e2' },
    );
    expect(score).toBe(0);
  });

  it('returns > 0 for same entity + predicate with conflicting string values', () => {
    const score = computeContradictionScore(baseA, baseB);
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 for same entity + predicate with same value', () => {
    const score = computeContradictionScore(
      { ...baseA, value: 'done' },
      { ...baseB, value: 'done' },
    );
    expect(score).toBe(0);
  });

  it('is bounded by [0,1]', () => {
    const score = computeContradictionScore(baseA, baseB);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scales with minimum confidence', () => {
    const highConf = computeContradictionScore(
      { ...baseA, confidence: 1.0 },
      { ...baseB, confidence: 1.0 },
    );
    const lowConf = computeContradictionScore(
      { ...baseA, confidence: 0.1 },
      { ...baseB, confidence: 0.1 },
    );
    expect(highConf).toBeGreaterThan(lowConf);
  });
});

// ── Phi ───────────────────────────────────────────────────────

describe('computePhi', () => {
  const now = new Date();

  it('returns 0 for empty world state', () => {
    const phi = computePhi(
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights,
      now,
      0.001,
    );
    expect(phi).toBe(0);
  });

  it('increases with constraint violations', () => {
    const phi1 = computePhi(
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    const phi2 = computePhi(
      { activeViolations: [{ severity: 0.9, constraintId: 'c1' }], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    expect(phi2).toBeGreaterThan(phi1);
  });

  it('increases with open contradictions', () => {
    const phi1 = computePhi(
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    const phi2 = computePhi(
      { activeViolations: [], openContradictions: [{ score: 0.8 }], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    expect(phi2).toBeGreaterThan(phi1);
  });

  it('increases with open branches', () => {
    const phi1 = computePhi(
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    const phi2 = computePhi(
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 3 },
      weights, now, 0.001,
    );
    expect(phi2).toBeGreaterThan(phi1);
  });

  it('matches formula: Phi = lambdaC*Vc + lambdaK*Vk + lambdaD*Vd + lambdaU*Vu + lambdaB*Vb', () => {
    const violations = [{ severity: 0.5, constraintId: 'c1' }, { severity: 0.3, constraintId: 'c2' }];
    const contradictions = [{ score: 0.7 }];
    const phi = computePhi(
      { activeViolations: violations, openContradictions: contradictions, violatedDependencies: 2, activeClaims: [], openBranches: 1 },
      weights, now, 0.001,
    );
    const expected =
      weights.lambdaC * (0.5 + 0.3)
      + weights.lambdaK * 0.7
      + weights.lambdaD * 2
      + weights.lambdaU * 0  // no claims, so Vu = 0
      + weights.lambdaB * 1;
    expect(phi).toBeCloseTo(expected, 5);
  });
});

// ── CoherenceScore ────────────────────────────────────────────

describe('computeCoherenceScore', () => {
  it('returns 100 for phi=0 (perfect coherence)', () => {
    expect(computeCoherenceScore(0, 2.0)).toBeCloseTo(100);
  });

  it('decreases as phi increases', () => {
    const s1 = computeCoherenceScore(1, 2.0);
    const s2 = computeCoherenceScore(5, 2.0);
    expect(s1).toBeGreaterThan(s2);
  });

  it('returns value in (0, 100]', () => {
    const s = computeCoherenceScore(10, 2.0);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

// ── Psi ───────────────────────────────────────────────────────

describe('computePsi', () => {
  it('returns 0 for all-zero components', () => {
    const psi = computePsi(
      { constraintViolationRisk: 0, dependencyBreakageRisk: 0, contradictionAmplification: 0, uncertaintyExposure: 0, provenanceFragility: 0, propagatedRisk: 0 },
      actionWeights,
    );
    expect(psi).toBe(0);
  });

  it('returns weighted sum of components including propagated risk', () => {
    const components = { constraintViolationRisk: 0.8, dependencyBreakageRisk: 0.6, contradictionAmplification: 0.4, uncertaintyExposure: 0.2, provenanceFragility: 0.3, propagatedRisk: 0.5 };
    const psi = computePsi(components, actionWeights);
    const expected = 0.25*0.8 + 0.25*0.6 + 0.20*0.4 + 0.15*0.2 + 0.15*0.3 + 0.20*0.5;
    expect(psi).toBeCloseTo(expected, 5);
  });

  it('propagatedRisk defaults to 0 when omitted', () => {
    const components = { constraintViolationRisk: 0.8, dependencyBreakageRisk: 0.6, contradictionAmplification: 0.4, uncertaintyExposure: 0.2, provenanceFragility: 0.3 };
    const psi = computePsi(components, actionWeights);
    const expected = 0.25*0.8 + 0.25*0.6 + 0.20*0.4 + 0.15*0.2 + 0.15*0.3;
    expect(psi).toBeCloseTo(expected, 5);
  });
});

// ── Action Admissibility ──────────────────────────────────────

describe('classifyActionAdmissibility', () => {
  it('VALID when both within budget', () => {
    expect(classifyActionAdmissibility(2.0, 0.3, config, false)).toBe('VALID');
  });

  it('RISKY when slightly above budget', () => {
    expect(classifyActionAdmissibility(6.5, 0.7, config, false)).toBe('RISKY');
  });

  it('BLOCKED when well above budget', () => {
    expect(classifyActionAdmissibility(50, 5.0, config, false)).toBe('BLOCKED');
  });

  it('BRANCH_DEPENDENT when branch dependence exists', () => {
    expect(classifyActionAdmissibility(0, 0, config, true)).toBe('BRANCH_DEPENDENT');
  });

  // Phase 1: global threshold rule — propagated risk alone triggers BLOCKED
  it('BLOCKED when propagated risk exceeds global threshold even with low local Psi', () => {
    // action looks locally safe (deltaPhi=0, psi=0.1) but has a hard constraint
    // violation reachable downstream (propagatedRisk=0.9 > theta_global=0.70)
    expect(classifyActionAdmissibility(0, 0.1, config, false, 0.9)).toBe('BLOCKED');
  });

  it('VALID when propagated risk is below global threshold', () => {
    // modest transitive risk (0.3) does not trigger global threshold
    expect(classifyActionAdmissibility(2.0, 0.3, config, false, 0.3)).toBe('VALID');
  });

  it('RISKY when propagated risk is low but Psi is slightly elevated', () => {
    expect(classifyActionAdmissibility(6.5, 0.7, config, false, 0.1)).toBe('RISKY');
  });

  it('BRANCH_DEPENDENT takes priority over propagated risk global threshold', () => {
    // even with severe propagated risk, branch dependence is evaluated first
    expect(classifyActionAdmissibility(0, 0.1, config, true, 0.9)).toBe('BRANCH_DEPENDENT');
  });

  it('BLOCKED when propagated risk equals the threshold exactly (boundary)', () => {
    // strictly greater than, so exactly at threshold = not blocked by global rule
    expect(classifyActionAdmissibility(2.0, 0.3, config, false, 0.70)).toBe('VALID');
    expect(classifyActionAdmissibility(2.0, 0.3, config, false, 0.701)).toBe('BLOCKED');
  });
});

// ── Severity Classification ───────────────────────────────────

describe('classifyContradictionSeverity', () => {
  it('LOW for score < 0.4', () => expect(classifyContradictionSeverity(0.3)).toBe('LOW'));
  it('MEDIUM for score 0.4-0.6', () => expect(classifyContradictionSeverity(0.5)).toBe('MEDIUM'));
  it('HIGH for score 0.6-0.8', () => expect(classifyContradictionSeverity(0.7)).toBe('HIGH'));
  it('CRITICAL for score >= 0.8', () => expect(classifyContradictionSeverity(0.9)).toBe('CRITICAL'));
});
