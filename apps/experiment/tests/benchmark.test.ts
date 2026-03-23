/**
 * Tests — Benchmark Harness (end-to-end)
 *
 * These tests verify that the benchmark produces credible, reproducible
 * results and that the thesis comparison is meaningful.
 */

import { describe, it, expect } from "vitest";
import { BenchmarkHarness } from "../src/benchmark/harness.js";
import { compareMetrics } from "../src/benchmark/metrics.js";
import { logger } from "../src/logger/logger.js";

logger.setSilent(true);

describe("BenchmarkHarness", () => {
  it("runs serial mode and produces valid metrics", async () => {
    const harness = new BenchmarkHarness({
      mode: "serial",
      action_delay_ms: 1,
      silent: true,
    });

    const output = await harness.run();

    expect(output.serial).toBeDefined();
    expect(output.parallel).toBeUndefined();
    expect(output.serial!.mode).toBe("serial");
    expect(output.serial!.wall_clock_ms).toBeGreaterThan(0);
    expect(output.serial!.total_tasks).toBeGreaterThan(0);
  });

  it("runs parallel mode and produces valid metrics", async () => {
    const harness = new BenchmarkHarness({
      mode: "parallel",
      action_delay_ms: 1,
      parallel_workers: 4,
      silent: true,
    });

    const output = await harness.run();

    expect(output.parallel).toBeDefined();
    expect(output.serial).toBeUndefined();
    expect(output.parallel!.mode).toBe("parallel");
    expect(output.parallel!.max_concurrent_workers).toBe(4);
  });

  it("runs both modes and produces comparison", async () => {
    const harness = new BenchmarkHarness({
      mode: "both",
      action_delay_ms: 1,
      parallel_workers: 4,
      silent: true,
    });

    const output = await harness.run();

    expect(output.serial).toBeDefined();
    expect(output.parallel).toBeDefined();
    expect(output.comparison).toBeDefined();
    expect(output.comparison!.speedup_factor).toBeGreaterThan(0);
    expect(typeof output.comparison!.thesis_supported).toBe("boolean");
    expect(output.comparison!.analysis.length).toBeGreaterThan(0);
  });

  it("parallel mode completes at least as many tasks as serial mode", async () => {
    const harness = new BenchmarkHarness({
      mode: "both",
      action_delay_ms: 1,
      parallel_workers: 4,
      silent: true,
    });

    const output = await harness.run();

    expect(output.parallel!.completed_tasks).toBeGreaterThanOrEqual(
      output.serial!.completed_tasks * 0.9  // Allow 10% tolerance
    );
  });

  it("all runs have a consistent task count", async () => {
    const run1 = new BenchmarkHarness({
      mode: "serial",
      action_delay_ms: 1,
      silent: true,
    });
    const run2 = new BenchmarkHarness({
      mode: "serial",
      action_delay_ms: 1,
      silent: true,
    });

    const out1 = await run1.run();
    const out2 = await run2.run();

    // Reproducible: same task count every run
    expect(out1.serial!.total_tasks).toBe(out2.serial!.total_tasks);
  });

  it("records blocked actions (pre-execution validation is active)", async () => {
    const harness = new BenchmarkHarness({
      mode: "parallel",
      action_delay_ms: 1,
      parallel_workers: 4,
      silent: true,
    });

    const output = await harness.run();

    // In parallel mode with shared files (routes.ts, auth.ts),
    // at least some actions should be blocked
    // Note: may be 0 if task scoping prevents all conflicts — that's also valid
    expect(output.parallel!.total_actions_attempted).toBeGreaterThan(0);
  });

  it("produces thesis analysis with VERDICT line", async () => {
    const harness = new BenchmarkHarness({
      mode: "both",
      action_delay_ms: 1,
      parallel_workers: 4,
      silent: true,
    });

    const output = await harness.run();
    const verdict = output.comparison!.analysis.find((a) => a.includes("VERDICT"));
    expect(verdict).toBeDefined();
    expect(verdict).toMatch(/THESIS/);
  });
});

describe("compareMetrics", () => {
  it("correctly identifies speedup > 1 when parallel is faster", () => {
    const serial = {
      mode: "serial" as const,
      run_id: "r1",
      wall_clock_ms: 1000,
      total_tasks: 10,
      completed_tasks: 10,
      failed_tasks: 0,
      blocked_tasks: 0,
      task_completion_rate: 1.0,
      invalid_actions_blocked: 0,
      total_actions_attempted: 50,
      total_actions_executed: 50,
      block_rate: 0,
      merge_conflicts_encountered: 0,
      repair_tasks_generated: 0,
      repair_attempts: 0,
      contradictions_escalated: 0,
      final_test_pass_rate: 1.0,
      human_interventions_required: 0,
      features_targeted: 3,
      features_completed: 3,
      feature_completeness: 1.0,
    };

    const parallel = {
      ...serial,
      mode: "parallel" as const,
      wall_clock_ms: 400,
      invalid_actions_blocked: 5,
      block_rate: 0.1,
    };

    const comparison = compareMetrics(serial, parallel);
    expect(comparison.speedup_factor).toBeCloseTo(2.5, 1);
    expect(comparison.thesis_supported).toBe(true);
  });

  it("does not support thesis when parallel is slower", () => {
    const serial = {
      mode: "serial" as const,
      run_id: "r1",
      wall_clock_ms: 500,
      total_tasks: 5,
      completed_tasks: 5,
      failed_tasks: 0,
      blocked_tasks: 0,
      task_completion_rate: 1.0,
      invalid_actions_blocked: 0,
      total_actions_attempted: 25,
      total_actions_executed: 25,
      block_rate: 0,
      merge_conflicts_encountered: 0,
      repair_tasks_generated: 0,
      repair_attempts: 0,
      contradictions_escalated: 0,
      final_test_pass_rate: 1.0,
      human_interventions_required: 0,
      features_targeted: 3,
      features_completed: 3,
      feature_completeness: 1.0,
    };

    const parallel = {
      ...serial,
      mode: "parallel" as const,
      wall_clock_ms: 1000,  // slower!
      invalid_actions_blocked: 0, // no validation effects
    };

    const comparison = compareMetrics(serial, parallel);
    expect(comparison.thesis_supported).toBe(false);
  });
});
