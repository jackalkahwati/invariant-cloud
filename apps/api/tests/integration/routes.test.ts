/**
 * Integration tests for all HTTP routes.
 *
 * Uses Fastify's built-in inject() — no real server or database.
 * The container (all repos + services) and Prisma are fully mocked.
 * The master API key defaults to 'dev-api-key' (config.ts default).
 */

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';

// ── vi.hoisted() — mocks defined BEFORE vi.mock() factories execute ───────────

const {
  mockEntityRepo,
  mockClaimRepo,
  mockAuditRepo,
  mockContradictionRepo,
  mockBranchRepo,
  mockConstraintRepo,
  mockDependencyRepo,
  mockActionRepo,
  mockObservationRepo,
  mockSnapshotRepo,
  mockSourceRepo,
  mockSettlingService,
  mockActionValidationService,
  mockPolicyRepo,
  mockPolicyService,
  mockTraceRepo,
  mockTraceService,
  mockPlanRepo,
  mockPlanService,
  mockWebhookService,
  mockPrisma,
} = vi.hoisted(() => {
  const now = new Date().toISOString();

  return {
    mockPrisma: {
      workspace: { findUnique: vi.fn(), update: vi.fn() },
      workspaceApiKey: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
      workspaceMember: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    mockEntityRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'ent-1', name: 'Test Entity', type: 'GENERIC', isActive: true, createdAt: now, updatedAt: now }),
    },
    mockClaimRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findActive: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'claim-1' }),
    },
    mockAuditRepo: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      findByEntity: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue([]),
    },
    mockContradictionRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'con-1' }),
      update: vi.fn().mockResolvedValue({ id: 'con-1' }),
    },
    mockBranchRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'test', status: 'OPEN', confidence: 0.8, createdAt: now, updatedAt: now }),
      update: vi.fn().mockResolvedValue({ id: 'branch-1' }),
    },
    mockConstraintRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'cst-1' }),
      findActiveViolations: vi.fn().mockResolvedValue([]),
    },
    mockDependencyRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findFrom: vi.fn().mockResolvedValue([]),
      findTo: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'dep-1' }),
    },
    mockActionRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      createProposal: vi.fn().mockResolvedValue({ id: 'action-1', operation: 'test', status: 'PENDING', impactedEntityIds: [], provenanceChain: [], parameters: {}, createdAt: now, updatedAt: now }),
      updateProposal: vi.fn().mockResolvedValue({ id: 'action-1' }),
    },
    mockObservationRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'obs-1', processed: false }),
      update: vi.fn().mockResolvedValue({ id: 'obs-1' }),
    },
    mockSnapshotRepo: {
      findLatest: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'snap-1' }),
    },
    mockSourceRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findByName: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'src-1', name: 'test', type: 'AGENT', trustScore: 1.0, createdAt: now }),
    },
    mockSettlingService: {
      computeCurrentPhiBreakdown: vi.fn().mockResolvedValue({
        coherenceScore: 95.0, phi: 0.05,
        Vc: 0, Vk: 0, Vd: 0, Vu: 0, Vb: 0,
        lambdaC: 1.0, lambdaK: 1.5, lambdaD: 0.8, lambdaU: 0.5, lambdaB: 0.7,
      }),
      settleUntilConvergence: vi.fn().mockResolvedValue({
        rounds: 1, converged: true, phiBefore: 0.05, phiAfter: 0.04,
        coherenceScoreBefore: 95, coherenceScoreAfter: 96,
        monotonicityMaintained: true, summary: [],
      }),
    },
    mockActionValidationService: {
      // validateAction returns just the validation record (route wraps it with proposal)
      validateAction: vi.fn().mockResolvedValue({
        id: 'val-1', actionProposalId: 'action-1', admissibility: 'VALID',
        deltaPhi: -0.01, psiScore: 0.1, constraintViolationRisk: 0,
        dependencyBreakageRisk: 0, contradictionAmplification: 0,
        uncertaintyExposure: 0, provenanceFragility: 0, propagatedRisk: 0,
        impactedEntityIds: [], provenanceChain: [], reasons: [], createdAt: now,
      }),
    },
    mockPolicyRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findActiveRules: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'policy-1' }),
      findApprovals: vi.fn().mockResolvedValue([]),
      createApproval: vi.fn().mockResolvedValue({ id: 'approval-1' }),
      updateApproval: vi.fn().mockResolvedValue({ id: 'approval-1' }),
      findApprovalById: vi.fn().mockResolvedValue(null),
    },
    mockPolicyService: {
      evaluatePolicy: vi.fn().mockResolvedValue({ decision: 'ALLOW', matchedRules: [], requiresApproval: false, escalations: [], warnings: [] }),
      requestApproval: vi.fn().mockResolvedValue({ id: 'approval-1' }),
    },
    mockTraceRepo: {
      createSession: vi.fn().mockResolvedValue({ id: 'session-1', name: 'test', status: 'ACTIVE', startedAt: now }),
      findSessionById: vi.fn().mockResolvedValue(null),
      findAllSessions: vi.fn().mockResolvedValue([]),
      appendEvent: vi.fn().mockResolvedValue({ id: 'event-1' }),
      findEventsBySession: vi.fn().mockResolvedValue([]),
      updateSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
    },
    mockTraceService: {
      startSession: vi.fn().mockResolvedValue({ id: 'session-1', name: 'test', status: 'ACTIVE', startedAt: now }),
      appendEvent: vi.fn().mockResolvedValue({ id: 'event-1' }),
      endSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
      getSessionStats: vi.fn().mockResolvedValue({ eventCount: 0, entityCount: 0, phiDelta: 0 }),
    },
    mockPlanRepo: {
      findAll: vi.fn().mockResolvedValue([]),
      findAllPlans: vi.fn().mockResolvedValue([]),
      findActivePlans: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'plan-1', name: 'test', goal: 'test', status: 'PENDING', steps: [], entityIds: [], createdAt: now, updatedAt: now }),
      update: vi.fn().mockResolvedValue({ id: 'plan-1' }),
    },
    mockPlanService: {
      createPlan: vi.fn().mockResolvedValue({ id: 'plan-1', name: 'test', goal: 'test', status: 'PENDING', steps: [], entityIds: [], createdAt: now, updatedAt: now }),
      getPlanProgress: vi.fn().mockResolvedValue({ plan: { id: 'plan-1' }, totalSteps: 0, completedSteps: 0, runningSteps: 0, failedSteps: 0, blockedSteps: 0, readySteps: 0, percentComplete: 0 }),
      startNextStep: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      completeStep: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      failStep: vi.fn().mockResolvedValue({ id: 'plan-1' }),
    },
    mockWebhookService: {
      dispatch: vi.fn(),
      dispatchEvent: vi.fn(),
    },
  };
});

