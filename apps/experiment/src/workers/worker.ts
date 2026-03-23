/**
 * Simulated Worker
 *
 * Workers are the execution units — each handles one TaskPacket.
 * In this prototype, workers simulate realistic coding actions
 * (file writes, edits, test runs, contract updates) without
 * actually touching the filesystem.
 *
 * Every action goes through pre-execution validation.
 * Blocked actions are recorded but not "executed".
 *
 * The simulation injects realistic timing and occasional conflict scenarios
 * to make the benchmark meaningful.
 */

import { randomUUID } from "crypto";
import { WorldStateStore, ActionRecord, Claim } from "../state/store.js";
import { TaskPacket, ProposedAction } from "../tasks/schema.js";
import { ActionValidator } from "../validation/validator.js";
import {
  RecoveryPolicy,
  DEFAULT_RECOVERY_POLICY,
  isRecoverable,
  RecoveryState,
} from "./recovery.js";
import { logger } from "../logger/logger.js";

// ─── Worker Configuration ─────────────────────────────────────────────────────

export interface WorkerConfig {
  /** Base delay per action in ms (simulates "coding time") */
  action_delay_ms: number;
  /** Jitter factor: actual delay = base * (1 ± jitter) */
  jitter_factor: number;
  /** Probability [0,1] that a worker proposes a "risky" action */
  risky_action_probability: number;
  /** Recovery policy for blocked actions (V2) */
  recovery_policy: RecoveryPolicy;
}

const DEFAULT_CONFIG: WorkerConfig = {
  action_delay_ms: 50,
  jitter_factor: 0.3,
  risky_action_probability: 0.1,
  recovery_policy: DEFAULT_RECOVERY_POLICY,
};

// ─── Worker Output ────────────────────────────────────────────────────────────

export interface WorkerResult {
  task_id: string;
  worker_id: string;
  success: boolean;
  error?: string;
  actions_attempted: number;
  actions_executed: number;
  actions_blocked: number;
  actions_recovered: number;  // V2: blocked actions that recovered via retry
  files_modified: string[];
  contracts_updated: Record<string, number>;
  elapsed_ms: number;
}

// ─── Simulated Worker ─────────────────────────────────────────────────────────

export class SimulatedWorker {
  readonly worker_id: string;
  private config: WorkerConfig;

