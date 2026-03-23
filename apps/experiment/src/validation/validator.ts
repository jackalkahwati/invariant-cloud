/**
 * Pre-Execution Validator
 *
 * Every action a worker proposes must pass validation before execution.
 * This is the core admissibility gate — the "Invariant check" of the runtime.
 *
 * Returns: VALID | RISKY | BLOCKED with full audit trail.
 */

import { randomUUID } from "crypto";
import {
  WorldStateStore,
  ActionType,
  Admissibility,
  ValidationOutcome,
} from "../state/store.js";
import { ProposedAction, TaskPacket } from "../tasks/schema.js";
import { logger } from "../logger/logger.js";

// ─── Validation Result ────────────────────────────────────────────────────────

export interface ValidationResult {
  admissibility: Admissibility;
  reasons: string[];
  metadata: Record<string, unknown>;
  conflicting_claims: string[];
  stale_state: boolean;
  outcome_id: string;
  checked_at: number;
}

// ─── Individual Check Results ─────────────────────────────────────────────────

interface CheckResult {
  passed: boolean;
  reason?: string;
  severity: "block" | "warn" | "info";
  metadata?: Record<string, unknown>;
}

// ─── Validator ────────────────────────────────────────────────────────────────

export class ActionValidator {
  constructor(private store: WorldStateStore) {}

  /**
   * Validate a proposed action against current world state.
   * Records the outcome in the store for audit trail.
   */
  validate(
    action: ProposedAction,
    task: TaskPacket,
    action_id: string
  ): ValidationResult {
    const checks: CheckResult[] = [];
    const conflicting_claims: string[] = [];

    // Run all applicable checks
    checks.push(this.checkTaskIsActive(task));
    checks.push(this.checkDependenciesSatisfied(task));

    if (action.action_type === "file_write" || action.action_type === "file_edit") {
      checks.push(this.checkForbiddenPath(action.path, task));
      checks.push(this.checkAllowedPath(action.path, task));
      checks.push(this.checkFileOwnership(action.path, task));
      const staleCheck = this.checkStaleState(action.path, task);
      checks.push(staleCheck);
    }

    if (action.action_type === "contract_update") {
      checks.push(this.checkContractVersionSafe(action.module, action.new_version, task));
    }

    if (action.action_type === "branch_merge") {
      checks.push(this.checkMergeAdmissibility(action.source_branch, action.target_branch, task));
    }

    if (action.action_type === "shell_command") {
      checks.push(this.checkShellCommandSafety(action.command, task));
    }

    // Check for conflicting active claims
    const claimConflicts = this.checkConflictingClaims(action, task);
    checks.push(claimConflicts.check);
    conflicting_claims.push(...claimConflicts.conflicting_ids);

    // Determine overall admissibility
    const blocking = checks.filter((c) => !c.passed && c.severity === "block");
    const warnings = checks.filter((c) => !c.passed && c.severity === "warn");

    let admissibility: Admissibility;
    if (blocking.length > 0) {
      admissibility = "BLOCKED";
    } else if (warnings.length > 0) {
      admissibility = "RISKY";
    } else {
      admissibility = "VALID";
    }

    const reasons = [...blocking, ...warnings]
      .filter((c) => c.reason)
      .map((c) => c.reason as string);

    const stale_state = checks.some(
      (c) => !c.passed && c.metadata?.["check_type"] === "stale_state"
    );

    const outcome_id = randomUUID();
    const checked_at = Date.now();

    const metadata: Record<string, unknown> = {
      task_id: task.task_id,
      action_type: action.action_type,
      worker_id: action.worker_id,
      blocking_check_count: blocking.length,
      warning_check_count: warnings.length,
      total_checks: checks.length,
    };

    // Record in world state
    const outcome: ValidationOutcome = {
      outcome_id,
      action_id,
      task_id: task.task_id,
      admissibility,
      reasons,
      metadata,
      conflicting_claims,
      stale_state,
      checked_at,
    };
    this.store.recordValidationOutcome(outcome);

    logger.validation({
      outcome_id,
      task_id: task.task_id,
      action_type: action.action_type,
      admissibility,
      reasons,
      conflicting_claims,
    });

    return { admissibility, reasons, metadata, conflicting_claims, stale_state, outcome_id, checked_at };
  }

  // ─── Individual Checks ──────────────────────────────────────────────────────

