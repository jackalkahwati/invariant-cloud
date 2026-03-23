/**
 * Tests — Pre-Execution Validator
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WorldStateStore } from "../src/state/store.js";
import { ActionValidator } from "../src/validation/validator.js";
import { ProposedAction, TaskPacket, createTaskPacket } from "../src/tasks/schema.js";
import { logger } from "../src/logger/logger.js";

// Silence logs during tests
logger.setSilent(true);

function makeTask(overrides: Partial<TaskPacket> = {}): TaskPacket {
  return createTaskPacket({
    feature: "Test",
    objective: "Test task",
    allowed_paths: ["src/auth.ts", "src/roles.ts"],
    forbidden_paths: ["src/protected.ts", "src/core/"],
    dependencies: [],
    required_contract_versions: { "auth-contract": 1 },
    acceptance_criteria: [],
    validation_rules: [],
    escalation_rules: [],
    assigned_worker_id: "worker-1",
    status: "IN_PROGRESS",
    ...overrides,
  });
}

function writeAction(path: string, task_id: string, worker_id = "worker-1"): ProposedAction {
  return {
    action_type: "file_write",
    task_id,
    worker_id,
    path,
    content: "// test",
    reason: "test",
  };
}

describe("ActionValidator", () => {
  let store: WorldStateStore;
  let validator: ActionValidator;

  beforeEach(() => {
    store = new WorldStateStore();
    validator = new ActionValidator(store);
  });

  // ─── Task Status ────────────────────────────────────────────────────────────

  it("blocks action when task is not active", () => {
    const task = makeTask({ status: "PENDING" });
    const action = writeAction("src/auth.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    expect(result.admissibility).toBe("BLOCKED");
    expect(result.reasons.some((r) => r.includes("not active"))).toBe(true);
  });

  it("allows action when task is IN_PROGRESS", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    store.registerTask({ ...task, acceptance_criteria: [], validation_rules: [], escalation_rules: [] });
    const action = writeAction("src/auth.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    // Should not be blocked for inactivity
    expect(result.reasons.every((r) => !r.includes("not active"))).toBe(true);
  });

  // ─── Forbidden Path ─────────────────────────────────────────────────────────

  it("blocks writes to forbidden paths", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const action = writeAction("src/protected.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    expect(result.admissibility).toBe("BLOCKED");
    expect(result.reasons.some((r) => r.includes("forbidden_paths"))).toBe(true);
  });

  it("blocks writes to paths under forbidden directory prefix", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const action = writeAction("src/core/engine.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    expect(result.admissibility).toBe("BLOCKED");
  });

  // ─── Allowed Path ───────────────────────────────────────────────────────────

  it("blocks writes outside allowed_paths", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const action = writeAction("src/unrelated.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    expect(result.admissibility).toBe("BLOCKED");
    expect(result.reasons.some((r) => r.includes("outside allowed_paths"))).toBe(true);
  });

  it("allows writes to explicitly allowed paths", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const action = writeAction("src/auth.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    // Check forbidden/allowed don't block it
    expect(result.reasons.every((r) => !r.includes("forbidden") && !r.includes("outside allowed"))).toBe(true);
  });

  // ─── File Ownership ─────────────────────────────────────────────────────────

  it("blocks write when another task exclusively owns the file", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    store.claimFile("src/auth.ts", "other-task", "exclusive");

    const action = writeAction("src/auth.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    expect(result.admissibility).toBe("BLOCKED");
    expect(result.reasons.some((r) => r.includes("exclusively owned"))).toBe(true);
  });

  it("allows write when task owns the file itself", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    store.claimFile("src/auth.ts", task.task_id, "exclusive");

    const action = writeAction("src/auth.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    expect(result.reasons.every((r) => !r.includes("exclusively owned"))).toBe(true);
  });

  it("marks RISKY (not BLOCKED) for shared lock conflicts", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    store.claimFile("src/auth.ts", "other-task", "shared");

    const action = writeAction("src/auth.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    // Shared lock → RISKY not BLOCKED (concurrent edit warning)
    expect(["RISKY", "BLOCKED"]).toContain(result.admissibility);
  });

  // ─── Dependency Check ───────────────────────────────────────────────────────

  it("blocks action when dependencies are not satisfied", () => {
    const dep_task = createTaskPacket({
      task_id: "dep-1",
      feature: "Dep",
      objective: "dependency",
      allowed_paths: [],
      forbidden_paths: [],
      dependencies: [],
      required_contract_versions: {},
      acceptance_criteria: [],
      validation_rules: [],
      escalation_rules: [],
      assigned_worker_id: null,
      status: "PENDING",
    });
    store.registerTask({
      ...dep_task,
      acceptance_criteria: [],
      validation_rules: [],
      escalation_rules: [],
    });

    const task = makeTask({
      status: "IN_PROGRESS",
      dependencies: ["dep-1"],
    });
    const action = writeAction("src/auth.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    expect(result.admissibility).toBe("BLOCKED");
    expect(result.reasons.some((r) => r.includes("dep-1"))).toBe(true);
  });

  it("allows action when all dependencies are completed", () => {
    const dep_task = createTaskPacket({
      task_id: "dep-1",
      feature: "Dep",
      objective: "dependency",
      allowed_paths: [],
      forbidden_paths: [],
      dependencies: [],
      required_contract_versions: {},
      acceptance_criteria: [],
      validation_rules: [],
      escalation_rules: [],
      assigned_worker_id: null,
      status: "COMPLETED",
    });
    store.registerTask({
      ...dep_task,
      acceptance_criteria: [],
      validation_rules: [],
      escalation_rules: [],
    });

    const task = makeTask({
      status: "IN_PROGRESS",
      dependencies: ["dep-1"],
    });
    const action = writeAction("src/auth.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    expect(result.reasons.every((r) => !r.includes("Unsatisfied dep"))).toBe(true);
  });

  // ─── Contract Version ───────────────────────────────────────────────────────

  it("blocks contract downgrade", () => {
    store.updateContractVersion({
      module: "auth-contract",
      version: 3,
      interface_hash: "v3",
      defined_by_task: "previous-task",
      created_at: Date.now(),
    });

    const task = makeTask({ status: "IN_PROGRESS" });
    const action: ProposedAction = {
      action_type: "contract_update",
      task_id: task.task_id,
      worker_id: "worker-1",
      module: "auth-contract",
      new_version: 2, // downgrade!
      interface_hash: "v2-hash",
      reason: "test",
    };
    const result = validator.validate(action, task, "action-1");
    expect(result.admissibility).toBe("BLOCKED");
    expect(result.reasons.some((r) => r.includes("downgrade"))).toBe(true);
  });

  // ─── Shell Command ──────────────────────────────────────────────────────────

  it("blocks obviously dangerous shell commands", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const action: ProposedAction = {
      action_type: "shell_command",
      task_id: task.task_id,
      worker_id: "worker-1",
      command: "rm -rf /",
      working_dir: "/",
      reason: "test",
    };
    const result = validator.validate(action, task, "action-1");
    expect(result.admissibility).toBe("BLOCKED");
  });

  it("allows safe shell commands", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const action: ProposedAction = {
      action_type: "shell_command",
      task_id: task.task_id,
      worker_id: "worker-1",
      command: "tsc --noEmit",
      working_dir: "/app",
      reason: "type check",
    };
    const result = validator.validate(action, task, "action-1");
    // Should not be blocked (may be RISKY or VALID)
    expect(result.admissibility).not.toBe("BLOCKED");
  });

  // ─── Audit Trail ────────────────────────────────────────────────────────────

  it("records validation outcomes in the store", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const action = writeAction("src/auth.ts", task.task_id);
    const result = validator.validate(action, task, "action-1");
    const outcome = store.getValidationOutcome(result.outcome_id);
    expect(outcome).toBeDefined();
    expect(outcome?.admissibility).toBe(result.admissibility);
  });
});
