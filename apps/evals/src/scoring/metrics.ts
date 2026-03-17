/**
 * Scoring Functions — compute all hard metrics for each evaluation result.
 *
 * These are adversarial to all systems, including our own engine.
 * Ground truth was authored independently of any evaluator.
 */

import type {
  Scenario, EvaluationResult, ScenarioMetrics, AggregateMetrics,
  ScenarioCategory,
} from '../scenarios/types.js';

// ── Per-Scenario Scoring ──────────────────────────────────────

export function scoreResult(
  scenario: Scenario,
  result: EvaluationResult,
): ScenarioMetrics {
  const gt = scenario.groundTruth;

  // ── Contradiction detection ─────────────────────────────────
  const { precision: cPrecision, recall: cRecall, f1: cF1 } =
    scoreContradictionDetection(gt.contradictions, result.contradictionsDetected);

  // ── Branch correctness ───────────────────────────────────────
  const branchPrecision = gt.branchRequired === result.branchCreated ? 1 : 0;
  const branchRecall = branchPrecision; // symmetric for binary

  // ── Action classification ────────────────────────────────────
  const actionCorrect = gt.actionAdmissibility === result.actionAdmissibility;
  const actionWithinRisk = isWithinOneRisk(gt.actionAdmissibility, result.actionAdmissibility);

  // ── Invalidation recall ──────────────────────────────────────
  const { precision: iPrecision, recall: iRecall } =
    scoreStringSet(gt.invalidatedEntityNames, result.invalidatedEntityNames);
  const invalidationF1 = f1(iPrecision, iRecall);

  // ── Reasoning keyword coverage ───────────────────────────────
  const reasoningCoverage = scoreReasoningKeywords(
    gt.requiredReasoningKeywords,
    result.explanation,
  );

  // ── Composite score ──────────────────────────────────────────
  // Weights: action accuracy is most important, then contradictions, then invalidation
  const overallScore = (
    0.35 * (actionCorrect ? 1 : actionWithinRisk ? 0.5 : 0)
    + 0.25 * cF1
    + 0.20 * branchPrecision
    + 0.10 * invalidationF1
    + 0.10 * reasoningCoverage
  );

  return {
    contradictionRecall: cRecall,
    contradictionPrecision: cPrecision,
    contradictionF1: cF1,
    branchPrecision,
    branchRecall,
    actionCorrect,
    actionWithinRisk,
    invalidationRecall: iRecall,
    invalidationPrecision: iPrecision,
    reasoningKeywordCoverage: reasoningCoverage,
    overallScore,
  };
}

// ── Contradiction Detection Scoring ──────────────────────────

function scoreContradictionDetection(
  gtContradictions: Scenario['groundTruth']['contradictions'],
  detected: EvaluationResult['contradictionsDetected'],
): { precision: number; recall: number; f1: number } {
  if (gtContradictions.length === 0 && detected.length === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }
  if (gtContradictions.length === 0) {
    return { precision: 0, recall: 1, f1: 0 }; // false positives
  }
  if (detected.length === 0) {
    return { precision: 0, recall: 0, f1: 0 }; // missed all
  }

  // For each GT contradiction, check if it was detected.
  // Match by: entity name substring match OR predicate match in description.
  let matched = 0;
  for (const gt of gtContradictions) {
    const caught = detected.some(d => {
      const descLower = d.description?.toLowerCase() ?? '';
      const entityMatch = d.entityName?.toLowerCase().includes(gt.entityName.toLowerCase())
        || descLower.includes(gt.entityName.toLowerCase());
      const predicateMatch = d.predicate?.toLowerCase().includes(gt.predicate.toLowerCase())
        || descLower.includes(gt.predicate.toLowerCase());
      const valueMatch = descLower.includes(String(gt.valueA).toLowerCase())
        || descLower.includes(String(gt.valueB).toLowerCase());
      return entityMatch || (predicateMatch && valueMatch);
    });
    if (caught) matched++;
  }

  const recall = matched / gtContradictions.length;
  const precision = matched / detected.length;

  return { precision, recall, f1: f1(precision, recall) };
}

// ── Generic String Set Scoring ────────────────────────────────

function scoreStringSet(
  gtSet: string[],
  detectedSet: string[],
): { precision: number; recall: number } {
  if (gtSet.length === 0 && detectedSet.length === 0) return { precision: 1, recall: 1 };
  if (gtSet.length === 0) return { precision: 0, recall: 1 };
  if (detectedSet.length === 0) return { precision: 0, recall: 0 };

  const gtLower = new Set(gtSet.map(s => s.toLowerCase()));
  const detLower = new Set(detectedSet.map(s => s.toLowerCase()));

  let tp = 0;
  for (const g of gtLower) {
    if (detLower.has(g) || [...detLower].some(d => d.includes(g) || g.includes(d))) tp++;
  }

  return {
    precision: tp / detLower.size,
    recall: tp / gtLower.size,
  };
}

// ── Reasoning Coverage ────────────────────────────────────────

function scoreReasoningKeywords(
  keywords: string[],
  explanation: string,
): number {
  if (keywords.length === 0) return 1;
  const lower = explanation.toLowerCase();
  const found = keywords.filter(k => lower.includes(k.toLowerCase()));
  return found.length / keywords.length;
}

