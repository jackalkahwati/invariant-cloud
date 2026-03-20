import type { FastifyInstance } from 'fastify';
import {
  settlingService, snapshotRepo, entityRepo, claimRepo,
  contradictionRepo, branchRepo, constraintRepo, auditRepo,
} from '../../../infrastructure/container.js';
import { computeCoherenceScore } from '../../../application/services/CoherenceEngine.js';

export async function worldRoutes(app: FastifyInstance) {
  // GET /world/coherence, current coherence score and Phi breakdown
  app.get('/world/coherence', {
    schema: {
      tags: ['World'],
      summary: 'Get current coherence score and incoherence energy breakdown',
    },
  }, async () => {
    const now = new Date();
    const breakdown = await settlingService.computeCurrentPhiBreakdown(now);
    return {
      coherenceScore: breakdown.coherenceScore,
      phi: breakdown.phi,
      breakdown: {
        Vc: breakdown.Vc,
        Vk: breakdown.Vk,
        Vd: breakdown.Vd,
        Vu: breakdown.Vu,
        Vb: breakdown.Vb,
      },
      weights: {
        lambdaC: breakdown.lambdaC,
        lambdaK: breakdown.lambdaK,
        lambdaD: breakdown.lambdaD,
        lambdaU: breakdown.lambdaU,
        lambdaB: breakdown.lambdaB,
      },
      formula: 'Phi(G) = lambdaC*Vc + lambdaK*Vk + lambdaD*Vd + lambdaU*Vu + lambdaB*Vb',
      coherenceFormula: 'CoherenceScore = 100 * exp(-k * Phi_norm)',
      timestamp: now.toISOString(),
    };
  });

  // GET /world/snapshot, current world state snapshot
  app.get('/world/snapshot', {
    schema: {
      tags: ['World'],
      summary: 'Get current world state snapshot',
    },
  }, async () => {
    const [entities, activeClaims, allClaims, contradictions, openContradictions,
           branches, openBranches, violations, snapshot] = await Promise.all([
      entityRepo.findAll({ isActive: true }),
      claimRepo.findAll({ status: 'ACTIVE' }),
      claimRepo.findAll(),
      contradictionRepo.findAll(),
      contradictionRepo.findAll('OPEN'),
      branchRepo.findAll(),
      branchRepo.findAll('OPEN'),
      constraintRepo.findActiveViolations(),
      snapshotRepo.findLatest(),
    ]);

    const breakdown = await settlingService.computeCurrentPhiBreakdown();

    return {
      coherenceScore: breakdown.coherenceScore,
      phi: breakdown.phi,
      entityCount: entities.length,
      activeClaimCount: activeClaims.length,
      totalClaimCount: allClaims.length,
      contradictionCount: allClaims.length > 0 ? contradictions.length : 0,
      openContradictionCount: openContradictions.length,
      branchCount: branches.length,
      openBranchCount: openBranches.length,
      constraintViolationCount: violations.length,
      lastSnapshot: snapshot,
      highRiskEntities: getHighRiskEntities(activeClaims, openContradictions, violations),
    };
  });

  // POST /world/settle, manually trigger a settling pass
  app.post('/world/settle', {
    schema: {
      tags: ['World'],
      summary: 'Manually trigger the discrete fixed-point settling loop',
    },
  }, async () => {
    const rounds = await settlingService.settle();
    const converged = rounds.some(r => r.converged);
    const lastRound = rounds[rounds.length - 1];

    return {
      rounds: rounds.length,
      converged,
      phiBefore: rounds[0]?.phiBefore ?? 0,
      phiAfter: lastRound?.phiAfter ?? 0,
      coherenceScoreBefore: rounds[0]?.coherenceScoreBefore ?? 100,
      coherenceScoreAfter: lastRound?.coherenceScoreAfter ?? 100,
      monotonicityMaintained: rounds.every(r => r.monotonicity),
      summary: rounds.map(r => ({
        round: r.round,
        contradictionsDetected: r.contradictionsDetected,
        branchesCreated: r.branchesCreated,
        claimsInvalidated: r.claimsInvalidated,
        constraintViolationsFound: r.constraintViolationsFound,
        phiChange: r.phiAfter - r.phiBefore,
        monotonicity: r.monotonicity,
      })),
    };
  });

  // GET /world/history, recent snapshots
  app.get('/world/history', {
    schema: {
      tags: ['World'],
      summary: 'Get recent world state snapshots',
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      },
    },
  }, async (req) => {
    const query = req.query as { limit?: number };
    return snapshotRepo.findAll(query.limit ?? 20);
  });

  // GET /search, search entities and claims
  app.get('/search', {
    schema: {
      tags: ['World'],
      summary: 'Search entities and claims',
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['entity', 'claim', 'all'] },
        },
      },
    },
  }, async (req) => {
    const query = req.query as { q: string; type?: string };
    const searchType = query.type ?? 'all';
    const q = query.q.toLowerCase();

    const results: { entities: unknown[]; claims: unknown[] } = {
      entities: [],
      claims: [],
    };

    if (searchType === 'entity' || searchType === 'all') {
      const entities = await entityRepo.findAll();
      results.entities = entities.filter(
        e => e.name.toLowerCase().includes(q)
          || e.type.toLowerCase().includes(q)
          || (e.description ?? '').toLowerCase().includes(q)
      );
    }

    if (searchType === 'claim' || searchType === 'all') {
      const claims = await claimRepo.findAll({ status: 'ACTIVE' });
      results.claims = claims.filter(
        c => c.predicate.toLowerCase().includes(q)
          || JSON.stringify(c.value).toLowerCase().includes(q)
          || c.entity.name.toLowerCase().includes(q)
      );
    }

    return results;
  });

  // GET /world/stream, Server-Sent Events: live coherence score
  // Pushes `{ coherenceScore, phi, timestamp }` every 5 seconds.
  // Accepts optional `?entityId=` to scope the stream to a specific entity.
  // Properly tears down the interval when the client disconnects.
  app.get('/world/stream', {
    schema: {
      tags: ['World'],
      summary: 'Server-Sent Events stream of coherence score updates',
      querystring: {
        type: 'object',
        properties: {
          entityId: { type: 'string', description: 'Filter updates to a specific entity' },
        },
      },
    },
  }, async (req, reply) => {
    const query = req.query as { entityId?: string };
    const entityId = query.entityId ?? null;

    // SSE response headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Flush an initial comment to establish the stream immediately
    reply.raw.write(': connected\n\n');

    const sendEvent = async () => {
      try {
        const breakdown = await settlingService.computeCurrentPhiBreakdown();
        const payload: Record<string, unknown> = {
          coherenceScore: breakdown.coherenceScore,
          phi: breakdown.phi,
          timestamp: new Date().toISOString(),
        };
        if (entityId) payload.entityId = entityId;
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // Silently skip failed snapshots, the stream will retry next tick
      }
    };

    // Send immediately, then every 5 seconds
    await sendEvent();
    const interval = setInterval(() => { void sendEvent(); }, 5000);

    // Clean up when the client disconnects
    reply.raw.on('close', () => {
      clearInterval(interval);
    });

    // Keep the Fastify reply open (do not call reply.send())
    await new Promise<void>((resolve) => {
      reply.raw.on('close', resolve);
      reply.raw.on('error', resolve);
    });
  });

  // GET /audit/:id, get audit event by ID
  app.get('/audit/:id', {
    schema: {
      tags: ['World'],
      summary: 'Get audit event by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await auditRepo.findById(id);
    if (!event) return reply.status(404).send({ error: 'Audit event not found' });
    return event;
  });

  // GET /audit, recent audit trail
  app.get('/audit', {
    schema: {
      tags: ['World'],
      summary: 'Get recent audit trail',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          type: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const query = req.query as { limit?: number; type?: string };
    if (query.type) return auditRepo.findByType(query.type, query.limit ?? 50);
    return auditRepo.findRecent(query.limit ?? 50);
  });
}

function getHighRiskEntities(
  claims: Array<{ entityId: string; entity: { name: string }; confidence: number }>,
  contradictions: Array<{ claimA?: { entityId: string } | null; claimB?: { entityId: string } | null; score: number }>,
  violations: Array<{ entityIds: string[]; severity: number }>,
): Array<{ entityId: string; name: string; riskScore: number; reasons: string[] }> {
  const entityRisk = new Map<string, { name: string; riskScore: number; reasons: string[] }>();

  // Add contradiction risk
  for (const c of contradictions) {
    for (const eid of [c.claimA?.entityId, c.claimB?.entityId].filter(Boolean) as string[]) {
      const existing = entityRisk.get(eid);
      const claim = claims.find(cl => cl.entityId === eid);
      if (!existing) {
        entityRisk.set(eid, { name: claim?.entity.name ?? eid, riskScore: c.score, reasons: [`Contradiction score: ${c.score.toFixed(2)}`] });
      } else {
        existing.riskScore += c.score * 0.5;
        existing.reasons.push(`Contradiction score: ${c.score.toFixed(2)}`);
      }
    }
  }

  // Add violation risk
  for (const v of violations) {
    for (const eid of v.entityIds) {
      const existing = entityRisk.get(eid);
      const claim = claims.find(cl => cl.entityId === eid);
      if (!existing) {
        entityRisk.set(eid, { name: claim?.entity.name ?? eid, riskScore: v.severity, reasons: [`Constraint violation severity: ${v.severity.toFixed(2)}`] });
      } else {
        existing.riskScore += v.severity;
        existing.reasons.push(`Constraint violation severity: ${v.severity.toFixed(2)}`);
      }
    }
  }

  return [...entityRisk.entries()]
    .map(([entityId, v]) => ({ entityId, ...v }))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);
}
