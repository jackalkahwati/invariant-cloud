/**
 * LLM Benchmark Harness
 *
 * Runs the same parallel-vs-serial experiment as V3, but uses real LLMWorkers
 * (Anthropic API calls) instead of SimulatedWorkers. After all workers
 * complete, the fixture-app integration tests are executed via vitest to get
 * a ground-truth test pass rate.
 *
 * Key differences from harness-v3:
 *   - Uses LLMWorkerPool (real Anthropic API calls)
 *   - Runs vitest on fixture-app after each mode completes
 *   - No action_delay_ms (real latency dominates)
 *   - Timeout is much larger (2 minutes per mode)
 *   - fixture-app files are reset between serial and parallel runs
 */

import { randomUUID } from "crypto";
import { execSync, spawnSync } from "child_process";
import { resolve, join, dirname } from "path";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { WorldStateStore } from "../state/store.js";
import { createOptimizedTaskPackets } from "../tasks/schema.js";
import { TaskOrchestrator } from "../orchestrator/orchestrator.js";
import { Integrator } from "../integrator/integrator.js";
import { RepairExecutor } from "../orchestrator/repair-executor.js";
import { LLMWorker, LLMWorkerPool, LLMWorkerConfig, PriorRepairRound } from "../workers/llm-worker.js";
import { BACKOFF_RETRY_POLICY, DEFAULT_RECOVERY_POLICY } from "../workers/recovery.js";
import {
  InstrumentationCollector,
  InstrumentationSummary,
  formatInstrumentationTable,
} from "../instrumentation/timing.js";
import { logger } from "../logger/logger.js";
import { ActionValidator } from "../validation/validator.js";
import {
  BenchmarkMetrics,
  BenchmarkComparison,
  computeMetrics,
  compareMetrics,
  formatMetricsTable,
} from "./metrics.js";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface LLMBenchmarkConfig {
  mode: "serial" | "parallel" | "both";
  parallel_workers: number;
  /** LLM model to use (defaults to claude-haiku-4-5-20251001) */
  model?: string;
  /** Max tokens per LLM call */
  max_tokens?: number;
  /** Anthropic API key (defaults to ANTHROPIC_API_KEY env var) */
  api_key?: string;
  /** Timeout per mode in ms (default: 300_000 = 5 min) */
  timeout_ms: number;
  /** Max repair rounds after integration */
  max_repair_rounds: number;
  /** Target pass rate to stop repair */
  target_pass_rate: number;
  /** After initial vitest run, iteratively repair failing tests with the LLM */
  repair_until_pass: boolean;
  silent: boolean;
}

const DEFAULT_LLM_BENCH_CONFIG: LLMBenchmarkConfig = {
  mode: "both",
  parallel_workers: 4,
  timeout_ms: 300_000,
  max_repair_rounds: 2,
  target_pass_rate: 0.98,
  repair_until_pass: false,
  silent: false,
};

// ─── Extended Metrics ─────────────────────────────────────────────────────────

export interface RepairRound {
  round: number;
  pass_rate_before: number;
  pass_rate_after: number;
  improvement_pp: number;
  wall_clock_ms: number;
  failures_targeted: number;
  files_patched: string[];
}

export interface LLMBenchmarkMetrics extends BenchmarkMetrics {
  actions_recovered: number;
  repair_rounds_executed: number;
  repair_tasks_executed: number;
  pass_rate_before_repair: number;
  pass_rate_after_repair: number;
  pass_rate_restored: boolean;
  /** Ground-truth vitest test results (initial draft, before test-driven repair) */
  vitest_results: VitestResults;
  /** Per-round test-driven repair data (populated when repair_until_pass=true) */
  test_driven_repair_rounds: RepairRound[];
  /** Wall clock from mode start to initial vitest result (excludes repair) */
  wall_clock_to_first_draft_ms: number;
  /** Wall clock from mode start to first fully-passing vitest (undefined if not reached) */
  wall_clock_to_full_pass_ms?: number;
  instrumentation: InstrumentationSummary;
}

