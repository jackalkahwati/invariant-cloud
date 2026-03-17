/**
 * Unit tests for ContradictionDetector and all detection plugins.
 */

import { describe, it, expect } from 'vitest';
import {
  ExactNumericConflictDetector,
  StatusConflictDetector,
  TemporalConflictDetector,
  RangeThresholdConflictDetector,
  ContradictionDetectorRegistry,
} from '../../src/application/services/ContradictionDetector.js';
import type { ClaimWithRelations } from '../../src/domain/entities/types.js';

function makeClaim(overrides: Partial<ClaimWithRelations>): ClaimWithRelations {
  return {
    id: 'claim-1',
    entityId: 'entity-1',
    predicate: 'status',
    value: 'active',
    confidence: 0.9,
    sourceId: 'source-1',
    timestamp: new Date(),
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    entity: { id: 'entity-1', name: 'Entity One', type: 'COMPONENT', isActive: true, createdAt: new Date(), updatedAt: new Date() },
    source: { id: 'source-1', name: 'Test Source', type: 'SYSTEM', trustScore: 0.8, createdAt: new Date() },
    ...overrides,
  } as ClaimWithRelations;
}

// ── ExactNumericConflictDetector ──────────────────────────────

describe('ExactNumericConflictDetector', () => {
  const detector = new ExactNumericConflictDetector();

  it('detects numeric conflict on same entity+predicate', () => {
    const a = makeClaim({ predicate: 'mass', value: 21.3 });
    const b = makeClaim({ id: 'claim-2', predicate: 'mass', value: 14.2 });
    const result = detector.detect(a, b);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('NUMERIC_CONFLICT');
    expect(result?.score).toBeGreaterThan(0);
  });

  it('returns null for same value', () => {
    const a = makeClaim({ predicate: 'mass', value: 14.2 });
    const b = makeClaim({ id: 'claim-2', predicate: 'mass', value: 14.2 });
    expect(detector.detect(a, b)).toBeNull();
  });

  it('returns null for different entities', () => {
    const a = makeClaim({ entityId: 'e1', predicate: 'mass', value: 21.3 });
    const b = makeClaim({ id: 'claim-2', entityId: 'e2', predicate: 'mass', value: 14.2 });
    expect(detector.detect(a, b)).toBeNull();
  });

  it('returns null for non-numeric values', () => {
    const a = makeClaim({ predicate: 'status', value: 'done' });
    const b = makeClaim({ id: 'claim-2', predicate: 'status', value: 'blocked' });
    expect(detector.detect(a, b)).toBeNull();
  });
});

// ── StatusConflictDetector ────────────────────────────────────

describe('StatusConflictDetector', () => {
  const detector = new StatusConflictDetector();

  it('detects mutex status conflict (done vs blocked)', () => {
    const a = makeClaim({ predicate: 'status', value: 'done' });
    const b = makeClaim({ id: 'claim-2', predicate: 'status', value: 'blocked' });
    const result = detector.detect(a, b);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('STATUS_CONFLICT');
    expect(result?.score).toBeGreaterThanOrEqual(0.8);
  });

  it('detects green vs red conflict', () => {
    const a = makeClaim({ predicate: 'status', value: 'green' });
    const b = makeClaim({ id: 'claim-2', predicate: 'status', value: 'red' });
    expect(detector.detect(a, b)).not.toBeNull();
  });

  it('returns null for same status', () => {
    const a = makeClaim({ predicate: 'status', value: 'done' });
    const b = makeClaim({ id: 'claim-2', predicate: 'status', value: 'done' });
    expect(detector.detect(a, b)).toBeNull();
  });

  it('returns null for different entities', () => {
    const a = makeClaim({ entityId: 'e1', predicate: 'status', value: 'done' });
    const b = makeClaim({ id: 'claim-2', entityId: 'e2', predicate: 'status', value: 'blocked' });
    expect(detector.detect(a, b)).toBeNull();
  });
});

// ── RangeThresholdConflictDetector ────────────────────────────

describe('RangeThresholdConflictDetector', () => {
  const detector = new RangeThresholdConflictDetector();

  it('detects when value exceeds limit predicate', () => {
    const a = makeClaim({ predicate: 'mass', value: 21.3 });
    const b = makeClaim({ id: 'claim-2', predicate: 'mass_limit', value: 20.0 });
    const result = detector.detect(a, b);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('RANGE_THRESHOLD_CONFLICT');
    expect(result?.score).toBeGreaterThan(0);
  });

  it('returns null when value is within limit', () => {
    const a = makeClaim({ predicate: 'mass', value: 18.0 });
    const b = makeClaim({ id: 'claim-2', predicate: 'mass_limit', value: 20.0 });
    expect(detector.detect(a, b)).toBeNull();
  });

  it('returns null for unrelated predicates', () => {
    const a = makeClaim({ predicate: 'temperature', value: 25.0 });
    const b = makeClaim({ id: 'claim-2', predicate: 'mass_limit', value: 20.0 });
    expect(detector.detect(a, b)).toBeNull();
  });
});

// ── Registry ──────────────────────────────────────────────────

describe('ContradictionDetectorRegistry', () => {
  const registry = new ContradictionDetectorRegistry();

  it('detectInSet finds contradictions in a claim set', () => {
    const claims: ClaimWithRelations[] = [
      makeClaim({ id: 'c1', predicate: 'status', value: 'done' }),
      makeClaim({ id: 'c2', predicate: 'status', value: 'blocked' }),
      makeClaim({ id: 'c3', predicate: 'mass', value: 21.3 }),
      makeClaim({ id: 'c4', predicate: 'mass_limit', value: 20.0 }),
    ];

    const results = registry.detectInSet(claims);
    expect(results.length).toBeGreaterThan(0);
    const types = results.map(r => r.result.type);
    expect(types).toContain('STATUS_CONFLICT');
  });

  it('detectBetween returns null for non-conflicting claims', () => {
    const a = makeClaim({ id: 'c1', predicate: 'status', value: 'done' });
    const b = makeClaim({ id: 'c2', entityId: 'entity-2', predicate: 'status', value: 'blocked' });
    const result = registry.detectBetween(a, b);
    expect(result).toBeNull();
  });

  it('detectBetween returns highest-scoring result', () => {
    const a = makeClaim({ id: 'c1', predicate: 'status', value: 'done', confidence: 1.0 });
    const b = makeClaim({ id: 'c2', predicate: 'status', value: 'blocked', confidence: 1.0 });
    const result = registry.detectBetween(a, b);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.5);
  });
});