// ── Module mocks (factories run after vi.hoisted values are initialized) ──────

vi.mock('../../src/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
  default: mockPrisma,
}));

vi.mock('../../src/infrastructure/container.js', () => ({
  entityRepo: mockEntityRepo,
  claimRepo: mockClaimRepo,
  auditRepo: mockAuditRepo,
  contradictionRepo: mockContradictionRepo,
  branchRepo: mockBranchRepo,
  constraintRepo: mockConstraintRepo,
  dependencyRepo: mockDependencyRepo,
  actionRepo: mockActionRepo,
  observationRepo: mockObservationRepo,
  snapshotRepo: mockSnapshotRepo,
  sourceRepo: mockSourceRepo,
  policyRepo: mockPolicyRepo,
  traceRepo: mockTraceRepo,
  planRepo: mockPlanRepo,
  settlingService: mockSettlingService,
  actionValidationService: mockActionValidationService,
  policyService: mockPolicyService,
  traceService: mockTraceService,
  planService: mockPlanService,
  webhookService: mockWebhookService,
  engineConfig: {
    coherenceWeights: { lambdaC: 1.0, lambdaK: 1.5, lambdaD: 0.8, lambdaU: 0.5, lambdaB: 0.7, kScale: 2.0 },
    actionWeights: { mu1: 0.2, mu2: 0.2, mu3: 0.15, mu4: 0.1, mu5: 0.15, mu6: 0.2 },
    stalenessLambda: 0.001,
    contradictionThreshold: 0.5,
    branchThreshold: 0.7,
    actionBudget: 5.0,
    actionEpsilon: 0.6,
    settlingMaxRounds: 50,
    propagatedRiskGlobalThreshold: 0.7,
    propagationHops: 4,
    propagationDecay: 0.7,
  },
}));

