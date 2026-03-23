/**
 * Benchmark Harness V3 — Speed Optimization Pass
 *
 * Implements and measures three targeted optimizations over V2:
 *
 *   A. Feature-local files (eliminates hot-file contention)
 *      Tasks write to per-feature route/auth fragments.
 *      Integration-wiring aggregates fragments into the shared files.
 *      → Blocked actions drop to 0, repair loop overhead eliminated.
 *
 *   B. Orchestrator poll sleep removed (reduces scheduling latency)
 *      The unconditional sleep(poll_interval_ms) in the parallel loop is removed.
 *      Promise.race() already yields; the extra sleep added ~10ms per task completion.
 *      → Saves ~100ms for a 10-task run.
 *
 *   C. Staged incremental integration (moves integration off critical path)
 *      When all tasks in a feature group complete, a background integration pass
 *      runs concurrently with remaining task execution.
 *      → Final integration barrier is lighter; pre-validation happens in parallel.
 *
 * Also includes:
 *   - Deep instrumentation via InstrumentationCollector
 *   - Worker count sweep (2, 4, 8, 12 workers)
 *   - Bottleneck ranking derived from measured data
 */

import { randomUUID } from "crypto";
import { WorldStateStore } from "../state/store.js";
import {
  createBenchmarkTaskPackets,
  createOptimizedTaskPackets,
  TaskPacket,
} from "../tasks/schema.js";
import { TaskOrchestrator } from "../orchestrator/orchestrator.js";
import { Integrator } from "../integrator/integrator.js";
import { RepairExecutor } from "../orchestrator/repair-executor.js";
import { BACKOFF_RETRY_POLICY, DEFAULT_RECOVERY_POLICY } from "../workers/recovery.js";
import {
  InstrumentationCollector,
  InstrumentationSummary,
  formatInstrumentationTable,
} from "../instrumentation/timing.js";
import { logger } from "../logger/logger.js";
import {
  BenchmarkMetrics,
  BenchmarkComparison,
  computeMetrics,
  compareMetrics,
  formatMetricsTable,
} from "./metrics.js";

// ─── V3 Config ────────────────────────────────────────────────────────────────

export interface BenchmarkV3Config {
  action_delay_ms: number;
  parallel_workers: number;
  mode: "serial" | "parallel" | "both";
  silent: boolean;
  max_repair_rounds: number;
  target_pass_rate: number;
  /** "original" = V1/V2 fixture; "optimized" = feature-local fixture (V3) */
  fixture: "original" | "optimized";
  /** Worker count sweep: if set, overrides parallel_workers */
  worker_sweep?: number[];
}

const DEFAULT_V3_CONFIG: BenchmarkV3Config = {
  action_delay_ms: 15,
  parallel_workers: 4,
  mode: "both",
  silent: false,
  max_repair_rounds: 3,
  target_pass_rate: 0.98,
  fixture: "optimized",
};

// ─── V3 Extended Metrics ──────────────────────────────────────────────────────

export interface V3BenchmarkMetrics extends BenchmarkMetrics {
  // Recovery (inherited from V2 pattern)
  actions_recovered: number;
  // Repair loop
  repair_rounds_executed: number;
  repair_tasks_executed: number;
  pass_rate_before_repair: number;
  pass_rate_after_repair: number;
  pass_rate_restored: boolean;
  // V3 Instrumentation
  instrumentation: InstrumentationSummary;
}

// ─── Single-Run Output ────────────────────────────────────────────────────────

export interface V3RunResult {
  worker_count: number;
  serial: V3BenchmarkMetrics;
  parallel: V3BenchmarkMetrics;
  comparison: BenchmarkComparison;
}

// ─── Full Benchmark Output ────────────────────────────────────────────────────

export interface BenchmarkV3Output {
  run_id: string;
  version: "v3";
  scenario: string;
  fixture: "original" | "optimized";
  started_at: string;
  completed_at: string;
  config: BenchmarkV3Config;
  /** Primary run at configured worker count */
  primary: V3RunResult;
  /** Worker sweep results (if configured) */
  sweep?: V3SweepResult[];
  log_entries: unknown[];
}

