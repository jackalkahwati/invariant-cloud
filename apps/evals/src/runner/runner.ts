/**
 * Eval Runner — orchestrates scenario execution across all evaluators.
 *
 * Supports:
 *   - Parallel execution (configurable concurrency)
 *   - Skip-LLM mode (engine + ablations only, no API cost)
 *   - Suite filtering (atlas, branch, drift)
 *   - Progress reporting
 *   - Graceful error handling (one failed eval doesn't stop the run)
 */

import type { Scenario, EvaluationResult, ScenarioMetrics } from '../scenarios/types.js';
import type { Evaluator } from '../engine/evaluators.js';
import { scoreResult, aggregateMetrics, computeAblationDeltas } from '../scoring/metrics.js';
import {
  printMainResultsTable, printAblationTable, printCategoryBreakdown,
  printDifficultyBreakdown, saveResults, printThesisSummary,
} from '../scoring/report.js';

export interface RunnerConfig {
  scenarios: Scenario[];
  evaluators: Evaluator[];
  concurrency?: number;
  runId?: string;
  verbose?: boolean;
  saveJson?: boolean;
}

export interface RunResult {
  scenario: Scenario;
  evaluatorId: string;
  result: EvaluationResult;
  metrics: ScenarioMetrics;
}

export async function runEvals(config: RunnerConfig): Promise<void> {
  const {
    scenarios,
    evaluators,
    concurrency = 3,
    runId = `run-${Date.now()}`,
    verbose = false,
    saveJson = true,
  } = config;

  const totalJobs = scenarios.length * evaluators.length;
  console.log(`\n🔬 Coherence Engine Eval Suite`);
  console.log(`   Scenarios: ${scenarios.length}`);
  console.log(`   Evaluators: ${evaluators.length} (${evaluators.map(e => e.id).join(', ')})`);
  console.log(`   Total evaluations: ${totalJobs}`);
  console.log(`   Concurrency: ${concurrency}\n`);

  const allResults: RunResult[] = [];
  let completed = 0;
  let errors = 0;

  // Build job queue: [scenario, evaluator, namespace] tuples
  const jobs: Array<{ scenario: Scenario; evaluator: Evaluator; namespace: string }> = [];

  for (const scenario of scenarios) {
    for (const evaluator of evaluators) {
      jobs.push({
        scenario,
        evaluator,
        // Unique namespace per (scenario, evaluator) to avoid DB collisions
        namespace: `eval_${runId}_${scenario.id}_${evaluator.id}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      });
    }
  }

  // Process in batches
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, Math.min(i + concurrency, jobs.length));

    const batchResults = await Promise.allSettled(
      batch.map(async ({ scenario, evaluator, namespace }) => {
        const result = await evaluator.run(scenario, namespace);
        const metrics = scoreResult(scenario, result);
        return { scenario, evaluatorId: evaluator.id, result, metrics };
      })
    );

    for (const res of batchResults) {
      completed++;
      const progress = `[${completed}/${totalJobs}]`;

      if (res.status === 'fulfilled') {
        const { scenario, result, metrics } = res.value;
        allResults.push(res.value);

        if (verbose || result.error) {
          const icon = result.error ? '✗' : metrics.actionCorrect ? '✓' : '△';
          console.log(`${progress} ${icon} ${scenario.id} × ${result.evaluatorId}: overall=${(metrics.overallScore * 100).toFixed(0)}% ${result.error ? `ERROR: ${result.error}` : ''}`);
        } else {
          process.stdout.write(`\r${progress} ${scenario.id.slice(0, 20).padEnd(20)} ...`);
        }
      } else {
        errors++;
        console.error(`${progress} ✗ FATAL: ${batch[batchResults.indexOf(res)]?.scenario.id} × ${batch[batchResults.indexOf(res)]?.evaluator.id}: ${res.reason}`);
      }
    }
  }

  console.log(`\n\n✅ Eval complete: ${completed - errors} succeeded, ${errors} failed\n`);

  // Group by evaluator and compute aggregate metrics
  const evaluatorIds = [...new Set(allResults.map(r => r.evaluatorId))];
  const aggregates = evaluatorIds.map(eid => {
    const evalResults = allResults.filter(r => r.evaluatorId === eid);
    return aggregateMetrics(eid, evalResults);
  });

  // Print results
  printMainResultsTable(aggregates);

  // Ablation deltas
  const fullMetrics = aggregates.find(a => a.evaluatorId === 'engine_full');
  if (fullMetrics) {
    const ablationMetrics = aggregates.filter(a => a.evaluatorId.startsWith('ablation_'));
    if (ablationMetrics.length > 0) {
      const deltas = computeAblationDeltas(fullMetrics, ablationMetrics);
      printAblationTable(fullMetrics, deltas);

      const baselineMetrics = aggregates.filter(a => a.evaluatorId.startsWith('baseline_'));
      if (baselineMetrics.length > 0) {
        printThesisSummary(fullMetrics, baselineMetrics, deltas);
      }

      // Save JSON results
      if (saveJson) {
        saveResults(runId, aggregates, deltas, allResults.map(r => ({
          scenario: { id: r.scenario.id, category: r.scenario.category, difficulty: r.scenario.difficulty },
          result: { evaluatorId: r.evaluatorId, admissibility: r.result.actionAdmissibility, error: r.result.error },
          metrics: r.metrics,
        })));
      }
    }
  }

  printCategoryBreakdown(aggregates);
  printDifficultyBreakdown(aggregates);
}

// ── Convenience: engine-only run (no API cost) ───────────────

export async function runEngineOnlyEvals(
  scenarios: Scenario[],
  engineEvaluators: Evaluator[],
  opts: Partial<RunnerConfig> = {},
): Promise<void> {
  return runEvals({
    scenarios,
    evaluators: engineEvaluators,
    concurrency: opts.concurrency ?? 5,
    runId: opts.runId ?? `engine-${Date.now()}`,
    verbose: opts.verbose ?? false,
    saveJson: opts.saveJson ?? true,
  });
}
