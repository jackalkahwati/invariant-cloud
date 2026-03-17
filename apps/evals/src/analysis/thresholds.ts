/**
 * Threshold Sweep Analysis
 *
 * Sweeps over (epsilon × budget) parameter grid and computes action accuracy,
 * BLOCKED recall/precision, and macro-F1 at each configuration.
 *
 * Also provides an optimal threshold recommendation based on maximizing
 * BLOCKED recall while maintaining actionAccuracy >= 0.85.
 */

import type {
  ScenarioV2, EvaluationResult, RawScores, ActionAdmissibility, ThresholdResult,
} from '../scenarios/types.js';

// ── Classify using custom thresholds ──────────────────────────────────────────

function classify(
  rawScores: RawScores,
  epsilon: number,
  budget: number,
): ActionAdmissibility {
  const { deltaPhi, psiScore } = rawScores;

  // BLOCKED: either component exceeds 1.5× threshold
  if (deltaPhi > budget * 1.5 || psiScore > epsilon * 1.5) return 'BLOCKED';
  // VALID: both within nominal threshold
  if (deltaPhi <= budget && psiScore <= epsilon) return 'VALID';
  // RISKY: in between
  return 'RISKY';
}

// ── Single threshold evaluation ───────────────────────────────────────────────

function evaluateThreshold(
  pairs: Array<{ scenario: ScenarioV2; result: EvaluationResult }>,
  epsilon: number,
  budget: number,
): ThresholdResult {
  const CLASSES: ActionAdmissibility[] = ['VALID', 'RISKY', 'BLOCKED', 'BRANCH_DEPENDENT'];

  // Count TP/FP/FN per class
  const tp: Record<string, number> = {};
  const fp: Record<string, number> = {};
  const fn: Record<string, number> = {};
  for (const c of CLASSES) { tp[c] = 0; fp[c] = 0; fn[c] = 0; }

  let correct = 0;

  for (const { scenario, result } of pairs) {
    const actual = scenario.expectedAction;
    const rawScores = result.rawScores;

    let predicted: ActionAdmissibility | 'UNKNOWN';

    if (actual === 'BRANCH_DEPENDENT') {
      // BRANCH_DEPENDENT is not affected by epsilon/budget (it's about open branches)
      predicted = result.actionAdmissibility ?? 'UNKNOWN';
    } else if (rawScores) {
      predicted = classify(rawScores, epsilon, budget);
    } else {
      predicted = result.actionAdmissibility ?? 'UNKNOWN';
    }

    if (predicted === actual) correct++;

    for (const c of CLASSES) {
      if (predicted === c && actual === c) tp[c]++;
      else if (predicted === c && actual !== c) fp[c]++;
      else if (predicted !== c && actual === c) fn[c]++;
    }
  }

  const perClass: ThresholdResult['perClass'] = {};
  for (const c of CLASSES) {
    const p = tp[c]! + fp[c]! > 0 ? tp[c]! / (tp[c]! + fp[c]!) : 0;
    const r = tp[c]! + fn[c]! > 0 ? tp[c]! / (tp[c]! + fn[c]!) : 0;
    const f = p + r > 0 ? 2 * p * r / (p + r) : 0;
    perClass[c] = { precision: p, recall: r, f1: f };
  }

  const macroF1 = CLASSES.reduce((s, c) => s + (perClass[c]?.f1 ?? 0), 0) / CLASSES.length;

  return {
    epsilon,
    budget,
    actionAccuracy: correct / (pairs.length || 1),
    blockedRecall: perClass['BLOCKED']?.recall ?? 0,
    blockedPrecision: perClass['BLOCKED']?.precision ?? 0,
    macroF1,
    perClass,
  };
}

// ── Grid sweep ─────────────────────────────────────────────────────────────────

export interface ThresholdSweepResult {
  grid: ThresholdResult[];
  optimal: ThresholdResult;
  baseline: ThresholdResult;  // current production config (epsilon=0.6, budget=5.0)
}

export function sweepThresholds(
  pairs: Array<{ scenario: ScenarioV2; result: EvaluationResult }>,
): ThresholdSweepResult {
  const epsilons = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70];
  const budgets = [2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];

  const grid: ThresholdResult[] = [];

  for (const epsilon of epsilons) {
    for (const budget of budgets) {
      grid.push(evaluateThreshold(pairs, epsilon, budget));
    }
  }

  // Baseline (current production config)
  const baseline = evaluateThreshold(pairs, 0.6, 5.0);

  // Optimal: maximize BLOCKED recall subject to actionAccuracy >= 0.85
  // Tie-break by macroF1
  const candidates = grid.filter(r => r.actionAccuracy >= 0.85);
  const optimal = candidates.length > 0
    ? candidates.reduce((best, r) =>
        r.blockedRecall > best.blockedRecall ||
        (r.blockedRecall === best.blockedRecall && r.macroF1 > best.macroF1)
          ? r : best
      )
    : grid.reduce((best, r) => r.blockedRecall > best.blockedRecall ? r : best);

  return { grid, optimal, baseline };
}