export interface V3SweepResult {
  worker_count: number;
  speedup_factor: number;
  parallel_wall_clock_ms: number;
  serial_wall_clock_ms: number;
  pass_rate_after_repair: number;
  actions_blocked: number;
  repair_tasks: number;
  worker_utilization_pct: string;
}

// ─── Harness V3 ───────────────────────────────────────────────────────────────

export class BenchmarkHarnessV3 {
  constructor(private config: Partial<BenchmarkV3Config> = {}) {}

  async run(): Promise<BenchmarkV3Output> {
    const cfg = { ...DEFAULT_V3_CONFIG, ...this.config };
    const run_id = randomUUID();
    const started_at = new Date().toISOString();

    logger.setSilent(cfg.silent);
    logger.clearEntries();

    logger.benchmarkPhase({ phase: "v3_start", mode: cfg.mode, fixture: cfg.fixture });

    // ── Primary run ──────────────────────────────────────────────────────────
    const serial = await this.runMode("serial", run_id, cfg, cfg.parallel_workers);
    const parallel = await this.runMode("parallel", run_id, cfg, cfg.parallel_workers);
    const comparison = compareMetrics(serial, parallel);

    const primary: V3RunResult = { worker_count: cfg.parallel_workers, serial, parallel, comparison };

    // ── Worker sweep ─────────────────────────────────────────────────────────
    let sweep: V3SweepResult[] | undefined;
    if (cfg.worker_sweep && cfg.worker_sweep.length > 0) {
      sweep = [];
      // Use a cached serial baseline (don't re-run serial for each worker count)
      for (const wc of cfg.worker_sweep) {
        const par = await this.runMode("parallel", run_id, cfg, wc);
        const speedup = serial.wall_clock_ms > 0 ? serial.wall_clock_ms / par.wall_clock_ms : 1;
        sweep.push({
          worker_count: wc,
          speedup_factor: Math.round(speedup * 100) / 100,
          parallel_wall_clock_ms: par.wall_clock_ms,
          serial_wall_clock_ms: serial.wall_clock_ms,
          pass_rate_after_repair: par.pass_rate_after_repair,
          actions_blocked: par.invalid_actions_blocked,
          repair_tasks: par.repair_tasks_executed,
          worker_utilization_pct: par.instrumentation.worker_utilization_pct,
        });
      }
    }

    logger.setSilent(false);

    return {
      run_id,
      version: "v3",
      scenario: "Add enterprise SSO, audit logging, and admin role management to a realistic web app",
      fixture: cfg.fixture,
      started_at,
      completed_at: new Date().toISOString(),
      config: cfg,
      primary,
      sweep,
      log_entries: logger.getEntries(),
    };
  }