  private checkTaskIsActive(task: TaskPacket): CheckResult {
    if (task.status === "IN_PROGRESS" || task.status === "ASSIGNED") {
      return { passed: true, severity: "block" };
    }
    return {
      passed: false,
      severity: "block",
      reason: `Task ${task.task_id} is not active (status: ${task.status})`,
    };
  }

  private checkDependenciesSatisfied(task: TaskPacket): CheckResult {
    const unsatisfied = task.dependencies.filter((dep_id) => {
      const dep = this.store.getTask(dep_id);
      return !dep || dep.status !== "COMPLETED";
    });

    if (unsatisfied.length === 0) {
      return { passed: true, severity: "block" };
    }

    return {
      passed: false,
      severity: "block",
      reason: `Unsatisfied dependencies: ${unsatisfied.join(", ")}`,
      metadata: { unsatisfied_deps: unsatisfied },
    };
  }

  private checkForbiddenPath(path: string, task: TaskPacket): CheckResult {
    const forbidden = task.forbidden_paths.find(
      (fp) => path === fp || path.startsWith(fp + "/")
    );
    if (!forbidden) return { passed: true, severity: "block" };

    return {
      passed: false,
      severity: "block",
      reason: `Path "${path}" is in forbidden_paths for task ${task.task_id}`,
      metadata: { forbidden_pattern: forbidden },
    };
  }

  private checkAllowedPath(path: string, task: TaskPacket): CheckResult {
    if (task.allowed_paths.length === 0) return { passed: true, severity: "block" };

    const allowed = task.allowed_paths.some(
      (ap) =>
        path === ap ||
        path.startsWith(ap + "/") ||
        // Wildcard prefix match: "fixture-app/src/auth/*" matches "fixture-app/src/auth/foo.ts"
        (ap.endsWith("/*") && path.startsWith(ap.slice(0, -2) + "/"))
    );

    if (allowed) return { passed: true, severity: "block" };

    return {
      passed: false,
      severity: "block",
      reason: `Path "${path}" is outside allowed_paths for task ${task.task_id}`,
      metadata: { allowed_paths: task.allowed_paths },
    };
  }

  private checkFileOwnership(path: string, task: TaskPacket): CheckResult {
    const ownership = this.store.getFileOwner(path);
    if (!ownership) return { passed: true, severity: "block" };

    if (ownership.owner_task_id === task.task_id) {
      return { passed: true, severity: "block" }; // Own it already
    }

    if (ownership.lock_type === "exclusive") {
      return {
        passed: false,
        severity: "block",
        reason: `File "${path}" is exclusively owned by task ${ownership.owner_task_id}`,
        metadata: { owner_task_id: ownership.owner_task_id, lock_type: "exclusive" },
      };
    }

    // Shared lock — allow read but warn about concurrent writes
    return {
      passed: false,
      severity: "warn",
      reason: `File "${path}" is shared-locked by task ${ownership.owner_task_id} — concurrent edit is RISKY`,
      metadata: { owner_task_id: ownership.owner_task_id, lock_type: "shared" },
    };
  }

  private checkStaleState(path: string, task: TaskPacket): CheckResult {
    // Check if another task has recently modified this file and this task
    // hasn't acknowledged those changes (i.e., its contract versions might be stale)
    const owner = this.store.getFileOwner(path);
    if (!owner) return { passed: true, severity: "warn" };

    // Check if any of the required contracts are stale
    const staleContracts: string[] = [];
    for (const [module, required_version] of Object.entries(task.required_contract_versions)) {
      const current = this.store.getContractVersion(module);
      if (current && current.version > required_version) {
        staleContracts.push(
          `${module} (required: ${required_version}, current: ${current.version})`
        );
      }
    }

    if (staleContracts.length > 0) {
      return {
        passed: false,
        severity: "warn",
        reason: `Stale contract versions: ${staleContracts.join("; ")}`,
        metadata: { check_type: "stale_state", stale_contracts: staleContracts },
      };
    }

    return { passed: true, severity: "warn" };
  }

