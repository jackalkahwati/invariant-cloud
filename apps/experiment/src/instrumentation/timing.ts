/**
 * Deep Instrumentation — Timing and Utilization Tracking (V3)
 *
 * Collects per-phase timing, worker utilization, queue wait times,
 * and blocked-action overhead for systematic bottleneck analysis.
 *
 * Design goals:
 *   - Zero structural changes to workers/orchestrator required
 *   - Derives utilization from WorkerResult data already collected
 *   - Provides machine-readable JSON + readable summary
 */

// ─── Phase Timing ─────────────────────────────────────────────────────────────

export interface PhaseRecord {
  name: string;
  start_ms: number;      // ms since collector was created
  end_ms?: number;
  elapsed_ms?: number;
  metadata?: Record<string, unknown>;
}

// ─── Worker Utilization ───────────────────────────────────────────────────────

export interface WorkerUtilizationRecord {
  worker_id: string;
  task_count: number;
  total_execution_ms: number;   // time actually running tasks
  utilization_rate: number;     // 0.0 – 1.0 (execution / total_observed_ms)
}

// ─── Queue Wait ───────────────────────────────────────────────────────────────

export interface QueueWaitRecord {
  task_id: string;
  feature: string;
  enqueued_ms: number;          // relative to collector start
  started_ms?: number;
  queue_wait_ms?: number;
}

// ─── Bottleneck Report ────────────────────────────────────────────────────────

export interface BottleneckReport {
  rank: number;
  name: string;
  category: "hot_file_contention" | "poll_overhead" | "repair_loop_serialization" | "worker_idle" | "integration_barrier" | "lock_scope";
  estimated_overhead_ms: number;
  pct_of_wall_clock: number;
  evidence: string;
  recommendation: string;
}

// ─── Full Instrumentation Summary ─────────────────────────────────────────────

export interface InstrumentationSummary {
  total_elapsed_ms: number;
  phases: PhaseRecord[];
  phase_breakdown: Record<string, number>;  // name → elapsed_ms

  // Worker utilization (derived from WorkerResult[])
  worker_count: number;
  worker_utilization_records: WorkerUtilizationRecord[];
  avg_worker_utilization: number;    // 0.0 – 1.0
  max_worker_utilization: number;
  min_worker_utilization: number;
  worker_utilization_pct: string;    // human readable

  // Queue waits
  queue_waits: QueueWaitRecord[];
  avg_queue_wait_ms: number;
  max_queue_wait_ms: number;

  // Blocked-action overhead
  total_blocked_actions: number;
  actions_recovered: number;
  estimated_backoff_overhead_ms: number;  // blocked × avg backoff per attempt

  // Repair loop overhead
  repair_rounds: number;
  repair_tasks_executed: number;
  repair_loop_ms: number;

  // Derived bottleneck ranking
  bottlenecks: BottleneckReport[];
}

// ─── Collector ────────────────────────────────────────────────────────────────

export class InstrumentationCollector {
  private start_time = Date.now();
  private phases = new Map<string, PhaseRecord>();
  private phase_list: PhaseRecord[] = [];
  private queue_waits: QueueWaitRecord[] = [];

  startPhase(name: string, metadata?: Record<string, unknown>): void {
    const record: PhaseRecord = {
      name,
      start_ms: Date.now() - this.start_time,
      metadata,
    };
    this.phases.set(name, record);
    this.phase_list.push(record);
  }

  endPhase(name: string): number {
    const record = this.phases.get(name);
    if (!record) return 0;
    record.end_ms = Date.now() - this.start_time;
    record.elapsed_ms = record.end_ms - record.start_ms;
    return record.elapsed_ms;
  }

  getElapsed(name: string): number {
    return this.phases.get(name)?.elapsed_ms ?? 0;
  }

  recordTaskQueued(task_id: string, feature: string): void {
    this.queue_waits.push({
      task_id,
      feature,
      enqueued_ms: Date.now() - this.start_time,
    });
  }

