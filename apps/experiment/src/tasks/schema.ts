/**
 * Task Packet Schema
 *
 * Defines the canonical schema for bounded task packets.
 * Every unit of work in the parallel runtime is a TaskPacket.
 * Workers may only act within the bounds declared in their packet.
 */

import { z } from "zod";

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const TaskStatusSchema = z.enum([
  "PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
]);

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  // How to verify this criterion: test name, file existence, etc.
  verification_type: z.enum(["test_pass", "file_exists", "no_contradictions", "manual"]),
  verification_target: z.string().optional(),
});

export const ValidationRuleSchema = z.object({
  rule_id: z.string(),
  description: z.string(),
  rule_type: z.enum([
    "no_forbidden_path_write",
    "dependency_satisfied",
    "contract_version_match",
    "no_overlapping_ownership",
    "no_conflicting_claims",
    "stale_state_check",
  ]),
  params: z.record(z.unknown()).optional(),
});

export const EscalationRuleSchema = z.object({
  rule_id: z.string(),
  trigger: z.enum([
    "max_retries_exceeded",
    "unresolvable_conflict",
    "critical_contradiction",
    "dependency_cycle",
    "contract_downgrade",
  ]),
  action: z.enum(["notify_orchestrator", "block_task", "escalate_to_human", "abort_all"]),
  max_retries: z.number().optional(),
});

export const TaskPacketSchema = z.object({
  // Identity
  task_id: z.string(),
  parent_objective_id: z.string().optional(),

  // What to do
  objective: z.string(),
  feature: z.string(), // High-level feature name (e.g., "SSO", "AuditLogging")

  // Scope boundaries
  allowed_paths: z.array(z.string()),
  forbidden_paths: z.array(z.string()),

  // Dependency graph
  dependencies: z.array(z.string()), // task_ids that must complete first

  // Contract requirements
  required_contract_versions: z.record(z.number()),

  // Verification
  acceptance_criteria: z.array(AcceptanceCriterionSchema),
  validation_rules: z.array(ValidationRuleSchema),
  escalation_rules: z.array(EscalationRuleSchema),

  // Assignment
  assigned_worker_id: z.string().nullable(),
  status: TaskStatusSchema,

  // Timing
  created_at: z.number(),
  updated_at: z.number(),
  completed_at: z.number().optional(),

  // Priority (lower = higher priority)
  priority: z.number().default(5),

  // Retry tracking
  retry_count: z.number().default(0),
  max_retries: z.number().default(3),
});

export type TaskPacket = z.infer<typeof TaskPacketSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export type ValidationRule = z.infer<typeof ValidationRuleSchema>;
export type EscalationRule = z.infer<typeof EscalationRuleSchema>;

// ─── Action Schemas ───────────────────────────────────────────────────────────

export const ActionTypeSchema = z.enum([
  "file_write",
  "file_edit",
  "shell_command",
  "branch_merge",
  "test_run",
  "contract_update",
]);

export const ProposedActionSchema = z.discriminatedUnion("action_type", [
  z.object({
    action_type: z.literal("file_write"),
    task_id: z.string(),
    worker_id: z.string(),
    path: z.string(),
    content: z.string(),
    reason: z.string(),
  }),
  z.object({
    action_type: z.literal("file_edit"),
    task_id: z.string(),
    worker_id: z.string(),
    path: z.string(),
    diff_description: z.string(),
    reason: z.string(),
  }),
  z.object({
    action_type: z.literal("shell_command"),
    task_id: z.string(),
    worker_id: z.string(),
    command: z.string(),
    working_dir: z.string(),
    reason: z.string(),
  }),
  z.object({
    action_type: z.literal("branch_merge"),
    task_id: z.string(),
    worker_id: z.string(),
    source_branch: z.string(),
    target_branch: z.string(),
    reason: z.string(),
  }),
  z.object({
    action_type: z.literal("test_run"),
    task_id: z.string(),
    worker_id: z.string(),
    suite: z.string(),
    reason: z.string(),
  }),
  z.object({
    action_type: z.literal("contract_update"),
    task_id: z.string(),
    worker_id: z.string(),
    module: z.string(),
    new_version: z.number(),
    interface_hash: z.string(),
    reason: z.string(),
  }),
]);

