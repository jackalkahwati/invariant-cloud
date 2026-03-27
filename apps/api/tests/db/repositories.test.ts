/**
 * Real-database integration tests for Prisma repository implementations.
 *
 * Requires: DATABASE_URL set to a live PostgreSQL instance with migrations applied.
 * Run: npm run test:db
 *
 * Isolation: each test starts with truncateAll() — every table is wiped.
 * Verifies the actual SQL queries, filter logic, FK relationships, and status
 * transitions that mocked-DB route tests cannot catch.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  truncateAll, testPrisma,
  createSource, createEntity, createClaim, createConstraint,
} from './helpers.js';
import { PrismaEntityRepository } from '../../src/infrastructure/database/repositories/EntityRepository.js';
import { PrismaClaimRepository } from '../../src/infrastructure/database/repositories/ClaimRepository.js';
import { PrismaContradictionRepository } from '../../src/infrastructure/database/repositories/ContradictionRepository.js';
import { PrismaConstraintRepository } from '../../src/infrastructure/database/repositories/ConstraintRepository.js';

const entityRepo = new PrismaEntityRepository();
const claimRepo = new PrismaClaimRepository();
const contradictionRepo = new PrismaContradictionRepository();
const constraintRepo = new PrismaConstraintRepository();

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

// ── EntityRepository ──────────────────────────────────────────────────────────

describe('PrismaEntityRepository', () => {
  it('create and findById returns the entity', async () => {
    const entity = await entityRepo.create({
      name: 'Thruster A', type: 'COMPONENT', isActive: true,
      description: null, metadata: null,
    });
    const found = await entityRepo.findById(entity.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Thruster A');
  });

  it('findById returns null for unknown id', async () => {
    const found = await entityRepo.findById('non-existent-id');
    expect(found).toBeNull();
  });

  it('findAll returns all entities', async () => {
    await entityRepo.create({ name: 'A', type: 'GENERIC', isActive: true, description: null, metadata: null });
    await entityRepo.create({ name: 'B', type: 'GENERIC', isActive: true, description: null, metadata: null });
    const all = await entityRepo.findAll();
    expect(all).toHaveLength(2);
  });

  it('findAll with isActive filter excludes soft-deleted entities', async () => {
    await entityRepo.create({ name: 'Active', type: 'GENERIC', isActive: true, description: null, metadata: null });
    await entityRepo.create({ name: 'Inactive', type: 'GENERIC', isActive: false, description: null, metadata: null });
    const active = await entityRepo.findAll({ isActive: true });
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('Active');
  });

  it('delete soft-deletes by setting isActive=false', async () => {
    const entity = await entityRepo.create({ name: 'ToDelete', type: 'GENERIC', isActive: true, description: null, metadata: null });
    await entityRepo.delete(entity.id);
    const active = await entityRepo.findAll({ isActive: true });
    expect(active.find(e => e.id === entity.id)).toBeUndefined();
    // Record still exists
    const found = await entityRepo.findById(entity.id);
    expect(found).not.toBeNull();
  });

  it('update persists field changes', async () => {
    const entity = await entityRepo.create({ name: 'Old Name', type: 'GENERIC', isActive: true, description: null, metadata: null });
    await entityRepo.update(entity.id, { name: 'New Name' });
    const updated = await entityRepo.findById(entity.id);
    expect(updated!.name).toBe('New Name');
  });
});

// ── ClaimRepository ───────────────────────────────────────────────────────────

describe('PrismaClaimRepository', () => {
  it('findAll with status filter excludes non-matching claims', async () => {
    const entity = await createEntity();
    const source = await createSource();
    await createClaim(entity.id, source.id, { status: 'ACTIVE' });
    await createClaim(entity.id, source.id, { status: 'INVALIDATED' });

    const active = await claimRepo.findAll({ status: 'ACTIVE' });
    expect(active).toHaveLength(1);
    expect(active[0]!.status).toBe('ACTIVE');
  });

  it('findActive returns only ACTIVE claims for an entity', async () => {
    const entity = await createEntity();
    const source = await createSource();
    await createClaim(entity.id, source.id, { predicate: 'mass', status: 'ACTIVE' });
    await createClaim(entity.id, source.id, { predicate: 'status', status: 'SUPERSEDED' });

    const active = await claimRepo.findActive(entity.id);
    expect(active).toHaveLength(1);
    expect(active[0]!.predicate).toBe('mass');
  });

  it('findActive scoped by predicate returns matching claim only', async () => {
    const entity = await createEntity();
    const source = await createSource();
    await createClaim(entity.id, source.id, { predicate: 'mass' });
    await createClaim(entity.id, source.id, { predicate: 'status' });

    const result = await claimRepo.findActive(entity.id, 'mass');
    expect(result).toHaveLength(1);
    expect(result[0]!.predicate).toBe('mass');
  });

  it('invalidate sets status to INVALIDATED', async () => {
    const entity = await createEntity();
    const source = await createSource();
    const claim = await createClaim(entity.id, source.id, { status: 'ACTIVE' });

    await claimRepo.invalidate(claim.id);
    const found = await claimRepo.findById(claim.id);
    expect(found!.status).toBe('INVALIDATED');
  });

  it('supersede sets status and links supersededBy', async () => {
    const entity = await createEntity();
    const source = await createSource();
    const old = await createClaim(entity.id, source.id, { predicate: 'status', value: 'NOMINAL' });
    const newer = await createClaim(entity.id, source.id, { predicate: 'status', value: 'DEGRADED' });

    await claimRepo.supersede(old.id, newer.id);
    const found = await claimRepo.findById(old.id);
    expect(found!.status).toBe('SUPERSEDED');
    expect(found!.supersededBy).toBe(newer.id);
  });

  it('countActive reflects only active claims', async () => {
    const entity = await createEntity();
    const source = await createSource();
    await createClaim(entity.id, source.id, { status: 'ACTIVE' });
    await createClaim(entity.id, source.id, { status: 'ACTIVE' });
    await createClaim(entity.id, source.id, { status: 'INVALIDATED' });

    const count = await claimRepo.countActive();
    expect(count).toBe(2);
  });
});

// ── ContradictionRepository ───────────────────────────────────────────────────

describe('PrismaContradictionRepository', () => {
  async function seedContradiction(status: 'OPEN' | 'RESOLVED' | 'BRANCHED' = 'OPEN') {
    const entity = await createEntity();
    const source = await createSource();
    const claimA = await createClaim(entity.id, source.id, { predicate: 'mass', value: 100 });
    const claimB = await createClaim(entity.id, source.id, { predicate: 'mass', value: 200 });
    const contradiction = await contradictionRepo.create({
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
    const { contradiction } = await seedContradiction();
    const found = await contradictionRepo.findById(contradiction.id);
    expect(found).not.toBeNull();
    expect(found!.score).toBe(0.9);
    expect(found!.claimA).toBeDefined();
    expect(found!.claimB).toBeDefined();
  });

  it('findAll without filter returns all contradictions', async () => {
    await seedContradiction('OPEN');
    await seedContradiction('RESOLVED');
    const all = await contradictionRepo.findAll();
    expect(all).toHaveLength(2);
  });

  it('findAll with OPEN status excludes resolved contradictions', async () => {
    await seedContradiction('OPEN');
    await seedContradiction('RESOLVED');
    const open = await contradictionRepo.findAll('OPEN');
    expect(open).toHaveLength(1);
    expect(open[0]!.status).toBe('OPEN');
  });

  it('findForClaims finds contradiction in either direction', async () => {
    const { contradiction, claimA, claimB } = await seedContradiction();

    const forward = await contradictionRepo.findForClaims(claimA.id, claimB.id);
    expect(forward!.id).toBe(contradiction.id);

    const reverse = await contradictionRepo.findForClaims(claimB.id, claimA.id);
    expect(reverse!.id).toBe(contradiction.id);
  });

  it('findForClaims returns null for unrelated claims', async () => {
    const entity = await createEntity();
    const source = await createSource();
    const c1 = await createClaim(entity.id, source.id);
    const c2 = await createClaim(entity.id, source.id);
    const result = await contradictionRepo.findForClaims(c1.id, c2.id);
    expect(result).toBeNull();
  });

  it('countOpen reflects only open contradictions', async () => {
    await seedContradiction('OPEN');
    await seedContradiction('OPEN');
    await seedContradiction('RESOLVED');
    const count = await contradictionRepo.countOpen();
    expect(count).toBe(2);
  });

  it('update changes status to RESOLVED', async () => {
    const { contradiction } = await seedContradiction('OPEN');
    await contradictionRepo.update(contradiction.id, { status: 'RESOLVED', resolution: 'manual' });
    const found = await contradictionRepo.findById(contradiction.id);
    expect(found!.status).toBe('RESOLVED');
    expect(found!.resolution).toBe('manual');
  });
});

// ── ConstraintRepository ──────────────────────────────────────────────────────

describe('PrismaConstraintRepository', () => {
  it('findAll(true) returns only active constraints', async () => {
    await createConstraint({ name: 'Active', isActive: true });
    await createConstraint({ name: 'Inactive', isActive: false });
    const active = await constraintRepo.findAll(true);
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('Active');
  });

  it('findAll() without arg returns all constraints', async () => {
    await createConstraint({ isActive: true });
    await createConstraint({ isActive: false });
    const all = await constraintRepo.findAll();
    expect(all).toHaveLength(2);
  });

  it('createViolation and findActiveViolations returns the violation', async () => {
    const constraint = await createConstraint();
    const entity = await createEntity();

    await constraintRepo.createViolation({
      constraintId: constraint.id,
      entityIds: [entity.id],
      claimIds: [],
      severity: 0.8,
      description: 'test violation',
      isActive: true,
    });

    const violations = await constraintRepo.findActiveViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]!.constraintId).toBe(constraint.id);
    expect(violations[0]!.severity).toBe(0.8);
  });

  it('deactivateViolations sets isActive=false for matching entity', async () => {
    const constraint = await createConstraint();
    const entity = await createEntity();

    await constraintRepo.createViolation({
      constraintId: constraint.id,
      entityIds: [entity.id],
      claimIds: [],
      severity: 0.5,
      description: 'will be deactivated',
      isActive: true,
    });

    await constraintRepo.deactivateViolations(constraint.id, [entity.id]);
    const violations = await constraintRepo.findActiveViolations();
    expect(violations).toHaveLength(0);
  });

  it('deactivateViolations does not affect violations for other entities', async () => {
    const constraint = await createConstraint();
    const entityA = await createEntity({ name: 'A' });
    const entityB = await createEntity({ name: 'B' });

    await constraintRepo.createViolation({
      constraintId: constraint.id,
      entityIds: [entityA.id],
      claimIds: [],
      severity: 0.5,
      description: 'A violation',
      isActive: true,
    });
    await constraintRepo.createViolation({
      constraintId: constraint.id,
      entityIds: [entityB.id],
      claimIds: [],
      severity: 0.5,
      description: 'B violation',
      isActive: true,
    });

    await constraintRepo.deactivateViolations(constraint.id, [entityA.id]);
    const remaining = await constraintRepo.findActiveViolations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.entityIds).toContain(entityB.id);
  });

  it('countActiveViolations returns correct count', async () => {
    const constraint = await createConstraint();
    const entity = await createEntity();

    await constraintRepo.createViolation({
      constraintId: constraint.id, entityIds: [entity.id],
      claimIds: [], severity: 0.5, description: 'v1', isActive: true,
    });
    await constraintRepo.createViolation({
      constraintId: constraint.id, entityIds: [entity.id],
      claimIds: [], severity: 0.7, description: 'v2', isActive: true,
    });

    expect(await constraintRepo.countActiveViolations()).toBe(2);
  });
});