export interface VitestResults {
  ran: boolean;
  passed: number;
  failed: number;
  total: number;
  pass_rate: number;
  duration_ms: number;
  output: string;
  error?: string;
}

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface LLMRunResult {
  worker_count: number;
  serial?: LLMBenchmarkMetrics;
  parallel?: LLMBenchmarkMetrics;
  comparison?: BenchmarkComparison;
}

export interface LLMBenchmarkOutput {
  run_id: string;
  version: "llm";
  scenario: string;
  model: string;
  started_at: string;
  completed_at: string;
  config: LLMBenchmarkConfig;
  result: LLMRunResult;
  log_entries: unknown[];
}

// ─── Fixture reset ────────────────────────────────────────────────────────────

const FIXTURE_ROOT = resolve(
  new URL(".", import.meta.url).pathname,
  "../../fixture-app"
);

/** Paths that LLM workers write to — reset between runs */
const LLM_WRITTEN_DIRS = [
  "src/routes",
  "src/auth/extensions",
  "src/audit",
  "src/roles",
  "tests",
];

/** Loose files written by LLM tasks (not inside a dedicated subdir) */
const LLM_WRITTEN_FILES = [
  "src/auth/middleware.ts",
  "src/auth/sso-provider.ts",
  "src/auth/sso-routes.ts",
  "src/auth/token-exchange.ts",
  "src/auth/types.ts",
];

/** Baseline content for files that must exist before LLM runs */
const BASE_FILES: Record<string, string> = {
  "src/app.ts": `/**
 * Fixture App — Express entry point
 *
 * BASE file. Feature tasks DO NOT touch this.
 * integration-wiring mounts feature routes and wires auth here.
 */

import express from "express";
import type { Application } from "express";

export const app: Application = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});
`,
  "src/routes.ts": `// Route aggregator — written by integration-wiring task
`,
  "src/auth/auth.ts": `// Base auth — written by integration-wiring task
`,
};