export type ProposedAction = z.infer<typeof ProposedActionSchema>;

// ─── Task Factory Helpers ─────────────────────────────────────────────────────

let _task_counter = 0;

export function makeTaskId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_task_counter}`;
}

export function createTaskPacket(
  partial: Omit<TaskPacket, "task_id" | "status" | "created_at" | "updated_at" | "retry_count"> &
    Partial<Pick<TaskPacket, "task_id" | "status" | "created_at" | "updated_at" | "retry_count">>
): TaskPacket {
  const now = Date.now();
  return TaskPacketSchema.parse({
    task_id: partial.task_id ?? makeTaskId(partial.feature.toLowerCase().replace(/\s+/g, "-")),
    status: partial.status ?? "PENDING",
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
    retry_count: partial.retry_count ?? 0,
    ...partial,
  });
}

// ─── Benchmark Scenario: Enterprise Feature Tasks ─────────────────────────────

/**
 * Returns the canonical set of task packets for the benchmark scenario:
 * "Add enterprise SSO, audit logging, and admin role management to a realistic web app"
 *
 * Each feature is broken into sub-tasks with explicit file scopes.
 * Some tasks intentionally share files to create realistic integration challenges.
 */
export function createBenchmarkTaskPackets(objective_id: string): TaskPacket[] {
  const now = Date.now();

  const base = (
    id: string,
    feature: string,
    objective: string,
    allowed: string[],
    forbidden: string[],
    deps: string[],
    contracts: Record<string, number>
  ): TaskPacket =>
    createTaskPacket({
      task_id: id,
      parent_objective_id: objective_id,
      feature,
      objective,
      allowed_paths: allowed,
      forbidden_paths: forbidden,
      dependencies: deps,
      required_contract_versions: contracts,
      acceptance_criteria: [
        {
          id: `${id}-ac-1`,
          description: `All tests pass after completing ${id}`,
          verification_type: "test_pass",
          verification_target: `tests/${id}`,
        },
      ],
      validation_rules: [
        {
          rule_id: `${id}-vr-1`,
          description: "No writes to forbidden paths",
          rule_type: "no_forbidden_path_write",
        },
        {
          rule_id: `${id}-vr-2`,
          description: "Dependencies must be satisfied",
          rule_type: "dependency_satisfied",
        },
        {
          rule_id: `${id}-vr-3`,
          description: "No overlapping file ownership",
          rule_type: "no_overlapping_ownership",
        },
      ],
      escalation_rules: [
        {
          rule_id: `${id}-er-1`,
          trigger: "max_retries_exceeded",
          action: "notify_orchestrator",
          max_retries: 3,
        },
        {
          rule_id: `${id}-er-2`,
          trigger: "unresolvable_conflict",
          action: "escalate_to_human",
        },
      ],
      assigned_worker_id: null,
      priority: 5,
      max_retries: 3,
      created_at: now,
      updated_at: now,
    });

  return [
    // ── SSO Feature ───────────────────────────────────────────────────────────
    base(
      "sso-provider",
      "SSO",
      "Implement SAML/OIDC provider adapter and token exchange logic",
      [
        "fixture-app/src/auth/sso-provider.ts",
        "fixture-app/src/auth/token-exchange.ts",
        "fixture-app/src/auth/types.ts",
      ],
      ["fixture-app/src/routes.ts", "fixture-app/src/app.ts"],
      [],
      { "auth-contract": 1 }
    ),

    base(
      "sso-middleware",
      "SSO",
      "Add SSO middleware to route authentication and update auth.ts",
      [
        "fixture-app/src/auth/middleware.ts",
        "fixture-app/src/auth/auth.ts",
      ],
      ["fixture-app/src/routes.ts"],
      ["sso-provider"],
      { "auth-contract": 2, "middleware-contract": 1 }
    ),

    base(
      "sso-routes",
      "SSO",
      "Add /auth/sso/* routes for SSO callback and session initiation",
      [
        "fixture-app/src/routes.ts",
        "fixture-app/src/auth/sso-routes.ts",
      ],
      ["fixture-app/src/app.ts"],
      ["sso-middleware"],
      { "auth-contract": 2, "routes-contract": 2 }
    ),

    // ── Audit Logging Feature ─────────────────────────────────────────────────
    base(
      "audit-logger",
      "AuditLogging",
      "Implement structured audit logger with sink abstraction",
      [
        "fixture-app/src/audit/logger.ts",
        "fixture-app/src/audit/sinks.ts",
        "fixture-app/src/audit/types.ts",
      ],
      ["fixture-app/src/routes.ts", "fixture-app/src/app.ts"],
      [],
      { "audit-contract": 1 }
    ),

    base(
      "audit-middleware",
      "AuditLogging",
      "Add request audit middleware — wraps all routes to emit audit events",
      [
        "fixture-app/src/audit/middleware.ts",
        "fixture-app/src/auth/auth.ts",
      ],
      [],
      ["audit-logger"],
      { "audit-contract": 2, "middleware-contract": 1 }
    ),

    base(
      "audit-routes",
      "AuditLogging",
      "Expose /audit/* admin API for querying audit logs",
      [
        "fixture-app/src/routes.ts",
        "fixture-app/src/audit/audit-routes.ts",
      ],
      [],
      ["audit-middleware"],
      { "audit-contract": 2, "routes-contract": 2 }
    ),

    // ── Admin Role Management Feature ─────────────────────────────────────────
    base(
      "roles-schema",
      "AdminRoles",
      "Define role hierarchy, permissions matrix, and role assignment types",
      [
        "fixture-app/src/roles/schema.ts",
        "fixture-app/src/roles/permissions.ts",
        "fixture-app/src/roles/types.ts",
      ],
      ["fixture-app/src/routes.ts", "fixture-app/src/app.ts"],
      [],
      { "roles-contract": 1 }
    ),

    base(
      "roles-enforcement",
      "AdminRoles",
      "Implement role enforcement guard and attach to auth middleware",
      [
        "fixture-app/src/roles/guard.ts",
        "fixture-app/src/auth/auth.ts",
      ],
      [],
      ["roles-schema", "sso-middleware"],
      { "roles-contract": 2, "auth-contract": 2, "middleware-contract": 1 }
    ),

    base(
      "admin-routes",
      "AdminRoles",
      "Add /admin/* routes for user role management (assign, revoke, list)",
      [
        "fixture-app/src/routes.ts",
        "fixture-app/src/roles/admin-routes.ts",
      ],
      [],
      ["roles-enforcement", "audit-middleware"],
      { "roles-contract": 2, "audit-contract": 2, "routes-contract": 2 }
    ),

    // ── Integration Task ───────────────────────────────────────────────────────
    base(
      "integration-wiring",
      "Integration",
      "Wire all three features into the main app entrypoint and run full test suite",
      [
        "fixture-app/src/app.ts",
        "fixture-app/src/routes.ts",
        "fixture-app/tests/integration.test.ts",
      ],
      [],
      ["sso-routes", "audit-routes", "admin-routes"],
      { "auth-contract": 2, "audit-contract": 2, "roles-contract": 2, "routes-contract": 2 }
    ),
  ];
}

// ─── V3 Optimized Task Fixture ────────────────────────────────────────────────

/**
 * Optimized benchmark task packets for V3.
 *
 * Key difference from V1/V2 fixture:
 *   Each feature writes to its own dedicated route and auth fragment file.
 *   The integration-wiring task (already last in the DAG) aggregates the fragments.
 *
 * This eliminates ALL hot-file contention between parallel feature tasks:
 *   - No two feature tasks compete for routes.ts
 *   - No two feature tasks compete for auth.ts
 *   - Blocked actions drop to 0 in parallel mode
 *   - Merge conflicts drop to 0 in the feature phase
 *   - Repair loop becomes trivially fast
 *
 * The dependency DAG is identical to V1/V2 — only file paths change.
 */
export function createOptimizedTaskPackets(objective_id: string): TaskPacket[] {
  const now = Date.now();

  const base = (
    id: string,
    feature: string,
    objective: string,
    allowed: string[],
    forbidden: string[],
    deps: string[],
    contracts: Record<string, number>
  ): TaskPacket =>
    createTaskPacket({
      task_id: id,
      parent_objective_id: objective_id,
      feature,
      objective,
      allowed_paths: allowed,
      forbidden_paths: forbidden,
      dependencies: deps,
      required_contract_versions: contracts,
      acceptance_criteria: [
        {
          id: `${id}-ac-1`,
          description: `All tests pass after completing ${id}`,
          verification_type: "test_pass",
          verification_target: `tests/${id}`,
        },
      ],
      validation_rules: [
        {
          rule_id: `${id}-vr-1`,
          description: "No writes to forbidden paths",
          rule_type: "no_forbidden_path_write",
        },
        {
          rule_id: `${id}-vr-2`,
          description: "Dependencies must be satisfied",
          rule_type: "dependency_satisfied",
        },
        {
          rule_id: `${id}-vr-3`,
          description: "No overlapping file ownership",
          rule_type: "no_overlapping_ownership",
        },
      ],
      escalation_rules: [
        {
          rule_id: `${id}-er-1`,
          trigger: "max_retries_exceeded",
          action: "notify_orchestrator",
          max_retries: 3,
        },
        {
          rule_id: `${id}-er-2`,
          trigger: "unresolvable_conflict",
          action: "escalate_to_human",
        },
      ],
      assigned_worker_id: null,
      priority: 5,
      max_retries: 3,
      created_at: now,
      updated_at: now,
    });

  // Shared aggregator files — only integration-wiring may write these
  const AGGREGATOR_FORBIDDEN = [
    "fixture-app/src/routes.ts",
    "fixture-app/src/auth/auth.ts",
    "fixture-app/src/app.ts",
  ];

  return [
    // ── SSO Feature ───────────────────────────────────────────────────────────
    // sso-provider: unchanged — already uses unique paths
    base(
      "sso-provider",
      "SSO",
      "Implement SAML/OIDC provider adapter and token exchange logic",
      [
        "fixture-app/src/auth/sso-provider.ts",
        "fixture-app/src/auth/token-exchange.ts",
        "fixture-app/src/auth/types.ts",
      ],
      AGGREGATOR_FORBIDDEN,
      [],
      { "auth-contract": 1 }
    ),

    // sso-middleware: feature-local auth extension (no longer writes auth.ts)
    base(
      "sso-middleware",
      "SSO",
      "Add SSO middleware — writes to feature-local sso.ts extension module",
      [
        "fixture-app/src/auth/middleware.ts",
        "fixture-app/src/auth/extensions/sso.ts",  // ← V3: feature-local, not auth.ts
      ],
      AGGREGATOR_FORBIDDEN,
      ["sso-provider"],
      { "auth-contract": 2, "middleware-contract": 1 }
    ),

    // sso-routes: feature-local route fragment (no longer writes routes.ts)
    base(
      "sso-routes",
      "SSO",
      "Add SSO route fragment — writes to feature-local sso.routes.ts",
      [
        "fixture-app/src/routes/sso.routes.ts",    // ← V3: feature-local, not routes.ts
        "fixture-app/src/auth/sso-routes.ts",
      ],
      AGGREGATOR_FORBIDDEN,
      ["sso-middleware"],
      { "auth-contract": 2, "routes-contract": 2 }
    ),

    // ── Audit Logging Feature ─────────────────────────────────────────────────
    base(
      "audit-logger",
      "AuditLogging",
      "Implement structured audit logger with sink abstraction",
      [
        "fixture-app/src/audit/logger.ts",
        "fixture-app/src/audit/sinks.ts",
        "fixture-app/src/audit/types.ts",
      ],
      AGGREGATOR_FORBIDDEN,
      [],
      { "audit-contract": 1 }
    ),

    // audit-middleware: feature-local auth extension (no longer writes auth.ts)
    base(
      "audit-middleware",
      "AuditLogging",
      "Add audit middleware — writes to feature-local audit.ts extension module",
      [
        "fixture-app/src/audit/middleware.ts",
        "fixture-app/src/auth/extensions/audit.ts",  // ← V3: feature-local, not auth.ts
      ],
      AGGREGATOR_FORBIDDEN,
      ["audit-logger"],
      { "audit-contract": 2, "middleware-contract": 1 }
    ),

    // audit-routes: feature-local route fragment (no longer writes routes.ts)
    base(
      "audit-routes",
      "AuditLogging",
      "Add audit route fragment — writes to feature-local audit.routes.ts",
      [
        "fixture-app/src/routes/audit.routes.ts",   // ← V3: feature-local, not routes.ts
        "fixture-app/src/audit/audit-routes.ts",
      ],
      AGGREGATOR_FORBIDDEN,
      ["audit-middleware"],
      { "audit-contract": 2, "routes-contract": 2 }
    ),

    // ── Admin Role Management Feature ─────────────────────────────────────────
    base(
      "roles-schema",
      "AdminRoles",
      "Define role hierarchy, permissions matrix, and role assignment types",
      [
        "fixture-app/src/roles/schema.ts",
        "fixture-app/src/roles/permissions.ts",
        "fixture-app/src/roles/types.ts",
      ],
      AGGREGATOR_FORBIDDEN,
      [],
      { "roles-contract": 1 }
    ),

    // roles-enforcement: already uses unique guard.ts — no change needed
    base(
      "roles-enforcement",
      "AdminRoles",
      "Implement role enforcement guard — writes to feature-local guard.ts",
      [
        "fixture-app/src/roles/guard.ts",
        "fixture-app/src/auth/extensions/admin.ts",  // ← V3: feature-local, not auth.ts
      ],
      AGGREGATOR_FORBIDDEN,
      ["roles-schema", "sso-middleware"],
      { "roles-contract": 2, "auth-contract": 2, "middleware-contract": 1 }
    ),

    // admin-routes: feature-local route fragment (no longer writes routes.ts)
    base(
      "admin-routes",
      "AdminRoles",
      "Add admin route fragment — writes to feature-local admin.routes.ts",
      [
        "fixture-app/src/routes/admin.routes.ts",   // ← V3: feature-local, not routes.ts
        "fixture-app/src/roles/admin-routes.ts",
      ],
      AGGREGATOR_FORBIDDEN,
      ["roles-enforcement", "audit-middleware"],
      { "roles-contract": 2, "audit-contract": 2, "routes-contract": 2 }
    ),

    // ── Integration Task ───────────────────────────────────────────────────────
    // integration-wiring: aggregates all feature fragments into shared files
    // It is the ONLY task allowed to write routes.ts and auth.ts
    base(
      "integration-wiring",
      "Integration",
      "Aggregate feature route/auth fragments into app entrypoint and run full test suite",
      [
        "fixture-app/src/app.ts",
        "fixture-app/src/routes.ts",           // Aggregates sso/audit/admin route fragments
        "fixture-app/src/auth/auth.ts",        // Aggregates sso/audit/admin auth extensions
        "fixture-app/tests/integration.test.ts",
      ],
      [],  // Integration task has no forbidden paths — it is the aggregator
      ["sso-routes", "audit-routes", "admin-routes"],
      { "auth-contract": 2, "audit-contract": 2, "roles-contract": 2, "routes-contract": 2 }
    ),
  ];
}
