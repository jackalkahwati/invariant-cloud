/**
 * Real-database integration tests — remaining repositories.
 *
 * Covers: Source, Branch, Dependency, Audit, Action, Observation,
 *         Snapshot, Policy, Trace, Plan
 *
 * Requires: DATABASE_URL pointing at a live PostgreSQL instance.
 * Run: npm run test:db
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  truncateAll, testPrisma,
  createSource, createEntity, createClaim, createConstraint,
} from './helpers.js';
import { PrismaSourceRepository } from '../../src/infrastructure/database/repositories/SourceRepository.js';
import { PrismaBranchRepository } from '../../src/infrastructure/database/repositories/BranchRepository.js';
import { PrismaDependencyRepository } from '../../src/infrastructure/database/repositories/DependencyRepository.js';
import { PrismaAuditRepository } from '../../src/infrastructure/database/repositories/AuditRepository.js';
import { PrismaActionRepository } from '../../src/infrastructure/database/repositories/ActionRepository.js';
import { PrismaObservationRepository } from '../../src/infrastructure/database/repositories/ObservationRepository.js';
import { PrismaSnapshotRepository } from '../../src/infrastructure/database/repositories/SnapshotRepository.js';
import { PrismaPolicyRepository } from '../../src/infrastructure/database/repositories/PolicyRepository.js';
import { PrismaTraceRepository } from '../../src/infrastructure/database/repositories/TraceRepository.js';
import { PrismaPlanRepository } from '../../src/infrastructure/database/repositories/PlanRepository.js';

const sourceRepo = new PrismaSourceRepository();
const branchRepo = new PrismaBranchRepository();
const depRepo = new PrismaDependencyRepository();
const auditRepo = new PrismaAuditRepository();
const actionRepo = new PrismaActionRepository();
const observationRepo = new PrismaObservationRepository();
const snapshotRepo = new PrismaSnapshotRepository();
const policyRepo = new PrismaPolicyRepository();
const traceRepo = new PrismaTraceRepository();
const planRepo = new PrismaPlanRepository();

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

// ── SourceRepository ──────────────────────────────────────────────────────────

describe('PrismaSourceRepository', () => {
  it('create and findById returns source', async () => {
    const source = await sourceRepo.create({ name: 'radar', type: 'SENSOR', trustScore: 0.9, isActive: true } as never);
    const found = await sourceRepo.findById(source.id);
    expect(found!.name).toBe('radar');
    expect(found!.trustScore).toBe(0.9);
  });

  it('findAll returns all sources ordered by createdAt desc', async () => {
    await sourceRepo.create({ name: 'a', type: 'AGENT', trustScore: 0.8 } as never);
    await sourceRepo.create({ name: 'b', type: 'HUMAN', trustScore: 0.7 } as never);
    const all = await sourceRepo.findAll();
    expect(all).toHaveLength(2);
  });

  it('getOrCreate returns existing source without creating duplicate', async () => {
    const first = await sourceRepo.create({ name: 'gps', type: 'SENSOR', trustScore: 1.0 } as never);
    const second = await sourceRepo.getOrCreate('gps', 'SENSOR');
    expect(second.id).toBe(first.id);
    expect((await sourceRepo.findAll())).toHaveLength(1);
  });

  it('getOrCreate creates source if none exists', async () => {
    const created = await sourceRepo.getOrCreate('new-source', 'TOOL');
    expect(created.id).toBeDefined();
    expect(created.name).toBe('new-source');
  });
});

// ── BranchRepository ──────────────────────────────────────────────────────────

describe('PrismaBranchRepository', () => {
  const branchBase = {
    name: 'Branch A', description: null, parentBranchId: null,
    status: 'OPEN' as const, confidence: 0.5, contradictionId: null, metadata: null,
  };

  it('create and findById returns branch', async () => {
    const branch = await branchRepo.create(branchBase);
    const found = await branchRepo.findById(branch.id);
    expect(found!.name).toBe('Branch A');
    expect(found!.status).toBe('OPEN');
  });

  it('findAll with OPEN status excludes resolved branches', async () => {
    await branchRepo.create({ ...branchBase, name: 'Open' });
    const closed = await branchRepo.create({ ...branchBase, name: 'Closed', status: 'RESOLVED' });
    expect(closed.status).toBe('RESOLVED');

    const open = await branchRepo.findAll('OPEN');
    expect(open).toHaveLength(1);
    expect(open[0]!.name).toBe('Open');
  });

  it('findAll without filter returns all branches', async () => {
    await branchRepo.create({ ...branchBase, name: 'B1' });
    await branchRepo.create({ ...branchBase, name: 'B2', status: 'MERGED' });
    const all = await branchRepo.findAll();
    expect(all).toHaveLength(2);
  });

  it('update changes status and confidence', async () => {
    const branch = await branchRepo.create(branchBase);
    await branchRepo.update(branch.id, { status: 'RESOLVED', confidence: 1.0 });
    const found = await branchRepo.findById(branch.id);
    expect(found!.status).toBe('RESOLVED');
    expect(found!.confidence).toBe(1.0);
  });

  it('countOpen reflects only OPEN branches', async () => {
    await branchRepo.create({ ...branchBase, status: 'OPEN' });
    await branchRepo.create({ ...branchBase, status: 'OPEN' });
    await branchRepo.create({ ...branchBase, status: 'RESOLVED' });
    expect(await branchRepo.countOpen()).toBe(2);
  });
});

// ── DependencyRepository ──────────────────────────────────────────────────────

describe('PrismaDependencyRepository', () => {
  async function makeDep(fromId: string, toId: string, type = 'REQUIRES' as const) {
    return depRepo.create({
      fromEntityId: fromId, toEntityId: toId, type,
      weight: 1.0, description: null, metadata: null, isActive: true,
    });
  }

  it('create and findById returns dependency', async () => {
    const from = await createEntity({ name: 'from' });
    const to = await createEntity({ name: 'to' });
    const dep = await makeDep(from.id, to.id);
    const found = await depRepo.findById(dep.id);
    expect(found!.fromEntityId).toBe(from.id);
    expect(found!.type).toBe('REQUIRES');
  });

  it('findAll returns only active dependencies', async () => {
    const a = await createEntity({ name: 'a' });
    const b = await createEntity({ name: 'b' });
    const dep = await makeDep(a.id, b.id);
    await depRepo.delete(dep.id); // soft-delete → isActive=false
    const all = await depRepo.findAll();
    expect(all).toHaveLength(0);
  });

  it('findFrom returns deps from entity, filtered by type', async () => {
    const a = await createEntity({ name: 'a' });
    const b = await createEntity({ name: 'b' });
    const c = await createEntity({ name: 'c' });
    await makeDep(a.id, b.id, 'REQUIRES');
    await makeDep(a.id, c.id, 'SUPPORTS');

    const requires = await depRepo.findFrom(a.id, 'REQUIRES');
    expect(requires).toHaveLength(1);
    expect(requires[0]!.toEntityId).toBe(b.id);

    const all = await depRepo.findFrom(a.id);
    expect(all).toHaveLength(2);
  });

  it('findTo returns deps pointing to entity, filtered by type', async () => {
    const a = await createEntity({ name: 'a' });
    const b = await createEntity({ name: 'b' });
    const c = await createEntity({ name: 'c' });
    await makeDep(a.id, b.id, 'REQUIRES');
    await makeDep(c.id, b.id, 'SUPPORTS');

    const toB = await depRepo.findTo(b.id, 'REQUIRES');
    expect(toB).toHaveLength(1);
    expect(toB[0]!.fromEntityId).toBe(a.id);
  });

  it('delete soft-deletes by setting isActive=false', async () => {
    const a = await createEntity({ name: 'a' });
    const b = await createEntity({ name: 'b' });
    const dep = await makeDep(a.id, b.id);
    await depRepo.delete(dep.id);
    const found = await depRepo.findById(dep.id);
    expect(found).not.toBeNull();
    expect(found!.isActive).toBe(false);
  });
});

// ── AuditRepository ───────────────────────────────────────────────────────────

describe('PrismaAuditRepository', () => {
  it('create and findById returns audit event', async () => {
    const event = await auditRepo.create({ type: 'CLAIM_ADDED', data: { key: 'val' } });
    const found = await auditRepo.findById(event.id);
    expect(found!.type).toBe('CLAIM_ADDED');
    expect(found!.data).toEqual({ key: 'val' });
  });

  it('findByEntity returns events scoped to entityId', async () => {
    const entity = await createEntity();
    await auditRepo.create({ type: 'CLAIM_ADDED', entityId: entity.id, data: {} });
    await auditRepo.create({ type: 'CLAIM_ADDED', data: {} }); // no entityId

    const events = await auditRepo.findByEntity(entity.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.entityId).toBe(entity.id);
  });

  it('findByType returns only matching type', async () => {
    await auditRepo.create({ type: 'CLAIM_ADDED', data: {} });
    await auditRepo.create({ type: 'BRANCH_CREATED', data: {} });

    const events = await auditRepo.findByType('BRANCH_CREATED');
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('BRANCH_CREATED');
  });

  it('findRecent respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await auditRepo.create({ type: 'SETTLING_PASS', data: { round: i } });
    }
    const recent = await auditRepo.findRecent(3);
    expect(recent).toHaveLength(3);
  });

  it('findByEntity respects limit', async () => {
    const entity = await createEntity();
    for (let i = 0; i < 5; i++) {
      await auditRepo.create({ type: 'CLAIM_ADDED', entityId: entity.id, data: { i } });
    }
    const limited = await auditRepo.findByEntity(entity.id, 2);
    expect(limited).toHaveLength(2);
  });
});

// ── ActionRepository ──────────────────────────────────────────────────────────

describe('PrismaActionRepository', () => {
  const proposalBase = {
    operation: 'deploy', description: 'deploy v2',
    parameters: { version: 2 }, impactedEntityIds: ['e-1'],
    sourceId: null, branchId: null, provenanceChain: [],
    status: 'PENDING' as const,
  };

  it('createProposal and findProposalById returns the proposal', async () => {
    const p = await actionRepo.createProposal(proposalBase);
    const found = await actionRepo.findProposalById(p.id);
    expect(found!.operation).toBe('deploy');
    expect(found!.parameters).toEqual({ version: 2 });
  });

  it('findProposalById returns null for unknown id', async () => {
    expect(await actionRepo.findProposalById('no-such-id')).toBeNull();
  });

  it('updateProposal persists status change', async () => {
    const p = await actionRepo.createProposal(proposalBase);
    await actionRepo.updateProposal(p.id, { status: 'VALID' });
    const found = await actionRepo.findProposalById(p.id);
    expect(found!.status).toBe('VALID');
  });

  it('createValidation links to proposal and findValidationsByProposalId returns it', async () => {
    const p = await actionRepo.createProposal(proposalBase);
    await actionRepo.createValidation({
      actionProposalId: p.id,
      admissibility: 'VALID',
      deltaPhi: -0.1, psiScore: 0.2,
      constraintViolationRisk: 0, dependencyBreakageRisk: 0,
      contradictionAmplification: 0, uncertaintyExposure: 0,
      provenanceFragility: 0, propagatedRisk: 0,
      impactedEntityIds: ['e-1'], provenanceChain: [], reasons: [],
    });
    const validations = await actionRepo.findValidationsByProposalId(p.id);
    expect(validations).toHaveLength(1);
    expect(validations[0]!.admissibility).toBe('VALID');
    expect(validations[0]!.deltaPhi).toBe(-0.1);
  });

  it('findAll with status filter returns only matching proposals', async () => {
    await actionRepo.createProposal({ ...proposalBase, status: 'PENDING' });
    await actionRepo.createProposal({ ...proposalBase, status: 'BLOCKED' });
    const pending = await actionRepo.findAll({ status: 'PENDING' });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('PENDING');
  });

  it('findAll limit is respected', async () => {
    for (let i = 0; i < 5; i++) {
      await actionRepo.createProposal({ ...proposalBase, operation: `op-${i}` });
    }
    const limited = await actionRepo.findAll({ limit: 3 });
    expect(limited).toHaveLength(3);
  });
});

// ── ObservationRepository ─────────────────────────────────────────────────────

describe('PrismaObservationRepository', () => {
  it('create and findById returns observation', async () => {
    const source = await createSource();
    const obs = await observationRepo.create({
      sourceId: source.id, type: 'telemetry',
      content: { temp: 42 }, entityIds: [], processed: false,
    });
    const found = await observationRepo.findById(obs.id);
    expect(found!.type).toBe('telemetry');
    expect(found!.content).toEqual({ temp: 42 });
  });

  it('findUnprocessed excludes processed observations', async () => {
    const source = await createSource();
    await observationRepo.create({
      sourceId: source.id, type: 'raw', content: {}, entityIds: [], processed: false,
    });
    await observationRepo.create({
      sourceId: source.id, type: 'raw', content: {}, entityIds: [], processed: true,
    });
    const unprocessed = await observationRepo.findUnprocessed();
    expect(unprocessed).toHaveLength(1);
    expect(unprocessed[0]!.processed).toBe(false);
  });

  it('markProcessed sets processed=true', async () => {
    const source = await createSource();
    const obs = await observationRepo.create({
      sourceId: source.id, type: 'sensor', content: {}, entityIds: [], processed: false,
    });
    await observationRepo.markProcessed(obs.id);
    const found = await observationRepo.findById(obs.id);
    expect(found!.processed).toBe(true);
  });
});

// ── SnapshotRepository ────────────────────────────────────────────────────────

describe('PrismaSnapshotRepository', () => {
  const snapshotBase = {
    phi: 0.5, coherenceScore: 85, entityCount: 10, claimCount: 20,
    activeClaimCount: 15, contradictionCount: 2, openContradictionCount: 1,
    branchCount: 1, openBranchCount: 1, constraintViolationCount: 0,
    lambdaC: 1, lambdaK: 1, lambdaD: 1, lambdaU: 1, lambdaB: 1, metadata: null,
  };

  it('create and findLatest returns the most recent snapshot', async () => {
    await snapshotRepo.create({ ...snapshotBase, coherenceScore: 70 });
    await snapshotRepo.create({ ...snapshotBase, coherenceScore: 85 });
    const latest = await snapshotRepo.findLatest();
    expect(latest).not.toBeNull();
    expect(latest!.coherenceScore).toBe(85);
  });

  it('findLatest returns null when no snapshots exist', async () => {
    expect(await snapshotRepo.findLatest()).toBeNull();
  });

  it('findAll respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await snapshotRepo.create({ ...snapshotBase, phi: i * 0.1 });
    }
    const limited = await snapshotRepo.findAll(3);
    expect(limited).toHaveLength(3);
  });

  it('findAll without limit defaults to 20 and returns most recent first', async () => {
    for (let i = 0; i < 3; i++) {
      await snapshotRepo.create({ ...snapshotBase, coherenceScore: i * 10 });
    }
    const all = await snapshotRepo.findAll();
    expect(all).toHaveLength(3);
    // ordered desc — highest coherenceScore was created last
    expect(all[0]!.coherenceScore).toBeGreaterThanOrEqual(all[1]!.coherenceScore);
  });
});

// ── PolicyRepository ──────────────────────────────────────────────────────────

describe('PrismaPolicyRepository', () => {
  const ruleBase = {
    name: 'No high-risk deploys',
    condition: { type: 'phi_exceeds', threshold: 0.8 },
    effect: 'DENY',
    priority: 10,
  };

  it('createRule and findRuleById returns the rule', async () => {
    const rule = await policyRepo.createRule(ruleBase);
    const found = await policyRepo.findRuleById(rule.id);
    expect(found!.name).toBe('No high-risk deploys');
    expect(found!.effect).toBe('DENY');
  });

  it('findActiveRules excludes soft-deleted rules', async () => {
    const rule = await policyRepo.createRule(ruleBase);
    await policyRepo.createRule({ ...ruleBase, name: 'Another rule' });
    await policyRepo.deleteRule(rule.id); // sets isActive=false

    const active = await policyRepo.findActiveRules();
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('Another rule');
  });

  it('findActiveRules orders by priority desc', async () => {
    await policyRepo.createRule({ ...ruleBase, name: 'Low', priority: 1 });
    await policyRepo.createRule({ ...ruleBase, name: 'High', priority: 100 });
    const rules = await policyRepo.findActiveRules();
    expect(rules[0]!.name).toBe('High');
  });

  it('updateRule persists changes', async () => {
    const rule = await policyRepo.createRule(ruleBase);
    await policyRepo.updateRule(rule.id, { name: 'Updated name', isActive: false });
    const found = await policyRepo.findRuleById(rule.id);
    expect(found!.name).toBe('Updated name');
    expect(found!.isActive).toBe(false);
  });

  it('createApproval and findPendingApprovals returns pending', async () => {
    const rule = await policyRepo.createRule(ruleBase);
    await policyRepo.createApproval({
      policyRuleId: rule.id, requestedBy: 'agent-1', reason: 'needs it',
    });
    const pending = await policyRepo.findPendingApprovals();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('PENDING');
  });

  it('decideApproval sets APPROVED status', async () => {
    const rule = await policyRepo.createRule(ruleBase);
    const approval = await policyRepo.createApproval({
      policyRuleId: rule.id, requestedBy: 'agent-1', reason: 'ok',
    });
    await policyRepo.decideApproval(approval.id, {
      approved: true, reviewedBy: 'human-1', reason: 'LGTM',
    });
    const found = await policyRepo.findApprovalById(approval.id);
    expect(found!.status).toBe('APPROVED');
    expect(found!.reviewedBy).toBe('human-1');
  });

  it('expireOldApprovals marks past-deadline PENDING approvals as EXPIRED', async () => {
    const rule = await policyRepo.createRule(ruleBase);
    // Create approval that expired 1 hour ago
    await testPrisma.approvalRequest.create({
      data: {
        policyRuleId: rule.id, requestedBy: 'agent-1', reason: 'old',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 3600_000),
      },
    });
    await policyRepo.expireOldApprovals();
    const pending = await policyRepo.findPendingApprovals();
    expect(pending).toHaveLength(0);
  });
});

// ── TraceRepository ───────────────────────────────────────────────────────────

describe('PrismaTraceRepository', () => {
  it('createSession and findSessionById returns session', async () => {
    const session = await traceRepo.createSession({ name: 'test-run', agentId: 'agent-1' });
    const found = await traceRepo.findSessionById(session.id);
    expect(found!.name).toBe('test-run');
    expect(found!.status).toBe('ACTIVE');
  });

  it('findActiveSessions excludes completed sessions', async () => {
    const s1 = await traceRepo.createSession({ name: 'active' });
    const s2 = await traceRepo.createSession({ name: 'done' });
    await traceRepo.endSession(s2.id, 'COMPLETED');

    const active = await traceRepo.findActiveSessions();
    expect(active.map(s => s.id)).toContain(s1.id);
    expect(active.map(s => s.id)).not.toContain(s2.id);
  });

  it('appendEvent auto-increments sequenceNumber', async () => {
    const session = await traceRepo.createSession({ name: 'seq-test' });
    const e1 = await traceRepo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: { i: 1 } });
    const e2 = await traceRepo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: { i: 2 } });
    const e3 = await traceRepo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: { i: 3 } });
    expect(e1.sequenceNumber).toBe(0);
    expect(e2.sequenceNumber).toBe(1);
    expect(e3.sequenceNumber).toBe(2);
  });

  it('getTimeline returns events ordered by sequenceNumber ascending', async () => {
    const session = await traceRepo.createSession({ name: 'timeline-test' });
    await traceRepo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: {} });
    await traceRepo.appendEvent({ sessionId: session.id, type: 'CONTRADICTION_DETECTED', data: {} });
    await traceRepo.appendEvent({ sessionId: session.id, type: 'BRANCH_OPENED', data: {} });

    const timeline = await traceRepo.getTimeline(session.id);
    expect(timeline).toHaveLength(3);
    expect(timeline[0]!.sequenceNumber).toBe(0);
    expect(timeline[2]!.sequenceNumber).toBe(2);
  });

  it('getTimelineSlice returns events in the specified range', async () => {
    const session = await traceRepo.createSession({ name: 'slice-test' });
    for (let i = 0; i < 5; i++) {
      await traceRepo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: { i } });
    }
    const slice = await traceRepo.getTimelineSlice(session.id, 1, 3);
    expect(slice).toHaveLength(3);
    expect(slice[0]!.sequenceNumber).toBe(1);
    expect(slice[2]!.sequenceNumber).toBe(3);
  });

  it('countEvents returns correct count per session', async () => {
    const s1 = await traceRepo.createSession({ name: 's1' });
    const s2 = await traceRepo.createSession({ name: 's2' });
    await traceRepo.appendEvent({ sessionId: s1.id, type: 'CLAIM_ADDED', data: {} });
    await traceRepo.appendEvent({ sessionId: s1.id, type: 'CLAIM_ADDED', data: {} });
    await traceRepo.appendEvent({ sessionId: s2.id, type: 'CLAIM_ADDED', data: {} });

    expect(await traceRepo.countEvents(s1.id)).toBe(2);
    expect(await traceRepo.countEvents(s2.id)).toBe(1);
  });

  it('endSession sets status and endedAt', async () => {
    const session = await traceRepo.createSession({ name: 'end-test' });
    await traceRepo.endSession(session.id, 'FAILED');
    const found = await traceRepo.findSessionById(session.id);
    expect(found!.status).toBe('FAILED');
    expect(found!.endedAt).not.toBeNull();
  });
});

// ── PlanRepository ────────────────────────────────────────────────────────────

describe('PrismaPlanRepository', () => {
  it('createPlan and findPlanById returns plan with empty steps', async () => {
    const plan = await planRepo.createPlan({ name: 'Mission Alpha', goal: 'Deploy v2' });
    const found = await planRepo.findPlanById(plan.id);
    expect(found!.name).toBe('Mission Alpha');
    expect(found!.status).toBe('DRAFT');
    expect(found!.steps).toHaveLength(0);
  });

  it('findActivePlans returns only ACTIVE and REPLANNING plans', async () => {
    const p1 = await planRepo.createPlan({ name: 'Draft', goal: 'g' });
    const p2 = await planRepo.createPlan({ name: 'Active', goal: 'g' });
    const p3 = await planRepo.createPlan({ name: 'Replanning', goal: 'g' });
    await planRepo.updatePlanStatus(p2.id, 'ACTIVE');
    await planRepo.updatePlanStatus(p3.id, 'REPLANNING');

    const active = await planRepo.findActivePlans();
    const ids = active.map(p => p.id);
    expect(ids).not.toContain(p1.id);
    expect(ids).toContain(p2.id);
    expect(ids).toContain(p3.id);
  });

  it('createStep links to plan and findPlanById includes it', async () => {
    const plan = await planRepo.createPlan({ name: 'P', goal: 'G' });
    await planRepo.createStep({
      planId: plan.id, name: 'Step 1', operation: 'validate', order: 0,
    });
    const found = await planRepo.findPlanById(plan.id);
    expect(found!.steps).toHaveLength(1);
    expect(found!.steps[0]!.name).toBe('Step 1');
  });

  it('updateStepStatus persists status and optional fields', async () => {
    const plan = await planRepo.createPlan({ name: 'P', goal: 'G' });
    const step = await planRepo.createStep({
      planId: plan.id, name: 'Step', operation: 'execute', order: 0,
    });
    const now = new Date();
    await planRepo.updateStepStatus(step.id, 'RUNNING', { startedAt: now });
    const found = await planRepo.findStepById(step.id);
    expect(found!.status).toBe('RUNNING');
    expect(found!.startedAt).not.toBeNull();
  });

  it('findReadySteps returns pending steps whose requires are all completed', async () => {
    const plan = await planRepo.createPlan({ name: 'P', goal: 'G' });
    const s1 = await planRepo.createStep({
      planId: plan.id, name: 'S1', operation: 'setup', order: 0, requires: [],
    });
    const s2 = await planRepo.createStep({
      planId: plan.id, name: 'S2', operation: 'deploy', order: 1, requires: [s1.id],
    });
    const s3 = await planRepo.createStep({
      planId: plan.id, name: 'S3', operation: 'verify', order: 2, requires: [s2.id],
    });

    // Before any completions — only S1 is ready (no requires)
    const readyBefore = await planRepo.findReadySteps(plan.id);
    expect(readyBefore.map(s => s.id)).toContain(s1.id);
    expect(readyBefore.map(s => s.id)).not.toContain(s2.id);

    // Complete S1 — S2 becomes ready, S3 still blocked
    await planRepo.updateStepStatus(s1.id, 'COMPLETED');
    const readyAfterS1 = await planRepo.findReadySteps(plan.id);
    expect(readyAfterS1.map(s => s.id)).toContain(s2.id);
    expect(readyAfterS1.map(s => s.id)).not.toContain(s3.id);
  });

  it('getPlanProgress returns accurate counts', async () => {
    const plan = await planRepo.createPlan({ name: 'P', goal: 'G' });
    const s1 = await planRepo.createStep({ planId: plan.id, name: 'S1', operation: 'op', order: 0 });
    const s2 = await planRepo.createStep({ planId: plan.id, name: 'S2', operation: 'op', order: 1 });
    const s3 = await planRepo.createStep({ planId: plan.id, name: 'S3', operation: 'op', order: 2 });
    await planRepo.updateStepStatus(s1.id, 'COMPLETED');
    await planRepo.updateStepStatus(s2.id, 'FAILED');

    const progress = await planRepo.getPlanProgress(plan.id);
    expect(progress.total).toBe(3);
    expect(progress.completed).toBe(1);
    expect(progress.failed).toBe(1);
    expect(progress.pending).toBe(1);
  });

  it('findAllPlans respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await planRepo.createPlan({ name: `Plan ${i}`, goal: 'g' });
    }
    const limited = await planRepo.findAllPlans(3);
    expect(limited).toHaveLength(3);
  });
});