  private async runMode(
    mode: "serial" | "parallel",
    run_id: string,
    cfg: BenchmarkV3Config,
    worker_count: number
  ): Promise<V3BenchmarkMetrics> {
    const instrumentation = new InstrumentationCollector();
    const store = new WorldStateStore();
    const objective_id = `obj-v3-${run_id}-${mode}-w${worker_count}`;

    // Select fixture
    const tasks =
      cfg.fixture === "optimized"
        ? createOptimizedTaskPackets(objective_id)
        : createBenchmarkTaskPackets(objective_id);

    // Build feature groups for staged integration
    const feature_groups = buildFeatureGroups(tasks);

    // Staged integration state
    const staged_integration_results: Array<{
      feature: string;
      elapsed_ms: number;
      conflicts: number;
    }> = [];

    // ── Phase 1: Main execution ───────────────────────────────────────────────
    instrumentation.startPhase("main_execution", { mode, worker_count, fixture: cfg.fixture });

    for (const t of tasks) {
      instrumentation.recordTaskQueued(t.task_id, t.feature);
    }

    const orchestrator = new TaskOrchestrator(store, {
      mode,
      max_workers: mode === "parallel" ? worker_count : 1,
      action_delay_ms: cfg.action_delay_ms,
      poll_interval_ms: 0,  // V3: poll sleep removed from hot path
      timeout_ms: 60_000,
      // Parallel mode: use backoff retry for any residual conflicts
      // Serial mode: no recovery needed (no contention)
      recovery_policy: mode === "parallel" ? BACKOFF_RETRY_POLICY : DEFAULT_RECOVERY_POLICY,

      // V3: staged integration — fire when a feature group completes
      feature_groups: mode === "parallel" ? feature_groups : undefined,
      on_feature_group_complete:
        mode === "parallel"
          ? (feature, task_ids) => {
              const si_start = Date.now();
              const completed = task_ids
                .map((id) => store.getTask(id))
                .filter((t): t is NonNullable<typeof t> => t?.status === "COMPLETED");
              const integrator = new Integrator(store);
              // Fire-and-forget: run in background, don't await
              void integrator.integrate(completed).then((result) => {
                staged_integration_results.push({
                  feature,
                  elapsed_ms: Date.now() - si_start,
                  conflicts: result.conflicts_detected.length,
                });
                logger.orchestratorEvent({
                  event: "staged_integration_complete",
                  details: {
                    feature,
                    elapsed_ms: Date.now() - si_start,
                    conflicts: result.conflicts_detected.length,
                    repair_tasks: result.repair_tasks_generated.length,
                  },
                });
              });
            }
          : undefined,
    });

    const orch_result = await orchestrator.run(objective_id, tasks);

    // Record task start times for queue wait calculation
    for (const wr of orch_result.worker_results) {
      instrumentation.recordTaskStarted(wr.task_id);
    }

    instrumentation.endPhase("main_execution");

    // ── Phase 2: Initial integration ─────────────────────────────────────────
    instrumentation.startPhase("integration");
    const integrator = new Integrator(store);
    let completed_tasks = store.getTasksByStatus("COMPLETED");
    const initial_integration = await integrator.integrate(completed_tasks);
    const integration_elapsed = instrumentation.endPhase("integration");

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
        worker_config: {
          action_delay_ms: cfg.action_delay_ms,
          recovery_policy: BACKOFF_RETRY_POLICY,
        },
      });

      const repair_result = await repair_executor.run(
        initial_integration.repair_tasks_generated
      );

      repair_rounds_executed = repair_result.rounds.length;
      repair_tasks_executed = repair_result.total_repair_tasks_executed;
      pass_rate_after_repair = repair_result.final_test_pass_rate;
      pass_rate_restored = repair_result.pass_rate_restored;
    }
    const repair_loop_elapsed = instrumentation.endPhase("repair_loop");

    // ── Phase 4: Final integration snapshot ──────────────────────────────────
    completed_tasks = store.getTasksByStatus("COMPLETED");
    const final_integration = await integrator.integrate(completed_tasks);
    const snapshot = store.snapshot();

    // ── Build instrumentation summary ─────────────────────────────────────────
    const total_blocked = orch_result.worker_results.reduce(
      (s, r) => s + r.actions_blocked,
      0
    );
    const actions_recovered = orch_result.worker_results.reduce(
      (s, r) => s + (r.actions_recovered ?? 0),
      0
    );

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

    // ── Compute base metrics ──────────────────────────────────────────────────
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
      final_test_pass_rate: pass_rate_after_repair,
      actions_recovered,
      repair_rounds_executed,
      repair_tasks_executed,
      pass_rate_before_repair,
      pass_rate_after_repair,
      pass_rate_restored,
      instrumentation: instr_summary,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFeatureGroups(tasks: TaskPacket[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const t of tasks) {
    if (!groups[t.feature]) groups[t.feature] = [];
    groups[t.feature].push(t.task_id);
  }
  // Only include "real" feature groups (not Integration — that's the final task)
  delete groups["Integration"];
  return groups;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatV3Report(output: BenchmarkV3Output): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════",
    "  PARALLEL CODING RUNTIME — BENCHMARK V3 (OPTIMIZED)",
    "═══════════════════════════════════════════════════════",
    `  Run ID:    ${output.run_id}`,
    `  Scenario:  ${output.scenario}`,
    `  Fixture:   ${output.fixture === "optimized" ? "V3 (feature-local files)" : "Original (shared routes.ts/auth.ts)"}`,
    `  Started:   ${output.started_at}`,
    `  Completed: ${output.completed_at}`,
    "═══════════════════════════════════════════════════════",
  ];

  const addMode = (label: string, m: V3BenchmarkMetrics) => {
    lines.push("", `── ${label} ─`.padEnd(55, "─"), "");
    lines.push(...formatMetricsTable(m).split("\n").map((l) => `  ${l}`));
    lines.push("");
    lines.push(`  Actions recovered:      ${m.actions_recovered}`);
    lines.push(`  Repair rounds:          ${m.repair_rounds_executed}`);
    lines.push(`  Repair tasks executed:  ${m.repair_tasks_executed}`);
    lines.push(`  Pass rate before repair:${(m.pass_rate_before_repair * 100).toFixed(1)}%`);
    lines.push(`  Pass rate after repair: ${(m.pass_rate_after_repair * 100).toFixed(1)}%`);
    lines.push(`  Pass rate ≥98% restored:${m.pass_rate_restored ? "YES ✓" : "NO"}`);
    lines.push("");
    lines.push(...formatInstrumentationTable(m.instrumentation).split("\n").map((l) => `  ${l}`));
  };

  addMode("SERIAL EXECUTION (V3)", output.primary.serial);
  addMode("PARALLEL EXECUTION (V3)", output.primary.parallel);

  const c = output.primary.comparison;
  lines.push("", "── COMPARISON & ANALYSIS ─────────────────────────────", "");
  lines.push(`  Speedup factor:  ${c.speedup_factor.toFixed(2)}x`);
  lines.push(`  Quality delta:   ${c.quality_delta >= 0 ? "+" : ""}${(c.quality_delta * 100).toFixed(1)}%`);
  lines.push("");
  for (const a of c.analysis) lines.push(`  ${a}`);

  if (output.sweep && output.sweep.length > 0) {
    lines.push("", "── WORKER COUNT SWEEP ────────────────────────────────", "");
    lines.push(
      `  ${"Workers".padEnd(10)} ${"Speedup".padEnd(12)} ${"Parallel ms".padEnd(14)} ${"Pass Rate".padEnd(12)} ${"Blocked".padEnd(10)} ${"Utilization"}`
    );
    lines.push("  " + "─".repeat(72));
    for (const r of output.sweep) {
      lines.push(
        `  ${String(r.worker_count).padEnd(10)} ${(r.speedup_factor.toFixed(2) + "x").padEnd(12)} ${String(r.parallel_wall_clock_ms + "ms").padEnd(14)} ${((r.pass_rate_after_repair * 100).toFixed(1) + "%").padEnd(12)} ${String(r.actions_blocked).padEnd(10)} ${r.worker_utilization_pct}`
      );
    }
  }

  lines.push("", "═══════════════════════════════════════════════════════");
  return lines.join("\n");
}

export function formatV3CompactSweep(output: BenchmarkV3Output): string {
  if (!output.sweep) return "";
  const serial_ms = output.primary.serial.wall_clock_ms;
  const lines = [
    `\nWorker Sweep (serial baseline: ${serial_ms}ms, fixture: ${output.fixture})`,
    "Workers  │  Speedup  │  Wall ms  │  Pass%  │  Blocked  │  Util%",
    "─────────┼───────────┼───────────┼─────────┼───────────┼────────",
  ];
  for (const r of output.sweep) {
    lines.push(
      `${String(r.worker_count).padStart(7)}  │  ${(r.speedup_factor.toFixed(2) + "x").padEnd(7)}  │  ${String(r.parallel_wall_clock_ms + "ms").padEnd(7)}  │  ${(r.pass_rate_after_repair * 100).toFixed(1).padEnd(5)}  │  ${String(r.actions_blocked).padEnd(9)}  │  ${r.worker_utilization_pct}`
    );
  }
  return lines.join("\n");
}
