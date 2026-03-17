/**
 * Unit tests for constraint violation checking.
 */

import { describe, it, expect } from 'vitest';
import { checkConstraintViolation } from '../../src/application/services/CoherenceEngine.js';
import type { Constraint, ClaimWithRelations } from '../../src/domain/entities/types.js';

function makeConstraint(overrides: Partial<Constraint>): Constraint {
  return {
    id: 'con-1',
    name: 'Test Constraint',
    description: 'Test',
    type: 'NUMERIC_RANGE',
    expression: { type: 'NUMERIC_RANGE' },
    entityIds: [],
    weight: 1.0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeClaim(overrides: Partial<ClaimWithRelations>): ClaimWithRelations {
  return {
    id: 'claim-1',
    entityId: 'entity-1',
    predicate: 'mass',
    value: 14.2,
    confidence: 0.9,
    sourceId: 'source-1',
    timestamp: new Date(),
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    entity: { id: 'entity-1', name: 'Battery Pack', type: 'COMPONENT', isActive: true, createdAt: new Date(), updatedAt: new Date() },
    source: { id: 'source-1', name: 'Test', type: 'SYSTEM', trustScore: 0.8, createdAt: new Date() },
    ...overrides,
  } as ClaimWithRelations;
}

// ── NUMERIC_RANGE ─────────────────────────────────────────────

describe('NUMERIC_RANGE constraint', () => {
  it('detects violation when value exceeds max', () => {
    const constraint = makeConstraint({
      type: 'NUMERIC_RANGE',
      expression: { type: 'NUMERIC_RANGE', predicate: 'mass', max: 20.0 },
    });
    const claims = [makeClaim({ predicate: 'mass', value: 21.3 })];
    const result = checkConstraintViolation(constraint, claims);
    expect(result?.violated).toBe(true);
    expect(result?.description).toContain('21.3');
    expect(result?.description).toContain('20');
  });

  it('returns null when value is within range', () => {
    const constraint = makeConstraint({
      type: 'NUMERIC_RANGE',
      expression: { type: 'NUMERIC_RANGE', predicate: 'mass', max: 20.0 },
    });
    const claims = [makeClaim({ predicate: 'mass', value: 18.0 })];
    expect(checkConstraintViolation(constraint, claims)).toBeNull();
  });

  it('detects violation when value is below min', () => {
    const constraint = makeConstraint({
      type: 'NUMERIC_RANGE',
      expression: { type: 'NUMERIC_RANGE', predicate: 'voltage', min: 3.7 },
    });
    const claims = [makeClaim({ predicate: 'voltage', value: 2.0 })];
    const result = checkConstraintViolation(constraint, claims);
    expect(result?.violated).toBe(true);
  });
});

// ── STATUS_DEPENDENCY ─────────────────────────────────────────

describe('STATUS_DEPENDENCY constraint', () => {
  it('detects violation when status=complete but verification=not_started', () => {
    const constraint = makeConstraint({
      type: 'STATUS_DEPENDENCY',
      expression: {
        type: 'STATUS_DEPENDENCY',
        ifPredicate: 'status',
        ifValue: 'complete',
        requiresPredicate: 'verificationStatus',
        requiresValue: 'complete',
      },
    });

    const claims = [
      makeClaim({ id: 'c1', predicate: 'status', value: 'complete' }),
      makeClaim({ id: 'c2', predicate: 'verificationStatus', value: 'not_started' }),
    ];

    const result = checkConstraintViolation(constraint, claims);
    expect(result?.violated).toBe(true);
  });

  it('returns null when requirement is satisfied', () => {
    const constraint = makeConstraint({
      type: 'STATUS_DEPENDENCY',
      expression: {
        type: 'STATUS_DEPENDENCY',
        ifPredicate: 'status',
        ifValue: 'complete',
        requiresPredicate: 'verificationStatus',
        requiresValue: 'complete',
      },
    });

    const claims = [
      makeClaim({ id: 'c1', predicate: 'status', value: 'complete' }),
      makeClaim({ id: 'c2', predicate: 'verificationStatus', value: 'complete' }),
    ];

    expect(checkConstraintViolation(constraint, claims)).toBeNull();
  });

  it('returns null when trigger condition is not met', () => {
    const constraint = makeConstraint({
      type: 'STATUS_DEPENDENCY',
      expression: {
        type: 'STATUS_DEPENDENCY',
        ifPredicate: 'status',
        ifValue: 'complete',
        requiresPredicate: 'verificationStatus',
        requiresValue: 'complete',
      },
    });

    const claims = [
      makeClaim({ id: 'c1', predicate: 'status', value: 'in_progress' }),
    ];

    expect(checkConstraintViolation(constraint, claims)).toBeNull();
  });
});

// ── MUTUAL_EXCLUSION ──────────────────────────────────────────

describe('MUTUAL_EXCLUSION constraint', () => {
  it('detects when both excluded values are present', () => {
    const constraint = makeConstraint({
      type: 'MUTUAL_EXCLUSION',
      expression: {
        type: 'MUTUAL_EXCLUSION',
        predicate: 'status',
        excludedValues: ['done', 'blocked'],
      },
    });

    const claims = [
      makeClaim({ id: 'c1', predicate: 'status', value: 'done' }),
      makeClaim({ id: 'c2', predicate: 'status', value: 'blocked' }),
    ];

    const result = checkConstraintViolation(constraint, claims);
    expect(result?.violated).toBe(true);
  });

  it('returns null when only one excluded value is present', () => {
    const constraint = makeConstraint({
      type: 'MUTUAL_EXCLUSION',
      expression: {
        type: 'MUTUAL_EXCLUSION',
        predicate: 'status',
        excludedValues: ['done', 'blocked'],
      },
    });

    const claims = [
      makeClaim({ id: 'c1', predicate: 'status', value: 'done' }),
    ];

    expect(checkConstraintViolation(constraint, claims)).toBeNull();
  });
});
