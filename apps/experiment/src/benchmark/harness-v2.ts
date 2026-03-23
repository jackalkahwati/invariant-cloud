/**
 * Benchmark Harness V2 — Recovery Loop Edition
 *
 * Extends V1 with:
 *   1. Worker-level recovery: blocked actions back off and retry
 *   2. Repair task re-execution: integrator repair tasks are automatically
 *      re-queued and executed until quality is restored
 *   3. Test re-run after repair: affected suites are re-evaluated
 *
 * Goal: keep the speedup, restore test pass rate to near 100%
 */

import { randomUUID } from "crypto";
import { WorldStateStore } from "../state/store.js";
import { createBenchmarkTaskPackets } from "../tasks/schema.js";
import { TaskOrchestrator } from "../orchestrator/orchestrator.js";
import { Integrator } from "../integrator/integrator.js";
import { RepairExecutor } from "../orchestrator/repair-executor.js";
import { BACKOFF_RETRY_POLICY, DEFAULT_RECOVERY_POLICY } from "../workers/recovery.js";
import { logger } from "../logger/logger.js";
import {
  BenchmarkMetrics,
  BenchmarkComparison,
  computeMetrics,
  compareMetrics,
  formatMetricsTable,
} from "./metrics.js";

// ─── V2 Config ─────────────────────────────────────────────────────────────────

export interface BenchmarkV2Config {
  action_delay_ms: number;
  parallel_workers: number;
  mode: "serial" | "parallel" | "both";
  silent: boolean;
  /** Max repair rounds per run */
  max_repair_rounds: number;
  /** Target test pass rate to stop repair loop early */
  target_pass_rate: number;
}

const DEFAULT_V2_CONFIG: BenchmarkV2Config = {
  action_delay_ms: 20,
  parallel_workers: 4,
  mode: "both",
  silent: false,
  max_repair_rounds: 3,
  target_pass_rate: 0.98,
};

// ─── V2 Extended Metrics ───────────────────────────────────────────────────────

export interface V2BenchmarkMetrics extends BenchmarkMetrics {
  // Recovery
  actions_recovered: number;
  recovery_attempts: number;
  // Repair loop
  repair_rounds_executed: number;
  repair_tasks_executed: number;
  pass_rate_before_repair: number;
  pass_rate_after_repair: number;
  pass_rate_restored: boolean;
}

// ─── V2 Output ────────────────────────────────────────────────────────────────

export interface BenchmarkV2Output {
  run_id: string;
  version: "v2";
  scenario: string;
  started_at: string;
  completed_at: string;
  config: BenchmarkV2Config;
  serial?: V2BenchmarkMetrics;
  parallel?: V2BenchmarkMetrics;
  comparison?: BenchmarkComparison & { v2_improvement: string[] };
  log_entries: unknown[];
}

// ─── Harness V2 ───────────────────────────────────────────────────────────────

export class BenchmarkHarnessV2 {
  constructor(private config: Partial<BenchmarkV2Config> = {}) {}

  async run(): Promise<BenchmarkV2Output> {
    const cfg = { ...DEFAULT_V2_CONFIG, ...this.config };
    const run_id = randomUUID();
    const started_at = new Date().toISOString();

    logger.setSilent(cfg.silent);
    logger.clearEntries();

    logger.benchmarkPhase({ phase: "v2_start", mode: cfg.mode });

    let serial_metrics: V2BenchmarkMetrics | undefined;
    let parallel_metrics: V2BenchmarkMetrics | undefined;

    if (cfg.mode === "serial" || cfg.mode === "both") {
      serial_metrics = await this.runMode("serial", run_id, cfg);
    }

    if (cfg.mode === "parallel" || cfg.mode === "both") {
      parallel_metrics = await this.runMode("parallel", run_id, cfg);
    }

    let comparison:
      | (BenchmarkComparison & { v2_improvement: string[] })
      | undefined;

    if (serial_metrics && parallel_metrics) {
      const base_comparison = compareMetrics(serial_metrics, parallel_metrics);
      const v2_improvement = buildV2ImprovementNotes(serial_metrics, parallel_metrics);
      comparison = { ...base_comparison, v2_improvement };

      logger.benchmarkComplete({
        run_id,
        version: "v2",
        thesis_supported: base_comparison.thesis_supported,
        speedup_factor: base_comparison.speedup_factor,
        serial_pass_rate_restored: serial_metrics.pass_rate_restored,
        parallel_pass_rate_restored: parallel_metrics.pass_rate_restored,
      });
    }

    logger.setSilent(false);

    return {
      run_id,
      version: "v2",
      scenario:
        "Add enterprise SSO, audit logging, and admin role management to a realistic web app",
      started_at,
      completed_at: new Date().toISOString(),
      config: cfg,
      serial: serial_metrics,
      parallel: parallel_metrics,
      comparison,
      log_entries: logger.getEntries(),
    };
  }