  private checkContractVersionSafe(
    module: string,
    new_version: number,
    task: TaskPacket
  ): CheckResult {
    const current = this.store.getContractVersion(module);

    if (!current) return { passed: true, severity: "block" }; // First definition — fine

    if (new_version < current.version) {
      return {
        passed: false,
        severity: "block",
        reason: `Contract downgrade blocked: ${module} current=${current.version}, proposed=${new_version}`,
        metadata: { module, current_version: current.version, proposed_version: new_version },
      };
    }

    if (new_version === current.version) {
      return {
        passed: false,
        severity: "warn",
        reason: `Contract version ${module}@${new_version} already registered — potential duplicate update`,
        metadata: { module, version: new_version },
      };
    }

    // Check if any other tasks require a version between current and new_version
    const tasks = this.store.getAllTasks();
    const incompatible = tasks.filter((t) => {
      if (t.task_id === task.task_id) return false;
      if (t.status === "COMPLETED" || t.status === "FAILED") return false;
      const required = t.required_contract_versions[module];
      return required !== undefined && required < new_version && required > current.version;
    });

    if (incompatible.length > 0) {
      return {
        passed: false,
        severity: "warn",
        reason: `Contract update ${module}@${new_version} may break tasks: ${incompatible.map((t) => t.task_id).join(", ")}`,
        metadata: {
          module,
          new_version,
          affected_tasks: incompatible.map((t) => t.task_id),
        },
      };
    }

    return { passed: true, severity: "block" };
  }

  private checkMergeAdmissibility(
    source_branch: string,
    target_branch: string,
    task: TaskPacket
  ): CheckResult {
    const sourceBranch = this.store.getBranch(source_branch);
    const conflicts = this.store.getUnresolvedContradictions();

    if (!sourceBranch) {
      return {
        passed: false,
        severity: "block",
        reason: `Source branch "${source_branch}" not found in world state`,
      };
    }

    if (sourceBranch.status !== "open") {
      return {
        passed: false,
        severity: "block",
        reason: `Source branch "${source_branch}" is not open (status: ${sourceBranch.status})`,
      };
    }

    if (conflicts.length > 0) {
      return {
        passed: false,
        severity: "block",
        reason: `Cannot merge: ${conflicts.length} unresolved contradictions`,
        metadata: {
          contradiction_ids: conflicts.map((c) => c.contradiction_id),
        },
      };
    }

    return { passed: true, severity: "block" };
  }

  private checkShellCommandSafety(
    command: string,
    task: TaskPacket
  ): CheckResult {
    // Block obviously dangerous patterns
    const dangerous_patterns = [
      /rm\s+-rf\s+\//,
      />\s*\/dev\/(sd|nvme|hd)/,
      /mkfs\./,
      /dd\s+.*of=\/dev/,
      /:\(\)\{.*\};:/,  // Fork bomb
      /curl.*\|\s*bash/,
      /wget.*\|\s*sh/,
    ];

    const matched = dangerous_patterns.find((p) => p.test(command));
    if (matched) {
      return {
        passed: false,
        severity: "block",
        reason: `Shell command matches dangerous pattern: ${matched}`,
        metadata: { command },
      };
    }

    // Warn about commands that write outside allowed paths
    if (command.includes("npm install") || command.includes("yarn add")) {
      return {
        passed: false,
        severity: "warn",
        reason: "Package installation modifies shared node_modules — may affect other tasks",
        metadata: { command },
      };
    }

    return { passed: true, severity: "warn" };
  }

  private checkConflictingClaims(
    action: ProposedAction,
    task: TaskPacket
  ): { check: CheckResult; conflicting_ids: string[] } {
    // Find active claims that contradict what this action asserts
    const path =
      action.action_type === "file_write" || action.action_type === "file_edit"
        ? action.path
        : action.action_type === "contract_update"
        ? `contract:${action.module}`
        : null;

    if (!path) return { check: { passed: true, severity: "warn" }, conflicting_ids: [] };

    const activeClaims = this.store.getActiveClaims(path);
    const conflicting = activeClaims.filter(
      (c) => c.source_task_id !== task.task_id
    );

    if (conflicting.length === 0) {
      return { check: { passed: true, severity: "warn" }, conflicting_ids: [] };
    }

    const conflicting_ids = conflicting.map((c) => c.claim_id);

    return {
      check: {
        passed: false,
        severity: "warn",
        reason: `Active claims on "${path}" from other tasks: ${conflicting.map((c) => c.source_task_id).join(", ")}`,
        metadata: { conflicting_claim_ids: conflicting_ids, path },
      },
      conflicting_ids,
    };
  }
}
