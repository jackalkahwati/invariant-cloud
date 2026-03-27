/**
 * Test helpers for real-database integration tests.
 *
 * Isolation strategy: true transaction rollback.
 *
 * Each test calls setupTx() in beforeEach to start a Prisma interactive
 * transaction. The test creates repos and seed data inside that transaction.
 * afterEach calls ctx.rollback() which rejects the transaction promise,
 * causing Prisma to automatically rollback — no data persists between tests.
 *
 * This is strictly stronger than truncation: parallel test workers can never
 * interfere, and no explicit table list is needed.
 */

import { PrismaClient } from '@prisma/client';
import prisma, { type DbClient } from '../../src/infrastructure/database/prisma.js';

// Re-export DbClient so test files don't need to import from the source tree
export type { DbClient };

export type TxContext = {
  tx: DbClient;
  rollback: () => void;
};

/**
 * Start a Prisma interactive transaction and return a context that exposes:
 *   ctx.tx       — the transaction client (pass to repo constructors)
 *   ctx.rollback — call in afterEach to abort the transaction
 *
 * The transaction stays open until rollback() is called. The outer
 * $transaction promise is intentionally swallowed — rollback is expected.
 */
export async function setupTx(): Promise<TxContext> {
  let tx!: DbClient;
  let rollback!: () => void;

  const started = new Promise<void>((resolveStarted) => {
    prisma.$transaction(async (txClient) => {
      tx = txClient;
      resolveStarted();
      // Hold the transaction open until teardown calls rollback()
      await new Promise<never>((_, reject) => {
        rollback = () => reject(new Error('_test_rollback_'));
      });
    }, { timeout: 30_000 }).catch(() => {
      // Expected: every test ends with a forced rollback
    });
  });

  await started;
  return { tx, rollback };
}

// ── Seed factories — all accept a DbClient so writes are inside the tx ────────

export async function createSource(
  db: DbClient,
  overrides?: Partial<{ name: string; type: 'AGENT' | 'HUMAN' | 'TOOL' | 'SYSTEM' | 'SENSOR'; trustScore: number }>,
) {
  return db.source.create({
    data: {
      name: overrides?.name ?? 'test-source',
      type: overrides?.type ?? 'SYSTEM',
      trustScore: overrides?.trustScore ?? 1.0,
    },
  });
}

export async function createEntity(
  db: DbClient,
  overrides?: Partial<{ name: string; type: string; isActive: boolean }>,
) {
  return db.entity.create({
    data: {
      name: overrides?.name ?? 'Test Entity',
      type: (overrides?.type ?? 'GENERIC') as never,
      isActive: overrides?.isActive ?? true,
    },
  });
}

export async function createClaim(
  db: DbClient,
  entityId: string,
  sourceId: string,
  overrides?: Partial<{
    predicate: string;
    value: unknown;
    status: 'ACTIVE' | 'INVALIDATED' | 'SUPERSEDED' | 'DISPUTED' | 'BRANCH_SPECIFIC';
    confidence: number;
  }>,
) {
  return db.claim.create({
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

export async function createConstraint(
  db: DbClient,
  overrides?: Partial<{ name: string; isActive: boolean }>,
) {
  return db.constraint.create({
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

/**
 * Truncate all tables once at the start of a test file to clear any data
 * left over from previous runs. Per-test isolation is handled by rollback;
 * this is only a suite-level clean slate.
 */
export async function truncateAll(): Promise<void> {
  await (prisma as PrismaClient).$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_events, action_validations, action_proposals,
      claim_provenance_edges, claim_evidence, contradictions,
      state_snapshots, policy_evaluations, approval_requests, policy_rules,
      constraint_violations, constraints, plan_steps, plans,
      trace_events, trace_sessions, claims, observations,
      dependencies, branches, entities, sources,
      workspace_api_keys, workspace_members, workspaces, users
    RESTART IDENTITY CASCADE
  `);
}

/** Disconnect the shared Prisma client — call once in afterAll. */
export async function disconnect(): Promise<void> {
  await (prisma as PrismaClient).$disconnect();
}
