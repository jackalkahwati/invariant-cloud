/**
 * Shared World State Store
 *
 * Canonical state layer for the parallel coding runtime.
 * All workers read from and write to this single source of truth
 * (with validation gating every write).
 *
 * Intentionally in-memory for the experiment — no DB dependency.
 */

import { EventEmitter } from "events";

// ─── Domain Types ────────────────────────────────────────────────────────────

export type TaskStatus =
  | "PENDING"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED";

export interface TaskDefinition {
  task_id: string;
  objective: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  dependencies: string[];
  required_contract_versions: Record<string, number>;
  acceptance_criteria: string[];
  validation_rules: string[];
  escalation_rules: string[];
  assigned_worker_id: string | null;
  status: TaskStatus;
  created_at: number;
  updated_at: number;
  completed_at?: number;
  outputs?: TaskOutput[];
  error?: string;
}

export interface TaskOutput {
  task_id: string;
  worker_id: string;
  actions_performed: ActionRecord[];
  files_modified: string[];
  contracts_updated: Record<string, number>;
  test_results: TestResult[];
  completed_at: number;
}

export interface FileOwnership {
  path: string;
  owner_task_id: string;
  claimed_at: number;
  lock_type: "exclusive" | "shared";
}

export interface Claim {
  claim_id: string;
  predicate: string;
  subject: string;
  value: unknown;
  source_task_id: string;
  confidence: number;
  created_at: number;
  superseded: boolean;
}

export interface BranchState {
  branch_id: string;
  parent_branch_id: string | null;
  task_id: string;
  created_at: number;
  merged_at?: number;
  status: "open" | "merged" | "abandoned";
}

export interface ContractVersion {
  module: string;
  version: number;
  interface_hash: string;
  defined_by_task: string;
  created_at: number;
}

export interface TestResult {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  run_at: number;
  task_id: string;
}

export interface Contradiction {
  contradiction_id: string;
  claim_a: string;
  claim_b: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  detected_at: number;
  resolved: boolean;
  resolution?: string;
}

export interface ActionRecord {
  action_id: string;
  task_id: string;
  worker_id: string;
  action_type: ActionType;
  target: string;
  params: Record<string, unknown>;
  admissibility: Admissibility;
  executed_at: number;
  result: "SUCCESS" | "BLOCKED" | "FAILED";
}

export interface ValidationOutcome {
  outcome_id: string;
  action_id: string;
  task_id: string;
  admissibility: Admissibility;
  reasons: string[];
  metadata: Record<string, unknown>;
  conflicting_claims: string[];
  stale_state: boolean;
  checked_at: number;
}

export type ActionType =
  | "file_write"
  | "file_edit"
  | "shell_command"
  | "branch_merge"
  | "test_run"
  | "contract_update";

export type Admissibility = "VALID" | "RISKY" | "BLOCKED";

// ─── Store Events ─────────────────────────────────────────────────────────────

export interface StoreEvents {
  task_created: [task: TaskDefinition];
  task_updated: [task: TaskDefinition];
  task_assigned: [task: TaskDefinition, worker_id: string];
  task_completed: [task: TaskDefinition];
  task_failed: [task: TaskDefinition, error: string];
  file_claimed: [ownership: FileOwnership];
  file_released: [path: string, task_id: string];
  claim_added: [claim: Claim];
  contradiction_detected: [contradiction: Contradiction];
  action_recorded: [action: ActionRecord];
  validation_recorded: [outcome: ValidationOutcome];
  contract_updated: [contract: ContractVersion];
}

// ─── World State Store ────────────────────────────────────────────────────────

export class WorldStateStore extends EventEmitter {
  // Core state maps
  private tasks = new Map<string, TaskDefinition>();
  private file_ownership = new Map<string, FileOwnership>();
  private claims = new Map<string, Claim>();
  private branch_states = new Map<string, BranchState>();
  private contract_versions = new Map<string, ContractVersion>();
  private test_results: TestResult[] = [];
  private contradictions = new Map<string, Contradiction>();
  private action_history: ActionRecord[] = [];
  private validation_outcomes = new Map<string, ValidationOutcome>();

  // Snapshot metadata
  private created_at = Date.now();
  private mutation_count = 0;

  // ─── Task Operations ───────────────────────────────────────────────────────

  registerTask(task: TaskDefinition): void {
    this.tasks.set(task.task_id, { ...task });
    this.mutation_count++;
    this.emit("task_created", task);
  }

  updateTaskStatus(task_id: string, status: TaskStatus, extra?: Partial<TaskDefinition>): void {
    const task = this.tasks.get(task_id);
    if (!task) throw new Error(`Task not found: ${task_id}`);
    const updated = { ...task, ...extra, status, updated_at: Date.now() };
    this.tasks.set(task_id, updated);
    this.mutation_count++;
    this.emit("task_updated", updated);
    if (status === "COMPLETED") this.emit("task_completed", updated);
  }

