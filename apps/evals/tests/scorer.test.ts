/**
 * Unit tests for the eval scoring functions.
 * These must not require a database — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import { scoreResult, aggregateMetrics, computeAblationDeltas } from '../src/scoring/metrics.js';
import type { Scenario, EvaluationResult } from '../src/scenarios/types.js';

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'test-scenario',
    name: 'Test',
    category: 'action_safety',
    description: 'Test scenario',
    difficulty: 'medium',
    entities: [],
    claims: [],
    constraints: [],
    dependencies: [],
    proposedAction: { operation: 'test', description: 'test', impactedEntityNames: [] },
    groundTruth: {
      contradictions: [],
      branchRequired: false,
      actionAdmissibility: 'BLOCKED',
      invalidatedEntityNames: [],
      coherenceLevel: 'LOW',
      requiredReasoningKeywords: ['blocked', 'violation'],
    },
    ...overrides,
  };
}

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    scenarioId: 'test-scenario',
    evaluatorId: 'test',
    durationMs: 100,
    contradictionsDetected: [],
    branchCreated: false,
    actionAdmissibility: 'BLOCKED',
    invalidatedEntityNames: [],
    explanation: 'Action blocked due to violation',
    ...overrides,
  };
}

// ── Action Classification ─────────────────────────────────────

describe('Action classification scoring', () => {
  it('exact match scores actionCorrect=true', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, actionAdmissibility: 'BLOCKED' } });
    const result = makeResult({ actionAdmissibility: 'BLOCKED' });
    const metrics = scoreResult(scenario, result);
    expect(metrics.actionCorrect).toBe(true);
    expect(metrics.actionWithinRisk).toBe(true);
  });

  it('one tier off scores actionCorrect=false, actionWithinRisk=true', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, actionAdmissibility: 'BLOCKED' } });
    const result = makeResult({ actionAdmissibility: 'RISKY' });
    const metrics = scoreResult(scenario, result);
    expect(metrics.actionCorrect).toBe(false);
    expect(metrics.actionWithinRisk).toBe(true);
  });

  it('two tiers off scores actionCorrect=false, actionWithinRisk=false', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, actionAdmissibility: 'BLOCKED' } });
    const result = makeResult({ actionAdmissibility: 'VALID' });
    const metrics = scoreResult(scenario, result);
    expect(metrics.actionCorrect).toBe(false);
    expect(metrics.actionWithinRisk).toBe(false);
  });

  it('VALID GT correctly matched', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, actionAdmissibility: 'VALID' } });
    const result = makeResult({ actionAdmissibility: 'VALID' });
    const metrics = scoreResult(scenario, result);
    expect(metrics.actionCorrect).toBe(true);
  });
});

// ── Contradiction Detection ───────────────────────────────────

describe('Contradiction detection scoring', () => {
  it('no GT contradictions, none detected → perfect score', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, contradictions: [] } });
    const result = makeResult({ contradictionsDetected: [] });
    const metrics = scoreResult(scenario, result);
    expect(metrics.contradictionF1).toBe(1);
    expect(metrics.contradictionRecall).toBe(1);
    expect(metrics.contradictionPrecision).toBe(1);
  });

  it('GT contradiction detected → recall=1', () => {
    const scenario = makeScenario({
      groundTruth: {
        ...makeScenario().groundTruth,
        contradictions: [{ entityName: 'Battery', predicate: 'mass', valueA: 21.3, valueB: 20.0, expectedSeverity: 'HIGH' }],
      },
    });
    const result = makeResult({
      contradictionsDetected: [{ description: 'Numeric conflict on Battery.mass: 21.3 vs 20', entityName: 'Battery', predicate: 'mass', score: 0.8 }],
    });
    const metrics = scoreResult(scenario, result);
    expect(metrics.contradictionRecall).toBeCloseTo(1);
  });

  it('missed GT contradiction → recall=0', () => {
    const scenario = makeScenario({
      groundTruth: {
        ...makeScenario().groundTruth,
        contradictions: [{ entityName: 'Battery', predicate: 'mass', valueA: 21.3, valueB: 20.0, expectedSeverity: 'HIGH' }],
      },
    });
    const result = makeResult({ contradictionsDetected: [] });
    const metrics = scoreResult(scenario, result);
    expect(metrics.contradictionRecall).toBe(0);
    expect(metrics.contradictionF1).toBe(0);
  });

  it('false positive (no GT, detected one) → precision=0', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, contradictions: [] } });
    const result = makeResult({
      contradictionsDetected: [{ description: 'Spurious detection', score: 0.3 }],
    });
    const metrics = scoreResult(scenario, result);
    expect(metrics.contradictionPrecision).toBe(0);
  });
});

// ── Branch Scoring ────────────────────────────────────────────

describe('Branch scoring', () => {
  it('GT requires branch, branch created → branchPrecision=1', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, branchRequired: true } });
    const result = makeResult({ branchCreated: true });
    const metrics = scoreResult(scenario, result);
    expect(metrics.branchPrecision).toBe(1);
  });

  it('GT no branch required, no branch created → branchPrecision=1', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, branchRequired: false } });
    const result = makeResult({ branchCreated: false });
    const metrics = scoreResult(scenario, result);
    expect(metrics.branchPrecision).toBe(1);
  });

  it('GT requires branch, no branch created → branchPrecision=0', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, branchRequired: true } });
    const result = makeResult({ branchCreated: false });
    const metrics = scoreResult(scenario, result);
    expect(metrics.branchPrecision).toBe(0);
  });

  it('GT no branch, branch created (false positive) → branchPrecision=0', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, branchRequired: false } });
    const result = makeResult({ branchCreated: true });
    const metrics = scoreResult(scenario, result);
    expect(metrics.branchPrecision).toBe(0);
  });
});

// ── Reasoning Coverage ────────────────────────────────────────

describe('Reasoning keyword coverage', () => {
  it('all keywords present → coverage=1', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, requiredReasoningKeywords: ['blocked', 'violation'] } });
    const result = makeResult({ explanation: 'Action is blocked due to a constraint violation' });
    const metrics = scoreResult(scenario, result);
    expect(metrics.reasoningKeywordCoverage).toBe(1);
  });

  it('half keywords present → coverage=0.5', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, requiredReasoningKeywords: ['blocked', 'contradiction'] } });
    const result = makeResult({ explanation: 'Action is blocked' });
    const metrics = scoreResult(scenario, result);
    expect(metrics.reasoningKeywordCoverage).toBe(0.5);
  });

  it('no keywords present → coverage=0', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, requiredReasoningKeywords: ['blocked', 'violation'] } });
    const result = makeResult({ explanation: 'Everything looks fine' });
    const metrics = scoreResult(scenario, result);
    expect(metrics.reasoningKeywordCoverage).toBe(0);
  });
});

// ── Overall Score ─────────────────────────────────────────────

describe('Overall composite score', () => {
  it('perfect result → overallScore close to 1', () => {
    const scenario = makeScenario({
      groundTruth: {
        contradictions: [{ entityName: 'Battery', predicate: 'mass', valueA: 21.3, valueB: 20.0, expectedSeverity: 'HIGH' }],
        branchRequired: false,
        actionAdmissibility: 'BLOCKED',
        invalidatedEntityNames: ['Launch'],
        coherenceLevel: 'LOW',
        requiredReasoningKeywords: ['blocked'],
      },
    });
    const result = makeResult({
      contradictionsDetected: [{ description: 'Battery.mass 21.3 exceeds limit 20', entityName: 'Battery', predicate: 'mass' }],
      branchCreated: false,
      actionAdmissibility: 'BLOCKED',
      invalidatedEntityNames: ['Launch'],
      explanation: 'blocked',
    });
    const metrics = scoreResult(scenario, result);
    expect(metrics.overallScore).toBeGreaterThan(0.8);
  });

  it('completely wrong result → overallScore near 0', () => {
    const scenario = makeScenario({ groundTruth: { ...makeScenario().groundTruth, actionAdmissibility: 'BLOCKED', branchRequired: true } });
    const result = makeResult({
      actionAdmissibility: 'VALID',
      branchCreated: false,
      explanation: 'All clear',
    });
    const metrics = scoreResult(scenario, result);
    expect(metrics.overallScore).toBeLessThan(0.3);
  });
});

// ── Aggregate Metrics ─────────────────────────────────────────

describe('aggregateMetrics', () => {
  it('computes mean over multiple results', () => {
    const scenario = makeScenario();
    const r1 = { scenario, result: makeResult({ actionAdmissibility: 'BLOCKED' }), metrics: scoreResult(scenario, makeResult({ actionAdmissibility: 'BLOCKED' })) };
    const r2 = { scenario, result: makeResult({ actionAdmissibility: 'VALID' }), metrics: scoreResult(scenario, makeResult({ actionAdmissibility: 'VALID' })) };

    const agg = aggregateMetrics('test', [r1, r2]);
    expect(agg.actionAccuracy).toBe(0.5); // one correct, one wrong
    expect(agg.scenarioCount).toBe(2);
  });
});

// ── Ablation Deltas ───────────────────────────────────────────

describe('computeAblationDeltas', () => {
  it('delta is positive when full engine outperforms ablation', () => {
    const full = { evaluatorId: 'engine_full', scenarioCount: 10, meanOverallScore: 0.8, actionAccuracy: 0.9, meanContradictionF1: 0.8, meanBranchF1: 0.7, meanInvalidationF1: 0.6, meanReasoningCoverage: 0.9, actionWithinRiskRate: 0.95, byCategory: {} as never, byDifficulty: {} as never };
    const ablation = { ...full, evaluatorId: 'ablation_no_branching', meanOverallScore: 0.65, actionAccuracy: 0.8 };

    const deltas = computeAblationDeltas(full, [ablation]);
    expect(deltas[0]?.deltaOverallScore).toBeCloseTo(0.15);
    expect(deltas[0]?.percentageDrop).toBeCloseTo(18.75);
  });
});
