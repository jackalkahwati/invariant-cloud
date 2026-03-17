/**
 * Results Reporter — generates structured tables and saves JSON results.
 *
 * Output:
 *   1. Console table: all evaluators × all metrics
 *   2. Ablation delta table
 *   3. Per-category breakdown
 *   4. JSON dump to results/
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  AggregateMetrics, AblationDelta, ScenarioCategory,
} from '../scenarios/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '../../results');

const EVALUATOR_ORDER = [
  'engine_full',
  'baseline_a_plain_llm',
  'baseline_b_rag',
  'baseline_c_memory',
  'baseline_d_rules',
  'ablation_no_branching',
  'ablation_no_settling',
  'ablation_unsigned_deps',
  'ablation_no_provenance',
  'ablation_no_staleness',
  'ablation_no_budget',
];

const EVALUATOR_LABELS: Record<string, string> = {
  engine_full:            'Full Engine      ',
  baseline_a_plain_llm:  'Baseline A (LLM) ',
  baseline_b_rag:         'Baseline B (RAG) ',
  baseline_c_memory:      'Baseline C (Mem) ',
  baseline_d_rules:       'Baseline D (Rules)',
  ablation_no_branching:  'Abl: No Branch   ',
  ablation_no_settling:   'Abl: No Settling ',
  ablation_unsigned_deps: 'Abl: Unsigned Dep',
  ablation_no_provenance: 'Abl: No Provenance',
  ablation_no_staleness:  'Abl: No Staleness',
  ablation_no_budget:     'Abl: No Budget   ',
};

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function num(n: number, decimals = 3): string {
  return n.toFixed(decimals);
}

function pad(s: string, width: number): string {
  return s.padEnd(width, ' ');
}

export function printMainResultsTable(aggregates: AggregateMetrics[]): void {
  const sorted = [...aggregates].sort(
    (a, b) => EVALUATOR_ORDER.indexOf(a.evaluatorId) - EVALUATOR_ORDER.indexOf(b.evaluatorId)
  );

  console.log('\n' + '═'.repeat(120));
  console.log('COHERENCE ENGINE EVAL RESULTS');
  console.log('═'.repeat(120));
  console.log(
    pad('Evaluator', 22) +
    pad('N', 5) +
    pad('Overall↑', 10) +
    pad('Action Acc↑', 12) +
    pad('Contr F1↑', 11) +
    pad('Branch F1↑', 12) +
    pad('Inval F1↑', 11) +
    pad('Reasoning↑', 11) +
    pad('Within-Risk↑', 13)
  );
  console.log('─'.repeat(120));

  for (const agg of sorted) {
    const label = EVALUATOR_LABELS[agg.evaluatorId] ?? agg.evaluatorId;
    const isFullEngine = agg.evaluatorId === 'engine_full';
    const prefix = isFullEngine ? '▶ ' : '  ';

    console.log(
      prefix + pad(label, 20) +
      pad(String(agg.scenarioCount), 5) +
      pad(pct(agg.meanOverallScore), 10) +
      pad(pct(agg.actionAccuracy), 12) +
      pad(pct(agg.meanContradictionF1), 11) +
      pad(pct(agg.meanBranchF1), 12) +
      pad(pct(agg.meanInvalidationF1), 11) +
      pad(pct(agg.meanReasoningCoverage), 11) +
      pad(pct(agg.actionWithinRiskRate), 13)
    );
  }

  console.log('═'.repeat(120));
}

export function printAblationTable(
  fullMetrics: AggregateMetrics,
  deltas: AblationDelta[],
): void {
  console.log('\n' + '═'.repeat(90));
  console.log('ABLATION ANALYSIS (delta from full engine)');
  console.log('Table answers: what happens when we remove each ingredient?');
  console.log('═'.repeat(90));
  console.log(
    pad('Removed Component', 22) +
    pad('Overall Δ', 12) +
    pad('Action Δ', 11) +
    pad('Contr Δ', 10) +
    pad('Branch Δ', 11) +
    pad('% Drop', 8) +
    pad('Verdict', 15)
  );
  console.log('─'.repeat(90));

  for (const d of deltas) {
    const verdict = d.percentageDrop > 10
      ? '✗ CRITICAL'
      : d.percentageDrop > 5
        ? '△ IMPORTANT'
        : d.percentageDrop > 2
          ? '~ MARGINAL'
          : '≈ MINIMAL';

    console.log(
      pad(d.ablationName, 22) +
      pad(`${d.deltaOverallScore >= 0 ? '+' : ''}${pct(d.deltaOverallScore)}`, 12) +
      pad(`${d.deltaActionAccuracy >= 0 ? '+' : ''}${pct(d.deltaActionAccuracy)}`, 11) +
      pad(`${d.deltaContradictionF1 >= 0 ? '+' : ''}${pct(d.deltaContradictionF1)}`, 10) +
      pad(`${d.deltaBranchF1 >= 0 ? '+' : ''}${pct(d.deltaBranchF1)}`, 11) +
      pad(`${d.percentageDrop.toFixed(1)}%`, 8) +
      pad(verdict, 15)
    );
  }

  console.log('═'.repeat(90));
  console.log(`Full engine baseline: overall=${pct(fullMetrics.meanOverallScore)}, action_acc=${pct(fullMetrics.actionAccuracy)}`);
}

export function printCategoryBreakdown(aggregates: AggregateMetrics[]): void {
  const categories: ScenarioCategory[] = ['action_safety', 'contradiction', 'multi_hop', 'branch_sensitive', 'stale_state', 'long_horizon'];

  const relevant = aggregates.filter(a =>
    ['engine_full', 'baseline_a_plain_llm', 'baseline_b_rag', 'baseline_d_rules'].includes(a.evaluatorId)
  );

  console.log('\n' + '═'.repeat(100));
  console.log('PERFORMANCE BY CATEGORY');
  console.log('═'.repeat(100));

  for (const cat of categories) {
    const hasData = relevant.some(a => a.byCategory[cat]);
    if (!hasData) continue;

    console.log(`\n  ${cat.toUpperCase()}:`);
    console.log('  ' + pad('Evaluator', 22) + pad('Count', 7) + pad('Overall', 10) + pad('Action Acc', 12));

    for (const agg of relevant) {
      const catData = agg.byCategory[cat];
      if (!catData) continue;
      const label = EVALUATOR_LABELS[agg.evaluatorId] ?? agg.evaluatorId;
      console.log('  ' + pad(label, 22) + pad(String(catData.count), 7) + pad(pct(catData.meanOverallScore), 10) + pad(pct(catData.actionAccuracy), 12));
    }
  }
  console.log();
}

export function printDifficultyBreakdown(aggregates: AggregateMetrics[]): void {
  const relevant = aggregates.filter(a =>
    ['engine_full', 'baseline_a_plain_llm', 'baseline_d_rules'].includes(a.evaluatorId)
  );

  console.log('\n' + '═'.repeat(80));
  console.log('PERFORMANCE BY DIFFICULTY');
  console.log('═'.repeat(80));

  for (const diff of ['easy', 'medium', 'hard']) {
    const hasData = relevant.some(a => a.byDifficulty[diff]);
    if (!hasData) continue;

    console.log(`\n  ${diff.toUpperCase()}:`);
    console.log('  ' + pad('Evaluator', 22) + pad('Count', 7) + pad('Overall', 10));

    for (const agg of relevant) {
      const diffData = agg.byDifficulty[diff];
      if (!diffData) continue;
      const label = EVALUATOR_LABELS[agg.evaluatorId] ?? agg.evaluatorId;
      console.log('  ' + pad(label, 22) + pad(String(diffData.count), 7) + pad(pct(diffData.meanOverallScore), 10));
    }
  }
  console.log();
}

export function saveResults(
  runId: string,
  aggregates: AggregateMetrics[],
  ablationDeltas: AblationDelta[],
  rawResults: Array<{ scenario: unknown; result: unknown; metrics: unknown }>,
): void {
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `eval-${runId}-${timestamp}.json`;
    const filePath = join(RESULTS_DIR, fileName);

    writeFileSync(filePath, JSON.stringify({
      runId,
      timestamp: new Date().toISOString(),
      summary: aggregates,
      ablationDeltas,
      rawResults,
    }, null, 2));

    console.log(`\n📊 Results saved to: ${filePath}`);
  } catch (err) {
    console.warn(`Warning: could not save results: ${err}`);
  }
}

export function printThesisSummary(
  fullMetrics: AggregateMetrics,
  baselineMetrics: AggregateMetrics[],
  ablationDeltas: AblationDelta[],
): void {
  const bestBaseline = baselineMetrics.reduce(
    (best, curr) => curr.meanOverallScore > best.meanOverallScore ? curr : best
  );

  const gap = fullMetrics.meanOverallScore - bestBaseline.meanOverallScore;
  const criticalAblations = ablationDeltas.filter(d => d.percentageDrop > 10);
  const importantAblations = ablationDeltas.filter(d => d.percentageDrop > 5 && d.percentageDrop <= 10);

  console.log('\n' + '█'.repeat(80));
  console.log('THESIS EVALUATION SUMMARY');
  console.log('█'.repeat(80));
  console.log('\nThesis tested:');
  console.log('  "For tasks requiring persistent truth maintenance under change,');
  console.log('   explicit coherence-first architectures with branching and');
  console.log('   fixed-point settling outperform standard agent stacks."');
  console.log();
  console.log(`Full Engine:       ${pct(fullMetrics.meanOverallScore)} overall, ${pct(fullMetrics.actionAccuracy)} action accuracy`);
  console.log(`Best Baseline:     ${pct(bestBaseline.meanOverallScore)} overall (${bestBaseline.evaluatorId})`);
  console.log(`Gap vs. baselines: ${gap >= 0 ? '+' : ''}${pct(gap)}`);
  console.log();

  if (gap > 0.05) {
    console.log('✓ Full engine OUTPERFORMS best baseline by ' + pct(gap));
  } else if (gap > 0) {
    console.log('~ Full engine marginally outperforms baseline (' + pct(gap) + ')');
  } else {
    console.log('✗ Full engine does NOT outperform best baseline');
  }

  console.log('\nAblation findings (which ingredients matter):');
  for (const d of criticalAblations) {
    console.log(`  ✗ CRITICAL: Removing "${d.ablationName}" drops performance by ${d.percentageDrop.toFixed(1)}%`);
  }
  for (const d of importantAblations) {
    console.log(`  △ IMPORTANT: Removing "${d.ablationName}" drops performance by ${d.percentageDrop.toFixed(1)}%`);
  }
  if (criticalAblations.length === 0 && importantAblations.length === 0) {
    console.log('  ~ No ablation produced a critical drop (may need more scenarios)');
  }

  console.log();
  console.log('Evidence for BPR principles:');
  const branchingDelta = ablationDeltas.find(d => d.ablationId === 'ablation_no_branching');
  const settlingDelta = ablationDeltas.find(d => d.ablationId === 'ablation_no_settling');
  const depsDelta = ablationDeltas.find(d => d.ablationId === 'ablation_unsigned_deps');

  if (branchingDelta) console.log(`  Explicit branching: ${branchingDelta.percentageDrop.toFixed(1)}% contribution`);
  if (settlingDelta) console.log(`  Fixed-point settling: ${settlingDelta.percentageDrop.toFixed(1)}% contribution`);
  if (depsDelta) console.log(`  Signed dependencies: ${depsDelta.percentageDrop.toFixed(1)}% contribution`);
  console.log('█'.repeat(80) + '\n');
}