function resetFixture(): void {
  // Remove LLM-written directories
  for (const dir of LLM_WRITTEN_DIRS) {
    const abs = join(FIXTURE_ROOT, dir);
    if (existsSync(abs)) {
      rmSync(abs, { recursive: true, force: true });
    }
    mkdirSync(abs, { recursive: true });
  }

  // Remove loose LLM-written files
  for (const file of LLM_WRITTEN_FILES) {
    const abs = join(FIXTURE_ROOT, file);
    if (existsSync(abs)) {
      rmSync(abs, { force: true });
    }
  }

  // Restore base files
  for (const [rel, content] of Object.entries(BASE_FILES)) {
    const abs = join(FIXTURE_ROOT, rel);
    mkdirSync(join(FIXTURE_ROOT, rel.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

// ─── Fixture snapshot / restore ───────────────────────────────────────────────

/** Maps relative path (e.g. "src/routes/admin.ts") → file content */
type FixtureSnapshot = Map<string, string>;

/**
 * Walk fixture-app/src and fixture-app/tests and snapshot every .ts file.
 * Used to preserve the best-known-good state across repair rounds.
 */
function snapshotFixtureFiles(root: string): FixtureSnapshot {
  const snapshot: FixtureSnapshot = new Map();

  const walk = (dir: string, rel_prefix: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = `${rel_prefix}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== "node_modules") {
        walk(abs, rel);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        try {
          snapshot.set(rel, readFileSync(abs, "utf8"));
        } catch { /* skip unreadable */ }
      }
    }
  };

  walk(join(root, "src"), "src");
  walk(join(root, "tests"), "tests");
  return snapshot;
}

/**
 * Restore fixture-app files from a snapshot.
 * Files present in the snapshot are overwritten; files NOT in the snapshot are
 * left untouched (they weren't present when the snapshot was taken).
 */
function restoreFixtureSnapshot(snapshot: FixtureSnapshot, root: string): void {
  for (const [rel, content] of snapshot) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

// ─── Real test runner ─────────────────────────────────────────────────────────

function runVitestOnFixture(): VitestResults {
  const start = Date.now();

  // Install deps if needed (fixture-app may not have node_modules yet)
  const nm = join(FIXTURE_ROOT, "node_modules");
  if (!existsSync(nm)) {
    try {
      execSync("npm install", { cwd: FIXTURE_ROOT, stdio: "pipe", timeout: 60_000 });
    } catch {
      // ignore, vitest will fail with a clearer error
    }
  }

  const result = spawnSync(
    "npx",
    ["vitest", "run", "--reporter=verbose"],
    {
      cwd: FIXTURE_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, NODE_ENV: "test" },
    }
  );

  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const duration_ms = Date.now() - start;

  // Parse vitest output — handle both formats:
  //   "Tests  2 failed | 12 passed (14)"
  //   "Tests  7 passed (7)"
  const passMatch = output.match(/(\d+)\s+passed/);
  const failMatch = output.match(/(\d+)\s+failed/);
  // Total is in parentheses: "passed (14)" or at the end
  const totalInParen = output.match(/passed\s+\((\d+)\)/);
  const totalMatch = totalInParen || output.match(/Tests\s+(\d+)/);

  const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
  const total = totalMatch ? parseInt(totalMatch[1], 10) : passed + failed;

  return {
    ran: true,
    passed,
    failed,
    total: total || passed + failed,
    pass_rate: total > 0 ? passed / total : (passed > 0 ? 1.0 : 0.0),
    duration_ms,
    output: output.slice(0, 4000), // truncate for JSON
    error: result.error?.message,
  };
}

/** Pull the structured failure block out of vitest verbose output */
function extractFailingSection(output: string): string {
  // Vitest verbose output ends with "⎯⎯ Failed Tests ⎯⎯" block
  const idx = output.indexOf("Failed Tests");
  if (idx !== -1) return output.slice(idx, idx + 3000);
  // Fallback: grab lines that contain the assertion errors
  return output
    .split("\n")
    .filter((l) =>
      l.includes("×") ||
      l.includes("→ expected") ||
      l.includes("AssertionError") ||
      l.includes("- Expected") ||
      l.includes("+ Received")
    )
    .join("\n")
    .slice(0, 2000);
}

// ─── Harness ──────────────────────────────────────────────────────────────────

export class LLMBenchmarkHarness {
  constructor(private config: Partial<LLMBenchmarkConfig> = {}) {}

  async run(): Promise<LLMBenchmarkOutput> {
    const cfg = { ...DEFAULT_LLM_BENCH_CONFIG, ...this.config };
    const run_id = randomUUID();
    const started_at = new Date().toISOString();

    logger.setSilent(cfg.silent);
    logger.clearEntries();

    logger.benchmarkPhase({ phase: "llm_start", mode: cfg.mode });

    const llm_config: Partial<LLMWorkerConfig> = {
      model: cfg.model ?? "claude-haiku-4-5-20251001",
      max_tokens: cfg.max_tokens ?? 4096,
      api_key: cfg.api_key,
      fixture_root: FIXTURE_ROOT,
    };

    let serial: LLMBenchmarkMetrics | undefined;
    let parallel: LLMBenchmarkMetrics | undefined;

    if (cfg.mode === "serial" || cfg.mode === "both") {
      console.log("\n[LLM Bench] Running SERIAL mode...");
      resetFixture();
      serial = await this.runMode("serial", run_id, cfg, llm_config, 1);
    }

    if (cfg.mode === "parallel" || cfg.mode === "both") {
      console.log(`\n[LLM Bench] Running PARALLEL mode (${cfg.parallel_workers} workers)...`);
      resetFixture();
      parallel = await this.runMode("parallel", run_id, cfg, llm_config, cfg.parallel_workers);
    }

    const comparison = serial && parallel ? compareMetrics(serial, parallel) : undefined;

    logger.setSilent(false);

    const result: LLMRunResult = {
      worker_count: cfg.parallel_workers,
      serial,
      parallel,
      comparison,
    };

    return {
      run_id,
      version: "llm",
      scenario: "Add enterprise SSO, audit logging, and admin role management to a realistic web app (real LLM workers)",
      model: llm_config.model!,
      started_at,
      completed_at: new Date().toISOString(),
      config: cfg,
      result,
      log_entries: logger.getEntries(),
    };
  }

  private async runMode(
    mode: "serial" | "parallel",
    run_id: string,
    cfg: LLMBenchmarkConfig,
    llm_config: Partial<LLMWorkerConfig>,
    worker_count: number
  ): Promise<LLMBenchmarkMetrics> {
    const mode_start_ms = Date.now();
    const instrumentation = new InstrumentationCollector();
    const store = new WorldStateStore();
    const objective_id = `obj-llm-${run_id}-${mode}-w${worker_count}`;
    const tasks = createOptimizedTaskPackets(objective_id);

    // Build LLM worker pool
    const llm_pool = new LLMWorkerPool(
      store,
      new ActionValidator(store),
      worker_count,
      llm_config
    );

    // Feature groups for staged integration (parallel only)
    const feature_groups: Record<string, string[]> = {};
    for (const t of tasks) {
      if (t.feature !== "Integration") {
        if (!feature_groups[t.feature]) feature_groups[t.feature] = [];
        feature_groups[t.feature].push(t.task_id);
      }
    }

    // ── Phase 1: Main execution ───────────────────────────────────────────────
    instrumentation.startPhase("main_execution", { mode, worker_count });

    for (const t of tasks) {
      instrumentation.recordTaskQueued(t.task_id, t.feature);
    }

    const staged_integration_results: Array<{ feature: string; elapsed_ms: number; conflicts: number }> = [];

    const orchestrator = new TaskOrchestrator(store, {
      mode,
      max_workers: worker_count,
      action_delay_ms: 0, // no artificial delay — real latency dominates
      poll_interval_ms: 0,
      timeout_ms: cfg.timeout_ms,
      recovery_policy: mode === "parallel" ? BACKOFF_RETRY_POLICY : DEFAULT_RECOVERY_POLICY,
      worker_pool: llm_pool,
      feature_groups: mode === "parallel" ? feature_groups : undefined,
      on_feature_group_complete:
        mode === "parallel"
          ? (feature, task_ids) => {
              const si_start = Date.now();
              const completed = task_ids
                .map((id) => store.getTask(id))
                .filter((t): t is NonNullable<typeof t> => t?.status === "COMPLETED");
              const integrator = new Integrator(store);
              void integrator.integrate(completed).then((result) => {
                staged_integration_results.push({
                  feature,
                  elapsed_ms: Date.now() - si_start,
                  conflicts: result.conflicts_detected.length,
                });
              });
            }
          : undefined,
    });

    const orch_result = await orchestrator.run(objective_id, tasks);

    for (const wr of orch_result.worker_results) {
      instrumentation.recordTaskStarted(wr.task_id);
    }

    instrumentation.endPhase("main_execution");

    // ── Phase 2: Integration ──────────────────────────────────────────────────
    instrumentation.startPhase("integration");
    const integrator = new Integrator(store);
    let completed_tasks = store.getTasksByStatus("COMPLETED");
    const initial_integration = await integrator.integrate(completed_tasks);
    instrumentation.endPhase("integration");

    const pass_rate_before_repair = store.getTestPassRate();

    // ── Phase 3: Repair loop ──────────────────────────────────────────────────
    instrumentation.startPhase("repair_loop");
    let repair_rounds_executed = 0;
    let repair_tasks_executed = 0;
    let pass_rate_after_repair = pass_rate_before_repair;
    let pass_rate_restored = pass_rate_before_repair >= cfg.target_pass_rate;

    if (initial_integration.repair_tasks_generated.length > 0 && !pass_rate_restored) {
      const repair_executor = new RepairExecutor(store, {
        max_rounds: cfg.max_repair_rounds,
        target_pass_rate: cfg.target_pass_rate,
        worker_config: { action_delay_ms: 0, recovery_policy: BACKOFF_RETRY_POLICY },
      });

      const repair_result = await repair_executor.run(initial_integration.repair_tasks_generated);
      repair_rounds_executed = repair_result.rounds.length;
      repair_tasks_executed = repair_result.total_repair_tasks_executed;
      pass_rate_after_repair = repair_result.final_test_pass_rate;
      pass_rate_restored = repair_result.pass_rate_restored;
    }
    const repair_loop_elapsed = instrumentation.endPhase("repair_loop");

    // ── Phase 4: Real vitest test run ────────────────────────────────────────
    instrumentation.startPhase("vitest");
    console.log(`\n[LLM Bench] Running vitest on fixture-app (${mode} mode)...`);
    const vitest_results = runVitestOnFixture();
    instrumentation.endPhase("vitest");

    console.log(`[LLM Bench] Vitest: ${vitest_results.passed}/${vitest_results.total} passed (${(vitest_results.pass_rate * 100).toFixed(0)}%) in ${vitest_results.duration_ms}ms`);

    // ── Phase 5: Test-driven repair loop ─────────────────────────────────────
    const wall_clock_to_first_draft_ms = Date.now() - mode_start_ms;
    const test_driven_repair_rounds: RepairRound[] = [];
    let current_vitest = vitest_results;
    let wall_clock_to_full_pass_ms: number | undefined;

    if (current_vitest.pass_rate === 1.0) {
      wall_clock_to_full_pass_ms = wall_clock_to_first_draft_ms;
    } else if (cfg.repair_until_pass && current_vitest.failed > 0) {
      const repair_worker = new LLMWorker(
        new WorldStateStore(),
        new ActionValidator(new WorldStateStore()),
        llm_config
      );
      let prev_pass_rate = current_vitest.pass_rate;

      // Best-state tracking: snapshot the filesystem at the highest pass rate seen.
      // If a later repair round regresses, we roll back to this snapshot.
      let best_pass_rate = current_vitest.pass_rate;
      let best_vitest = current_vitest;
      let best_snapshot = snapshotFixtureFiles(FIXTURE_ROOT);

      // Accumulated repair history passed to each subsequent round so Claude
      // knows what was already fixed and must not accidentally undo.
      const prior_repairs: PriorRepairRound[] = [];

      for (let round = 1; round <= cfg.max_repair_rounds; round++) {
        if (current_vitest.failed === 0) break;

        const round_start = Date.now();
        const failing_section = extractFailingSection(current_vitest.output);

        console.log(
          `\n[LLM Bench] Repair round ${round}/${cfg.max_repair_rounds} — targeting ${current_vitest.failed} failing test(s)...`
        );
        const { files_patched } = await repair_worker.repair(failing_section, round, prior_repairs);

        console.log(`[LLM Bench] Re-running vitest after repair round ${round}...`);
        const new_vitest = runVitestOnFixture();
        const improvement_pp = (new_vitest.pass_rate - prev_pass_rate) * 100;
        const round_ms = Date.now() - round_start;

        test_driven_repair_rounds.push({
          round,
          pass_rate_before: prev_pass_rate,
          pass_rate_after: new_vitest.pass_rate,
          improvement_pp,
          wall_clock_ms: round_ms,
          failures_targeted: current_vitest.failed,
          files_patched,
        });

        const arrow = improvement_pp >= 0 ? "+" : "";
        console.log(
          `[LLM Bench] Round ${round}: ${(prev_pass_rate * 100).toFixed(0)}% → ` +
          `${(new_vitest.pass_rate * 100).toFixed(0)}% (${arrow}${improvement_pp.toFixed(1)}pp) ` +
          `in ${round_ms}ms`
        );

        if (new_vitest.pass_rate === 1.0) {
          wall_clock_to_full_pass_ms = Date.now() - mode_start_ms;
          console.log(`[LLM Bench] ✓ Full pass achieved after round ${round}!`);
          current_vitest = new_vitest;
          break;
        }

        // Regression guard: if this round dropped below the best pass rate we've
        // seen, restore the best-known filesystem state and stop repairing.
        if (new_vitest.pass_rate < best_pass_rate) {
          console.log(
            `[LLM Bench] Regression detected: ${(new_vitest.pass_rate * 100).toFixed(0)}% < ` +
            `best ${(best_pass_rate * 100).toFixed(0)}%. ` +
            `Restoring best-known state and stopping.`
          );
          restoreFixtureSnapshot(best_snapshot, FIXTURE_ROOT);
          current_vitest = best_vitest; // report final result at the best state
          break;
        }

        // Update best state whenever pass rate improves
        if (new_vitest.pass_rate > best_pass_rate) {
          best_pass_rate = new_vitest.pass_rate;
          best_vitest = new_vitest;
          best_snapshot = snapshotFixtureFiles(FIXTURE_ROOT);
          console.log(`[LLM Bench] New best: ${(best_pass_rate * 100).toFixed(0)}% — snapshot saved.`);
        }

        // Carry this round's repair forward so the next round won't undo it
        prior_repairs.push({
          round,
          files_patched,
          failing_output_targeted: failing_section,
        });

        if (improvement_pp <= 0 && round > 1) {
          console.log(`[LLM Bench] No improvement (${arrow}${improvement_pp.toFixed(1)}pp), stopping repair.`);
          current_vitest = new_vitest;
          break;
        }

        prev_pass_rate = new_vitest.pass_rate;
        current_vitest = new_vitest;
      }
    }

    // ── Phase 7: Final integration snapshot ──────────────────────────────────
    completed_tasks = store.getTasksByStatus("COMPLETED");
    const final_integration = await integrator.integrate(completed_tasks);
    const snapshot = store.snapshot();

    // ── Build instrumentation summary ─────────────────────────────────────────
    const total_blocked = orch_result.worker_results.reduce((s, r) => s + r.actions_blocked, 0);
    const actions_recovered = orch_result.worker_results.reduce((s, r) => s + (r.actions_recovered ?? 0), 0);

    const instr_summary = instrumentation.buildSummary({
      worker_results: orch_result.worker_results.map((r) => ({
        worker_id: r.worker_id,
        elapsed_ms: r.elapsed_ms,
        actions_attempted: r.actions_attempted,
        actions_blocked: r.actions_blocked,
        actions_recovered: r.actions_recovered ?? 0,
      })),
      parallel_wall_clock_ms: orch_result.elapsed_ms,
      total_blocked_actions: total_blocked,
      actions_recovered,
      repair_rounds: repair_rounds_executed,
      repair_tasks_executed,
      repair_loop_ms: repair_loop_elapsed,
    });

    // Override test pass rate with ground-truth vitest result
    const base = computeMetrics(
      run_id,
      mode,
      orch_result,
      final_integration,
      snapshot,
      mode === "parallel" ? worker_count : undefined
    );

    return {
      ...base,
      // Use final vitest pass rate (post-repair if repair ran, else initial)
      final_test_pass_rate: current_vitest.pass_rate,
      actions_recovered,
      repair_rounds_executed,
      repair_tasks_executed,
      pass_rate_before_repair,
      pass_rate_after_repair: current_vitest.pass_rate,
      pass_rate_restored: current_vitest.pass_rate >= cfg.target_pass_rate,
      vitest_results,                    // initial draft results
      test_driven_repair_rounds,
      wall_clock_to_first_draft_ms,
      wall_clock_to_full_pass_ms,
      instrumentation: instr_summary,
    };
  }
}

// ─── Repair Rounds Table ──────────────────────────────────────────────────────

function formatRepairRoundsTable(
  rounds: RepairRound[],
  draft: VitestResults,
  full_pass_ms?: number
): string {
  const lines: string[] = [
    "  TEST-DRIVEN REPAIR ROUNDS",
    `  ${"─".repeat(61)}`,
    `  ${"Round".padEnd(7)} ${"Before".padEnd(8)} ${"After".padEnd(8)} ${"Δ".padEnd(9)} ${"Files".padEnd(7)} Time`,
    `  ${"─".repeat(61)}`,
    `  ${"0 (draft)".padEnd(7)} ${"—".padEnd(8)} ${(draft.pass_rate * 100).toFixed(0).padEnd(6)}%  ${"—".padEnd(9)} ${"—".padEnd(7)} —`,
  ];

  for (const r of rounds) {
    const before = `${(r.pass_rate_before * 100).toFixed(0)}%`;
    const after = `${(r.pass_rate_after * 100).toFixed(0)}%`;
    const delta = `${r.improvement_pp >= 0 ? "+" : ""}${r.improvement_pp.toFixed(1)}pp`;
    lines.push(
      `  ${String(r.round).padEnd(7)} ${before.padEnd(8)} ${after.padEnd(8)} ${delta.padEnd(9)} ${String(r.files_patched.length).padEnd(7)} ${r.wall_clock_ms}ms`
    );
  }

  lines.push(`  ${"─".repeat(61)}`);

  const last = rounds[rounds.length - 1];
  const final_rate = last ? last.pass_rate_after : draft.pass_rate;
  const total_repair_ms = rounds.reduce((s, r) => s + r.wall_clock_ms, 0);
  lines.push(`  Final: ${(final_rate * 100).toFixed(0)}%  |  ${rounds.length} repair round(s)  |  +${total_repair_ms}ms repair time`);
  if (full_pass_ms !== undefined) {
    lines.push(`  ✓ Full pass in ${full_pass_ms}ms total wall clock`);
  }

  return lines.join("\n");
}

// ─── Formatter ────────────────────────────────────────────────────────────────

export function formatLLMReport(output: LLMBenchmarkOutput): string {
  const lines: string[] = [
    "═".repeat(65),
    "  LLM BENCHMARK — REAL ANTHROPIC API WORKERS",
    "═".repeat(65),
    `  Run ID:   ${output.run_id}`,
    `  Model:    ${output.model}`,
    `  Started:  ${output.started_at}`,
    `  Finished: ${output.completed_at}`,
    `  Scenario: ${output.scenario}`,
    "",
  ];

  const { serial, parallel, comparison } = output.result;

  if (serial) {
    lines.push("─".repeat(65));
    lines.push("  SERIAL MODE");
    lines.push("─".repeat(65));
    lines.push(formatMetricsTable(serial));
    lines.push(`  LLM wall clock:        ${serial.wall_clock_ms}ms`);
    lines.push(`  Draft vitest:          ${(serial.vitest_results.pass_rate * 100).toFixed(0)}% (${serial.vitest_results.passed}/${serial.vitest_results.total}) in ${serial.wall_clock_to_first_draft_ms}ms`);
    if (serial.test_driven_repair_rounds.length > 0) {
      lines.push("");
      lines.push(formatRepairRoundsTable(serial.test_driven_repair_rounds, serial.vitest_results, serial.wall_clock_to_full_pass_ms));
    }
    lines.push("");
    lines.push(formatInstrumentationTable(serial.instrumentation));
    lines.push("");
  }

  if (parallel) {
    lines.push("─".repeat(65));
    lines.push(`  PARALLEL MODE (${output.result.worker_count} workers)`);
    lines.push("─".repeat(65));
    lines.push(formatMetricsTable(parallel));
    lines.push(`  LLM wall clock:        ${parallel.wall_clock_ms}ms`);
    lines.push(`  Draft vitest:          ${(parallel.vitest_results.pass_rate * 100).toFixed(0)}% (${parallel.vitest_results.passed}/${parallel.vitest_results.total}) in ${parallel.wall_clock_to_first_draft_ms}ms`);
    if (parallel.test_driven_repair_rounds.length > 0) {
      lines.push("");
      lines.push(formatRepairRoundsTable(parallel.test_driven_repair_rounds, parallel.vitest_results, parallel.wall_clock_to_full_pass_ms));
    }
    lines.push("");
    lines.push(formatInstrumentationTable(parallel.instrumentation));
    lines.push("");
  }

  if (comparison) {
    lines.push("─".repeat(65));
    lines.push("  COMPARISON");
    lines.push("─".repeat(65));
    lines.push(`  Speedup factor:        ${comparison.speedup_factor.toFixed(2)}x`);
    lines.push(`  Quality delta:         ${comparison.quality_delta >= 0 ? "+" : ""}${(comparison.quality_delta * 100).toFixed(1)}%`);
    lines.push(`  Thesis supported:      ${comparison.thesis_supported ? "✓ YES" : "✗ NO"}`);
    lines.push("");
    lines.push("  Analysis:");
    for (const a of comparison.analysis) {
      lines.push(`    ${a}`);
    }
    lines.push("");
  }

  lines.push("═".repeat(65));
  return lines.join("\n");
}
