/**
 * Real-database integration tests — remaining repositories.
 *
 * Isolation: true transaction rollback per test (see helpers.ts).
 *
 * Run: npm run test:db
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import {
  setupTx, truncateAll, disconnect,
  createSource, createEntity, createClaim, createConstraint,
  type TxContext,
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

// ── SourceRepository ──────────────────────────────────────────────────────────

describe('PrismaSourceRepository', () => {
  it('create and findById returns source', async () => {
    const repo = new PrismaSourceRepository(ctx.tx);
    const source = await repo.create({ name: 'radar', type: 'SENSOR', trustScore: 0.9, isActive: true } as never);
    const found = await repo.findById(source.id);
    expect(found!.name).toBe('radar');
    expect(found!.trustScore).toBe(0.9);
  });

  it('findAll returns all sources', async () => {
    const repo = new PrismaSourceRepository(ctx.tx);
    await repo.create({ name: 'a', type: 'AGENT', trustScore: 0.8 } as never);
    await repo.create({ name: 'b', type: 'HUMAN', trustScore: 0.7 } as never);
    expect(await repo.findAll()).toHaveLength(2);
  });

  it('getOrCreate returns existing source without creating duplicate', async () => {
    const repo = new PrismaSourceRepository(ctx.tx);
    const first = await repo.create({ name: 'gps', type: 'SENSOR', trustScore: 1.0 } as never);
    const second = await repo.getOrCreate('gps', 'SENSOR');
    expect(second.id).toBe(first.id);
    expect(await repo.findAll()).toHaveLength(1);
  });

  it('getOrCreate creates source if none exists', async () => {
    const repo = new PrismaSourceRepository(ctx.tx);
    const created = await repo.getOrCreate('new-source', 'TOOL');
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
    const repo = new PrismaBranchRepository(ctx.tx);
    const branch = await repo.create(branchBase);
    const found = await repo.findById(branch.id);
    expect(found!.name).toBe('Branch A');
    expect(found!.status).toBe('OPEN');
  });

  it('findAll with OPEN status excludes resolved branches', async () => {
    const repo = new PrismaBranchRepository(ctx.tx);
    await repo.create({ ...branchBase, name: 'Open' });
    await repo.create({ ...branchBase, name: 'Closed', status: 'RESOLVED' });
    const open = await repo.findAll('OPEN');
    expect(open).toHaveLength(1);
    expect(open[0]!.name).toBe('Open');
  });

  it('findAll without filter returns all branches', async () => {
    const repo = new PrismaBranchRepository(ctx.tx);
    await repo.create({ ...branchBase, name: 'B1' });
    await repo.create({ ...branchBase, name: 'B2', status: 'MERGED' });
    expect(await repo.findAll()).toHaveLength(2);
  });

  it('update changes status and confidence', async () => {
    const repo = new PrismaBranchRepository(ctx.tx);
    const branch = await repo.create(branchBase);
    await repo.update(branch.id, { status: 'RESOLVED', confidence: 1.0 });
    const found = await repo.findById(branch.id);
    expect(found!.status).toBe('RESOLVED');
    expect(found!.confidence).toBe(1.0);
  });

  it('countOpen reflects only OPEN branches', async () => {
    const repo = new PrismaBranchRepository(ctx.tx);
    await repo.create({ ...branchBase, status: 'OPEN' });
    await repo.create({ ...branchBase, status: 'OPEN' });
    await repo.create({ ...branchBase, status: 'RESOLVED' });
    expect(await repo.countOpen()).toBe(2);
  });
});

// ── DependencyRepository ──────────────────────────────────────────────────────

describe('PrismaDependencyRepository', () => {
  async function makeDep(fromId: string, toId: string, type = 'REQUIRES' as const) {
    const repo = new PrismaDependencyRepository(ctx.tx);
    return repo.create({ fromEntityId: fromId, toEntityId: toId, type, weight: 1.0, description: null, metadata: null, isActive: true });
  }

  it('create and findById returns dependency', async () => {
    const repo = new PrismaDependencyRepository(ctx.tx);
    const from = await createEntity(ctx.tx, { name: 'from' });
    const to = await createEntity(ctx.tx, { name: 'to' });
    const dep = await makeDep(from.id, to.id);
    const found = await repo.findById(dep.id);
    expect(found!.fromEntityId).toBe(from.id);
    expect(found!.type).toBe('REQUIRES');
  });

  it('findAll returns only active dependencies', async () => {
    const repo = new PrismaDependencyRepository(ctx.tx);
    const a = await createEntity(ctx.tx, { name: 'a' });
    const b = await createEntity(ctx.tx, { name: 'b' });
    const dep = await makeDep(a.id, b.id);
    await repo.delete(dep.id);
    expect(await repo.findAll()).toHaveLength(0);
  });

  it('findFrom returns deps from entity, filtered by type', async () => {
    const repo = new PrismaDependencyRepository(ctx.tx);
    const a = await createEntity(ctx.tx, { name: 'a' });
    const b = await createEntity(ctx.tx, { name: 'b' });
    const c = await createEntity(ctx.tx, { name: 'c' });
    await makeDep(a.id, b.id, 'REQUIRES');
    await makeDep(a.id, c.id, 'SUPPORTS');

    expect(await repo.findFrom(a.id, 'REQUIRES')).toHaveLength(1);
    expect(await repo.findFrom(a.id)).toHaveLength(2);
  });

  it('findTo returns deps pointing to entity, filtered by type', async () => {
    const repo = new PrismaDependencyRepository(ctx.tx);
    const a = await createEntity(ctx.tx, { name: 'a' });
    const b = await createEntity(ctx.tx, { name: 'b' });
    const c = await createEntity(ctx.tx, { name: 'c' });
    await makeDep(a.id, b.id, 'REQUIRES');
    await makeDep(c.id, b.id, 'SUPPORTS');

    const toB = await repo.findTo(b.id, 'REQUIRES');
    expect(toB).toHaveLength(1);
    expect(toB[0]!.fromEntityId).toBe(a.id);
  });

  it('delete soft-deletes by setting isActive=false', async () => {
    const repo = new PrismaDependencyRepository(ctx.tx);
    const a = await createEntity(ctx.tx, { name: 'a' });
    const b = await createEntity(ctx.tx, { name: 'b' });
    const dep = await makeDep(a.id, b.id);
    await repo.delete(dep.id);
    const found = await repo.findById(dep.id);
    expect(found!.isActive).toBe(false);
  });
});

// ── AuditRepository ───────────────────────────────────────────────────────────

describe('PrismaAuditRepository', () => {
  it('create and findById returns audit event', async () => {
    const repo = new PrismaAuditRepository(ctx.tx);
    const event = await repo.create({ type: 'CLAIM_ADDED', data: { key: 'val' } });
    const found = await repo.findById(event.id);
    expect(found!.type).toBe('CLAIM_ADDED');
    expect(found!.data).toEqual({ key: 'val' });
  });

  it('findByEntity returns events scoped to entityId', async () => {
    const repo = new PrismaAuditRepository(ctx.tx);
    const entity = await createEntity(ctx.tx);
    await repo.create({ type: 'CLAIM_ADDED', entityId: entity.id, data: {} });
    await repo.create({ type: 'CLAIM_ADDED', data: {} });
    const events = await repo.findByEntity(entity.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.entityId).toBe(entity.id);
  });

  it('findByType returns only matching type', async () => {
    const repo = new PrismaAuditRepository(ctx.tx);
    await repo.create({ type: 'CLAIM_ADDED', data: {} });
    await repo.create({ type: 'BRANCH_CREATED', data: {} });
    const events = await repo.findByType('BRANCH_CREATED');
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('BRANCH_CREATED');
  });

  it('findRecent respects limit', async () => {
    const repo = new PrismaAuditRepository(ctx.tx);
    for (let i = 0; i < 5; i++) await repo.create({ type: 'SETTLING_PASS', data: { round: i } });
    expect(await repo.findRecent(3)).toHaveLength(3);
  });

  it('findByEntity respects limit', async () => {
    const repo = new PrismaAuditRepository(ctx.tx);
    const entity = await createEntity(ctx.tx);
    for (let i = 0; i < 5; i++) await repo.create({ type: 'CLAIM_ADDED', entityId: entity.id, data: { i } });
    expect(await repo.findByEntity(entity.id, 2)).toHaveLength(2);
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
    const repo = new PrismaActionRepository(ctx.tx);
    const p = await repo.createProposal(proposalBase);
    const found = await repo.findProposalById(p.id);
    expect(found!.operation).toBe('deploy');
    expect(found!.parameters).toEqual({ version: 2 });
  });

  it('findProposalById returns null for unknown id', async () => {
    expect(await new PrismaActionRepository(ctx.tx).findProposalById('no-such-id')).toBeNull();
  });

  it('updateProposal persists status change', async () => {
    const repo = new PrismaActionRepository(ctx.tx);
    const p = await repo.createProposal(proposalBase);
    await repo.updateProposal(p.id, { status: 'VALID' });
    expect((await repo.findProposalById(p.id))!.status).toBe('VALID');
  });

  it('createValidation links to proposal and findValidationsByProposalId returns it', async () => {
    const repo = new PrismaActionRepository(ctx.tx);
    const p = await repo.createProposal(proposalBase);
    await repo.createValidation({
      actionProposalId: p.id, admissibility: 'VALID',
      deltaPhi: -0.1, psiScore: 0.2,
      constraintViolationRisk: 0, dependencyBreakageRisk: 0,
      contradictionAmplification: 0, uncertaintyExposure: 0,
      provenanceFragility: 0, propagatedRisk: 0,
      impactedEntityIds: ['e-1'], provenanceChain: [], reasons: [],
    });
    const validations = await repo.findValidationsByProposalId(p.id);
    expect(validations).toHaveLength(1);
    expect(validations[0]!.admissibility).toBe('VALID');
  });

  it('findAll with status filter returns only matching proposals', async () => {
    const repo = new PrismaActionRepository(ctx.tx);
    await repo.createProposal({ ...proposalBase, status: 'PENDING' });
    await repo.createProposal({ ...proposalBase, status: 'BLOCKED' });
    const pending = await repo.findAll({ status: 'PENDING' });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('PENDING');
  });

  it('findAll limit is respected', async () => {
    const repo = new PrismaActionRepository(ctx.tx);
    for (let i = 0; i < 5; i++) await repo.createProposal({ ...proposalBase, operation: `op-${i}` });
    expect(await repo.findAll({ limit: 3 })).toHaveLength(3);
  });
});

// ── ObservationRepository ─────────────────────────────────────────────────────

describe('PrismaObservationRepository', () => {
  it('create and findById returns observation', async () => {
    const repo = new PrismaObservationRepository(ctx.tx);
    const source = await createSource(ctx.tx);
    const obs = await repo.create({ sourceId: source.id, type: 'telemetry', content: { temp: 42 }, entityIds: [], processed: false });
    const found = await repo.findById(obs.id);
    expect(found!.type).toBe('telemetry');
    expect(found!.content).toEqual({ temp: 42 });
  });

  it('findUnprocessed excludes processed observations', async () => {
    const repo = new PrismaObservationRepository(ctx.tx);
    const source = await createSource(ctx.tx);
    await repo.create({ sourceId: source.id, type: 'raw', content: {}, entityIds: [], processed: false });
    await repo.create({ sourceId: source.id, type: 'raw', content: {}, entityIds: [], processed: true });
    const unprocessed = await repo.findUnprocessed();
    expect(unprocessed).toHaveLength(1);
    expect(unprocessed[0]!.processed).toBe(false);
  });

  it('markProcessed sets processed=true', async () => {
    const repo = new PrismaObservationRepository(ctx.tx);
    const source = await createSource(ctx.tx);
    const obs = await repo.create({ sourceId: source.id, type: 'sensor', content: {}, entityIds: [], processed: false });
    await repo.markProcessed(obs.id);
    expect((await repo.findById(obs.id))!.processed).toBe(true);
  });
});

// ── SnapshotRepository ────────────────────────────────────────────────────────

describe('PrismaSnapshotRepository', () => {
  const base = {
    phi: 0.5, coherenceScore: 85, entityCount: 10, claimCount: 20,
    activeClaimCount: 15, contradictionCount: 2, openContradictionCount: 1,
    branchCount: 1, openBranchCount: 1, constraintViolationCount: 0,
    lambdaC: 1, lambdaK: 1, lambdaD: 1, lambdaU: 1, lambdaB: 1, metadata: null,
  };

  it('create and findLatest returns the most recent snapshot', async () => {
    const repo = new PrismaSnapshotRepository(ctx.tx);
    await repo.create({ ...base, coherenceScore: 70 });
    await repo.create({ ...base, coherenceScore: 85 });
    expect((await repo.findLatest())!.coherenceScore).toBe(85);
  });

  it('findLatest returns null when no snapshots exist', async () => {
    expect(await new PrismaSnapshotRepository(ctx.tx).findLatest()).toBeNull();
  });

  it('findAll respects limit', async () => {
    const repo = new PrismaSnapshotRepository(ctx.tx);
    for (let i = 0; i < 5; i++) await repo.create({ ...base, phi: i * 0.1 });
    expect(await repo.findAll(3)).toHaveLength(3);
  });
});

// ── PolicyRepository ──────────────────────────────────────────────────────────

describe('PrismaPolicyRepository', () => {
  const ruleBase = {
    name: 'No high-risk deploys',
    condition: { type: 'phi_exceeds', threshold: 0.8 },
    effect: 'DENY', priority: 10,
  };

  it('createRule and findRuleById returns the rule', async () => {
    const repo = new PrismaPolicyRepository(ctx.tx);
    const rule = await repo.createRule(ruleBase);
    expect((await repo.findRuleById(rule.id))!.name).toBe('No high-risk deploys');
  });

  it('findActiveRules excludes soft-deleted rules', async () => {
    const repo = new PrismaPolicyRepository(ctx.tx);
    const rule = await repo.createRule(ruleBase);
    await repo.createRule({ ...ruleBase, name: 'Another rule' });
    await repo.deleteRule(rule.id);
    const active = await repo.findActiveRules();
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('Another rule');
  });

  it('findActiveRules orders by priority desc', async () => {
    const repo = new PrismaPolicyRepository(ctx.tx);
    await repo.createRule({ ...ruleBase, name: 'Low', priority: 1 });
    await repo.createRule({ ...ruleBase, name: 'High', priority: 100 });
    const rules = await repo.findActiveRules();
    expect(rules[0]!.name).toBe('High');
  });

  it('updateRule persists changes', async () => {
    const repo = new PrismaPolicyRepository(ctx.tx);
    const rule = await repo.createRule(ruleBase);
    await repo.updateRule(rule.id, { name: 'Updated name', isActive: false });
    const found = await repo.findRuleById(rule.id);
    expect(found!.name).toBe('Updated name');
    expect(found!.isActive).toBe(false);
  });

  it('createApproval and findPendingApprovals returns pending', async () => {
    const repo = new PrismaPolicyRepository(ctx.tx);
    const rule = await repo.createRule(ruleBase);
    await repo.createApproval({ policyRuleId: rule.id, requestedBy: 'agent-1', reason: 'needs it' });
    const pending = await repo.findPendingApprovals();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('PENDING');
  });

  it('decideApproval sets APPROVED status', async () => {
    const repo = new PrismaPolicyRepository(ctx.tx);
    const rule = await repo.createRule(ruleBase);
    const approval = await repo.createApproval({ policyRuleId: rule.id, requestedBy: 'agent-1', reason: 'ok' });
    await repo.decideApproval(approval.id, { approved: true, reviewedBy: 'human-1', reason: 'LGTM' });
    const found = await repo.findApprovalById(approval.id);
    expect(found!.status).toBe('APPROVED');
    expect(found!.reviewedBy).toBe('human-1');
  });

  it('expireOldApprovals marks past-deadline PENDING approvals as EXPIRED', async () => {
    const repo = new PrismaPolicyRepository(ctx.tx);
    const rule = await repo.createRule(ruleBase);
    await ctx.tx.approvalRequest.create({
      data: {
        policyRuleId: rule.id, requestedBy: 'agent-1', reason: 'old',
        status: 'PENDING', expiresAt: new Date(Date.now() - 3600_000),
      },
    });
    await repo.expireOldApprovals();
    expect(await repo.findPendingApprovals()).toHaveLength(0);
  });
});

// ── TraceRepository ───────────────────────────────────────────────────────────

describe('PrismaTraceRepository', () => {
  it('createSession and findSessionById returns session', async () => {
    const repo = new PrismaTraceRepository(ctx.tx);
    const session = await repo.createSession({ name: 'test-run', agentId: 'agent-1' });
    expect((await repo.findSessionById(session.id))!.name).toBe('test-run');
  });

  it('findActiveSessions excludes completed sessions', async () => {
    const repo = new PrismaTraceRepository(ctx.tx);
    const s1 = await repo.createSession({ name: 'active' });
    const s2 = await repo.createSession({ name: 'done' });
    await repo.endSession(s2.id, 'COMPLETED');
    const active = await repo.findActiveSessions();
    expect(active.map(s => s.id)).toContain(s1.id);
    expect(active.map(s => s.id)).not.toContain(s2.id);
  });

  it('appendEvent auto-increments sequenceNumber', async () => {
    const repo = new PrismaTraceRepository(ctx.tx);
    const session = await repo.createSession({ name: 'seq-test' });
    const e1 = await repo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: {} });
    const e2 = await repo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: {} });
    const e3 = await repo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: {} });
    expect(e1.sequenceNumber).toBe(0);
    expect(e2.sequenceNumber).toBe(1);
    expect(e3.sequenceNumber).toBe(2);
  });

  it('getTimeline returns events ordered by sequenceNumber ascending', async () => {
    const repo = new PrismaTraceRepository(ctx.tx);
    const session = await repo.createSession({ name: 'timeline-test' });
    await repo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: {} });
    await repo.appendEvent({ sessionId: session.id, type: 'CONTRADICTION_DETECTED', data: {} });
    await repo.appendEvent({ sessionId: session.id, type: 'BRANCH_OPENED', data: {} });
    const timeline = await repo.getTimeline(session.id);
    expect(timeline).toHaveLength(3);
    expect(timeline[0]!.sequenceNumber).toBe(0);
    expect(timeline[2]!.sequenceNumber).toBe(2);
  });

  it('getTimelineSlice returns events in the specified range', async () => {
    const repo = new PrismaTraceRepository(ctx.tx);
    const session = await repo.createSession({ name: 'slice-test' });
    for (let i = 0; i < 5; i++) await repo.appendEvent({ sessionId: session.id, type: 'CLAIM_ADDED', data: { i } });
    const slice = await repo.getTimelineSlice(session.id, 1, 3);
    expect(slice).toHaveLength(3);
    expect(slice[0]!.sequenceNumber).toBe(1);
    expect(slice[2]!.sequenceNumber).toBe(3);
  });

  it('countEvents returns correct count per session', async () => {
    const repo = new PrismaTraceRepository(ctx.tx);
    const s1 = await repo.createSession({ name: 's1' });
    const s2 = await repo.createSession({ name: 's2' });
    await repo.appendEvent({ sessionId: s1.id, type: 'CLAIM_ADDED', data: {} });
    await repo.appendEvent({ sessionId: s1.id, type: 'CLAIM_ADDED', data: {} });
    await repo.appendEvent({ sessionId: s2.id, type: 'CLAIM_ADDED', data: {} });
    expect(await repo.countEvents(s1.id)).toBe(2);
    expect(await repo.countEvents(s2.id)).toBe(1);
  });

  it('endSession sets status and endedAt', async () => {
    const repo = new PrismaTraceRepository(ctx.tx);
    const session = await repo.createSession({ name: 'end-test' });
    await repo.endSession(session.id, 'FAILED');
    const found = await repo.findSessionById(session.id);
    expect(found!.status).toBe('FAILED');
    expect(found!.endedAt).not.toBeNull();
  });
});

// ── PlanRepository ────────────────────────────────────────────────────────────

describe('PrismaPlanRepository', () => {
  it('createPlan and findPlanById returns plan with empty steps', async () => {
    const repo = new PrismaPlanRepository(ctx.tx);
    const plan = await repo.createPlan({ name: 'Mission Alpha', goal: 'Deploy v2' });
    const found = await repo.findPlanById(plan.id);
    expect(found!.name).toBe('Mission Alpha');
    expect(found!.status).toBe('DRAFT');
    expect(found!.steps).toHaveLength(0);
  });

  it('findActivePlans returns only ACTIVE and REPLANNING plans', async () => {
    const repo = new PrismaPlanRepository(ctx.tx);
    const p1 = await repo.createPlan({ name: 'Draft', goal: 'g' });
    const p2 = await repo.createPlan({ name: 'Active', goal: 'g' });
    const p3 = await repo.createPlan({ name: 'Replanning', goal: 'g' });
    await repo.updatePlanStatus(p2.id, 'ACTIVE');
    await repo.updatePlanStatus(p3.id, 'REPLANNING');
    const active = await repo.findActivePlans();
    const ids = active.map(p => p.id);
    expect(ids).not.toContain(p1.id);
    expect(ids).toContain(p2.id);
    expect(ids).toContain(p3.id);
  });

  it('createStep links to plan and findPlanById includes it', async () => {
    const repo = new PrismaPlanRepository(ctx.tx);
    const plan = await repo.createPlan({ name: 'P', goal: 'G' });
    await repo.createStep({ planId: plan.id, name: 'Step 1', operation: 'validate', order: 0 });
    const found = await repo.findPlanById(plan.id);
    expect(found!.steps).toHaveLength(1);
    expect(found!.steps[0]!.name).toBe('Step 1');
  });

  it('updateStepStatus persists status and optional fields', async () => {
    const repo = new PrismaPlanRepository(ctx.tx);
    const plan = await repo.createPlan({ name: 'P', goal: 'G' });
    const step = await repo.createStep({ planId: plan.id, name: 'Step', operation: 'execute', order: 0 });
    await repo.updateStepStatus(step.id, 'RUNNING', { startedAt: new Date() });
    const found = await repo.findStepById(step.id);
    expect(found!.status).toBe('RUNNING');
    expect(found!.startedAt).not.toBeNull();
  });

  it('findReadySteps returns pending steps whose requires are all completed', async () => {
    const repo = new PrismaPlanRepository(ctx.tx);
    const plan = await repo.createPlan({ name: 'P', goal: 'G' });
    const s1 = await repo.createStep({ planId: plan.id, name: 'S1', operation: 'setup', order: 0, requires: [] });
    const s2 = await repo.createStep({ planId: plan.id, name: 'S2', operation: 'deploy', order: 1, requires: [s1.id] });
    const s3 = await repo.createStep({ planId: plan.id, name: 'S3', operation: 'verify', order: 2, requires: [s2.id] });

    const readyBefore = await repo.findReadySteps(plan.id);
    expect(readyBefore.map(s => s.id)).toContain(s1.id);
    expect(readyBefore.map(s => s.id)).not.toContain(s2.id);

    await repo.updateStepStatus(s1.id, 'COMPLETED');
    const readyAfterS1 = await repo.findReadySteps(plan.id);
    expect(readyAfterS1.map(s => s.id)).toContain(s2.id);
    expect(readyAfterS1.map(s => s.id)).not.toContain(s3.id);
  });

  it('getPlanProgress returns accurate counts', async () => {
    const repo = new PrismaPlanRepository(ctx.tx);
    const plan = await repo.createPlan({ name: 'P', goal: 'G' });
    const s1 = await repo.createStep({ planId: plan.id, name: 'S1', operation: 'op', order: 0 });
    const s2 = await repo.createStep({ planId: plan.id, name: 'S2', operation: 'op', order: 1 });
    const s3 = await repo.createStep({ planId: plan.id, name: 'S3', operation: 'op', order: 2 });
    await repo.updateStepStatus(s1.id, 'COMPLETED');
    await repo.updateStepStatus(s2.id, 'FAILED');
    const progress = await repo.getPlanProgress(plan.id);
    expect(progress.total).toBe(3);
    expect(progress.completed).toBe(1);
    expect(progress.failed).toBe(1);
    expect(progress.pending).toBe(1);
  });

  it('findAllPlans respects limit', async () => {
    const repo = new PrismaPlanRepository(ctx.tx);
    for (let i = 0; i < 5; i++) await repo.createPlan({ name: `Plan ${i}`, goal: 'g' });
    expect(await repo.findAllPlans(3)).toHaveLength(3);
  });
});
