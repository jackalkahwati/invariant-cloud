/**
 * Coherence Engine Eval Suite — CLI Entry Point
 *
 * Usage:
 *   npm run eval                    # Full run (engine + LLM baselines)
 *   npm run eval:fast               # Engine + ablations only (no API cost)
 *   npm run eval:atlas              # Atlas benchmark only
 *   npm run eval:ablations          # Ablations only
 *
 * Env vars:
 *   ANTHROPIC_API_KEY               # Required for LLM baselines
 *   EVAL_CONCURRENCY                # Default: 3
 *   EVAL_VERBOSE                    # Set to '1' for verbose output
 */

import 'dotenv/config';
import { generateAllScenarios, generateAtlasBenchmark, generateBranchBenchmark, generateDriftBenchmark } from './scenarios/generator.js';
import { allEngineEvaluators, fullEngineEvaluator, ablationEvaluators } from './engine/evaluators.js';
import { createLLMBaselines } from './baselines/evaluators.js';
import { runEvals } from './runner/runner.js';
import type { Evaluator } from './engine/evaluators.js';

const args = process.argv.slice(2);
const skipLLM = args.includes('--skip-llm');
const ablationsOnly = args.includes('--ablations-only');
const reportOnly = args.includes('--report-only');

const suiteArg = args.find(a => a.startsWith('--suite='));
const suite = suiteArg ? suiteArg.replace('--suite=', '') : 'all';

// ── Scenarios ─────────────────────────────────────────────────
let scenarios = generateAllScenarios();

if (suite === 'atlas') {
  scenarios = generateAtlasBenchmark();
} else if (suite === 'branch') {
  scenarios = generateBranchBenchmark();
} else if (suite === 'drift') {
  scenarios = generateDriftBenchmark();
}

console.log(`📋 Suite: ${suite} | Scenarios: ${scenarios.length}`);
console.log(`   Distribution:`);
const catCounts = scenarios.reduce((acc, s) => {
  acc[s.category] = (acc[s.category] ?? 0) + 1;
  return acc;
}, {} as Record<string, number>);
for (const [cat, count] of Object.entries(catCounts)) {
  console.log(`     ${cat}: ${count}`);
}
const diffCounts = scenarios.reduce((acc, s) => {
  acc[s.difficulty] = (acc[s.difficulty] ?? 0) + 1;
  return acc;
}, {} as Record<string, number>);
for (const [diff, count] of Object.entries(diffCounts)) {
  console.log(`     ${diff}: ${count}`);
}

// ── Evaluators ────────────────────────────────────────────────
let evaluators: Evaluator[] = [];

if (ablationsOnly) {
  evaluators = [fullEngineEvaluator, ...ablationEvaluators];
} else if (skipLLM) {
  evaluators = allEngineEvaluators;
} else {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    console.warn('\n⚠️  ANTHROPIC_API_KEY not set. Running engine + ablations only.\n');
    evaluators = allEngineEvaluators;
  } else {
    const llmBaselines = createLLMBaselines(apiKey);
    evaluators = [...llmBaselines, ...allEngineEvaluators];
  }
}

// ── Run ───────────────────────────────────────────────────────
await runEvals({
  scenarios,
  evaluators,
  concurrency: parseInt(process.env['EVAL_CONCURRENCY'] ?? '1', 10),
  runId: `coherence-evals-${suite}`,
  verbose: process.env['EVAL_VERBOSE'] === '1',
  saveJson: true,
});
