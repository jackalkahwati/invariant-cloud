/**
 * Benchmark Harness
 *
 * Orchestrates a full serial vs parallel comparison run.
 * Each run is isolated with a fresh world state.
 * Results are deterministic given the same seed configuration.
 *
 * Benchmark scenario:
 *   "Add enterprise SSO, audit logging, and admin role management
 *    to a realistic web app codebase."
 */

import { randomUUID } from "crypto";
import { WorldStateStore } from "../state/store.js";
import { createBenchmarkTaskPackets } from "../tasks/schema.js";
import { TaskOrchestrator } from "../orchestrator/orchestrator.js";
import { Integrator } from "../integrator/integrator.js";
import { logger } from "../logger/logger.js";
import {
  BenchmarkMetrics,
  BenchmarkComparison,
  computeMetrics,
  compareMetrics,
  formatMetricsTable,
} from "./metrics.js";

// ─── Benchmark Config ─────────────────────────────────────────────────────────

export interface BenchmarkConfig {
  /** Simulated action delay (lower = faster runs, less realistic) */
  action_delay_ms: number;
  /** Number of parallel workers */
  parallel_workers: number;
  /** Whether to run serial, parallel, or both */
  mode: "serial" | "parallel" | "both";
  /** Suppress console output during run */
  silent: boolean;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  action_delay_ms: 20,
  parallel_workers: 4,
  mode: "both",
  silent: false,
};

// ─── Benchmark Output ─────────────────────────────────────────────────────────

export interface BenchmarkOutput {
  run_id: string;
  scenario: string;
  started_at: string;
  completed_at: string;
  config: BenchmarkConfig;
  serial?: BenchmarkMetrics;
  parallel?: BenchmarkMetrics;
  comparison?: BenchmarkComparison;
  log_entries: unknown[];
}

// ─── Harness ──────────────────────────────────────────────────────────────────

export class BenchmarkHarness {
  constructor(private config: Partial<BenchmarkConfig> = {}) {}

  async run(): Promise<BenchmarkOutput> {
    const cfg = { ...DEFAULT_CONFIG, ...this.config };
    const run_id = randomUUID();
    const started_at = new Date().toISOString();

    logger.setSilent(cfg.silent);
    logger.clearEntries();

    logger.benchmarkPhase({ phase: "start", mode: cfg.mode });

    let serial_metrics: BenchmarkMetrics | undefined;
    let parallel_metrics: BenchmarkMetrics | undefined;

    if (cfg.mode === "serial" || cfg.mode === "both") {
      serial_metrics = await this.runMode("serial", run_id, cfg);
    }

    if (cfg.mode === "parallel" || cfg.mode === "both") {
      parallel_metrics = await this.runMode("parallel", run_id, cfg);
    }

    const comparison =
      serial_metrics && parallel_metrics
        ? compareMetrics(serial_metrics, parallel_metrics)
        : undefined;

    if (comparison) {
      logger.benchmarkComplete({
        run_id,
        thesis_supported: comparison.thesis_supported,
        speedup_factor: comparison.speedup_factor,
        quality_delta: comparison.quality_delta,
      });
    }

    const output: BenchmarkOutput = {
      run_id,
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

    logger.setSilent(false);
    return output;
  }

  private async runMode(
    mode: "serial" | "parallel",
    run_id: string,
    cfg: BenchmarkConfig
  ): Promise<BenchmarkMetrics> {
    logger.benchmarkPhase({ phase: `run_${mode}_start`, mode });

    // Fresh isolated store for each run
    const store = new WorldStateStore();
    const objective_id = `obj-${run_id}-${mode}`;

    // Create task packets for the benchmark scenario
    const tasks = createBenchmarkTaskPackets(objective_id);

    // Run orchestration
    const orchestrator = new TaskOrchestrator(store, {
      mode,
      max_workers: mode === "parallel" ? cfg.parallel_workers : 1,
      action_delay_ms: cfg.action_delay_ms,
      poll_interval_ms: 5,
      timeout_ms: 30_000,
    });

    const orch_result = await orchestrator.run(objective_id, tasks);

    // Run integration
    const integrator = new Integrator(store);
    const completed_tasks = store.getTasksByStatus("COMPLETED");
    const integration_result = await integrator.integrate(completed_tasks);

    // Capture snapshot
    const snapshot = store.snapshot();

    logger.benchmarkPhase({
      phase: `run_${mode}_complete`,
      mode,
      elapsed_ms: orch_result.elapsed_ms,
    });

    return computeMetrics(
      run_id,
      mode,
      orch_result,
      integration_result,
      snapshot,
      mode === "parallel" ? cfg.parallel_workers : undefined
    );
  }
}

// ─── Formatted Report ─────────────────────────────────────────────────────────

export function formatBenchmarkReport(output: BenchmarkOutput): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════",
    "  PARALLEL CODING RUNTIME — BENCHMARK RESULTS",
    "═══════════════════════════════════════════════════════",
    `  Run ID:    ${output.run_id}`,
    `  Scenario:  ${output.scenario}`,
    `  Started:   ${output.started_at}`,
    `  Completed: ${output.completed_at}`,
    "═══════════════════════════════════════════════════════",
  ];

  if (output.serial) {
    lines.push("", "── SERIAL EXECUTION ──────────────────────────────────", "");
    lines.push(
      ...formatMetricsTable(output.serial)
        .split("\n")
        .map((l) => `  ${l}`)
    );
  }

  if (output.parallel) {
    lines.push("", "── PARALLEL EXECUTION ────────────────────────────────", "");
    lines.push(
      ...formatMetricsTable(output.parallel)
        .split("\n")
        .map((l) => `  ${l}`)
    );
  }

  if (output.comparison) {
    const c = output.comparison;
    lines.push("", "── COMPARISON & ANALYSIS ─────────────────────────────", "");
    lines.push(`  Speedup factor:  ${c.speedup_factor.toFixed(2)}x`);
    lines.push(`  Quality delta:   ${c.quality_delta >= 0 ? "+" : ""}${(c.quality_delta * 100).toFixed(1)}%`);
    lines.push("");
    for (const a of c.analysis) {
      lines.push(`  ${a}`);
    }
  }

  lines.push("", "═══════════════════════════════════════════════════════");
  return lines.join("\n");
}
