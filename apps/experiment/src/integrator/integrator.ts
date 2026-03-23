/**
 * Integrator and Repair Loop
 *
 * After workers complete their tasks, the integrator:
 * 1. Collects all completed task outputs
 * 2. Checks merge admissibility (conflicts, contract mismatches)
 * 3. Detects integration-level contradictions
 * 4. Generates repair tasks when integration fails
 * 5. Retries bounded recovery paths
 * 6. Escalates unresolved contradictions
 */

import { randomUUID } from "crypto";
import {
  WorldStateStore,
  TaskDefinition,
  TaskOutput,
  Contradiction,
} from "../state/store.js";
import { TaskPacket, createTaskPacket } from "../tasks/schema.js";
import { ActionValidator } from "../validation/validator.js";
import { logger } from "../logger/logger.js";

// ─── Integration Config ───────────────────────────────────────────────────────

export interface IntegratorConfig {
  max_repair_attempts: number;
  max_repair_tasks_per_conflict: number;
}

const DEFAULT_CONFIG: IntegratorConfig = {
  max_repair_attempts: 3,
  max_repair_tasks_per_conflict: 2,
};

// ─── Integration Result ───────────────────────────────────────────────────────

export interface IntegrationResult {
  success: boolean;
  integrated_tasks: string[];
  conflicts_detected: ConflictReport[];
  repair_tasks_generated: TaskPacket[];
  repair_attempts: number;
  contradictions_escalated: string[];
  merge_conflicts: number;
  elapsed_ms: number;
}

export interface ConflictReport {
  conflict_id: string;
  type:
    | "file_overlap"
    | "contract_mismatch"
    | "claim_contradiction"
    | "missing_dependency"
    | "acceptance_criteria_failed";
  task_ids: string[];
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  repair_possible: boolean;
}

// ─── Integrator ───────────────────────────────────────────────────────────────

export class Integrator {
  private validator: ActionValidator;
  private config: IntegratorConfig;

