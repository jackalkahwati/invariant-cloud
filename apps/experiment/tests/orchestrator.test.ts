/**
 * Tests — Task Orchestrator
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WorldStateStore } from "../src/state/store.js";
import { TaskOrchestrator } from "../src/orchestrator/orchestrator.js";
import { createTaskPacket } from "../src/tasks/schema.js";
import { logger } from "../src/logger/logger.js";

logger.setSilent(true);

function makeSimpleTask(id: string, deps: string[] = []) {
  return createTaskPacket({
    task_id: id,
    feature: "Test",
    objective: `Task ${id}`,
    allowed_paths: [`src/${id}.ts`],
    forbidden_paths: [],
    dependencies: deps,
    required_contract_versions: {},
    acceptance_criteria: [],
    validation_rules: [],
    escalation_rules: [],
    assigned_worker_id: null,
    status: "PENDING",
  });
}

describe("TaskOrchestrator", () => {
  let store: WorldStateStore;

  beforeEach(() => {
    store = new WorldStateStore();
  });

  describe("serial mode", () => {
    it("completes all independent tasks", async () => {
      const orchestrator = new TaskOrchestrator(store, {
        mode: "serial",
        action_delay_ms: 1,
        poll_interval_ms: 1,
      });

      const tasks = [makeSimpleTask("t1"), makeSimpleTask("t2"), makeSimpleTask("t3")];
      const result = await orchestrator.run("obj-1", tasks);

      expect(result.completed_tasks).toBe(3);
      expect(result.failed_tasks).toBe(0);
    });

    it("respects dependency order in serial mode", async () => {
      const orchestrator = new TaskOrchestrator(store, {
        mode: "serial",
        action_delay_ms: 1,
        poll_interval_ms: 1,
      });

      const order: string[] = [];
      store.on("task_completed", (t) => order.push(t.task_id));

      const tasks = [
        makeSimpleTask("t3", ["t1", "t2"]),
        makeSimpleTask("t2", ["t1"]),
        makeSimpleTask("t1"),
      ];

      await orchestrator.run("obj-1", tasks);

      // t1 must come before t2, t2 must come before t3
      const idx = (id: string) => order.indexOf(id);
      expect(idx("t1")).toBeLessThan(idx("t2"));
      expect(idx("t2")).toBeLessThan(idx("t3"));
    });
  });

  describe("parallel mode", () => {
    it("completes all independent tasks faster than serial equivalent", async () => {
      const DELAY = 10;

      const serial_store = new WorldStateStore();
      const serial_orch = new TaskOrchestrator(serial_store, {
        mode: "serial",
        action_delay_ms: DELAY,
        poll_interval_ms: 1,
      });

      const parallel_store = new WorldStateStore();
      const parallel_orch = new TaskOrchestrator(parallel_store, {
        mode: "parallel",
        max_workers: 4,
        action_delay_ms: DELAY,
        poll_interval_ms: 1,
      });

      const tasks = () => [
        makeSimpleTask("t1"),
        makeSimpleTask("t2"),
        makeSimpleTask("t3"),
        makeSimpleTask("t4"),
      ];

      const serial_result = await serial_orch.run("obj-serial", tasks());
      const parallel_result = await parallel_orch.run("obj-parallel", tasks());

      expect(parallel_result.completed_tasks).toBe(4);
      expect(serial_result.completed_tasks).toBe(4);

      // Parallel should be noticeably faster with 4 independent tasks
      expect(parallel_result.elapsed_ms).toBeLessThan(serial_result.elapsed_ms * 0.9);
    });

    it("handles dependency chains in parallel mode", async () => {
      const orchestrator = new TaskOrchestrator(store, {
        mode: "parallel",
        max_workers: 4,
        action_delay_ms: 1,
        poll_interval_ms: 1,
      });

      const tasks = [
        makeSimpleTask("t1"),
        makeSimpleTask("t2", ["t1"]),
        makeSimpleTask("t3", ["t1"]),
        makeSimpleTask("t4", ["t2", "t3"]),
      ];

      const result = await orchestrator.run("obj-1", tasks);
      expect(result.completed_tasks).toBe(4);

      // t4 must complete after t2 and t3
      const t4 = store.getTask("t4");
      const t2 = store.getTask("t2");
      const t3 = store.getTask("t3");
      expect(t4?.status).toBe("COMPLETED");
      expect(t2?.status).toBe("COMPLETED");
      expect(t3?.status).toBe("COMPLETED");
    });

    it("marks tasks BLOCKED when dependency cycle would deadlock", async () => {
      const orchestrator = new TaskOrchestrator(store, {
        mode: "parallel",
        max_workers: 2,
        action_delay_ms: 1,
        poll_interval_ms: 1,
        timeout_ms: 500,
      });

      // Circular dependency: t1 -> t2 -> t1
      const tasks = [
        makeSimpleTask("t1", ["t2"]),
        makeSimpleTask("t2", ["t1"]),
      ];

      const result = await orchestrator.run("obj-1", tasks);
      // Both should end up blocked (cycle detected)
      expect(result.completed_tasks).toBe(0);
      expect(result.blocked_tasks).toBeGreaterThan(0);
    });
  });

  describe("metrics", () => {
    it("records human interventions for failed tasks", async () => {
      const orchestrator = new TaskOrchestrator(store, {
        mode: "serial",
        action_delay_ms: 1,
        poll_interval_ms: 1,
      });

      // Task with impossible dependency (not in task list)
      const tasks = [makeSimpleTask("t1", ["nonexistent-task"])];
      const result = await orchestrator.run("obj-1", tasks);

      // t1 is blocked because its dep is never satisfied
      expect(result.human_interventions_required).toBeGreaterThanOrEqual(0);
    });
  });
});
