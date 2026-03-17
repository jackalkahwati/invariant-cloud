/**
 * Confusion Matrix Rendering
 *
 * Formats Phase 2 confusion matrices and per-class metrics
 * as ASCII tables for terminal output and report inclusion.
 */

import type { ConfusionEntry, PerClassMetrics, ActionAdmissibility } from '../scenarios/types.js';

const CLASSES: ActionAdmissibility[] = ['VALID', 'RISKY', 'BLOCKED', 'BRANCH_DEPENDENT'];
const SHORT: Record<string, string> = {
  VALID: 'VLD',
  RISKY: 'RSK',
  BLOCKED: 'BLK',
  BRANCH_DEPENDENT: 'BRN',
  UNKNOWN: 'UNK',
};

// ── ASCII confusion matrix ──────────────────────────────────────────────────

/**
 * Render a 4×4 confusion matrix as ASCII table.
 * Rows = actual, columns = predicted.
 */
export function renderConfusionMatrix(entries: ConfusionEntry[]): string {
  const predCols = [...CLASSES, 'UNKNOWN'] as const;
  const W = 6;

  const getCount = (actual: ActionAdmissibility, predicted: string): number =>
    entries.filter(e => e.actual === actual && e.predicted === predicted)
      .reduce((s, e) => s + e.count, 0);

  const lines: string[] = [];

  // Header
  const header = 'Actual \\ Predicted'.padEnd(18) +
    predCols.map(c => (SHORT[c] ?? c.slice(0, W)).padStart(W)).join('');
  lines.push(header);
  lines.push('─'.repeat(header.length));

  // Rows
  for (const actual of CLASSES) {
    const row = (SHORT[actual] ?? actual).padEnd(18) +
      predCols.map(c => {
        const n = getCount(actual, c);
        const cell = n === 0 ? '·' : String(n);
        // Highlight diagonal (correct) with brackets
        return (actual === c ? `[${cell}]` : ` ${cell} `).padStart(W);
      }).join('');
    lines.push(row);
  }

  lines.push('─'.repeat(header.length));

  // Row totals / column totals
  const rowTotals = CLASSES.map(a =>
    entries.filter(e => e.actual === a).reduce((s, e) => s + e.count, 0)
  );
  const colTotals = predCols.map(c =>
    entries.filter(e => e.predicted === c).reduce((s, e) => s + e.count, 0)
  );
  const total = rowTotals.reduce((s, n) => s + n, 0);

  lines.push('Support'.padEnd(18) + rowTotals.map(n => String(n).padStart(W)).join(''));
  lines.push('Col total'.padEnd(18) + colTotals.map(n => String(n).padStart(W)).join('') +
    `  (N=${total})`);

  return lines.join('\n');
}

// ── Per-class precision/recall/F1 table ────────────────────────────────────

export function renderPerClassMetrics(metrics: PerClassMetrics[]): string {
  const header =
    'Class'.padEnd(20) +
    'Precision'.padStart(12) +
    'Recall'.padStart(10) +
    'F1'.padStart(10) +
    'Support'.padStart(10);

  const sep = '─'.repeat(header.length);
  const rows = metrics.map(m =>
    (SHORT[m.class] ?? m.class).padEnd(20) +
    pct(m.precision).padStart(12) +
    pct(m.recall).padStart(10) +
    pct(m.f1).padStart(10) +
    String(m.support).padStart(10)
  );

  // Macro averages
  const n = metrics.filter(m => m.support > 0).length;
  const macroP = metrics.reduce((s, m) => s + m.precision, 0) / (n || 1);
  const macroR = metrics.reduce((s, m) => s + m.recall, 0) / (n || 1);
  const macroF = metrics.reduce((s, m) => s + m.f1, 0) / (n || 1);
  const totalSupport = metrics.reduce((s, m) => s + m.support, 0);

  const macroRow =
    'macro avg'.padEnd(20) +
    pct(macroP).padStart(12) +
    pct(macroR).padStart(10) +
    pct(macroF).padStart(10) +
    String(totalSupport).padStart(10);

  return [header, sep, ...rows, sep, macroRow].join('\n');
}

// ── Per-family breakdown ───────────────────────────────────────────────────

export function renderFamilyBreakdown(
  breakdown: Record<string, { count: number; actionAccuracy: number; confusionMatrix: ConfusionEntry[] }>,
): string {
  const header =
    'Family'.padEnd(18) +
    'Count'.padStart(8) +
    'ActionAcc'.padStart(12) +
    '  BLOCKED recall'.padStart(18);

  const sep = '─'.repeat(header.length);

  const rows = Object.entries(breakdown)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fam, stats]) => {
      const blkRecall = computeBlockedRecall(stats.confusionMatrix);
      return (
        fam.padEnd(18) +
        String(stats.count).padStart(8) +
        pct(stats.actionAccuracy).padStart(12) +
        pct(blkRecall).padStart(18)
      );
    });

  return [header, sep, ...rows].join('\n');
}

function computeBlockedRecall(entries: ConfusionEntry[]): number {
  const tp = entries.filter(e => e.actual === 'BLOCKED' && e.predicted === 'BLOCKED')
    .reduce((s, e) => s + e.count, 0);
  const fn = entries.filter(e => e.actual === 'BLOCKED' && e.predicted !== 'BLOCKED')
    .reduce((s, e) => s + e.count, 0);
  return tp + fn > 0 ? tp / (tp + fn) : 1;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
