/**
 * Repair Task Executor (V2)
 *
 * After the main orchestration pass, the integrator may generate repair tasks.
 * This module automatically re-queues those tasks, executes them, and
 * re-runs affected test suites — closing the recovery loop.
 *
 * The loop runs until:
 *   (a) no more repair tasks are generated, OR
 *   (b) max_rounds is reached, OR
 *   (c) test pass rate reaches the target threshold
 */

import { WorldStateStore } from "../state/store.js";
import { TaskPacket } from "../tasks/schema.js";
import { TaskOrchestrator, OrchestrationResult } from "./orchestrator.js";
import { Integrator, IntegrationResult } from "../integrator/integrator.js";
import { WorkerConfig } from "../workers/worker.js";
import { BACKOFF_RETRY_POLICY } from "../workers/recovery.js";
import { logger } from "../logger/logger.js";

export interface RepairExecutorConfig {
  max_rounds: number;
  target_pass_rate: number;   // Stop early if pass rate reaches this (0.0–1.0)
  worker_config: Partial<WorkerConfig>;
}

const DEFAULT_CONFIG: RepairExecutorConfig = {
  max_rounds: 3,
  target_pass_rate: 0.98,
  worker_config: {},
};

export interface RepairRound {
  round: number;
  repair_tasks_attempted: number;
  repair_tasks_completed: number;
  test_pass_rate_before: number;
  test_pass_rate_after: number;
  integration_result: IntegrationResult;
  elapsed_ms: number;
}

export interface RepairExecutionResult {
  rounds: RepairRound[];
  total_repair_tasks_executed: number;
  final_test_pass_rate: number;
  pass_rate_restored: boolean;
  elapsed_ms: number;
}

export class RepairExecutor {
  private config: RepairExecutorConfig;

  constructor(
    private store: WorldStateStore,
    config: Partial<RepairExecutorConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run repair rounds until quality is restored or max_rounds exceeded.
   * Each round:
   *   1. Integrate completed tasks (detect remaining conflicts)
   *   2. Execute any generated repair tasks
   *   3. Re-run affected test suites
   *   4. Check if pass rate meets target
   */
  async run(pending_repair_tasks: TaskPacket[]): Promise<RepairExecutionResult> {
    const start = Date.now();
    const rounds: RepairRound[] = [];
    let total_repair_tasks_executed = 0;
    let remaining_repairs = [...pending_repair_tasks];

    logger.orchestratorEvent({
      event: "repair_loop_start",
      details: {
        pending_repairs: remaining_repairs.length,
        max_rounds: this.config.max_rounds,
        target_pass_rate: this.config.target_pass_rate,
      },
    });

    for (let round = 1; round <= this.config.max_rounds; round++) {
      if (remaining_repairs.length === 0) {
        logger.orchestratorEvent({
          event: "repair_loop_early_exit",
          details: { reason: "no_repair_tasks", round },
        });
        break;
      }

      const pass_rate_before = this.store.getTestPassRate();
      if (pass_rate_before >= this.config.target_pass_rate) {
        logger.orchestratorEvent({
          event: "repair_loop_early_exit",
          details: { reason: "target_pass_rate_reached", round, pass_rate_before },
        });
        break;
      }

      const round_start = Date.now();
      logger.orchestratorEvent({
        event: "repair_round_start",
        details: { round, repair_tasks: remaining_repairs.length, pass_rate_before },
      });

      // Execute repair tasks with recovery policy enabled
      const orchestrator = new TaskOrchestrator(this.store, {
        mode: "parallel",
        max_workers: Math.min(remaining_repairs.length, 4),
        action_delay_ms: this.config.worker_config.action_delay_ms ?? 5,
        poll_interval_ms: 5,
        timeout_ms: 15_000,
        recovery_policy: BACKOFF_RETRY_POLICY,
      });

      const orch_result: OrchestrationResult = await orchestrator.run(
        `repair-round-${round}`,
        remaining_repairs
      );

      total_repair_tasks_executed += orch_result.completed_tasks;

      // Re-integrate to see if the repairs resolved the conflicts
      const completed_all = this.store.getTasksByStatus("COMPLETED");
      const integrator = new Integrator(this.store);
      const integration_result = await integrator.integrate(completed_all);

      const pass_rate_after = this.store.getTestPassRate();

      rounds.push({
        round,
        repair_tasks_attempted: remaining_repairs.length,
        repair_tasks_completed: orch_result.completed_tasks,
        test_pass_rate_before: pass_rate_before,
        test_pass_rate_after: pass_rate_after,
        integration_result,
        elapsed_ms: Date.now() - round_start,
      });

      logger.orchestratorEvent({
        event: "repair_round_complete",
        details: {
          round,
          pass_rate_before,
          pass_rate_after,
          pass_rate_delta: pass_rate_after - pass_rate_before,
          remaining_conflicts: integration_result.conflicts_detected.length,
        },
      });

      // Next round: any newly generated repair tasks
      remaining_repairs = integration_result.repair_tasks_generated;
    }

    const final_pass_rate = this.store.getTestPassRate();

    return {
      rounds,
      total_repair_tasks_executed,
      final_test_pass_rate: final_pass_rate,
      pass_rate_restored: final_pass_rate >= this.config.target_pass_rate,
      elapsed_ms: Date.now() - start,
    };
  }
}
