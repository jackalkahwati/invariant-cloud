/**
 * Tests for the scenario generator — validates scenario structure and ground truth.
 */

import { describe, it, expect } from 'vitest';
import {
  generateAtlasBenchmark,
  generateBranchBenchmark,
  generateDriftBenchmark,
  generateAllScenarios,
} from '../src/scenarios/generator.js';
import type { Scenario } from '../src/scenarios/types.js';

function validateScenario(s: Scenario) {
  expect(s.id).toBeTruthy();
  expect(s.name).toBeTruthy();
  expect(s.entities.length).toBeGreaterThan(0);
  expect(s.claims.length).toBeGreaterThan(0);
  expect(s.proposedAction.operation).toBeTruthy();
  expect(s.proposedAction.impactedEntityNames.length).toBeGreaterThan(0);
  expect(s.groundTruth.actionAdmissibility).toMatch(/^(VALID|RISKY|BLOCKED|BRANCH_DEPENDENT)$/);
  expect(s.groundTruth.requiredReasoningKeywords).toBeDefined();
  // All impacted entity names must exist in entity list
  for (const name of s.proposedAction.impactedEntityNames) {
    expect(s.entities.some(e => e.name === name)).toBe(true);
  }
  // All claim entity names must exist
  for (const claim of s.claims) {
    expect(s.entities.some(e => e.name === claim.entityName)).toBe(true);
  }
  // All dependency entity names must exist
  for (const dep of s.dependencies) {
    expect(s.entities.some(e => e.name === dep.fromEntityName)).toBe(true);
    expect(s.entities.some(e => e.name === dep.toEntityName)).toBe(true);
  }
}

describe('generateAtlasBenchmark', () => {
  const scenarios = generateAtlasBenchmark();

  it('generates >= 25 scenarios', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(25);
  });

  it('all scenarios are structurally valid', () => {
    for (const s of scenarios) {
      validateScenario(s);
    }
  });

  it('includes scenarios of all three difficulties', () => {
    const diffs = new Set(scenarios.map(s => s.difficulty));
    expect(diffs.has('easy')).toBe(true);
    expect(diffs.has('medium')).toBe(true);
    expect(diffs.has('hard')).toBe(true);
  });

  it('includes the clean-pass scenario (VALID)', () => {
    const clean = scenarios.find(s => s.id === 'atlas-clean-pass');
    expect(clean).toBeDefined();
    expect(clean?.groundTruth.actionAdmissibility).toBe('VALID');
    expect(clean?.groundTruth.contradictions.length).toBe(0);
  });

  it('clean-pass has no contradictions or violations in ground truth', () => {
    const clean = scenarios.find(s => s.id === 'atlas-clean-pass');
    expect(clean?.groundTruth.contradictions.length).toBe(0);
    expect(clean?.groundTruth.branchRequired).toBe(false);
    expect(clean?.groundTruth.invalidatedEntityNames.length).toBe(0);
  });

  it('conflicting launch status scenarios are BLOCKED or BRANCH_DEPENDENT', () => {
    const conflictScenarios = scenarios.filter(s => s.id.includes('conflict'));
    for (const s of conflictScenarios) {
      expect(['BLOCKED', 'BRANCH_DEPENDENT']).toContain(s.groundTruth.actionAdmissibility);
    }
  });

  it('conflicting scenarios require branching', () => {
    const conflictScenarios = scenarios.filter(s => s.id.includes('conflict') && !s.id.includes('mass'));
    for (const s of conflictScenarios) {
      expect(s.groundTruth.branchRequired).toBe(true);
    }
  });

  it('mass violation scenarios have mass contradiction in ground truth', () => {
    const massScenarios = scenarios.filter(s => s.id.includes('mass-'));
    for (const s of massScenarios) {
      const massContra = s.groundTruth.contradictions.some(c =>
        c.entityName.includes('Battery') && c.predicate === 'mass'
      );
      expect(massContra).toBe(true);
    }
  });

  it('no duplicate scenario IDs', () => {
    const ids = scenarios.map(s => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all blocked scenarios have at least one reasoning keyword', () => {
    for (const s of scenarios) {
      if (s.groundTruth.actionAdmissibility === 'BLOCKED') {
        expect(s.groundTruth.requiredReasoningKeywords.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('generateBranchBenchmark', () => {
  const scenarios = generateBranchBenchmark();

  it('generates branch scenarios', () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it('all scenarios are structurally valid', () => {
    for (const s of scenarios) {
      validateScenario(s);
    }
  });

  it('conflicting-source scenarios are BRANCH_DEPENDENT', () => {
    const branching = scenarios.filter(s => !s.id.includes('agree'));
    for (const s of branching) {
      expect(s.groundTruth.actionAdmissibility).toBe('BRANCH_DEPENDENT');
      expect(s.groundTruth.branchRequired).toBe(true);
    }
  });

  it('agreeing-source scenarios are not branch-dependent', () => {
    const agreeing = scenarios.filter(s => s.id.includes('agree'));
    for (const s of agreeing) {
      expect(s.groundTruth.branchRequired).toBe(false);
      expect(s.groundTruth.actionAdmissibility).not.toBe('BRANCH_DEPENDENT');
    }
  });
});

describe('generateDriftBenchmark', () => {
  const scenarios = generateDriftBenchmark();

  it('generates drift scenarios', () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it('all scenarios are structurally valid', () => {
    for (const s of scenarios) {
      validateScenario(s);
    }
  });

  it('sequential update scenario has an update sequence', () => {
    const drift = scenarios.find(s => s.id === 'drift-sequential-20');
    expect(drift?.updateSequence).toBeDefined();
    expect(drift?.updateSequence!.length).toBeGreaterThan(5);
  });
});

describe('generateAllScenarios', () => {
  const scenarios = generateAllScenarios();

  it('generates a substantial number of scenarios', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(40);
  });

  it('includes all categories', () => {
    const cats = new Set(scenarios.map(s => s.category));
    expect(cats.has('action_safety')).toBe(true);
    expect(cats.has('branch_sensitive')).toBe(true);
    expect(cats.has('stale_state')).toBe(true);
  });

  it('no duplicate IDs across all benchmarks', () => {
    const ids = scenarios.map(s => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('BLOCKED scenarios have primary block reason or keywords', () => {
    const blocked = scenarios.filter(s => s.groundTruth.actionAdmissibility === 'BLOCKED');
    expect(blocked.length).toBeGreaterThan(0);
    for (const s of blocked) {
      const hasReason = s.groundTruth.primaryBlockReason || s.groundTruth.requiredReasoningKeywords.length > 0;
      expect(hasReason).toBe(true);
    }
  });
});
