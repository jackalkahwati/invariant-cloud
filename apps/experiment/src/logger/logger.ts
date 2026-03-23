/**
 * Structured Logger for the Experimental Runtime
 *
 * All events are logged as JSON lines to stdout (and optionally to a file).
 * Each log entry has a type field for easy filtering with jq.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: number;       // Unix ms
  level: LogLevel;
  type: string;     // Structured event type
  msg: string;
  [key: string]: unknown;
}

class StructuredLogger {
  private level: LogLevel = "info";
  private entries: LogEntry[] = [];
  private silent = false;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setSilent(silent: boolean): void {
    this.silent = silent;
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clearEntries(): void {
    this.entries = [];
  }

  private shouldLog(level: LogLevel): boolean {
    const order: LogLevel[] = ["debug", "info", "warn", "error"];
    return order.indexOf(level) >= order.indexOf(this.level);
  }

  private emit(level: LogLevel, type: string, msg: string, extra?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      ts: Date.now(),
      level,
      type,
      msg,
      ...extra,
    };

    this.entries.push(entry);

    if (!this.silent) {
      const prefix =
        level === "error" ? "ERR" :
        level === "warn" ? "WRN" :
        level === "debug" ? "DBG" : "INF";
      // eslint-disable-next-line no-console
      console.log(`[${prefix}] ${JSON.stringify(entry)}`);
    }
  }

  // ─── Typed Event Loggers ───────────────────────────────────────────────────

  taskCreated(data: { task_id: string; feature: string; objective: string }): void {
    this.emit("info", "task.created", `Task created: ${data.task_id}`, data);
  }

  taskAssigned(data: { task_id: string; worker_id: string }): void {
    this.emit("info", "task.assigned", `Task ${data.task_id} assigned to ${data.worker_id}`, data);
  }

  taskStarted(data: { task_id: string; worker_id: string }): void {
    this.emit("info", "task.started", `Task ${data.task_id} started`, data);
  }

  taskCompleted(data: { task_id: string; worker_id: string; actions: number }): void {
    this.emit("info", "task.completed", `Task ${data.task_id} completed`, data);
  }

  taskFailed(data: { task_id: string; error: string }): void {
    this.emit("error", "task.failed", `Task ${data.task_id} failed: ${data.error}`, data);
  }

  taskBlocked(data: { task_id: string; reason: string }): void {
    this.emit("warn", "task.blocked", `Task ${data.task_id} blocked: ${data.reason}`, data);
  }

  validation(data: {
    outcome_id: string;
    task_id: string;
    action_type: string;
    admissibility: string;
    reasons: string[];
    conflicting_claims: string[];
  }): void {
    const level = data.admissibility === "BLOCKED" ? "warn" : "info";
    this.emit(
      level,
      "validation.outcome",
      `[${data.admissibility}] ${data.action_type} in ${data.task_id}`,
      data
    );
  }

  actionBlocked(data: { action_id: string; task_id: string; action_type: string; reasons: string[] }): void {
    this.emit("warn", "action.blocked", `Action blocked in ${data.task_id}: ${data.reasons[0]}`, data);
  }

  actionExecuted(data: { action_id: string; task_id: string; action_type: string; target: string }): void {
    this.emit("debug", "action.executed", `Action executed: ${data.action_type} on ${data.target}`, data);
  }

  integrationAttempt(data: {
    task_ids: string[];
    admissible: boolean;
    conflict_count: number;
  }): void {
    this.emit(
      data.admissible ? "info" : "warn",
      "integration.attempt",
      `Integration ${data.admissible ? "succeeded" : "failed"} for ${data.task_ids.length} tasks`,
      data
    );
  }

  repairGenerated(data: {
    repair_task_id: string;
    original_task_id: string;
    reason: string;
  }): void {
    this.emit("info", "repair.generated", `Repair task ${data.repair_task_id} for ${data.original_task_id}`, data);
  }

  contradictionDetected(data: {
    contradiction_id: string;
    description: string;
    severity: string;
  }): void {
    this.emit("warn", "contradiction.detected", `Contradiction: ${data.description}`, data);
  }

  benchmarkPhase(data: { phase: string; mode: string; elapsed_ms?: number }): void {
    this.emit("info", "benchmark.phase", `[${data.mode}] ${data.phase}`, data);
  }

  benchmarkComplete(data: Record<string, unknown>): void {
    this.emit("info", "benchmark.complete", "Benchmark run complete", data);
  }

  orchestratorEvent(data: { event: string; details: Record<string, unknown> }): void {
    this.emit("info", `orchestrator.${data.event}`, `Orchestrator: ${data.event}`, data.details);
  }

  info(msg: string, extra?: Record<string, unknown>): void {
    this.emit("info", "generic", msg, extra);
  }

  warn(msg: string, extra?: Record<string, unknown>): void {
    this.emit("warn", "generic.warn", msg, extra);
  }

  error(msg: string, extra?: Record<string, unknown>): void {
    this.emit("error", "generic.error", msg, extra);
  }

  debug(msg: string, extra?: Record<string, unknown>): void {
    this.emit("debug", "generic.debug", msg, extra);
  }
}

export const logger = new StructuredLogger();
