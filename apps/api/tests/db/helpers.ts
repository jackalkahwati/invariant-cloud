/**
 * Test helpers for real-database integration tests.
 *
 * Uses a dedicated PrismaClient so tests don't interfere with the
 * module-level singleton used by the application.
 *
 * Isolation strategy: truncate all tables before each test.
 * Each test starts from a clean slate; no transaction rollback needed.
 */

import { PrismaClient } from '@prisma/client';

export const testPrisma = new PrismaClient({
  log: [],
  datasources: {
    db: { url: process.env['DATABASE_URL'] },
  },
});

/**
 * Truncate every table in dependency order.
 * RESTART IDENTITY resets sequences; CASCADE handles FK chains.
 */
export async function truncateAll(): Promise<void> {
  await testPrisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_events,
      action_validations,
      action_proposals,
      claim_provenance_edges,
      claim_evidence,
      contradictions,
      state_snapshots,
      policy_evaluations,
      approval_requests,
      policy_rules,
      constraint_violations,
      constraints,
      plan_steps,
      plans,
      trace_events,
      trace_sessions,
      claims,
      observations,
      dependencies,
      branches,
      entities,
      sources,
      workspace_api_keys,
      workspace_members,
      workspaces,
      users
    RESTART IDENTITY CASCADE
  `);
}

// ── Seed factories ────────────────────────────────────────────────────────────

export async function createSource(overrides?: Partial<{
  name: string; type: 'AGENT' | 'HUMAN' | 'TOOL' | 'SYSTEM' | 'SENSOR'; trustScore: number;
}>) {
  return testPrisma.source.create({
    data: {
      name: overrides?.name ?? 'test-source',
      type: overrides?.type ?? 'SYSTEM',
      trustScore: overrides?.trustScore ?? 1.0,
    },
  });
}

export async function createEntity(overrides?: Partial<{
  name: string; type: string; isActive: boolean;
}>) {
  return testPrisma.entity.create({
    data: {
      name: overrides?.name ?? 'Test Entity',
      type: (overrides?.type ?? 'GENERIC') as never,
      isActive: overrides?.isActive ?? true,
    },
  });
}

export async function createClaim(
  entityId: string,
  sourceId: string,
  overrides?: Partial<{
    predicate: string;
    value: unknown;
    status: 'ACTIVE' | 'INVALIDATED' | 'SUPERSEDED' | 'DISPUTED' | 'BRANCH_SPECIFIC';
    confidence: number;
  }>,
) {
  return testPrisma.claim.create({
    data: {
      entityId,
      sourceId,
      predicate: overrides?.predicate ?? 'status',
      value: (overrides?.value ?? 'NOMINAL') as never,
      status: (overrides?.status ?? 'ACTIVE') as never,
      confidence: overrides?.confidence ?? 1.0,
      timestamp: new Date(),
    },
  });
}

export async function createConstraint(overrides?: Partial<{
  name: string; isActive: boolean;
}>) {
  return testPrisma.constraint.create({
    data: {
      name: overrides?.name ?? 'Test Constraint',
      description: 'Test constraint description',
      type: 'CUSTOM',
      expression: { rule: 'test' } as never,
      entityIds: [],
      weight: 1.0,
      isActive: overrides?.isActive ?? true,
    },
  });
}
