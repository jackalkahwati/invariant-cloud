/**
 * Parallel Worker Orchestrator
 *
 * Accepts a parent objective, manages a pool of workers,
 * enforces path scoping, tracks the dependency DAG,
 * and records all outputs into shared world state.
 *
 * Supports both serial and parallel execution modes for the benchmark.
 */

import { WorldStateStore } from "../state/store.js";
import { TaskPacket } from "../tasks/schema.js";
import { ActionValidator } from "../validation/validator.js";
import { SimulatedWorker, WorkerPool, WorkerResult } from "../workers/worker.js";
import { RecoveryPolicy, DEFAULT_RECOVERY_POLICY } from "../workers/recovery.js";
import { logger } from "../logger/logger.js";

// ─── Orchestrator Config ──────────────────────────────────────────────────────

export interface OrchestratorConfig {
  /** Maximum concurrent workers (parallel mode) */
  max_workers: number;
  /**
   * Polling interval in ms — only used as a fallback when the orchestrator
   * would otherwise spin. Set to 0 to remove entirely (V3 default).
   * V1/V2 default was 10ms which added ~100ms of wall clock overhead.
   */
  poll_interval_ms: number;
  /** Maximum total wall clock time before aborting */
  timeout_ms: number;
  /** Execution mode */
  mode: "serial" | "parallel";
  /** Action delay per worker (for reproducible benchmarks) */
  action_delay_ms?: number;
  /** Recovery policy for workers (V2) */
  recovery_policy?: RecoveryPolicy;
  /**
   * V3: Feature group definitions for staged integration.
   * Keys are feature names; values are arrays of task IDs in that feature.
   * When all tasks in a group complete, on_feature_group_complete fires.
   */
  feature_groups?: Record<string, string[]>;
  /**
   * V3: Callback fired (fire-and-forget) when all tasks in a feature group
   * complete. Runs concurrently with remaining task execution.
   */
  on_feature_group_complete?: (feature: string, task_ids: string[]) => void;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  max_workers: 4,
  poll_interval_ms: 10,
  timeout_ms: 60_000,
  mode: "parallel",
  action_delay_ms: 50,
};

// ─── Orchestration Result ─────────────────────────────────────────────────────

export interface OrchestrationResult {
  objective_id: string;
  mode: "serial" | "parallel";
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  blocked_tasks: number;
  worker_results: WorkerResult[];
  elapsed_ms: number;
  timed_out: boolean;
  human_interventions_required: number;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class TaskOrchestrator {
  private pool: WorkerPool;
  private validator: ActionValidator;

  constructor(
    private store: WorldStateStore,
    private config: Partial<OrchestratorConfig> = {}
  ) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.validator = new ActionValidator(store);
    this.pool = new WorkerPool(store, this.validator, cfg.max_workers, {
      action_delay_ms: cfg.action_delay_ms ?? 50,
      recovery_policy: cfg.recovery_policy ?? DEFAULT_RECOVERY_POLICY,
    });
    this.config = cfg;
  }

