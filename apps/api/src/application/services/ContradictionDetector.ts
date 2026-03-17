/**
 * ContradictionDetector — Modular contradiction detection service.
 *
 * Implements multiple typed detectors:
 *   1. ExactNumericConflict   — same entity+predicate, incompatible numbers
 *   2. StatusConflict         — same entity+predicate, incompatible status strings
 *   3. TemporalConflict       — same entity+predicate, logically impossible sequence
 *   4. MutexTagConflict       — mutually exclusive values from a defined set
 *   5. RangeThresholdConflict — value violates a known range constraint
 *   6. SemanticConflict       — STUB ONLY in v1 (requires embedding/LLM)
 *
 * Each detector is independently pluggable (implements ContradictionDetectorPlugin).
 */

import type { ClaimWithRelations, ContradictionType } from '../../domain/entities/types.js';
import { computeContradictionScore } from './CoherenceEngine.js';

export interface DetectionResult {
  type: ContradictionType;
  score: number;
  description: string;
}

export interface ContradictionDetectorPlugin {
  type: ContradictionType;
  detect(a: ClaimWithRelations, b: ClaimWithRelations): DetectionResult | null;
}

// ── 1. Exact Numeric Conflict ─────────────────────────────────

export class ExactNumericConflictDetector implements ContradictionDetectorPlugin {
  type: ContradictionType = 'NUMERIC_CONFLICT';

  detect(a: ClaimWithRelations, b: ClaimWithRelations): DetectionResult | null {
    if (a.entityId !== b.entityId) return null;
    if (a.predicate !== b.predicate) return null;
    if (typeof a.value !== 'number' || typeof b.value !== 'number') return null;
    if (a.value === b.value) return null;

    const score = computeContradictionScore(a, b);
    if (score < 0.05) return null;

    return {
      type: this.type,
      score,
      description: `Numeric conflict on ${a.entity.name}.${a.predicate}: ${a.value} vs ${b.value}`,
    };
  }
}

// ── 2. Status Conflict ────────────────────────────────────────

// Known mutually exclusive status pairs
const MUTEX_STATUS_PAIRS: Array<[string, string]> = [
  ['done', 'blocked'],
  ['done', 'not_started'],
  ['complete', 'incomplete'],
  ['complete', 'not_started'],
  ['green', 'red'],
  ['green', 'blocked'],
  ['valid', 'invalid'],
  ['verified', 'unverified'],
  ['active', 'inactive'],
];

export class StatusConflictDetector implements ContradictionDetectorPlugin {
  type: ContradictionType = 'STATUS_CONFLICT';

  detect(a: ClaimWithRelations, b: ClaimWithRelations): DetectionResult | null {
    if (a.entityId !== b.entityId) return null;
    if (a.predicate !== b.predicate) return null;
    if (typeof a.value !== 'string' || typeof b.value !== 'string') return null;
    if (a.value.toLowerCase() === b.value.toLowerCase()) return null;

    const av = a.value.toLowerCase();
    const bv = b.value.toLowerCase();

    const isMutex = MUTEX_STATUS_PAIRS.some(
      ([x, y]) => (av === x && bv === y) || (av === y && bv === x)
    );

    if (!isMutex) {
      // Still a potential conflict — different values for same predicate
      const score = computeContradictionScore(a, b);
      if (score < 0.3) return null;
      return {
        type: this.type,
        score,
        description: `Status conflict on ${a.entity.name}.${a.predicate}: '${a.value}' vs '${b.value}'`,
      };
    }

    const score = computeContradictionScore(a, b);
    return {
      type: this.type,
      score: Math.max(score, 0.8),
      description: `Mutually exclusive status on ${a.entity.name}.${a.predicate}: '${a.value}' vs '${b.value}'`,
    };
  }
}

// ── 3. Temporal Conflict ──────────────────────────────────────

export class TemporalConflictDetector implements ContradictionDetectorPlugin {
  type: ContradictionType = 'TEMPORAL_CONFLICT';

