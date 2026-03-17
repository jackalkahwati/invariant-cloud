/**
 * Monotonicity tests: Phi(G^(r+1)) <= Phi(G^(r))
 *
 * These tests verify the Lyapunov-style invariant:
 * ordinary settling passes must not increase incoherence energy.
 *
 * Tests use pure mathematical functions without DB dependencies.
 */

import { describe, it, expect } from 'vitest';
import {
  computePhi,
  computeCoherenceScore,
  classifyContradictionSeverity,
} from '../../src/application/services/CoherenceEngine.js';
import type { CoherenceWeights } from '../../src/domain/entities/types.js';

const weights: CoherenceWeights = {
  lambdaC: 1.0,
  lambdaK: 1.5,
  lambdaD: 0.8,
  lambdaU: 0.5,
  lambdaB: 0.7,
  kScale: 2.0,
};

const now = new Date();

/**
 * Simulate a reconciliation step that removes a resolved contradiction.
 * Phi must decrease.
 */
describe('Monotonicity invariant: Phi(G_next) <= Phi(G_current)', () => {
  it('resolving a contradiction decreases Phi', () => {
    const phiBefore = computePhi(
      { activeViolations: [], openContradictions: [{ score: 0.7 }], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    const phiAfter = computePhi(
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    expect(phiAfter).toBeLessThanOrEqual(phiBefore);
  });

  it('fixing a constraint violation decreases Phi', () => {
    const phiBefore = computePhi(
      { activeViolations: [{ severity: 0.9, constraintId: 'c1' }], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    const phiAfter = computePhi(
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    expect(phiAfter).toBeLessThanOrEqual(phiBefore);
  });

  it('resolving a branch decreases Phi', () => {
    const phiBefore = computePhi(
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 2 },
      weights, now, 0.001,
    );
    const phiAfter = computePhi(
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    expect(phiAfter).toBeLessThanOrEqual(phiBefore);
  });

  it('coherence score increases monotonically as Phi decreases', () => {
    const phi1 = 5.0;
    const phi2 = 3.0;
    const phi3 = 1.0;
    const s1 = computeCoherenceScore(phi1, 2.0);
    const s2 = computeCoherenceScore(phi2, 2.0);
    const s3 = computeCoherenceScore(phi3, 2.0);
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
  });

  it('partial improvement still reduces Phi', () => {
    // Start with 3 contradictions, fix 1
    const phiBefore = computePhi(
      { activeViolations: [], openContradictions: [{ score: 0.8 }, { score: 0.5 }, { score: 0.6 }], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    const phiAfter = computePhi(
      { activeViolations: [], openContradictions: [{ score: 0.5 }, { score: 0.6 }], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      weights, now, 0.001,
    );
    expect(phiAfter).toBeLessThanOrEqual(phiBefore);
  });

  it('multiple simultaneous improvements all decrease Phi', () => {
    const phiBefore = computePhi(
      {
        activeViolations: [{ severity: 0.8, constraintId: 'c1' }],
        openContradictions: [{ score: 0.7 }, { score: 0.5 }],
        violatedDependencies: 1,
        activeClaims: [],
        openBranches: 1,
      },
      weights, now, 0.001,
    );

    // Simulate settling: resolved 1 contradiction, fixed 1 dep, no constraint violation
    const phiAfter = computePhi(
      {
        activeViolations: [{ severity: 0.8, constraintId: 'c1' }],
        openContradictions: [{ score: 0.5 }],
        violatedDependencies: 0,
        activeClaims: [],
        openBranches: 1,
      },
      weights, now, 0.001,
    );

    expect(phiAfter).toBeLessThanOrEqual(phiBefore);
  });

  it('no change in world state keeps Phi identical (convergence)', () => {
    const params = {
      activeViolations: [{ severity: 0.3, constraintId: 'c1' }],
      openContradictions: [{ score: 0.4 }],
      violatedDependencies: 1,
      activeClaims: [],
      openBranches: 0,
    };
    const phi1 = computePhi(params, weights, now, 0.001);
    const phi2 = computePhi(params, weights, now, 0.001);
    expect(phi1).toBe(phi2); // idempotent
  });
});

// ── Fixed-point settling simulation ──────────────────────────

describe('Discrete fixed-point settling simulation', () => {
  /**
   * Simulates multiple rounds of settling on a pure data structure.
   * Verifies Phi is non-increasing across all rounds.
   */
  it('simulates convergence of a contradiction being resolved over rounds', () => {
    // Start: 2 contradictions, 1 violation
    const rounds = [
      { activeViolations: [{ severity: 0.9, constraintId: 'c1' }], openContradictions: [{ score: 0.8 }, { score: 0.5 }], violatedDependencies: 1, activeClaims: [], openBranches: 1 },
      { activeViolations: [{ severity: 0.9, constraintId: 'c1' }], openContradictions: [{ score: 0.8 }], violatedDependencies: 0, activeClaims: [], openBranches: 1 },
      { activeViolations: [{ severity: 0.9, constraintId: 'c1' }], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
      { activeViolations: [], openContradictions: [], violatedDependencies: 0, activeClaims: [], openBranches: 0 },
    ];

    const phis = rounds.map(r => computePhi(r, weights, now, 0.001));

    // Phi must be non-increasing across rounds
    for (let i = 1; i < phis.length; i++) {
      expect(phis[i]).toBeLessThanOrEqual(phis[i - 1]! + 1e-9);
    }

    // Final phi should be 0 (fully coherent)
    expect(phis[phis.length - 1]).toBe(0);

    // Coherence score must be non-decreasing
    const scores = phis.map(phi => computeCoherenceScore(phi, 2.0));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]! - 1e-9);
    }
    expect(scores[scores.length - 1]).toBeCloseTo(100);
  });
});