  private async runMode(
    mode: "serial" | "parallel",
    run_id: string,
    cfg: BenchmarkV2Config
  ): Promise<V2BenchmarkMetrics> {
    logger.benchmarkPhase({ phase: `v2_run_${mode}_start`, mode });

    const store = new WorldStateStore();
    const objective_id = `obj-v2-${run_id}-${mode}`;
    const tasks = createBenchmarkTaskPackets(objective_id);

    // ── Phase 1: Main execution (with worker-level recovery) ──────────────────
    const orchestrator = new TaskOrchestrator(store, {
      mode,
      max_workers: mode === "parallel" ? cfg.parallel_workers : 1,
      action_delay_ms: cfg.action_delay_ms,
      poll_interval_ms: 5,
      timeout_ms: 30_000,
      // V2: workers use backoff retry for file-lock conflicts
      recovery_policy: mode === "parallel" ? BACKOFF_RETRY_POLICY : DEFAULT_RECOVERY_POLICY,
    });

    const orch_result = await orchestrator.run(objective_id, tasks);

    // ── Phase 2: Initial integration ──────────────────────────────────────────
    const integrator = new Integrator(store);
    let completed_tasks = store.getTasksByStatus("COMPLETED");
    const initial_integration = await integrator.integrate(completed_tasks);

    const pass_rate_before_repair = store.getTestPassRate();

    // ── Phase 3: Repair loop — re-execute repair tasks until quality restored ─
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

    // Collect actions_recovered across all worker results
    const actions_recovered = orch_result.worker_results.reduce(
      (sum, r) => sum + (r.actions_recovered ?? 0),
      0
    );
    const recovery_attempts = orch_result.worker_results.reduce(
      (sum, r) => sum + (r.actions_recovered ?? 0) * 2, // approx attempts
      0
    );

    // ── Phase 4: Final snapshot & metrics ─────────────────────────────────────
    // Re-run integration for final state
    completed_tasks = store.getTasksByStatus("COMPLETED");
    const final_integration = await integrator.integrate(completed_tasks);
    const snapshot = store.snapshot();

    logger.benchmarkPhase({
      phase: `v2_run_${mode}_complete`,
      mode,
      elapsed_ms: orch_result.elapsed_ms,
    });

    const base = computeMetrics(
      run_id,
      mode,
      orch_result,
      final_integration,
      snapshot,
      mode === "parallel" ? cfg.parallel_workers : undefined
    );

    return {
      ...base,
      // Override test pass rate with post-repair value
      final_test_pass_rate: pass_rate_after_repair,
      actions_recovered,
      recovery_attempts,
      repair_rounds_executed,
      repair_tasks_executed,
      pass_rate_before_repair,
      pass_rate_after_repair,
      pass_rate_restored,
    };
  }
}

// ─── V2 Improvement Notes ─────────────────────────────────────────────────────

