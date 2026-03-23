/**
 * Tests — World State Store
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WorldStateStore, TaskDefinition, Claim, ContractVersion } from "../src/state/store.js";

function makeTask(id: string, status: TaskDefinition["status"] = "PENDING"): TaskDefinition {
  return {
    task_id: id,
    objective: `Test task ${id}`,
    allowed_paths: [`src/${id}.ts`],
    forbidden_paths: ["src/protected.ts"],
    dependencies: [],
    required_contract_versions: {},
    acceptance_criteria: [],
    validation_rules: [],
    escalation_rules: [],
    assigned_worker_id: null,
    status,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

describe("WorldStateStore", () => {
  let store: WorldStateStore;

  beforeEach(() => {
    store = new WorldStateStore();
  });

  // ─── Task Operations ────────────────────────────────────────────────────────

  describe("tasks", () => {
    it("registers and retrieves tasks", () => {
      const task = makeTask("t1");
      store.registerTask(task);
      expect(store.getTask("t1")).toMatchObject({ task_id: "t1", status: "PENDING" });
    });

    it("updates task status", () => {
      store.registerTask(makeTask("t1"));
      store.updateTaskStatus("t1", "COMPLETED");
      expect(store.getTask("t1")?.status).toBe("COMPLETED");
    });

    it("filters tasks by status", () => {
      store.registerTask(makeTask("t1", "PENDING"));
      store.registerTask(makeTask("t2", "COMPLETED"));
      store.registerTask(makeTask("t3", "PENDING"));

      expect(store.getTasksByStatus("PENDING")).toHaveLength(2);
      expect(store.getTasksByStatus("COMPLETED")).toHaveLength(1);
    });

    it("checks dependency satisfaction", () => {
      store.registerTask(makeTask("dep1"));
      const task = makeTask("t1");
      task.dependencies = ["dep1"];
      store.registerTask(task);

      // dep not satisfied yet
      expect(store.getDependenciesSatisfied(task)).toBe(false);

      // satisfy dep
      store.updateTaskStatus("dep1", "COMPLETED");
      expect(store.getDependenciesSatisfied(task)).toBe(true);
    });

    it("emits task_created event", () => {
      const events: string[] = [];
      store.on("task_created", (t) => events.push(t.task_id));
      store.registerTask(makeTask("t1"));
      expect(events).toContain("t1");
    });

    it("throws when updating unknown task", () => {
      expect(() => store.updateTaskStatus("nope", "COMPLETED")).toThrow("Task not found");
    });
  });

  // ─── File Ownership ─────────────────────────────────────────────────────────

  describe("file ownership", () => {
    it("claims a file exclusively", () => {
      const ok = store.claimFile("src/auth.ts", "task-1");
      expect(ok).toBe(true);
      expect(store.getFileOwner("src/auth.ts")?.owner_task_id).toBe("task-1");
    });

    it("blocks a second exclusive claim on the same file", () => {
      store.claimFile("src/auth.ts", "task-1", "exclusive");
      const ok = store.claimFile("src/auth.ts", "task-2", "exclusive");
      expect(ok).toBe(false);
    });

    it("allows the same task to re-claim its own file", () => {
      store.claimFile("src/auth.ts", "task-1");
      const ok = store.claimFile("src/auth.ts", "task-1");
      expect(ok).toBe(true);
    });

    it("releases file ownership", () => {
      store.claimFile("src/auth.ts", "task-1");
      store.releaseFile("src/auth.ts", "task-1");
      expect(store.getFileOwner("src/auth.ts")).toBeUndefined();
    });

    it("releases all files for a task", () => {
      store.claimFile("src/a.ts", "task-1");
      store.claimFile("src/b.ts", "task-1");
      store.claimFile("src/c.ts", "task-2");
      store.releaseAllFiles("task-1");
      expect(store.getFileOwner("src/a.ts")).toBeUndefined();
      expect(store.getFileOwner("src/b.ts")).toBeUndefined();
      expect(store.getFileOwner("src/c.ts")).toBeDefined();
    });
  });

  // ─── Claims ─────────────────────────────────────────────────────────────────

  describe("claims", () => {
    it("stores and retrieves active claims", () => {
      const claim: Claim = {
        claim_id: "c1",
        predicate: "implements",
        subject: "SSO",
        value: { done: true },
        source_task_id: "task-1",
        confidence: 0.9,
        created_at: Date.now(),
        superseded: false,
      };
      store.addClaim(claim);

      const active = store.getActiveClaims("SSO");
      expect(active).toHaveLength(1);
      expect(active[0].claim_id).toBe("c1");
    });

    it("supersedes claims", () => {
      const claim: Claim = {
        claim_id: "c1",
        predicate: "implements",
        subject: "SSO",
        value: { done: false },
        source_task_id: "task-1",
        confidence: 0.9,
        created_at: Date.now(),
        superseded: false,
      };
      store.addClaim(claim);
      store.supersedeClaim("c1");
      expect(store.getActiveClaims("SSO")).toHaveLength(0);
    });
  });

  // ─── Contract Versions ──────────────────────────────────────────────────────

  describe("contract versions", () => {
    it("stores and retrieves contract versions", () => {
      const cv: ContractVersion = {
        module: "auth-contract",
        version: 2,
        interface_hash: "abc123",
        defined_by_task: "task-1",
        created_at: Date.now(),
      };
      store.updateContractVersion(cv);
      expect(store.getContractVersion("auth-contract")?.version).toBe(2);
    });

    it("overwrites with newer version", () => {
      store.updateContractVersion({
        module: "auth-contract",
        version: 1,
        interface_hash: "v1",
        defined_by_task: "task-1",
        created_at: Date.now(),
      });
      store.updateContractVersion({
        module: "auth-contract",
        version: 2,
        interface_hash: "v2",
        defined_by_task: "task-2",
        created_at: Date.now(),
      });
      expect(store.getContractVersion("auth-contract")?.version).toBe(2);
    });
  });

  // ─── Test Results ────────────────────────────────────────────────────────────

  describe("test results", () => {
    it("computes pass rate from latest results", () => {
      store.recordTestResult({
        suite: "auth.test",
        passed: 8,
        failed: 2,
        skipped: 0,
        run_at: Date.now(),
        task_id: "t1",
      });
      store.recordTestResult({
        suite: "roles.test",
        passed: 5,
        failed: 0,
        skipped: 1,
        run_at: Date.now(),
        task_id: "t2",
      });
      // (8+5) / (8+2+5+0) = 13/15 ≈ 0.867
      expect(store.getTestPassRate()).toBeCloseTo(13 / 15, 3);
    });

    it("uses latest result per suite", () => {
      const now = Date.now();
      store.recordTestResult({ suite: "auth.test", passed: 3, failed: 7, skipped: 0, run_at: now - 100, task_id: "t1" });
      store.recordTestResult({ suite: "auth.test", passed: 10, failed: 0, skipped: 0, run_at: now, task_id: "t1" });
      expect(store.getTestPassRate()).toBe(1.0);
    });
  });

  // ─── Snapshot ────────────────────────────────────────────────────────────────

  describe("snapshot", () => {
    it("captures complete world state", () => {
      store.registerTask(makeTask("t1", "COMPLETED"));
      store.registerTask(makeTask("t2", "PENDING"));
      store.claimFile("src/auth.ts", "t1");

      const snap = store.snapshot();
      expect(snap.summary.total_tasks).toBe(2);
      expect(snap.summary.completed_tasks).toBe(1);
      expect(snap.summary.active_file_claims).toBe(1);
    });
  });
});
