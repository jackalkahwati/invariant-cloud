import type { FastifyInstance } from 'fastify';
import { contradictionRepo, branchRepo, auditRepo, webhookService } from '../../../infrastructure/container.js';

export async function contradictionRoutes(app: FastifyInstance) {
  // GET /contradictions
  app.get('/contradictions', {
    schema: {
      tags: ['Contradictions'],
      summary: 'List all contradictions',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['OPEN', 'RESOLVED', 'BRANCHED'] },
        },
      },
    },
  }, async (req) => {
    const query = req.query as { status?: 'OPEN' | 'RESOLVED' | 'BRANCHED' };
    return contradictionRepo.findAll(query.status);
  });

  // GET /contradictions/:id
  app.get('/contradictions/:id', {
    schema: {
      tags: ['Contradictions'],
      summary: 'Get contradiction by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await contradictionRepo.findById(id);
    if (!c) return reply.status(404).send({ error: 'Contradiction not found' });
    return c;
  });

  // POST /contradictions, manually record a contradiction and dispatch webhook
  app.post('/contradictions', {
    schema: {
      tags: ['Contradictions'],
      summary: 'Manually record a contradiction between two claims',
      body: {
        type: 'object',
        required: ['claimAId', 'claimBId', 'score', 'severity', 'type'],
        properties: {
          claimAId: { type: 'string' },
          claimBId: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 1 },
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          type: {
            type: 'string',
            enum: [
              'NUMERIC_CONFLICT',
              'STATUS_CONFLICT',
              'TEMPORAL_CONFLICT',
              'MUTEX_TAG_CONFLICT',
              'RANGE_THRESHOLD_CONFLICT',
              'SEMANTIC',
            ],
          },
          description: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      claimAId: string;
      claimBId: string;
      score: number;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      type: import('../../../domain/entities/types.js').ContradictionType;
      description?: string;
    };

    // Check if contradiction already exists for this pair
    const existing = await contradictionRepo.findForClaims(body.claimAId, body.claimBId);
    if (existing) {
      return reply.status(409).send({ error: 'Contradiction already exists for this claim pair', existing });
    }

    const contradiction = await contradictionRepo.create({
      claimAId: body.claimAId,
      claimBId: body.claimBId,
      score: body.score,
      severity: body.severity,
      type: body.type,
      status: 'OPEN',
      description: body.description,
    });

    await auditRepo.create({
      type: 'CONTRADICTION_DETECTED',
      data: {
        contradictionId: contradiction.id,
        claimAId: body.claimAId,
        claimBId: body.claimBId,
        score: body.score,
        severity: body.severity,
      },
    });

    // Dispatch webhook event
    webhookService.dispatch('contradiction.detected', {
      contradictionId: contradiction.id,
      claimAId: body.claimAId,
      claimBId: body.claimBId,
      score: body.score,
      severity: body.severity,
      type: body.type,
      description: body.description,
    });

    return reply.status(201).send(contradiction);
  });

  // POST /contradictions/:id/resolve
  app.post('/contradictions/:id/resolve', {
    schema: {
      tags: ['Contradictions'],
      summary: 'Resolve a contradiction with a resolution note',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['resolution'],
        properties: { resolution: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { resolution: string };
    const c = await contradictionRepo.findById(id);
    if (!c) return reply.status(404).send({ error: 'Contradiction not found' });

    const updated = await contradictionRepo.update(id, {
      status: 'RESOLVED',
      resolution: body.resolution,
    });

    // Resolve associated branch if any
    if (c.branchId) {
      await branchRepo.update(c.branchId, { status: 'RESOLVED' });
    }

    await auditRepo.create({
      type: 'BRANCH_RESOLVED',
      data: { contradictionId: id, resolution: body.resolution, branchId: c.branchId },
    });

    return updated;
  });
}