  /**
   * Run all tasks in the given list.
   * In serial mode: one at a time in dependency order.
   * In parallel mode: as many as the pool allows, respecting deps.
   */
  async run(
    objective_id: string,
    tasks: TaskPacket[]
  ): Promise<OrchestrationResult> {
    const cfg = { ...DEFAULT_CONFIG, ...this.config };
    const start = Date.now();

    logger.orchestratorEvent({
      event: "start",
      details: {
        objective_id,
        mode: cfg.mode,
        task_count: tasks.length,
        max_workers: cfg.max_workers,
      },
    });

    // Register all tasks in the store
    for (const task of tasks) {
      this.store.registerTask({
        ...task,
        task_id: task.task_id,
        objective: task.objective,
        allowed_paths: task.allowed_paths,
        forbidden_paths: task.forbidden_paths,
        dependencies: task.dependencies,
        required_contract_versions: task.required_contract_versions,
        acceptance_criteria: task.acceptance_criteria.map((ac) => ac.description),
        validation_rules: task.validation_rules.map((vr) => vr.description),
        escalation_rules: task.escalation_rules.map((er) => er.trigger),
        assigned_worker_id: null,
        status: "PENDING",
        created_at: task.created_at,
        updated_at: task.updated_at,
      });

      logger.taskCreated({
        task_id: task.task_id,
        feature: task.feature,
        objective: task.objective,
      });
    }

    const worker_results: WorkerResult[] = [];
    let timed_out = false;
    let human_interventions = 0;

    if (cfg.mode === "serial") {
      // Execute tasks one at a time, in dependency order
      const ordered = this.topologicalSort(tasks);
      const worker = new SimulatedWorker(this.store, this.validator, {
        action_delay_ms: cfg.action_delay_ms ?? 50,
        recovery_policy: cfg.recovery_policy ?? DEFAULT_RECOVERY_POLICY,
      });

      for (const task of ordered) {
        if (Date.now() - start > cfg.timeout_ms) {
          timed_out = true;
          break;
        }

        logger.orchestratorEvent({
          event: "serial_execute",
          details: { task_id: task.task_id },
        });

        this.store.assignTask(task.task_id, worker.worker_id);
        logger.taskAssigned({ task_id: task.task_id, worker_id: worker.worker_id });

        const result = await worker.execute(task);
        worker_results.push(result);

        if (!result.success) {
          human_interventions++;
        }
      }
    } else {
      // Parallel execution — keep feeding ready tasks to available workers
      const pending = new Set(tasks.map((t) => t.task_id));
      const in_flight = new Map<string, Promise<WorkerResult>>();
      // V3: track which feature groups have already fired the completion callback
      const completed_feature_groups = new Set<string>();

      while (pending.size > 0 || in_flight.size > 0) {
        if (Date.now() - start > cfg.timeout_ms) {
          timed_out = true;
          break;
        }

        // Find tasks whose deps are all satisfied and that aren't started
        const ready = tasks.filter((t) => {
          if (!pending.has(t.task_id)) return false;
          if (in_flight.has(t.task_id)) return false;
          const storeTask = this.store.getTask(t.task_id);
          if (!storeTask || storeTask.status !== "PENDING") return false;
          return this.store.getDependenciesSatisfied(storeTask);
        });

        for (const task of ready) {
          const worker = this.pool.getAvailable();
          if (!worker) break; // Pool saturated — wait

          this.pool.markBusy(worker.worker_id);
          pending.delete(task.task_id);

          this.store.assignTask(task.task_id, worker.worker_id);
          logger.taskAssigned({ task_id: task.task_id, worker_id: worker.worker_id });

          const promise = worker
            .execute(task)
            .then((result) => {
              this.pool.markFree(worker.worker_id);
              worker_results.push(result);
              if (!result.success) human_interventions++;

              // V3: Staged integration — check if a feature group just completed
              if (cfg.feature_groups && cfg.on_feature_group_complete) {
                const feature = task.feature;
                if (!completed_feature_groups.has(feature)) {
                  const group_ids = cfg.feature_groups[feature] ?? [];
                  const all_done = group_ids.length > 0 && group_ids.every(
                    (tid) => this.store.getTask(tid)?.status === "COMPLETED"
                  );
                  if (all_done) {
                    completed_feature_groups.add(feature);
                    // Fire-and-forget: runs concurrently, does not block execution
                    cfg.on_feature_group_complete(feature, group_ids);
                  }
                }
              }

              return result;
            })
            .catch((err) => {
              this.pool.markFree(worker.worker_id);
              const result: WorkerResult = {
                task_id: task.task_id,
                worker_id: worker.worker_id,
                success: false,
                error: err instanceof Error ? err.message : String(err),
                actions_attempted: 0,
                actions_executed: 0,
                actions_blocked: 0,
                actions_recovered: 0,  // V2/V3: explicit zero in error path
                files_modified: [],
                contracts_updated: {},
                elapsed_ms: 0,
              };
              worker_results.push(result);
              human_interventions++;
              return result;
            })
            .finally(() => {
              in_flight.delete(task.task_id);
            });

          in_flight.set(task.task_id, promise);
        }

        if (in_flight.size > 0) {
          // V3 optimization: Promise.race() already yields the event loop —
          // no additional sleep needed. V1/V2 had await this.sleep(poll_interval_ms)
          // here which added ~10ms × task_count of artificial overhead.
          await Promise.race(in_flight.values());
        } else if (ready.length === 0 && pending.size > 0) {
          // No progress — dependency cycle or all blocked
          const blocked_ids = Array.from(pending);
          logger.orchestratorEvent({
            event: "deadlock_detected",
            details: { blocked_task_ids: blocked_ids },
          });

          // Mark remaining as BLOCKED
          for (const task_id of blocked_ids) {
            this.store.updateTaskStatus(task_id, "BLOCKED");
            human_interventions++;
          }
          break;
        }
        // V3: removed unconditional await this.sleep(poll_interval_ms) here.
        // That sleep ran on EVERY loop iteration in V1/V2, adding ~100ms for 10 tasks.
      }

      // Wait for any remaining in-flight tasks
      if (in_flight.size > 0) {
        await Promise.allSettled(in_flight.values());
      }
    }

    const elapsed_ms = Date.now() - start;
    const all_tasks = this.store.getAllTasks();
    const completed = all_tasks.filter((t) => t.status === "COMPLETED").length;
    const failed = all_tasks.filter((t) => t.status === "FAILED").length;
    const blocked = all_tasks.filter((t) => t.status === "BLOCKED").length;

    logger.orchestratorEvent({
      event: "complete",
      details: {
        objective_id,
        mode: cfg.mode,
        elapsed_ms,
        completed,
        failed,
        blocked,
        timed_out,
      },
    });

    return {
      objective_id,
      mode: cfg.mode,
      total_tasks: tasks.length,
      completed_tasks: completed,
      failed_tasks: failed,
      blocked_tasks: blocked,
      worker_results,
      elapsed_ms,
      timed_out,
      human_interventions_required: human_interventions,
    };
  }

  // ─── Dependency Sort ────────────────────────────────────────────────────────

  /**
   * Topological sort of tasks by dependency order.
   * Tasks with no deps first, then their dependents.
   * Cycles are broken by original order.
   */
  private topologicalSort(tasks: TaskPacket[]): TaskPacket[] {
    const by_id = new Map(tasks.map((t) => [t.task_id, t]));
    const visited = new Set<string>();
    const result: TaskPacket[] = [];

    const visit = (task: TaskPacket): void => {
      if (visited.has(task.task_id)) return;
      visited.add(task.task_id);
      for (const dep_id of task.dependencies) {
        const dep = by_id.get(dep_id);
        if (dep) visit(dep);
      }
      result.push(task);
    };

    for (const task of tasks) {
      visit(task);
    }

    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