  recordTaskStarted(task_id: string): void {
    const record = this.queue_waits.find((r) => r.task_id === task_id && !r.started_ms);
    if (record) {
      record.started_ms = Date.now() - this.start_time;
      record.queue_wait_ms = record.started_ms - record.enqueued_ms;
    }
  }

  /**
   * Build the full instrumentation summary.
   * Worker utilization is derived from WorkerResult data (no internal hooks needed).
   *
   * @param worker_results - Array of completed WorkerResult objects
   * @param parallel_wall_clock_ms - Total wall clock for the parallel run
   * @param total_blocked_actions - Count of blocked actions across all workers
   * @param actions_recovered - Count of recovered blocked actions (V2/V3)
   * @param repair_rounds - Repair loop rounds executed
   * @param repair_tasks_executed - Repair tasks completed in repair loop
   * @param repair_loop_ms - Wall clock time spent in repair rounds
   */
  buildSummary(params: {
    worker_results: Array<{
      worker_id: string;
      elapsed_ms: number;
      actions_attempted: number;
      actions_blocked: number;
      actions_recovered: number;
    }>;
    parallel_wall_clock_ms: number;
    total_blocked_actions: number;
    actions_recovered: number;
    repair_rounds: number;
    repair_tasks_executed: number;
    repair_loop_ms: number;
  }): InstrumentationSummary {
    const total_elapsed_ms = Date.now() - this.start_time;

    // ── Phase breakdown ──────────────────────────────────────────────────────
    const phase_breakdown: Record<string, number> = {};
    const completed_phases = this.phase_list.filter((p) => p.elapsed_ms !== undefined);
    for (const p of completed_phases) {
      phase_breakdown[p.name] = p.elapsed_ms!;
    }

    // ── Worker utilization ───────────────────────────────────────────────────
    // Group results by worker_id (a worker may handle multiple tasks)
    const by_worker = new Map<string, { total_exec_ms: number; task_count: number }>();
    for (const r of params.worker_results) {
      const existing = by_worker.get(r.worker_id) ?? { total_exec_ms: 0, task_count: 0 };
      existing.total_exec_ms += r.elapsed_ms;
      existing.task_count++;
      by_worker.set(r.worker_id, existing);
    }

    const worker_count = by_worker.size;
    const wall = params.parallel_wall_clock_ms;

    const worker_utilization_records: WorkerUtilizationRecord[] = Array.from(
      by_worker.entries()
    ).map(([worker_id, { total_exec_ms, task_count }]) => ({
      worker_id,
      task_count,
      total_execution_ms: total_exec_ms,
      utilization_rate: wall > 0 ? Math.min(1.0, total_exec_ms / wall) : 0,
    }));

    const utils = worker_utilization_records.map((w) => w.utilization_rate);
    const avg_worker_utilization = utils.length > 0 ? utils.reduce((a, b) => a + b, 0) / utils.length : 0;
    const max_worker_utilization = utils.length > 0 ? Math.max(...utils) : 0;
    const min_worker_utilization = utils.length > 0 ? Math.min(...utils) : 0;

    // ── Queue waits ──────────────────────────────────────────────────────────
    const completed_waits = this.queue_waits.filter((r) => r.queue_wait_ms !== undefined);
    const avg_queue_wait_ms =
      completed_waits.length > 0
        ? completed_waits.reduce((s, r) => s + (r.queue_wait_ms ?? 0), 0) / completed_waits.length
        : 0;
    const max_queue_wait_ms =
      completed_waits.length > 0 ? Math.max(...completed_waits.map((r) => r.queue_wait_ms ?? 0)) : 0;

    // ── Blocked-action overhead estimate ─────────────────────────────────────
    // Average backoff per blocked action ≈ 10ms base × ~1.5 attempts (geometric average)
    const avg_backoff_per_blocked = 15; // ms estimate
    const estimated_backoff_overhead_ms = params.total_blocked_actions * avg_backoff_per_blocked;

    // ── Bottleneck ranking ────────────────────────────────────────────────────
    const bottlenecks = this.rankBottlenecks({
      wall_clock_ms: wall,
      total_blocked_actions: params.total_blocked_actions,
      estimated_backoff_overhead_ms,
      repair_loop_ms: params.repair_loop_ms,
      repair_rounds: params.repair_rounds,
      avg_queue_wait_ms,
      worker_count,
      avg_worker_utilization,
      phase_breakdown,
    });

    return {
      total_elapsed_ms,
      phases: completed_phases,
      phase_breakdown,
      worker_count,
      worker_utilization_records,
      avg_worker_utilization,
      max_worker_utilization,
      min_worker_utilization,
      worker_utilization_pct: `${(avg_worker_utilization * 100).toFixed(1)}%`,
      queue_waits: this.queue_waits,
      avg_queue_wait_ms,
      max_queue_wait_ms,
      total_blocked_actions: params.total_blocked_actions,
      actions_recovered: params.actions_recovered,
      estimated_backoff_overhead_ms,
      repair_rounds: params.repair_rounds,
      repair_tasks_executed: params.repair_tasks_executed,
      repair_loop_ms: params.repair_loop_ms,
      bottlenecks,
    };
  }