// ── Threshold recommendation text ─────────────────────────────────────────────

export function renderThresholdRecommendation(sweep: ThresholdSweepResult): string {
  const { optimal, baseline } = sweep;
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('  THRESHOLD RECOMMENDATION');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('  Current production:');
  lines.push(`    epsilon = ${baseline.epsilon.toFixed(2)}  budget = ${baseline.budget.toFixed(1)}`);
  lines.push(`    ActionAccuracy  = ${pct(baseline.actionAccuracy)}`);
  lines.push(`    BLOCKED recall  = ${pct(baseline.blockedRecall)}`);
  lines.push(`    BLOCKED prec    = ${pct(baseline.blockedPrecision)}`);
  lines.push(`    Macro-F1        = ${pct(baseline.macroF1)}`);
  lines.push('');
  lines.push('  Recommended:');
  lines.push(`    epsilon = ${optimal.epsilon.toFixed(2)}  budget = ${optimal.budget.toFixed(1)}`);
  lines.push(`    ActionAccuracy  = ${pct(optimal.actionAccuracy)}  (${delta(optimal.actionAccuracy, baseline.actionAccuracy)})`);
  lines.push(`    BLOCKED recall  = ${pct(optimal.blockedRecall)}  (${delta(optimal.blockedRecall, baseline.blockedRecall)})`);
  lines.push(`    BLOCKED prec    = ${pct(optimal.blockedPrecision)}  (${delta(optimal.blockedPrecision, baseline.blockedPrecision)})`);
  lines.push(`    Macro-F1        = ${pct(optimal.macroF1)}  (${delta(optimal.macroF1, baseline.macroF1)})`);
  lines.push('');

  if (optimal.epsilon === baseline.epsilon && optimal.budget === baseline.budget) {
    lines.push('  → Current thresholds already optimal for this dataset.');
  } else {
    lines.push(`  → Lower epsilon ${baseline.epsilon} → ${optimal.epsilon} to catch more BLOCKED scenarios.`);
    if (optimal.budget !== baseline.budget) {
      lines.push(`  → Adjust budget ${baseline.budget} → ${optimal.budget} for DeltaPhi dimension.`);
    }
    lines.push('');
    lines.push('  Impact analysis:');

    const classNames: ActionAdmissibility[] = ['VALID', 'RISKY', 'BLOCKED', 'BRANCH_DEPENDENT'];
    for (const c of classNames) {
      const ob = baseline.perClass[c] ?? { precision: 0, recall: 0, f1: 0 };
      const oo = optimal.perClass[c] ?? { precision: 0, recall: 0, f1: 0 };
      lines.push(
        `    ${c.padEnd(18)}: F1 ${pct(ob.f1)} → ${pct(oo.f1)}  ` +
        `Recall ${pct(ob.recall)} → ${pct(oo.recall)}`
      );
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}

// ── Top-N grid results ────────────────────────────────────────────────────────

export function renderTopThresholds(grid: ThresholdResult[], topN = 10): string {
  const sorted = [...grid].sort((a, b) => b.blockedRecall - a.blockedRecall || b.macroF1 - a.macroF1);
  const top = sorted.slice(0, topN);

  const header =
    'epsilon'.padStart(9) +
    'budget'.padStart(8) +
    'ActionAcc'.padStart(12) +
    'BLK-recall'.padStart(13) +
    'BLK-prec'.padStart(11) +
    'MacroF1'.padStart(10);

  const sep = '─'.repeat(header.length);

  const rows = top.map(r =>
    r.epsilon.toFixed(2).padStart(9) +
    r.budget.toFixed(1).padStart(8) +
    pct(r.actionAccuracy).padStart(12) +
    pct(r.blockedRecall).padStart(13) +
    pct(r.blockedPrecision).padStart(11) +
    pct(r.macroF1).padStart(10)
  );

  return [header, sep, ...rows].join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }

function delta(current: number, baseline: number): string {
  const d = current - baseline;
  const sign = d >= 0 ? '+' : '';
  return `${sign}${(d * 100).toFixed(1)}%`;
}