// ── Action Tier Distance ──────────────────────────────────────

const ADMISSIBILITY_ORDER = ['VALID', 'RISKY', 'BLOCKED', 'BRANCH_DEPENDENT'];

function isWithinOneRisk(
  gt: string,
  predicted: string,
): boolean {
  const gtIdx = ADMISSIBILITY_ORDER.indexOf(gt);
  const predIdx = ADMISSIBILITY_ORDER.indexOf(predicted);
  if (gtIdx === -1 || predIdx === -1) return false;
  return Math.abs(gtIdx - predIdx) <= 1;
}

// ── F1 helper ─────────────────────────────────────────────────

function f1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return 2 * precision * recall / (precision + recall);
}

// ── Aggregate Metrics ─────────────────────────────────────────

export function aggregateMetrics(
  evaluatorId: string,
  results: Array<{ scenario: Scenario; result: EvaluationResult; metrics: ScenarioMetrics }>,
): AggregateMetrics {
  const n = results.length;
  if (n === 0) {
    return emptyAggregate(evaluatorId);
  }

  const sum = (getter: (m: ScenarioMetrics) => number) =>
    results.reduce((acc, r) => acc + getter(r.metrics), 0) / n;

  const byCategory = {} as AggregateMetrics['byCategory'];
  const byDifficulty = {} as AggregateMetrics['byDifficulty'];

  for (const r of results) {
    const cat = r.scenario.category;
    const diff = r.scenario.difficulty;

    if (!byCategory[cat]) byCategory[cat] = { count: 0, meanOverallScore: 0, actionAccuracy: 0 };
    if (!byDifficulty[diff]) byDifficulty[diff] = { count: 0, meanOverallScore: 0 };

    byCategory[cat]!.count++;
    byCategory[cat]!.meanOverallScore += r.metrics.overallScore;
    byCategory[cat]!.actionAccuracy += r.metrics.actionCorrect ? 1 : 0;

    byDifficulty[diff]!.count++;
    byDifficulty[diff]!.meanOverallScore += r.metrics.overallScore;
  }

  for (const cat of Object.keys(byCategory) as ScenarioCategory[]) {
    const c = byCategory[cat]!;
    c.meanOverallScore /= c.count;
    c.actionAccuracy /= c.count;
  }

  for (const diff of Object.keys(byDifficulty)) {
    const d = byDifficulty[diff]!;
    d.meanOverallScore /= d.count;
  }

  return {
    evaluatorId,
    scenarioCount: n,
    meanContradictionF1: sum(m => m.contradictionF1),
    meanBranchF1: sum(m => f1(m.branchPrecision, m.branchRecall)),
    actionAccuracy: sum(m => m.actionCorrect ? 1 : 0),
    actionWithinRiskRate: sum(m => m.actionWithinRisk ? 1 : 0),
    meanInvalidationF1: sum(m => invalidationF1(m)),
    meanReasoningCoverage: sum(m => m.reasoningKeywordCoverage),
    meanOverallScore: sum(m => m.overallScore),
    byCategory,
    byDifficulty,
  };
}

function invalidationF1(m: ScenarioMetrics): number {
  return f1(m.invalidationPrecision, m.invalidationRecall);
}

function emptyAggregate(evaluatorId: string): AggregateMetrics {
  return {
    evaluatorId, scenarioCount: 0,
    meanContradictionF1: 0, meanBranchF1: 0, actionAccuracy: 0,
    actionWithinRiskRate: 0, meanInvalidationF1: 0,
    meanReasoningCoverage: 0, meanOverallScore: 0,
    byCategory: {} as never, byDifficulty: {} as never,
  };
}

// ── Ablation Delta Computation ────────────────────────────────

export interface AblationDelta {
  ablationId: string;
  ablationName: string;
  deltaOverallScore: number;      // full - ablation (positive = full wins)
  deltaActionAccuracy: number;
  deltaContradictionF1: number;
  deltaBranchF1: number;
  deltaInvalidationF1: number;
  percentageDrop: number;         // percentage decrease from full engine
}

export function computeAblationDeltas(
  fullMetrics: AggregateMetrics,
  ablationMetrics: AggregateMetrics[],
): AblationDelta[] {
  return ablationMetrics.map(agg => {
    const delta = fullMetrics.meanOverallScore - agg.meanOverallScore;
    const pct = fullMetrics.meanOverallScore > 0
      ? (delta / fullMetrics.meanOverallScore) * 100
      : 0;

    return {
      ablationId: agg.evaluatorId,
      ablationName: agg.evaluatorId.replace('ablation_', '').replace(/_/g, ' '),
      deltaOverallScore: delta,
      deltaActionAccuracy: fullMetrics.actionAccuracy - agg.actionAccuracy,
      deltaContradictionF1: fullMetrics.meanContradictionF1 - agg.meanContradictionF1,
      deltaBranchF1: fullMetrics.meanBranchF1 - agg.meanBranchF1,
      deltaInvalidationF1: fullMetrics.meanInvalidationF1 - agg.meanInvalidationF1,
      percentageDrop: pct,
    };
  });
}
