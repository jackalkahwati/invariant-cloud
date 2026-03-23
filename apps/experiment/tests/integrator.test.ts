/**
 * Tests — Integrator and Repair Loop
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WorldStateStore, TaskDefinition, TaskOutput } from "../src/state/store.js";
import { Integrator } from "../src/integrator/integrator.js";
import { logger } from "../src/logger/logger.js";

logger.setSilent(true);

function makeCompletedTask(
  id: string,
  files_modified: string[],
  contracts_updated: Record<string, number> = {}
): TaskDefinition {
  const output: TaskOutput = {
    task_id: id,
    worker_id: "worker-1",
    actions_performed: [],
    files_modified,
    contracts_updated,
    test_results: [],
    completed_at: Date.now(),
  };

  return {
    task_id: id,
    objective: `Task ${id}`,
    allowed_paths: files_modified,
    forbidden_paths: [],
    dependencies: [],
    required_contract_versions: contracts_updated,
    acceptance_criteria: [],
    validation_rules: [],
    escalation_rules: [],
    assigned_worker_id: "worker-1",
    status: "COMPLETED",
    created_at: Date.now() - 1000,
    updated_at: Date.now(),
    completed_at: Date.now(),
    outputs: [output],
  };
}

describe("Integrator", () => {
  let store: WorldStateStore;
  let integrator: Integrator;

  beforeEach(() => {
    store = new WorldStateStore();
    integrator = new Integrator(store);
  });

  describe("file conflict detection", () => {
    it("detects when two tasks modified the same file", async () => {
      const t1 = makeCompletedTask("t1", ["src/routes.ts"]);
      const t2 = makeCompletedTask("t2", ["src/routes.ts"]);

      const result = await integrator.integrate([t1, t2]);

      const file_conflicts = result.conflicts_detected.filter(
        (c) => c.type === "file_overlap"
      );
      expect(file_conflicts).toHaveLength(1);
      expect(file_conflicts[0].task_ids).toContain("t1");
      expect(file_conflicts[0].task_ids).toContain("t2");
    });

    it("does not flag conflict for different files", async () => {
      const t1 = makeCompletedTask("t1", ["src/auth.ts"]);
      const t2 = makeCompletedTask("t2", ["src/roles.ts"]);

      const result = await integrator.integrate([t1, t2]);

      const file_conflicts = result.conflicts_detected.filter(
        (c) => c.type === "file_overlap"
      );
      expect(file_conflicts).toHaveLength(0);
    });
  });

  describe("contract conflict detection", () => {
    it("detects contract version mismatches across tasks", async () => {
      const t1 = makeCompletedTask("t1", ["src/auth.ts"], { "auth-contract": 2 });
      const t2 = makeCompletedTask("t2", ["src/sso.ts"], { "auth-contract": 3 });

      const result = await integrator.integrate([t1, t2]);

      const contract_conflicts = result.conflicts_detected.filter(
        (c) => c.type === "contract_mismatch"
      );
      expect(contract_conflicts.length).toBeGreaterThan(0);
    });

    it("detects stale contract requirements", async () => {
      // Register a current contract version
      store.updateContractVersion({
        module: "auth-contract",
        version: 3,
        interface_hash: "v3-hash",
        defined_by_task: "t1",
        created_at: Date.now(),
      });

      // Task requires version 2 but current is 3
      const t2 = makeCompletedTask("t2", ["src/middleware.ts"], {});
      t2.required_contract_versions = { "auth-contract": 2 };

      const result = await integrator.integrate([t2]);

      const contract_conflicts = result.conflicts_detected.filter(
        (c) => c.type === "contract_mismatch"
      );
      expect(contract_conflicts.length).toBeGreaterThan(0);
    });
  });

  describe("repair task generation", () => {
    it("generates repair task for file overlap conflicts", async () => {
      const t1 = makeCompletedTask("t1", ["src/routes.ts"]);
      const t2 = makeCompletedTask("t2", ["src/routes.ts"]);

      const result = await integrator.integrate([t1, t2]);

      expect(result.repair_tasks_generated.length).toBeGreaterThan(0);
      const repair = result.repair_tasks_generated[0];
      expect(repair.task_id).toMatch(/^repair-/);
      expect(repair.objective).toMatch(/overlap|conflict/i);
    });

    it("marks integration as failed when conflicts exist", async () => {
      const t1 = makeCompletedTask("t1", ["src/routes.ts"]);
      const t2 = makeCompletedTask("t2", ["src/routes.ts"]);

      const result = await integrator.integrate([t1, t2]);

      expect(result.success).toBe(false);
    });

    it("succeeds when tasks have no conflicts", async () => {
      store.recordTestResult({
        suite: "tests/t1",
        passed: 5,
        failed: 0,
        skipped: 0,
        run_at: Date.now(),
        task_id: "t1",
      });

      const t1 = makeCompletedTask("t1", ["src/auth.ts"]);
      const t2 = makeCompletedTask("t2", ["src/roles.ts"]);

      const result = await integrator.integrate([t1, t2]);

      expect(result.conflicts_detected.filter((c) => c.type === "file_overlap")).toHaveLength(0);
    });
  });

  describe("acceptance criteria", () => {
    it("flags low test pass rate as acceptance failure", async () => {
      store.recordTestResult({
        suite: "tests/t1",
        passed: 2,
        failed: 8,  // 20% pass rate — below 90% threshold
        skipped: 0,
        run_at: Date.now(),
        task_id: "t1",
      });

      const t1 = makeCompletedTask("t1", ["src/auth.ts"]);
      const result = await integrator.integrate([t1]);

      const acceptance_failures = result.conflicts_detected.filter(
        (c) => c.type === "acceptance_criteria_failed"
      );
      expect(acceptance_failures.length).toBeGreaterThan(0);
    });

    it("does not flag high test pass rate", async () => {
      store.recordTestResult({
        suite: "tests/t1",
        passed: 10,
        failed: 0,
        skipped: 0,
        run_at: Date.now(),
        task_id: "t1",
      });

      const t1 = makeCompletedTask("t1", ["src/auth.ts"]);
      const result = await integrator.integrate([t1]);

      const acceptance_failures = result.conflicts_detected.filter(
        (c) => c.type === "acceptance_criteria_failed"
      );
      expect(acceptance_failures).toHaveLength(0);
    });
  });

  describe("contradiction recording", () => {
    it("records claim contradictions in the store", async () => {
      // Add competing claims for the same subject from different tasks
      store.addClaim({
        claim_id: "c1",
        predicate: "implements",
        subject: "SSO",
        value: { version: "v1" },
        source_task_id: "t1",
        confidence: 0.9,
        created_at: Date.now(),
        superseded: false,
      });
      store.addClaim({
        claim_id: "c2",
        predicate: "implements",
        subject: "SSO",
        value: { version: "v2" },
        source_task_id: "t2",
        confidence: 0.9,
        created_at: Date.now(),
        superseded: false,
      });

      const t1 = makeCompletedTask("t1", ["src/auth.ts"]);
      const t2 = makeCompletedTask("t2", ["src/sso.ts"]);
      store.registerTask(t1);
      store.registerTask(t2);

      await integrator.integrate([t1, t2]);

      const contradictions = store.getUnresolvedContradictions();
      expect(contradictions.length).toBeGreaterThan(0);
    });
  });
});