  detect(a: ClaimWithRelations, b: ClaimWithRelations): DetectionResult | null {
    if (a.entityId !== b.entityId) return null;
    if (a.predicate !== b.predicate) return null;

    // Both should be active — if both claim different values for a point-in-time predicate
    // and their timestamps are very close, flag as temporal conflict
    if (a.status !== 'ACTIVE' || b.status !== 'ACTIVE') return null;

    const timeDelta = Math.abs(a.timestamp.getTime() - b.timestamp.getTime());
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    // If both are within 5 minutes and have different values — potential temporal conflict
    if (timeDelta < FIVE_MINUTES_MS) {
      const score = computeContradictionScore(a, b);
      if (score > 0.3) {
        return {
          type: this.type,
          score: score * 0.8,  // slightly lower than direct conflict
          description: `Temporal conflict on ${a.entity.name}.${a.predicate}: two claims within ${Math.round(timeDelta / 1000)}s`,
        };
      }
    }
    return null;
  }
}

// ── 4. Range/Threshold Conflict ───────────────────────────────

export class RangeThresholdConflictDetector implements ContradictionDetectorPlugin {
  type: ContradictionType = 'RANGE_THRESHOLD_CONFLICT';

  // Known limit predicates: when entityId has a "X_limit" predicate,
  // the corresponding "X" predicate must be <= limit.
  detect(a: ClaimWithRelations, b: ClaimWithRelations): DetectionResult | null {
    if (a.entityId !== b.entityId) return null;
    if (typeof a.value !== 'number' || typeof b.value !== 'number') return null;

    // Check if one is a limit predicate for the other
    const isLimit = (pred: string, otherPred: string) =>
      pred === `${otherPred}_limit` || pred === `${otherPred}_max` || pred === `${otherPred}_threshold`;

    let valueClaim: ClaimWithRelations;
    let limitClaim: ClaimWithRelations;

    if (isLimit(b.predicate, a.predicate)) {
      valueClaim = a;
      limitClaim = b;
    } else if (isLimit(a.predicate, b.predicate)) {
      valueClaim = b;
      limitClaim = a;
    } else {
      return null;
    }

    const val = valueClaim.value as number;
    const limit = limitClaim.value as number;

    if (val <= limit) return null;

    const excess = (val - limit) / limit;
    const score = Math.min(1, excess + 0.5);

    return {
      type: this.type,
      score,
      description: `Range violation on ${a.entity.name}: ${valueClaim.predicate}=${val} exceeds limit ${limitClaim.predicate}=${limit}`,
    };
  }
}

// ── 5. Semantic Conflict — STUB ───────────────────────────────

export class SemanticConflictDetector implements ContradictionDetectorPlugin {
  type: ContradictionType = 'SEMANTIC';

  // v1 stub: semantic detection requires embedding similarity or LLM call.
  // Interface is preserved; implementation is deferred to v2.
  detect(_a: ClaimWithRelations, _b: ClaimWithRelations): DetectionResult | null {
    // TODO v2: embed claim values into vector space and measure semantic distance.
    // If distance > semantic_threshold, flag as SEMANTIC contradiction.
    return null;
  }
}

// ── Detector Registry ─────────────────────────────────────────

export class ContradictionDetectorRegistry {
  private detectors: ContradictionDetectorPlugin[] = [];

  constructor(plugins?: ContradictionDetectorPlugin[]) {
    this.detectors = plugins ?? [
      new ExactNumericConflictDetector(),
      new StatusConflictDetector(),
      new TemporalConflictDetector(),
      new RangeThresholdConflictDetector(),
      new SemanticConflictDetector(),
    ];
  }

  /**
   * Run all detectors against a pair of claims.
   * Returns the highest-scoring detection result, or null.
   */
  detectBetween(a: ClaimWithRelations, b: ClaimWithRelations): DetectionResult | null {
    let best: DetectionResult | null = null;

    for (const detector of this.detectors) {
      const result = detector.detect(a, b);
      if (result && (best === null || result.score > best.score)) {
        best = result;
      }
    }

    return best;
  }

  /**
   * Run all pairs in a claim set and return all detected contradictions.
   * O(n^2) but n is typically small for a single entity's active claims.
   */
  detectInSet(claims: ClaimWithRelations[]): Array<{
    claimA: ClaimWithRelations;
    claimB: ClaimWithRelations;
    result: DetectionResult;
  }> {
    const results: ReturnType<typeof this.detectInSet> = [];

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i]!;
        const b = claims[j]!;
        const result = this.detectBetween(a, b);
        if (result) {
          results.push({ claimA: a, claimB: b, result });
        }
      }
    }

    return results;
  }
}