import { buildApp } from '../../src/app.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const MASTER_KEY = 'dev-api-key'; // config.ts default

function authHeaders() {
  return { 'X-API-Key': MASTER_KEY };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('HTTP Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Health ────────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(typeof body.timestamp).toBe('string');
    });
  });

  // ── Auth middleware ───────────────────────────────────────────────────────

  describe('Auth middleware', () => {
    it('returns 401 when no API key is provided', async () => {
      const res = await app.inject({ method: 'GET', url: '/entities' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/invalid or missing/i);
    });

    it('returns 401 for an invalid API key', async () => {
      const res = await app.inject({
        method: 'GET', url: '/entities',
        headers: { 'X-API-Key': 'bad-key-xyz' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('allows through with the master API key', async () => {
      const res = await app.inject({
        method: 'GET', url: '/entities',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
    });

    it('echoes X-Request-Id on every response', async () => {
      const res = await app.inject({
        method: 'GET', url: '/health',
        headers: { 'X-Request-Id': 'test-correlation-id' },
      });
      expect(res.headers['x-request-id']).toBe('test-correlation-id');
    });

    it('generates X-Request-Id if not provided', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(typeof res.headers['x-request-id']).toBe('string');
      expect(res.headers['x-request-id']).toBeTruthy();
    });
  });

  // ── Entities ──────────────────────────────────────────────────────────────

  describe('GET /entities', () => {
    it('returns an empty array when no entities exist', async () => {
      mockEntityRepo.findAll.mockResolvedValueOnce([]);
      const res = await app.inject({ method: 'GET', url: '/entities', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns entities when they exist', async () => {
      const entity = { id: 'e1', name: 'Alpha', type: 'AGENT', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      mockEntityRepo.findAll.mockResolvedValueOnce([entity]);
      const res = await app.inject({ method: 'GET', url: '/entities', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
      expect(res.json()[0].id).toBe('e1');
    });
  });

  describe('GET /entities/:id', () => {
    it('returns 404 when entity does not exist', async () => {
      mockEntityRepo.findById.mockResolvedValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/entities/does-not-exist', headers: authHeaders() });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatch(/not found/i);
    });

    it('returns the entity when it exists', async () => {
      const entity = { id: 'e1', name: 'Alpha', type: 'AGENT', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      mockEntityRepo.findById.mockResolvedValueOnce(entity);
      const res = await app.inject({ method: 'GET', url: '/entities/e1', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('e1');
    });
  });

  describe('GET /entities/:id/state', () => {
    it('returns 404 when entity does not exist', async () => {
      mockEntityRepo.findById.mockResolvedValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/entities/missing/state', headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });

    it('returns entity state when entity exists', async () => {
      const entity = { id: 'e1', name: 'Alpha', type: 'AGENT', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      mockEntityRepo.findById.mockResolvedValueOnce(entity);
      mockClaimRepo.findActive.mockResolvedValueOnce([]);
      mockDependencyRepo.findFrom.mockResolvedValueOnce([]);
      mockDependencyRepo.findTo.mockResolvedValueOnce([]);
      const res = await app.inject({ method: 'GET', url: '/entities/e1/state', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entity.id).toBe('e1');
      expect(Array.isArray(body.activeClaims)).toBe(true);
      expect(typeof body.stateSnapshot).toBe('object');
    });
  });

  describe('POST /entities', () => {
    it('creates an entity and returns 201', async () => {
      const created = { id: 'e2', name: 'Beta', type: 'TASK', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      mockEntityRepo.create.mockResolvedValueOnce(created);
      const res = await app.inject({
        method: 'POST', url: '/entities', headers: authHeaders(),
        payload: { name: 'Beta', type: 'TASK' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe('e2');
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await app.inject({
        method: 'POST', url: '/entities', headers: authHeaders(),
        payload: { name: 'Missing Type' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Claims ────────────────────────────────────────────────────────────────
  // Note: there is no GET /claims list endpoint — only GET /claims/:id, POST /claims

  describe('GET /claims/:id', () => {
    it('returns 404 when claim does not exist', async () => {
      mockClaimRepo.findById.mockResolvedValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/claims/missing', headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Contradictions ────────────────────────────────────────────────────────

  describe('GET /contradictions', () => {
    it('returns an empty array', async () => {
      mockContradictionRepo.findAll.mockResolvedValueOnce([]);
      const res = await app.inject({ method: 'GET', url: '/contradictions', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe('GET /contradictions/:id', () => {
    it('returns 404 for unknown contradiction', async () => {
      mockContradictionRepo.findById.mockResolvedValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/contradictions/nope', headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Branches ──────────────────────────────────────────────────────────────

  describe('GET /branches', () => {
    it('returns an empty array', async () => {
      mockBranchRepo.findAll.mockResolvedValueOnce([]);
      const res = await app.inject({ method: 'GET', url: '/branches', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe('GET /branches/:id', () => {
    it('returns 404 for missing branch', async () => {
      mockBranchRepo.findById.mockResolvedValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/branches/x', headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Constraints ───────────────────────────────────────────────────────────

  describe('GET /constraints', () => {
    it('returns an empty array', async () => {
      mockConstraintRepo.findAll.mockResolvedValueOnce([]);
      const res = await app.inject({ method: 'GET', url: '/constraints', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Dependencies ──────────────────────────────────────────────────────────

  describe('GET /dependencies', () => {
    it('returns an empty array', async () => {
      mockDependencyRepo.findAll.mockResolvedValueOnce([]);
      const res = await app.inject({ method: 'GET', url: '/dependencies', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── World ─────────────────────────────────────────────────────────────────

  describe('GET /world/coherence', () => {
    it('returns coherence score and phi breakdown', async () => {
      const res = await app.inject({ method: 'GET', url: '/world/coherence', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.coherenceScore).toBe('number');
      expect(typeof body.phi).toBe('number');
      expect(body.breakdown).toHaveProperty('Vc');
      expect(body.breakdown).toHaveProperty('Vk');
      expect(typeof body.formula).toBe('string');
      expect(typeof body.timestamp).toBe('string');
    });
  });

  describe('GET /world/snapshot', () => {
    it('returns world snapshot with entity and claim counts', async () => {
      mockEntityRepo.findAll.mockResolvedValueOnce([]);
      mockClaimRepo.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockContradictionRepo.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockBranchRepo.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockConstraintRepo.findActiveViolations.mockResolvedValueOnce([]);
      mockSnapshotRepo.findLatest.mockResolvedValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/world/snapshot', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.entityCount).toBe('number');
      expect(typeof body.coherenceScore).toBe('number');
    });
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  describe('POST /actions/propose', () => {
    it('creates an action proposal and returns 201', async () => {
      const res = await app.inject({
        method: 'POST', url: '/actions/propose', headers: authHeaders(),
        payload: { operation: 'update_status', impactedEntityIds: ['e1'] },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe('action-1');
    });

    it('returns 400 when impactedEntityIds is missing', async () => {
      const res = await app.inject({
        method: 'POST', url: '/actions/propose', headers: authHeaders(),
        payload: { operation: 'update_status' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /actions/validate', () => {
    it('proposes and validates an action, returning proposal + validation', async () => {
      const res = await app.inject({
        method: 'POST', url: '/actions/validate', headers: authHeaders(),
        payload: { operation: 'update_status', impactedEntityIds: ['e1'] },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('proposal');
      expect(body).toHaveProperty('validation');
      expect(body.validation.admissibility).toBe('VALID');
    });
  });

  // ── Observations ──────────────────────────────────────────────────────────
  // Note: there is no GET /observations list endpoint — only POST /observations and GET /observations/:id

  describe('GET /observations/:id', () => {
    it('returns 404 for unknown observation', async () => {
      mockObservationRepo.findById.mockResolvedValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/observations/missing', headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Policies ──────────────────────────────────────────────────────────────

  describe('GET /policy/rules', () => {
    it('returns empty array', async () => {
      mockPolicyRepo.findAll.mockResolvedValueOnce([]);
      const res = await app.inject({ method: 'GET', url: '/policy/rules', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Traces ────────────────────────────────────────────────────────────────

  describe('GET /trace/sessions', () => {
    it('returns empty array', async () => {
      mockTraceRepo.findAllSessions.mockResolvedValueOnce([]);
      const res = await app.inject({ method: 'GET', url: '/trace/sessions', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Plans ─────────────────────────────────────────────────────────────────

  describe('GET /plans', () => {
    it('returns empty array', async () => {
      mockPlanRepo.findAll.mockResolvedValueOnce([]);
      const res = await app.inject({ method: 'GET', url: '/plans', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Workspace routes ──────────────────────────────────────────────────────
  // Workspace routes require a workspaceId on the auth context.
  // Master key sets workspaceId=null → always 401.
  // JWT path: sign with the default dev secret and mock workspaceMember lookup.

  const jwtHeaders = () => ({
    authorization: `Bearer ${jwt.sign({ userId: 'user-1' }, 'dev-jwt-secret-change-in-prod')}`,
  });

  describe('GET /workspace', () => {
    it('returns 401 with master key (no workspaceId)', async () => {
      const res = await app.inject({ method: 'GET', url: '/workspace', headers: authHeaders() });
      expect(res.statusCode).toBe(401);
    });

    it('returns workspace info when authenticated via JWT', async () => {
      mockPrisma.workspaceMember.findFirst.mockResolvedValueOnce({ workspaceId: 'ws-1' });
      mockPrisma.workspace.findUnique.mockResolvedValueOnce({
        id: 'ws-1', name: 'Test WS', slug: 'test-ws', tier: 'FREE', status: 'ACTIVE',
        trialEndsAt: null, claimsThisMonth: 0,
        apiKeys: [],
      });
      const res = await app.inject({ method: 'GET', url: '/workspace', headers: jwtHeaders() });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe('ws-1');
      expect(body.tier).toBe('FREE');
    });

    it('returns 404 when workspace row is missing', async () => {
      mockPrisma.workspaceMember.findFirst.mockResolvedValueOnce({ workspaceId: 'ws-missing' });
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/workspace', headers: jwtHeaders() });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /workspace/api-keys', () => {
    it('returns 401 with master key', async () => {
      const res = await app.inject({ method: 'POST', url: '/workspace/api-keys', headers: authHeaders(), payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('creates and returns a new API key via JWT', async () => {
      mockPrisma.workspaceMember.findFirst.mockResolvedValueOnce({ workspaceId: 'ws-1' });
      mockPrisma.workspaceApiKey.create = vi.fn().mockResolvedValueOnce({
        id: 'key-1', name: 'API Key', keyPrefix: 'inv_abc12345', createdAt: new Date().toISOString(),
      });
      const res = await app.inject({
        method: 'POST', url: '/workspace/api-keys',
        headers: jwtHeaders(),
        payload: { name: 'My Key' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.id).toBe('key-1');
      expect(body).toHaveProperty('apiKey'); // raw key returned once
    });
  });

  describe('DELETE /workspace/api-keys/:id', () => {
    it('returns 401 with master key', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/workspace/api-keys/key-1', headers: authHeaders() });
      expect(res.statusCode).toBe(401);
    });

    it('revokes the key via JWT', async () => {
      mockPrisma.workspaceMember.findFirst.mockResolvedValueOnce({ workspaceId: 'ws-1' });
      mockPrisma.workspaceApiKey.updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
      const res = await app.inject({ method: 'DELETE', url: '/workspace/api-keys/key-1', headers: jwtHeaders() });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.revoked).toBe(true);
    });
  });

  // ── Auth routes (no master key required) ─────────────────────────────────

  describe('POST /auth/register', () => {
    it('is accessible without an API key (auth routes skip preHandler)', async () => {
      // /auth/ is excluded from the auth preHandler — verify not 401
      const res = await app.inject({
        method: 'POST', url: '/auth/register',
        payload: { email: 'test@example.com', password: 'password', workspaceName: 'MyWorkspace' },
      });
      expect(res.statusCode).not.toBe(401);
    });
  });

  // ── Error handler ─────────────────────────────────────────────────────────

  describe('Global error handler', () => {
    it('returns JSON on an unknown route', async () => {
      const res = await app.inject({ method: 'GET', url: '/does-not-exist', headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });
  });
});