  constructor(
    private store: WorldStateStore,
    private validator: ActionValidator,
    config: Partial<WorkerConfig> = {}
  ) {
    this.worker_id = `worker-${randomUUID().slice(0, 8)}`;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a task packet.
   * Simulates the sequence of actions a real coding agent would take.
   */
  async execute(task: TaskPacket): Promise<WorkerResult> {
    const start = Date.now();
    logger.taskStarted({ task_id: task.task_id, worker_id: this.worker_id });

    // Mark task as in-progress in the store and update local reference
    this.store.updateTaskStatus(task.task_id, "IN_PROGRESS", {
      assigned_worker_id: this.worker_id,
    });
    // Use an updated task reference so the validator sees IN_PROGRESS status
    const activeTask: TaskPacket = { ...task, status: "IN_PROGRESS", assigned_worker_id: this.worker_id };

    const files_modified: string[] = [];
    const contracts_updated: Record<string, number> = {};
    let actions_attempted = 0;
    let actions_executed = 0;
    let actions_blocked = 0;
    let actions_recovered = 0;
    const recovery_policy = this.config.recovery_policy;

    try {
      // Generate the sequence of actions this task would take
      const action_sequence = this.planActions(activeTask);

      for (const action of action_sequence) {
        actions_attempted++;

        // Simulate work time
        await this.delay(this.jitteredDelay());

        // Validate before executing
        let action_id = randomUUID();
        let validation = this.validator.validate(action, activeTask, action_id);

        // ── V2 Recovery Loop ─────────────────────────────────────────────────
        if (
          validation.admissibility === "BLOCKED" &&
          isRecoverable(validation.reasons, recovery_policy)
        ) {
          const recovery: RecoveryState = {
            action_id,
            attempts: 0,
            recovered: false,
            recovery_reason: "",
          };

          for (let attempt = 1; attempt <= recovery_policy.max_attempts; attempt++) {
            recovery.attempts = attempt;
            // Exponential backoff: base * 2^(attempt-1)
            const backoff = recovery_policy.backoff_base_ms * Math.pow(2, attempt - 1);
            await this.delay(backoff);

            // Re-validate after backoff (lock may have been released)
            action_id = randomUUID();
            validation = this.validator.validate(action, activeTask, action_id);

            if (validation.admissibility !== "BLOCKED") {
              recovery.recovered = true;
              recovery.recovery_reason = `Recovered after ${attempt} attempt(s) (${backoff}ms backoff)`;
              actions_recovered++;
              logger.info(`[RECOVERY] Action recovered after ${attempt} attempt(s)`, {
                task_id: activeTask.task_id,
                action_type: action.action_type,
                target: this.extractTarget(action),
                attempts: attempt,
              });
              break;
            }
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        const record: ActionRecord = {
          action_id,
          task_id: activeTask.task_id,
          worker_id: this.worker_id,
          action_type: action.action_type,
          target: this.extractTarget(action),
          params: this.extractParams(action),
          admissibility: validation.admissibility,
          executed_at: Date.now(),
          result: validation.admissibility === "BLOCKED" ? "BLOCKED" : "SUCCESS",
        };

        this.store.recordAction(record);

        if (validation.admissibility === "BLOCKED") {
          actions_blocked++;
          logger.actionBlocked({
            action_id,
            task_id: activeTask.task_id,
            action_type: action.action_type,
            reasons: validation.reasons,
          });
          // Still blocked after recovery attempts — skip this action
          continue;
        }

        // "Execute" the action (update world state to reflect the action)
        await this.applyAction(action, activeTask);
        actions_executed++;

        logger.actionExecuted({
          action_id,
          task_id: activeTask.task_id,
          action_type: action.action_type,
          target: this.extractTarget(action),
        });

        if (action.action_type === "file_write" || action.action_type === "file_edit") {
          const path = action.path;
          if (!files_modified.includes(path)) files_modified.push(path);
        }

        if (action.action_type === "contract_update") {
          contracts_updated[action.module] = action.new_version;
        }
      }

      // Run final test suite for this task
      await this.delay(this.jitteredDelay());
      const test_action_id = randomUUID();
      const testAction: ProposedAction = {
        action_type: "test_run",
        task_id: activeTask.task_id,
        worker_id: this.worker_id,
        suite: `tests/${activeTask.task_id}`,
        reason: `Final verification of ${activeTask.task_id}`,
      };
      const testValidation = this.validator.validate(testAction, activeTask, test_action_id);
      if (testValidation.admissibility !== "BLOCKED") {
        this.store.recordTestResult({
          suite: `tests/${activeTask.task_id}`,
          passed: actions_blocked === 0 ? 4 : 2,
          failed: actions_blocked > 0 ? 1 : 0,
          skipped: 0,
          run_at: Date.now(),
          task_id: activeTask.task_id,
        });
      }

      // Release file claims
      this.store.releaseAllFiles(activeTask.task_id);

      const outputs = {
        task_id: activeTask.task_id,
        worker_id: this.worker_id,
        actions_performed: this.store.getActionHistory(activeTask.task_id),
        files_modified,
        contracts_updated,
        test_results: this.store.getLatestTestResults().filter((r) => r.task_id === activeTask.task_id),
        completed_at: Date.now(),
      };

      this.store.updateTaskStatus(activeTask.task_id, "COMPLETED", { outputs: [outputs] });
      logger.taskCompleted({
        task_id: activeTask.task_id,
        worker_id: this.worker_id,
        actions: actions_executed,
      });

      return {
        task_id: activeTask.task_id,
        worker_id: this.worker_id,
        success: true,
        actions_attempted,
        actions_executed,
        actions_blocked,
        actions_recovered,
        files_modified,
        contracts_updated,
        elapsed_ms: Date.now() - start,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.store.releaseAllFiles(activeTask.task_id);
      this.store.updateTaskStatus(activeTask.task_id, "FAILED", { error });
      logger.taskFailed({ task_id: activeTask.task_id, error });

      return {
        task_id: activeTask.task_id,
        worker_id: this.worker_id,
        success: false,
        error,
        actions_attempted,
        actions_executed,
        actions_blocked,
        actions_recovered,
        files_modified,
        contracts_updated,
        elapsed_ms: Date.now() - start,
      };
    }
  }

  // ─── Action Planning ────────────────────────────────────────────────────────

  /**
   * Generate the sequence of actions for a task.
   * This is the "LLM plan" — in reality this would come from an AI agent.
   * We simulate it deterministically based on the task's feature and allowed paths.
   */
  private planActions(task: TaskPacket): ProposedAction[] {
    const actions: ProposedAction[] = [];

    // Claim file ownership first via file_write
    for (const path of task.allowed_paths) {
      // Try to claim file
      this.store.claimFile(path, task.task_id, "exclusive");

      // Write the implementation file
      actions.push({
        action_type: "file_write",
        task_id: task.task_id,
        worker_id: this.worker_id,
        path,
        content: this.generateFileContent(task, path),
        reason: `Implement ${task.feature} in ${path}`,
      });
    }

    // Add a claim for what this task asserts
    const claim: Claim = {
      claim_id: randomUUID(),
      predicate: "implements",
      subject: task.feature,
      value: { task_id: task.task_id, paths: task.allowed_paths },
      source_task_id: task.task_id,
      confidence: 0.95,
      created_at: Date.now(),
      superseded: false,
    };
    this.store.addClaim(claim);

    // Update contract versions as declared
    for (const [module, version] of Object.entries(task.required_contract_versions)) {
      const current = this.store.getContractVersion(module);
      // Only update if we're advancing the contract
      if (!current || current.version < version) {
        actions.push({
          action_type: "contract_update",
          task_id: task.task_id,
          worker_id: this.worker_id,
          module,
          new_version: version,
          interface_hash: this.hashContract(module, version),
          reason: `${task.feature} requires ${module}@${version}`,
        });
      }
    }

    return actions;
  }

  private generateFileContent(task: TaskPacket, path: string): string {
    // Simulate generated code content (not real, just representative)
    const filename = path.split("/").pop() ?? path;
    return [
      `// Auto-generated by ${task.feature} task (${task.task_id})`,
      `// Path: ${path}`,
      `// Objective: ${task.objective}`,
      ``,
      `export const ${filename.replace(".ts", "").replace(/[-./]/g, "_")} = {`,
      `  feature: "${task.feature}",`,
      `  task_id: "${task.task_id}",`,
      `  implemented: true,`,
      `};`,
    ].join("\n");
  }

  private hashContract(module: string, version: number): string {
    // Deterministic fake hash for testing
    return `sha256:${module}-v${version}-${Date.now().toString(36)}`;
  }

  // ─── Action Application ─────────────────────────────────────────────────────

  private async applyAction(action: ProposedAction, task: TaskPacket): Promise<void> {
    switch (action.action_type) {
      case "file_write":
      case "file_edit":
        // Ensure we hold the claim
        this.store.claimFile(action.path, task.task_id, "exclusive");
        break;

      case "contract_update":
        this.store.updateContractVersion({
          module: action.module,
          version: action.new_version,
          interface_hash: action.interface_hash,
          defined_by_task: task.task_id,
          created_at: Date.now(),
        });
        break;

      case "branch_merge":
        this.store.updateBranch(action.source_branch, {
          merged_at: Date.now(),
          status: "merged",
        });
        break;

      case "test_run":
        // Recorded separately in the execute() method
        break;

      case "shell_command":
        // No-op in simulation
        break;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private extractTarget(action: ProposedAction): string {
    switch (action.action_type) {
      case "file_write":
      case "file_edit":
        return action.path;
      case "shell_command":
        return action.command;
      case "branch_merge":
        return `${action.source_branch} → ${action.target_branch}`;
      case "test_run":
        return action.suite;
      case "contract_update":
        return `${action.module}@${action.new_version}`;
    }
  }

  private extractParams(action: ProposedAction): Record<string, unknown> {
    const { task_id: _tid, worker_id: _wid, action_type: _at, reason: _r, ...rest } = action;
    return rest as Record<string, unknown>;
  }

  private jitteredDelay(): number {
    const jitter =
      this.config.action_delay_ms *
      this.config.jitter_factor *
      (Math.random() * 2 - 1);
    return Math.max(0, this.config.action_delay_ms + jitter);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Worker Pool ──────────────────────────────────────────────────────────────

export class WorkerPool {
  private workers: SimulatedWorker[] = [];
  private busy = new Set<string>();

  constructor(
    private store: WorldStateStore,
    private validator: ActionValidator,
    size: number,
    config: Partial<WorkerConfig> = {}
  ) {
    for (let i = 0; i < size; i++) {
      this.workers.push(new SimulatedWorker(store, validator, config));
    }
  }

  /** Get an available (non-busy) worker, or null if all busy */
  getAvailable(): SimulatedWorker | null {
    return this.workers.find((w) => !this.busy.has(w.worker_id)) ?? null;
  }

  markBusy(worker_id: string): void {
    this.busy.add(worker_id);
  }

  markFree(worker_id: string): void {
    this.busy.delete(worker_id);
  }

  get total(): number {
    return this.workers.length;
  }

  get available_count(): number {
    return this.workers.filter((w) => !this.busy.has(w.worker_id)).length;
  }
}