  private rankBottlenecks(ctx: {
    wall_clock_ms: number;
    total_blocked_actions: number;
    estimated_backoff_overhead_ms: number;
    repair_loop_ms: number;
    repair_rounds: number;
    avg_queue_wait_ms: number;
    worker_count: number;
    avg_worker_utilization: number;
    phase_breakdown: Record<string, number>;
  }): BottleneckReport[] {
    const bottlenecks: Omit<BottleneckReport, "rank">[] = [];
    const wall = ctx.wall_clock_ms || 1;

    // 1. Hot-file contention (blocked actions + recovery backoff)
    if (ctx.total_blocked_actions > 0) {
      const overhead = ctx.estimated_backoff_overhead_ms;
      bottlenecks.push({
        name: "Hot-file contention",
        category: "hot_file_contention",
        estimated_overhead_ms: overhead,
        pct_of_wall_clock: (overhead / wall) * 100,
        evidence: `${ctx.total_blocked_actions} actions blocked due to exclusive file lock conflicts on shared files (routes.ts, auth.ts). Each blocked action spends ~${Math.round(overhead / Math.max(1, ctx.total_blocked_actions))}ms in backoff retry.`,
        recommendation: "Refactor fixture so features write to per-feature route/auth fragments. Integration-wiring aggregates them. Eliminates all parallel file ownership conflicts.",
      });
    }

    // 2. Repair loop serialization
    if (ctx.repair_loop_ms > 0) {
      bottlenecks.push({
        name: "Repair loop serialization",
        category: "repair_loop_serialization",
        estimated_overhead_ms: ctx.repair_loop_ms,
        pct_of_wall_clock: (ctx.repair_loop_ms / wall) * 100,
        evidence: `${ctx.repair_rounds} repair round(s) executed sequentially after main parallel run, adding ${ctx.repair_loop_ms}ms. Repair tasks generated from file overlap conflicts caused by hot-file contention.`,
        recommendation: "Eliminating hot-file contention (above) eliminates file overlap conflicts → reduces repair tasks to near-zero → repair loop becomes trivially fast.",
      });
    }

    // 3. Poll overhead (sleep in orchestrator loop)
    const estimated_poll_overhead = Math.round(
      (ctx.phase_breakdown["main_execution"] ?? wall) * 0.10
    ); // ~10% overhead from 10ms sleep per task completion
    if (estimated_poll_overhead > 5) {
      bottlenecks.push({
        name: "Orchestrator poll sleep overhead",
        category: "poll_overhead",
        estimated_overhead_ms: estimated_poll_overhead,
        pct_of_wall_clock: (estimated_poll_overhead / wall) * 100,
        evidence: `Orchestrator loop sleeps ${10}ms after every Promise.race() completion. With ~${Math.round(wall / 50)} loop iterations, this adds ~${estimated_poll_overhead}ms of artificial delay.`,
        recommendation: "Remove the unconditional sleep from the parallel loop hot path. Promise.race() already provides the yield point. Saves ~10ms per task completion cycle.",
      });
    }

    // 4. Worker idle time
    if (ctx.avg_worker_utilization < 0.8) {
      const idle_overhead = Math.round(wall * ctx.worker_count * (1 - ctx.avg_worker_utilization) * 0.1);
      bottlenecks.push({
        name: "Worker idle time",
        category: "worker_idle",
        estimated_overhead_ms: idle_overhead,
        pct_of_wall_clock: (idle_overhead / wall) * 100,
        evidence: `Average worker utilization is ${(ctx.avg_worker_utilization * 100).toFixed(1)}% with ${ctx.worker_count} workers. Workers sit idle waiting for dependency-gated tasks.`,
        recommendation: "Increase worker count to allow more ready tasks to proceed immediately. Diminishing returns set in at ~critical-path-length workers.",
      });
    }

    // 5. Integration barrier
    const integration_ms = ctx.phase_breakdown["integration"] ?? 0;
    if (integration_ms > 20) {
      bottlenecks.push({
        name: "Late integration barrier",
        category: "integration_barrier",
        estimated_overhead_ms: integration_ms,
        pct_of_wall_clock: (integration_ms / wall) * 100,
        evidence: `Single integration pass runs after all tasks complete, adding ${integration_ms}ms to critical path. With many completed tasks, conflict detection scales super-linearly.`,
        recommendation: "Staged incremental integration: integrate each feature slice as soon as its tasks complete. Final integration then only checks cross-feature wiring. Runs concurrently with other features executing.",
      });
    }

    // Sort by estimated overhead descending
    bottlenecks.sort((a, b) => b.estimated_overhead_ms - a.estimated_overhead_ms);

    return bottlenecks.map((b, i) => ({ rank: i + 1, ...b }));
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatInstrumentationTable(summary: InstrumentationSummary): string {
  const lines: string[] = [
    "── INSTRUMENTATION ───────────────────────────────────",
    "",
    "  Phase Breakdown:",
  ];

  for (const [name, ms] of Object.entries(summary.phase_breakdown)) {
    const pct = ((ms / summary.total_elapsed_ms) * 100).toFixed(1);
    lines.push(`    ${name.padEnd(30)} ${String(ms + "ms").padStart(8)}  (${pct}%)`);
  }

  lines.push("", "  Worker Utilization:");
  for (const w of summary.worker_utilization_records) {
    lines.push(
      `    ${w.worker_id.padEnd(20)} ${(w.utilization_rate * 100).toFixed(1)}%  (${w.task_count} task(s), ${w.total_execution_ms}ms exec)`
    );
  }
  lines.push(`    Average:             ${summary.worker_utilization_pct}`);

  lines.push("", "  Queue & Blocking:");
  lines.push(`    Avg queue wait:      ${summary.avg_queue_wait_ms.toFixed(1)}ms`);
  lines.push(`    Max queue wait:      ${summary.max_queue_wait_ms.toFixed(1)}ms`);
  lines.push(`    Blocked actions:     ${summary.total_blocked_actions}`);
  lines.push(`    Actions recovered:   ${summary.actions_recovered}`);
  lines.push(`    Est. backoff waste:  ${summary.estimated_backoff_overhead_ms}ms`);
  lines.push(`    Repair loop:         ${summary.repair_rounds} round(s), ${summary.repair_tasks_executed} tasks, ${summary.repair_loop_ms}ms`);

  if (summary.bottlenecks.length > 0) {
    lines.push("", "  Ranked Bottlenecks:");
    for (const b of summary.bottlenecks) {
      lines.push(
        `    #${b.rank} ${b.name.padEnd(35)} ~${b.estimated_overhead_ms}ms (${b.pct_of_wall_clock.toFixed(1)}%)`
      );
      lines.push(`       → ${b.recommendation}`);
    }
  }

  return lines.join("\n");
}