  constructor(
    private store: WorldStateStore,
    config: Partial<IntegratorConfig> = {}
  ) {
    this.validator = new ActionValidator(store);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Attempt to integrate all completed tasks.
   * Returns whether integration succeeded and what repair tasks were generated.
   */
  async integrate(completed_tasks: TaskDefinition[]): Promise<IntegrationResult> {
    const start = Date.now();
    const integrated: string[] = [];
    const all_conflicts: ConflictReport[] = [];
    const repair_tasks: TaskPacket[] = [];
    const escalated: string[] = [];
    let repair_attempts = 0;
    let merge_conflicts = 0;

    logger.integrationAttempt({
      task_ids: completed_tasks.map((t) => t.task_id),
      admissible: true, // Optimistic start
      conflict_count: 0,
    });

    // Collect all outputs
    const all_outputs: TaskOutput[] = completed_tasks
      .flatMap((t) => t.outputs ?? []);

    // ── Phase 1: File conflict detection ──────────────────────────────────────
    const file_conflicts = this.detectFileConflicts(completed_tasks);
    all_conflicts.push(...file_conflicts);
    merge_conflicts += file_conflicts.length;

    // ── Phase 2: Contract version consistency ─────────────────────────────────
    const contract_conflicts = this.detectContractConflicts(completed_tasks);
    all_conflicts.push(...contract_conflicts);

    // ── Phase 3: Claim contradiction check ────────────────────────────────────
    const claim_conflicts = this.detectClaimContradictions(completed_tasks);
    all_conflicts.push(...claim_conflicts);
    for (const cc of claim_conflicts) {
      const contradiction: Contradiction = {
        contradiction_id: randomUUID(),
        claim_a: cc.task_ids[0] ?? "unknown",
        claim_b: cc.task_ids[1] ?? "unknown",
        description: cc.description,
        severity: cc.severity,
        detected_at: Date.now(),
        resolved: false,
      };
      this.store.recordContradiction(contradiction);
      logger.contradictionDetected({
        contradiction_id: contradiction.contradiction_id,
        description: contradiction.description,
        severity: contradiction.severity,
      });
    }

    // ── Phase 4: Acceptance criteria verification ─────────────────────────────
    const acceptance_failures = this.verifyAcceptanceCriteria(completed_tasks);
    all_conflicts.push(...acceptance_failures);

    // ── Phase 5: Generate repair tasks for fixable conflicts ──────────────────
    const fixable = all_conflicts.filter((c) => c.repair_possible);
    const blocking = all_conflicts.filter(
      (c) => !c.repair_possible && (c.severity === "HIGH" || c.severity === "CRITICAL")
    );

    if (fixable.length > 0 && repair_attempts < this.config.max_repair_attempts) {
      repair_attempts++;
      const generated = this.generateRepairTasks(fixable, completed_tasks);
      repair_tasks.push(...generated);

      for (const rt of generated) {
        logger.repairGenerated({
          repair_task_id: rt.task_id,
          original_task_id: rt.parent_objective_id ?? "unknown",
          reason: rt.objective,
        });
      }
    }

    // ── Phase 6: Escalate unresolvable contradictions ─────────────────────────
    for (const conflict of blocking) {
      const escalation_id = randomUUID();
      escalated.push(escalation_id);
      logger.warn(`Escalating unresolvable conflict: ${conflict.description}`, {
        conflict_id: conflict.conflict_id,
        escalation_id,
      });
    }

    // ── Phase 7: Mark successfully integrated tasks ────────────────────────────
    const conflicted_task_ids = new Set(all_conflicts.flatMap((c) => c.task_ids));
    for (const task of completed_tasks) {
      if (!conflicted_task_ids.has(task.task_id)) {
        integrated.push(task.task_id);
      }
    }

    const success = all_conflicts.length === 0 && repair_tasks.length === 0;

    logger.integrationAttempt({
      task_ids: completed_tasks.map((t) => t.task_id),
      admissible: success,
      conflict_count: all_conflicts.length,
    });

    return {
      success,
      integrated_tasks: integrated,
      conflicts_detected: all_conflicts,
      repair_tasks_generated: repair_tasks,
      repair_attempts,
      contradictions_escalated: escalated,
      merge_conflicts,
      elapsed_ms: Date.now() - start,
    };
  }

  // ─── Conflict Detection ────────────────────────────────────────────────────

  private detectFileConflicts(tasks: TaskDefinition[]): ConflictReport[] {
    const conflicts: ConflictReport[] = [];
    const file_to_tasks = new Map<string, string[]>();

    for (const task of tasks) {
      const outputs = task.outputs ?? [];
      for (const output of outputs) {
        for (const file of output.files_modified) {
          const existing = file_to_tasks.get(file) ?? [];
          existing.push(task.task_id);
          file_to_tasks.set(file, existing);
        }
      }
    }

    for (const [file, task_ids] of file_to_tasks) {
      if (task_ids.length > 1) {
        conflicts.push({
          conflict_id: randomUUID(),
          type: "file_overlap",
          task_ids,
          description: `File "${file}" was modified by multiple tasks: ${task_ids.join(", ")}`,
          severity: "HIGH",
          repair_possible: true,
        });
      }
    }

    return conflicts;
  }

  private detectContractConflicts(tasks: TaskDefinition[]): ConflictReport[] {
    const conflicts: ConflictReport[] = [];

    // Find contract updates from all tasks
    const contract_updates = new Map<
      string,
      Array<{ task_id: string; version: number }>
    >();

    for (const task of tasks) {
      const outputs = task.outputs ?? [];
      for (const output of outputs) {
        for (const [module, version] of Object.entries(output.contracts_updated)) {
          const existing = contract_updates.get(module) ?? [];
          existing.push({ task_id: task.task_id, version });
          contract_updates.set(module, existing);
        }
      }
    }

    for (const [module, updates] of contract_updates) {
      if (updates.length <= 1) continue;

      // Check if versions are consistent
      const versions = new Set(updates.map((u) => u.version));
      if (versions.size > 1) {
        conflicts.push({
          conflict_id: randomUUID(),
          type: "contract_mismatch",
          task_ids: updates.map((u) => u.task_id),
          description: `Contract "${module}" updated to different versions: ${Array.from(versions).join(" vs ")}`,
          severity: "CRITICAL",
          repair_possible: false, // Version conflicts need manual resolution
        });
      }
    }

    // Check consumer compatibility: tasks that needed a version that was changed
    for (const task of tasks) {
      for (const [module, required_version] of Object.entries(
        task.required_contract_versions ?? {}
      )) {
        const current = this.store.getContractVersion(module);
        if (current && current.version > required_version) {
          conflicts.push({
            conflict_id: randomUUID(),
            type: "contract_mismatch",
            task_ids: [task.task_id, current.defined_by_task],
            description: `Task ${task.task_id} required ${module}@${required_version} but current is @${current.version}`,
            severity: "MEDIUM",
            repair_possible: true,
          });
        }
      }
    }

    return conflicts;
  }

  private detectClaimContradictions(tasks: TaskDefinition[]): ConflictReport[] {
    const conflicts: ConflictReport[] = [];

    // Find active claims from these tasks
    const task_ids = new Set(tasks.map((t) => t.task_id));
    const claims = this.store
      .getActiveClaims()
      .filter((c) => task_ids.has(c.source_task_id));

    // Group by subject
    const by_subject = new Map<string, typeof claims>();
    for (const claim of claims) {
      const existing = by_subject.get(claim.subject) ?? [];
      existing.push(claim);
      by_subject.set(claim.subject, existing);
    }

    for (const [subject, subject_claims] of by_subject) {
      if (subject_claims.length <= 1) continue;

      // Check if claims on the same subject contradict each other
      const by_predicate = new Map<string, typeof subject_claims>();
      for (const claim of subject_claims) {
        const existing = by_predicate.get(claim.predicate) ?? [];
        existing.push(claim);
        by_predicate.set(claim.predicate, existing);
      }

      for (const [predicate, pred_claims] of by_predicate) {
        if (pred_claims.length <= 1) continue;

        // Multiple claims with same predicate/subject from different tasks = contradiction
        const task_ids_involved = pred_claims.map((c) => c.source_task_id);
        if (new Set(task_ids_involved).size > 1) {
          conflicts.push({
            conflict_id: randomUUID(),
            type: "claim_contradiction",
            task_ids: task_ids_involved,
            description: `Multiple tasks claim "${predicate}" on "${subject}"`,
            severity: "MEDIUM",
            repair_possible: true,
          });
        }
      }
    }

    return conflicts;
  }

  private verifyAcceptanceCriteria(tasks: TaskDefinition[]): ConflictReport[] {
    const conflicts: ConflictReport[] = [];
    const test_results = this.store.getLatestTestResults();
    const pass_rate = this.store.getTestPassRate();

    if (pass_rate < 0.9) {
      const failing_suites = test_results.filter((r) => r.failed > 0);
      conflicts.push({
        conflict_id: randomUUID(),
        type: "acceptance_criteria_failed",
        task_ids: failing_suites.map((r) => r.task_id),
        description: `Test pass rate ${(pass_rate * 100).toFixed(1)}% below 90% threshold. Failing suites: ${failing_suites.map((r) => r.suite).join(", ")}`,
        severity: "HIGH",
        repair_possible: true,
      });
    }

    return conflicts;
  }

  // ─── Repair Task Generation ────────────────────────────────────────────────

  private generateRepairTasks(
    conflicts: ConflictReport[],
    original_tasks: TaskDefinition[]
  ): TaskPacket[] {
    const repair_tasks: TaskPacket[] = [];
    const now = Date.now();

    for (const conflict of conflicts.slice(0, this.config.max_repair_tasks_per_conflict)) {
      if (conflict.type === "file_overlap") {
        // Generate a merge reconciliation task
        const conflicted_task = original_tasks.find((t) =>
          conflict.task_ids.includes(t.task_id)
        );
        if (!conflicted_task) continue;

        const repair = createTaskPacket({
          task_id: `repair-${randomUUID().slice(0, 8)}`,
          parent_objective_id: conflict.conflict_id,
          feature: "Repair",
          objective: `Resolve file overlap conflict: ${conflict.description}`,
          allowed_paths: this.extractConflictedPaths(conflict, original_tasks),
          forbidden_paths: [],
          dependencies: conflict.task_ids,
          required_contract_versions: {},
          acceptance_criteria: [
            {
              id: `repair-ac-1`,
              description: "No overlapping file ownership after repair",
              verification_type: "no_contradictions",
            },
          ],
          validation_rules: [
            {
              rule_id: "repair-vr-1",
              description: "No forbidden path writes",
              rule_type: "no_forbidden_path_write",
            },
          ],
          escalation_rules: [
            {
              rule_id: "repair-er-1",
              trigger: "max_retries_exceeded",
              action: "escalate_to_human",
              max_retries: 1,
            },
          ],
          assigned_worker_id: null,
          priority: 1, // High priority
          max_retries: 1,
          created_at: now,
          updated_at: now,
        });

        repair_tasks.push(repair);
      } else if (conflict.type === "contract_mismatch" && conflict.repair_possible) {
        // Generate a contract reconciliation task
        const repair = createTaskPacket({
          task_id: `repair-contract-${randomUUID().slice(0, 8)}`,
          parent_objective_id: conflict.conflict_id,
          feature: "ContractRepair",
          objective: `Resolve contract mismatch: ${conflict.description}`,
          allowed_paths: [],
          forbidden_paths: [],
          dependencies: conflict.task_ids,
          required_contract_versions: {},
          acceptance_criteria: [
            {
              id: `repair-contract-ac-1`,
              description: "Contract versions are consistent across all tasks",
              verification_type: "no_contradictions",
            },
          ],
          validation_rules: [],
          escalation_rules: [
            {
              rule_id: "repair-contract-er-1",
              trigger: "unresolvable_conflict",
              action: "escalate_to_human",
            },
          ],
          assigned_worker_id: null,
          priority: 1,
          max_retries: 1,
          created_at: now,
          updated_at: now,
        });

        repair_tasks.push(repair);
      } else if (conflict.type === "acceptance_criteria_failed") {
        const repair = createTaskPacket({
          task_id: `repair-tests-${randomUUID().slice(0, 8)}`,
          parent_objective_id: conflict.conflict_id,
          feature: "TestRepair",
          objective: `Fix failing tests: ${conflict.description}`,
          allowed_paths: conflict.task_ids
            .flatMap((tid) => {
              const task = original_tasks.find((t) => t.task_id === tid);
              return task?.outputs?.[0]?.files_modified ?? [];
            }),
          forbidden_paths: [],
          dependencies: conflict.task_ids,
          required_contract_versions: {},
          acceptance_criteria: [
            {
              id: `repair-tests-ac-1`,
              description: "All tests pass",
              verification_type: "test_pass",
            },
          ],
          validation_rules: [],
          escalation_rules: [],
          assigned_worker_id: null,
          priority: 1,
          max_retries: 2,
          created_at: now,
          updated_at: now,
        });

        repair_tasks.push(repair);
      }
    }

    return repair_tasks;
  }

  private extractConflictedPaths(
    conflict: ConflictReport,
    original_tasks: TaskDefinition[]
  ): string[] {
    const paths: string[] = [];
    for (const task_id of conflict.task_ids) {
      const task = original_tasks.find((t) => t.task_id === task_id);
      if (task?.outputs) {
        for (const output of task.outputs) {
          paths.push(...output.files_modified);
        }
      }
    }
    return [...new Set(paths)];
  }
}