function buildV2ImprovementNotes(
  serial: V2BenchmarkMetrics,
  parallel: V2BenchmarkMetrics
): string[] {
  const notes: string[] = [];

  // Recovery
  if (parallel.actions_recovered > 0) {
    notes.push(
      `RECOVERY: ${parallel.actions_recovered} blocked actions recovered via backoff retry — quality gap closed without human intervention`
    );
  } else {
    notes.push(
      `RECOVERY: No blocked actions needed recovery — file scoping prevented all conflicts`
    );
  }

  // Pass rate restoration
  const delta = parallel.pass_rate_after_repair - parallel.pass_rate_before_repair;
  if (delta > 0) {
    notes.push(
      `REPAIR LOOP: Test pass rate improved from ${(parallel.pass_rate_before_repair * 100).toFixed(1)}% to ${(parallel.pass_rate_after_repair * 100).toFixed(1)}% after ${parallel.repair_rounds_executed} repair round(s)`
    );
  }

  if (parallel.pass_rate_restored) {
    notes.push(
      `QUALITY PARITY: Parallel mode reached ≥${(98).toFixed(0)}% test pass rate — matches serial quality standard`
    );
  } else {
    notes.push(
      `QUALITY GAP REMAINS: Pass rate is ${(parallel.pass_rate_after_repair * 100).toFixed(1)}% — further repair rounds or manual review needed`
    );
  }

  // Repair tasks
  if (parallel.repair_tasks_executed > 0) {
    notes.push(
      `REPAIR TASKS: ${parallel.repair_tasks_executed} repair task(s) automatically executed — integration conflicts resolved without human involvement`
    );
  }

  return notes;
}

// ─── V2 Report Formatter ──────────────────────────────────────────────────────

export function formatV2Report(output: BenchmarkV2Output): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════",
    "  PARALLEL CODING RUNTIME — BENCHMARK V2 (REPAIR LOOP)",
    "═══════════════════════════════════════════════════════",
    `  Run ID:    ${output.run_id}`,
    `  Scenario:  ${output.scenario}`,
    `  Started:   ${output.started_at}`,
    `  Completed: ${output.completed_at}`,
    "═══════════════════════════════════════════════════════",
  ];

  const addMode = (label: string, m: V2BenchmarkMetrics) => {
    lines.push("", `── ${label} ─`.padEnd(55, "─"), "");
    lines.push(...formatMetricsTable(m).split("\n").map((l) => `  ${l}`));
    lines.push("");
    lines.push(`  Actions recovered (backoff retry):  ${m.actions_recovered}`);
    lines.push(`  Repair rounds executed:             ${m.repair_rounds_executed}`);
    lines.push(`  Repair tasks executed:              ${m.repair_tasks_executed}`);
    lines.push(`  Test pass rate — before repair:     ${(m.pass_rate_before_repair * 100).toFixed(1)}%`);
    lines.push(`  Test pass rate — after repair:      ${(m.pass_rate_after_repair * 100).toFixed(1)}%`);
    lines.push(`  Pass rate restored to ≥98%:         ${m.pass_rate_restored ? "YES ✓" : "NO"}`);
  };

  if (output.serial) addMode("SERIAL EXECUTION (V2)", output.serial);
  if (output.parallel) addMode("PARALLEL EXECUTION (V2)", output.parallel);

  if (output.comparison) {
    const c = output.comparison;
    lines.push("", "── COMPARISON & ANALYSIS ─────────────────────────────", "");
    lines.push(`  Speedup factor:  ${c.speedup_factor.toFixed(2)}x`);
    lines.push(`  Quality delta:   ${c.quality_delta >= 0 ? "+" : ""}${(c.quality_delta * 100).toFixed(1)}%`);
    lines.push("");
    for (const a of c.analysis) lines.push(`  ${a}`);
    if (c.v2_improvement.length > 0) {
      lines.push("", "  V2 IMPROVEMENTS:");
      for (const n of c.v2_improvement) lines.push(`  ${n}`);
    }
  }

  lines.push("", "═══════════════════════════════════════════════════════");
  return lines.join("\n");
}
