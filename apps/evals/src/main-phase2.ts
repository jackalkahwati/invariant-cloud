/**
 * Phase 2 Eval Suite — CLI Entry Point
 *
 * Usage:
 *   npm run eval:phase2                       # Full Phase 2 run (all families)
 *   npm run eval:phase2 -- --family=calibration
 *   npm run eval:phase2 -- --family=staleness
 *   npm run eval:phase2 -- --concurrency=4
 *   npm run eval:all                          # Phase 1 + Phase 2
 *
 * Env vars:
 *   DATABASE_URL                              # Prisma DB connection
 *   EVAL_CONCURRENCY                          # Default: 3
 *   EVAL_VERBOSE                              # Set to '1' for verbose output
 */

import 'dotenv/config';
import { generateAllScenariosV2, getScenariosByFamily, getPhase2Summary } from './scenarios/phase2/index.js';
import { runScenarioV2ThroughEngine } from './engine/harness-v2.js';
import { scoreV2Result, aggregateV2Metrics } from './scoring/metrics.js';
import { printPhase2Report, savePhase2Results } from './scoring/report.js';
import type { EvaluationResult, ScenarioV2, ScenarioMetrics } from './scenarios/types.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || process.env.EVAL_VERBOSE === '1';
const concurrency = parseInt(
  args.find(a => a.startsWith('--concurrency='))?.replace('--concurrency=', '') ??
  process.env.EVAL_CONCURRENCY ?? '3',
  10,
);

const familyArg = args.find(a => a.startsWith('--family='))?.replace('--family=', '');

// ── Engine configuration (matches production defaults) ────────────────────────

const ENGINE_CONFIG = {
  maxSettlingRounds: 20,
  phiConvergenceThreshold: 0.01,
  actionBudget: 5.0,         // DeltaPhi threshold for VALID
  actionEpsilon: 0.6,        // Psi threshold for VALID
  stalenessLambda: 0.001,    // half-life ~11 min
  coherenceWeights: {
    lambdaC: 1.0, lambdaD: 1.0, lambdaU: 1.0,
    w1: 0.4, w2: 0.3, w3: 0.3,
  },
  actionWeights: {
    mu1: 0.25, mu2: 0.25, mu3: 0.20, mu4: 0.15, mu5: 0.15,
  },
};

const HARNESS_CONFIG = {
  engineConfig: ENGINE_CONFIG as never,
};

// ── Scenario selection ────────────────────────────────────────────────────────

const allScenarios = familyArg
  ? getScenariosByFamily(familyArg as never)
  : generateAllScenariosV2();

if (allScenarios.length === 0) {
  console.error(`No scenarios found${familyArg ? ` for family '${familyArg}'` : ''}`);
  process.exit(1);
}

// Print summary
console.log('\n' + '═'.repeat(70));
console.log('  COHERENCE ENGINE — PHASE 2 EVAL');
console.log('═'.repeat(70));
if (familyArg) {
  console.log(`  Family: ${familyArg}  |  Scenarios: ${allScenarios.length}`);
} else {
  const summary = getPhase2Summary();
  console.log(`  All families  |  Total scenarios: ${allScenarios.length}`);
  console.log('  Distribution:');
  for (const [fam, count] of Object.entries(summary).sort()) {
    const expectedDist = getExpectedDistribution(allScenarios, fam);
    console.log(`    ${fam.padEnd(16)}: ${String(count).padStart(3)}  ${expectedDist}`);
  }
}
console.log('  Concurrency:', concurrency);
console.log('');

// ── Run ───────────────────────────────────────────────────────────────────────

async function runPhase2(): Promise<void> {
  const startTime = Date.now();

  const allPairs: Array<{ scenario: ScenarioV2; result: EvaluationResult; metrics: ScenarioMetrics }> = [];

  // Process scenarios in batches
  for (let i = 0; i < allScenarios.length; i += concurrency) {
    const batch = allScenarios.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (scenario) => {
        const namespace = `p2-${scenario.id}-${Date.now()}`;

        if (verbose) {
          process.stdout.write(`  Running [${scenario.id}] ${scenario.name}...`);
        }

        const result = await runScenarioV2ThroughEngine(scenario, HARNESS_CONFIG, namespace);
        const metrics = scoreV2Result(scenario, result);

        if (verbose) {
          const correct = metrics.actionCorrect ? '✓' : '✗';
          process.stdout.write(` ${correct} (${result.actionAdmissibility}, expected ${scenario.expectedAction})\n`);
        } else {
          // Progress indicator
          const n = i + batch.indexOf(scenario) + 1;
          process.stdout.write(`\r  Progress: ${n}/${allScenarios.length} (${Math.round(n / allScenarios.length * 100)}%)`);
        }

        return { scenario, result, metrics };
      })
    );

    allPairs.push(...batchResults);
  }

  if (!verbose) process.stdout.write('\n');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Completed in ${elapsed}s\n`);

  // ── Aggregate ────────────────────────────────────────────────────────────────
  const aggregates = aggregateV2Metrics('engine-v2', allPairs);

  // ── Report ───────────────────────────────────────────────────────────────────
  printPhase2Report(
    allPairs.map(p => ({ scenario: p.scenario, result: p.result })),
    aggregates,
  );

  // ── Save ─────────────────────────────────────────────────────────────────────
  const runId = familyArg ?? 'all';
  savePhase2Results(runId, allPairs, aggregates);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExpectedDistribution(scenarios: ScenarioV2[], family: string): string {
  const fam = scenarios.filter(s => s.familyId === family);
  const blocked = fam.filter(s => s.expectedAction === 'BLOCKED').length;
  const risky = fam.filter(s => s.expectedAction === 'RISKY').length;
  const valid = fam.filter(s => s.expectedAction === 'VALID').length;
  const branch = fam.filter(s => s.expectedAction === 'BRANCH_DEPENDENT').length;
  return `[B:${blocked} R:${risky} V:${valid} BD:${branch}]`;
}

// ── Entry ─────────────────────────────────────────────────────────────────────

runPhase2().catch(err => {
  console.error('Phase 2 eval failed:', err);
  process.exit(1);
});