  assignTask(task_id: string, worker_id: string): void {
    const task = this.tasks.get(task_id);
    if (!task) throw new Error(`Task not found: ${task_id}`);
    const updated: TaskDefinition = {
      ...task,
      assigned_worker_id: worker_id,
      status: "ASSIGNED",
      updated_at: Date.now(),
    };
    this.tasks.set(task_id, updated);
    this.mutation_count++;
    this.emit("task_assigned", updated, worker_id);
  }

  getTask(task_id: string): TaskDefinition | undefined {
    return this.tasks.get(task_id);
  }

  getAllTasks(): TaskDefinition[] {
    return Array.from(this.tasks.values());
  }

  getTasksByStatus(status: TaskStatus): TaskDefinition[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === status);
  }

  getDependenciesSatisfied(task: TaskDefinition): boolean {
    return task.dependencies.every((dep_id) => {
      const dep = this.tasks.get(dep_id);
      return dep?.status === "COMPLETED";
    });
  }

  // ─── File Ownership ────────────────────────────────────────────────────────

  claimFile(path: string, task_id: string, lock_type: "exclusive" | "shared" = "exclusive"): boolean {
    const existing = this.file_ownership.get(path);
    if (existing && existing.lock_type === "exclusive" && existing.owner_task_id !== task_id) {
      return false; // Already owned exclusively by another task
    }
    if (existing && lock_type === "exclusive" && existing.owner_task_id !== task_id) {
      return false; // Can't exclusively claim a file already claimed
    }
    const ownership: FileOwnership = {
      path,
      owner_task_id: task_id,
      claimed_at: Date.now(),
      lock_type,
    };
    this.file_ownership.set(path, ownership);
    this.mutation_count++;
    this.emit("file_claimed", ownership);
    return true;
  }

  releaseFile(path: string, task_id: string): void {
    const existing = this.file_ownership.get(path);
    if (existing?.owner_task_id === task_id) {
      this.file_ownership.delete(path);
      this.mutation_count++;
      this.emit("file_released", path, task_id);
    }
  }

  releaseAllFiles(task_id: string): void {
    for (const [path, ownership] of this.file_ownership) {
      if (ownership.owner_task_id === task_id) {
        this.file_ownership.delete(path);
        this.emit("file_released", path, task_id);
      }
    }
    this.mutation_count++;
  }

  getFileOwner(path: string): FileOwnership | undefined {
    return this.file_ownership.get(path);
  }

  getAllFileOwnerships(): FileOwnership[] {
    return Array.from(this.file_ownership.values());
  }

  // ─── Claims ────────────────────────────────────────────────────────────────

  addClaim(claim: Claim): void {
    this.claims.set(claim.claim_id, { ...claim });
    this.mutation_count++;
    this.emit("claim_added", claim);
  }

  supersedeClaim(claim_id: string): void {
    const claim = this.claims.get(claim_id);
    if (claim) {
      this.claims.set(claim_id, { ...claim, superseded: true });
      this.mutation_count++;
    }
  }

  getActiveClaims(subject?: string): Claim[] {
    const all = Array.from(this.claims.values()).filter((c) => !c.superseded);
    return subject ? all.filter((c) => c.subject === subject) : all;
  }

  getClaimsByTask(task_id: string): Claim[] {
    return Array.from(this.claims.values()).filter(
      (c) => c.source_task_id === task_id && !c.superseded
    );
  }

  // ─── Branch State ──────────────────────────────────────────────────────────

  registerBranch(branch: BranchState): void {
    this.branch_states.set(branch.branch_id, { ...branch });
    this.mutation_count++;
  }

  updateBranch(branch_id: string, update: Partial<BranchState>): void {
    const branch = this.branch_states.get(branch_id);
    if (branch) {
      this.branch_states.set(branch_id, { ...branch, ...update });
      this.mutation_count++;
    }
  }

  getBranch(branch_id: string): BranchState | undefined {
    return this.branch_states.get(branch_id);
  }

  getOpenBranches(): BranchState[] {
    return Array.from(this.branch_states.values()).filter((b) => b.status === "open");
  }

  // ─── Contract Versions ─────────────────────────────────────────────────────

  updateContractVersion(contract: ContractVersion): void {
    this.contract_versions.set(contract.module, { ...contract });
    this.mutation_count++;
    this.emit("contract_updated", contract);
  }

  getContractVersion(module: string): ContractVersion | undefined {
    return this.contract_versions.get(module);
  }

  getAllContractVersions(): ContractVersion[] {
    return Array.from(this.contract_versions.values());
  }

  // ─── Test Results ──────────────────────────────────────────────────────────

  recordTestResult(result: TestResult): void {
    this.test_results.push({ ...result });
    this.mutation_count++;
  }

  getLatestTestResults(): TestResult[] {
    // Return the most recent result per suite
    const latest = new Map<string, TestResult>();
    for (const r of this.test_results) {
      const existing = latest.get(r.suite);
      if (!existing || r.run_at > existing.run_at) {
        latest.set(r.suite, r);
      }
    }
    return Array.from(latest.values());
  }

  getTestPassRate(): number {
    const latest = this.getLatestTestResults();
    if (latest.length === 0) return 1.0;
    const total_passed = latest.reduce((s, r) => s + r.passed, 0);
    const total_all = latest.reduce((s, r) => s + r.passed + r.failed, 0);
    return total_all === 0 ? 1.0 : total_passed / total_all;
  }

  // ─── Contradictions ────────────────────────────────────────────────────────

  recordContradiction(contradiction: Contradiction): void {
    this.contradictions.set(contradiction.contradiction_id, { ...contradiction });
    this.mutation_count++;
    this.emit("contradiction_detected", contradiction);
  }

  resolveContradiction(contradiction_id: string, resolution: string): void {
    const c = this.contradictions.get(contradiction_id);
    if (c) {
      this.contradictions.set(contradiction_id, { ...c, resolved: true, resolution });
      this.mutation_count++;
    }
  }

  getUnresolvedContradictions(): Contradiction[] {
    return Array.from(this.contradictions.values()).filter((c) => !c.resolved);
  }

  // ─── Action History ────────────────────────────────────────────────────────

  recordAction(action: ActionRecord): void {
    this.action_history.push({ ...action });
    this.mutation_count++;
    this.emit("action_recorded", action);
  }

  getActionHistory(task_id?: string): ActionRecord[] {
    return task_id
      ? this.action_history.filter((a) => a.task_id === task_id)
      : [...this.action_history];
  }

  getBlockedActions(): ActionRecord[] {
    return this.action_history.filter((a) => a.result === "BLOCKED");
  }

  // ─── Validation Outcomes ───────────────────────────────────────────────────

  recordValidationOutcome(outcome: ValidationOutcome): void {
    this.validation_outcomes.set(outcome.outcome_id, { ...outcome });
    this.mutation_count++;
    this.emit("validation_recorded", outcome);
  }

  getValidationOutcome(outcome_id: string): ValidationOutcome | undefined {
    return this.validation_outcomes.get(outcome_id);
  }

  // ─── Snapshot / Observability ──────────────────────────────────────────────

  snapshot(): WorldStateSnapshot {
    return {
      created_at: this.created_at,
      snapshot_at: Date.now(),
      mutation_count: this.mutation_count,
      tasks: Object.fromEntries(this.tasks),
      file_ownership: Object.fromEntries(this.file_ownership),
      claims: Object.fromEntries(this.claims),
      branch_states: Object.fromEntries(this.branch_states),
      contract_versions: Object.fromEntries(this.contract_versions),
      test_results: [...this.test_results],
      contradictions: Object.fromEntries(this.contradictions),
      action_history: [...this.action_history],
      summary: {
        total_tasks: this.tasks.size,
        completed_tasks: this.getTasksByStatus("COMPLETED").length,
        failed_tasks: this.getTasksByStatus("FAILED").length,
        blocked_tasks: this.getTasksByStatus("BLOCKED").length,
        active_file_claims: this.file_ownership.size,
        active_claims: this.getActiveClaims().length,
        unresolved_contradictions: this.getUnresolvedContradictions().length,
        blocked_actions: this.getBlockedActions().length,
        test_pass_rate: this.getTestPassRate(),
      },
    };
  }

  reset(): void {
    this.tasks.clear();
    this.file_ownership.clear();
    this.claims.clear();
    this.branch_states.clear();
    this.contract_versions.clear();
    this.test_results = [];
    this.contradictions.clear();
    this.action_history = [];
    this.validation_outcomes.clear();
    this.mutation_count = 0;
    this.created_at = Date.now();
  }
}

export interface WorldStateSnapshot {
  created_at: number;
  snapshot_at: number;
  mutation_count: number;
  tasks: Record<string, TaskDefinition>;
  file_ownership: Record<string, FileOwnership>;
  claims: Record<string, Claim>;
  branch_states: Record<string, BranchState>;
  contract_versions: Record<string, ContractVersion>;
  test_results: TestResult[];
  contradictions: Record<string, Contradiction>;
  action_history: ActionRecord[];
  summary: {
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    blocked_tasks: number;
    active_file_claims: number;
    active_claims: number;
    unresolved_contradictions: number;
    blocked_actions: number;
    test_pass_rate: number;
  };
}

// Singleton for the experiment runtime
export const globalStore = new WorldStateStore();
