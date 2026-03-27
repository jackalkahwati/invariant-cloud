/**
 * Real-database integration tests for Prisma repository implementations.
 *
 * Isolation: true transaction rollback per test (see helpers.ts).
 * Each test gets a fresh transaction that is always rolled back in afterEach —
 * no data ever persists between tests, no truncation needed.
 *
 * Run: npm run test:db  (requires DATABASE_URL pointing at a live PostgreSQL instance)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import {
  setupTx, truncateAll, disconnect,
  createSource, createEntity, createClaim, createConstraint,
  type TxContext,
} from './helpers.js';
import { PrismaEntityRepository } from '../../src/infrastructure/database/repositories/EntityRepository.js';
import { PrismaClaimRepository } from '../../src/infrastructure/database/repositories/ClaimRepository.js';
import { PrismaContradictionRepository } from '../../src/infrastructure/database/repositories/ContradictionRepository.js';
import { PrismaConstraintRepository } from '../../src/infrastructure/database/repositories/ConstraintRepository.js';

let ctx: TxContext;

beforeAll(async () => { await truncateAll(); });

beforeEach(async () => {
  ctx = await setupTx();
});

afterEach(() => {
  ctx.rollback();
});

afterAll(async () => {
  await disconnect();
});

// ── EntityRepository ──────────────────────────────────────────────────────────

describe('PrismaEntityRepository', () => {
  it('create and findById returns the entity', async () => {
    const repo = new PrismaEntityRepository(ctx.tx);
    const entity = await repo.create({
      name: 'Thruster A', type: 'COMPONENT', isActive: true,
      description: null, metadata: null,
    });
    const found = await repo.findById(entity.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Thruster A');
  });

  it('findById returns null for unknown id', async () => {
    const repo = new PrismaEntityRepository(ctx.tx);
    expect(await repo.findById('non-existent-id')).toBeNull();
  });

  it('findAll returns all entities', async () => {
    const repo = new PrismaEntityRepository(ctx.tx);
    await repo.create({ name: 'A', type: 'GENERIC', isActive: true, description: null, metadata: null });
    await repo.create({ name: 'B', type: 'GENERIC', isActive: true, description: null, metadata: null });
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it('findAll with isActive filter excludes soft-deleted entities', async () => {
    const repo = new PrismaEntityRepository(ctx.tx);
    await repo.create({ name: 'Active', type: 'GENERIC', isActive: true, description: null, metadata: null });
    await repo.create({ name: 'Inactive', type: 'GENERIC', isActive: false, description: null, metadata: null });
    const active = await repo.findAll({ isActive: true });
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('Active');
  });

  it('delete soft-deletes by setting isActive=false', async () => {
    const repo = new PrismaEntityRepository(ctx.tx);
    const entity = await repo.create({ name: 'ToDelete', type: 'GENERIC', isActive: true, description: null, metadata: null });
    await repo.delete(entity.id);
    const active = await repo.findAll({ isActive: true });
    expect(active.find(e => e.id === entity.id)).toBeUndefined();
    expect(await repo.findById(entity.id)).not.toBeNull();
  });

  it('update persists field changes', async () => {
    const repo = new PrismaEntityRepository(ctx.tx);
    const entity = await repo.create({ name: 'Old Name', type: 'GENERIC', isActive: true, description: null, metadata: null });
    await repo.update(entity.id, { name: 'New Name' });
    const updated = await repo.findById(entity.id);
    expect(updated!.name).toBe('New Name');
  });
});

// ── ClaimRepository ───────────────────────────────────────────────────────────

describe('PrismaClaimRepository', () => {
  it('findAll with status filter excludes non-matching claims', async () => {
    const repo = new PrismaClaimRepository(ctx.tx);
    const entity = await createEntity(ctx.tx);
    const source = await createSource(ctx.tx);
    await createClaim(ctx.tx, entity.id, source.id, { status: 'ACTIVE' });
    await createClaim(ctx.tx, entity.id, source.id, { status: 'INVALIDATED' });

    const active = await repo.findAll({ status: 'ACTIVE' });
    expect(active).toHaveLength(1);
    expect(active[0]!.status).toBe('ACTIVE');
  });

  it('findActive returns only ACTIVE claims for an entity', async () => {
    const repo = new PrismaClaimRepository(ctx.tx);
    const entity = await createEntity(ctx.tx);
    const source = await createSource(ctx.tx);
    await createClaim(ctx.tx, entity.id, source.id, { predicate: 'mass', status: 'ACTIVE' });
    await createClaim(ctx.tx, entity.id, source.id, { predicate: 'status', status: 'SUPERSEDED' });

    const active = await repo.findActive(entity.id);
    expect(active).toHaveLength(1);
    expect(active[0]!.predicate).toBe('mass');
  });

  it('findActive scoped by predicate returns matching claim only', async () => {
    const repo = new PrismaClaimRepository(ctx.tx);
    const entity = await createEntity(ctx.tx);
    const source = await createSource(ctx.tx);
    await createClaim(ctx.tx, entity.id, source.id, { predicate: 'mass' });
    await createClaim(ctx.tx, entity.id, source.id, { predicate: 'status' });

    const result = await repo.findActive(entity.id, 'mass');
    expect(result).toHaveLength(1);
    expect(result[0]!.predicate).toBe('mass');
  });

  it('invalidate sets status to INVALIDATED', async () => {
    const repo = new PrismaClaimRepository(ctx.tx);
    const entity = await createEntity(ctx.tx);
    const source = await createSource(ctx.tx);
    const claim = await createClaim(ctx.tx, entity.id, source.id, { status: 'ACTIVE' });

    await repo.invalidate(claim.id);
    const found = await repo.findById(claim.id);
    expect(found!.status).toBe('INVALIDATED');
  });

  it('supersede sets status and links supersededBy', async () => {
    const repo = new PrismaClaimRepository(ctx.tx);
    const entity = await createEntity(ctx.tx);
    const source = await createSource(ctx.tx);
    const old = await createClaim(ctx.tx, entity.id, source.id, { predicate: 'status', value: 'NOMINAL' });
    const newer = await createClaim(ctx.tx, entity.id, source.id, { predicate: 'status', value: 'DEGRADED' });

    await repo.supersede(old.id, newer.id);
    const found = await repo.findById(old.id);
    expect(found!.status).toBe('SUPERSEDED');
    expect(found!.supersededBy).toBe(newer.id);
  });

  it('countActive reflects only active claims', async () => {
    const repo = new PrismaClaimRepository(ctx.tx);
    const entity = await createEntity(ctx.tx);
    const source = await createSource(ctx.tx);
    await createClaim(ctx.tx, entity.id, source.id, { status: 'ACTIVE' });
    await createClaim(ctx.tx, entity.id, source.id, { status: 'ACTIVE' });
    await createClaim(ctx.tx, entity.id, source.id, { status: 'INVALIDATED' });

    expect(await repo.countActive()).toBe(2);
  });
});

// ── ContradictionRepository ───────────────────────────────────────────────────

describe('PrismaContradictionRepository', () => {
  async function seedContradiction(status: 'OPEN' | 'RESOLVED' | 'BRANCHED' = 'OPEN') {
    const entity = await createEntity(ctx.tx);
    const source = await createSource(ctx.tx);
    const claimA = await createClaim(ctx.tx, entity.id, source.id, { predicate: 'mass', value: 100 });
    const claimB = await createClaim(ctx.tx, entity.id, source.id, { predicate: 'mass', value: 200 });
    const repo = new PrismaContradictionRepository(ctx.tx);
    const contradiction = await repo.create({
      claimAId: claimA.id,
      claimBId: claimB.id,
      score: 0.9,
      severity: 'HIGH',
      type: 'NUMERIC_CONFLICT',
      status,
      branchId: null,
      resolution: null,
      description: 'conflicting mass values',
    });
    return { contradiction, claimA, claimB };
  }

  it('create and findById returns the contradiction with claims', async () => {
    const repo = new PrismaContradictionRepository(ctx.tx);
    const { contradiction } = await seedContradiction();
    const found = await repo.findById(contradiction.id);
    expect(found).not.toBeNull();
    expect(found!.score).toBe(0.9);
    expect(found!.claimA).toBeDefined();
  });

  it('findAll without filter returns all contradictions', async () => {
    const repo = new PrismaContradictionRepository(ctx.tx);
    await seedContradiction('OPEN');
    await seedContradiction('RESOLVED');
    expect(await repo.findAll()).toHaveLength(2);
  });

  it('findAll with OPEN status excludes resolved contradictions', async () => {
    const repo = new PrismaContradictionRepository(ctx.tx);
    await seedContradiction('OPEN');
    await seedContradiction('RESOLVED');
    const open = await repo.findAll('OPEN');
    expect(open).toHaveLength(1);
    expect(open[0]!.status).toBe('OPEN');
  });

  it('findForClaims finds contradiction in either direction', async () => {
    const repo = new PrismaContradictionRepository(ctx.tx);
    const { contradiction, claimA, claimB } = await seedContradiction();
    expect((await repo.findForClaims(claimA.id, claimB.id))!.id).toBe(contradiction.id);
    expect((await repo.findForClaims(claimB.id, claimA.id))!.id).toBe(contradiction.id);
  });

  it('findForClaims returns null for unrelated claims', async () => {
    const repo = new PrismaContradictionRepository(ctx.tx);
    const entity = await createEntity(ctx.tx);
    const source = await createSource(ctx.tx);
    const c1 = await createClaim(ctx.tx, entity.id, source.id);
    const c2 = await createClaim(ctx.tx, entity.id, source.id);
    expect(await repo.findForClaims(c1.id, c2.id)).toBeNull();
  });

  it('countOpen reflects only open contradictions', async () => {
    const repo = new PrismaContradictionRepository(ctx.tx);
    await seedContradiction('OPEN');
    await seedContradiction('OPEN');
    await seedContradiction('RESOLVED');
    expect(await repo.countOpen()).toBe(2);
  });

  it('update changes status to RESOLVED', async () => {
    const repo = new PrismaContradictionRepository(ctx.tx);
    const { contradiction } = await seedContradiction('OPEN');
    await repo.update(contradiction.id, { status: 'RESOLVED', resolution: 'manual' });
    const found = await repo.findById(contradiction.id);
    expect(found!.status).toBe('RESOLVED');
    expect(found!.resolution).toBe('manual');
  });
});

// ── ConstraintRepository ──────────────────────────────────────────────────────

describe('PrismaConstraintRepository', () => {
  it('findAll(true) returns only active constraints', async () => {
    const repo = new PrismaConstraintRepository(ctx.tx);
    await createConstraint(ctx.tx, { name: 'Active', isActive: true });
    await createConstraint(ctx.tx, { name: 'Inactive', isActive: false });
    const active = await repo.findAll(true);
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('Active');
  });

  it('findAll() without arg returns all constraints', async () => {
    const repo = new PrismaConstraintRepository(ctx.tx);
    await createConstraint(ctx.tx, { isActive: true });
    await createConstraint(ctx.tx, { isActive: false });
    expect(await repo.findAll()).toHaveLength(2);
  });

  it('createViolation and findActiveViolations returns the violation', async () => {
    const repo = new PrismaConstraintRepository(ctx.tx);
    const constraint = await createConstraint(ctx.tx);
    const entity = await createEntity(ctx.tx);
    await repo.createViolation({
      constraintId: constraint.id, entityIds: [entity.id],
      claimIds: [], severity: 0.8, description: 'test violation', isActive: true,
    });
    const violations = await repo.findActiveViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe(0.8);
  });

  it('deactivateViolations sets isActive=false for matching entity', async () => {
    const repo = new PrismaConstraintRepository(ctx.tx);
    const constraint = await createConstraint(ctx.tx);
    const entity = await createEntity(ctx.tx);
    await repo.createViolation({
      constraintId: constraint.id, entityIds: [entity.id],
      claimIds: [], severity: 0.5, description: 'will be deactivated', isActive: true,
    });
    await repo.deactivateViolations(constraint.id, [entity.id]);
    expect(await repo.findActiveViolations()).toHaveLength(0);
  });

  it('deactivateViolations does not affect violations for other entities', async () => {
    const repo = new PrismaConstraintRepository(ctx.tx);
    const constraint = await createConstraint(ctx.tx);
    const entityA = await createEntity(ctx.tx, { name: 'A' });
    const entityB = await createEntity(ctx.tx, { name: 'B' });
    await repo.createViolation({ constraintId: constraint.id, entityIds: [entityA.id], claimIds: [], severity: 0.5, description: 'A', isActive: true });
    await repo.createViolation({ constraintId: constraint.id, entityIds: [entityB.id], claimIds: [], severity: 0.5, description: 'B', isActive: true });
    await repo.deactivateViolations(constraint.id, [entityA.id]);
    const remaining = await repo.findActiveViolations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.entityIds).toContain(entityB.id);
  });

  it('countActiveViolations returns correct count', async () => {
    const repo = new PrismaConstraintRepository(ctx.tx);
    const constraint = await createConstraint(ctx.tx);
    const entity = await createEntity(ctx.tx);
    await repo.createViolation({ constraintId: constraint.id, entityIds: [entity.id], claimIds: [], severity: 0.5, description: 'v1', isActive: true });
    await repo.createViolation({ constraintId: constraint.id, entityIds: [entity.id], claimIds: [], severity: 0.7, description: 'v2', isActive: true });
    expect(await repo.countActiveViolations()).toBe(2);
  });
});
