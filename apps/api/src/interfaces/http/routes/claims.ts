import type { FastifyInstance } from 'fastify';
import {
  claimRepo, sourceRepo, entityRepo, auditRepo, settlingService,
} from '../../../infrastructure/container.js';

export async function claimRoutes(app: FastifyInstance) {
  // POST /claims
  app.post('/claims', {
    schema: {
      tags: ['Claims'],
      summary: 'Assert a new claim about an entity',
      body: {
        type: 'object',
        required: ['entityId', 'predicate', 'value', 'sourceName'],
        properties: {
          entityId: { type: 'string' },
          predicate: { type: 'string' },
          value: {},
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          sourceName: { type: 'string' },
          sourceType: { type: 'string', enum: ['AGENT', 'HUMAN', 'TOOL', 'SYSTEM', 'SENSOR'] },
          branchId: { type: 'string' },
          observationId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      entityId: string;
      predicate: string;
      value: unknown;
      confidence?: number;
      sourceName: string;
      sourceType?: string;
      branchId?: string;
      observationId?: string;
    };

    // Validate entity exists
    const entity = await entityRepo.findById(body.entityId);
    if (!entity) return reply.status(404).send({ error: 'Entity not found' });

    // Get or create source
    const source = await sourceRepo.getOrCreate(body.sourceName, (body.sourceType ?? 'SYSTEM') as never);

    // Supersede any existing active claims for same entity+predicate on canonical branch
    if (!body.branchId) {
      const existingActive = await claimRepo.findActive(body.entityId, body.predicate);
      for (const existing of existingActive) {
        if (!existing.branchId) {
          // Will be superseded by the new claim
          const newClaim = await claimRepo.create({
            entityId: body.entityId,
            predicate: body.predicate,
            value: body.value,
            confidence: body.confidence ?? 1.0,
            sourceId: source.id,
            timestamp: new Date(),
            status: 'ACTIVE',
            branchId: body.branchId,
            observationId: body.observationId,
          });
          await claimRepo.supersede(existing.id, newClaim.id);
          await auditRepo.create({
            type: 'CLAIM_SUPERSEDED',
            entityId: body.entityId,
            data: { supersededId: existing.id, newClaimId: newClaim.id, predicate: body.predicate },
          });

          // Trigger settling after new claim
          settlingService.settle().catch(err => app.log.error({ err }, 'Settling error'));

          return reply.status(201).send(newClaim);
        }
      }
    }

    // Create new claim
    const claim = await claimRepo.create({
      entityId: body.entityId,
      predicate: body.predicate,
      value: body.value,
      confidence: body.confidence ?? 1.0,
      sourceId: source.id,
      timestamp: new Date(),
      status: body.branchId ? 'BRANCH_SPECIFIC' : 'ACTIVE',
      branchId: body.branchId,
      observationId: body.observationId,
    });

    await auditRepo.create({
      type: 'CLAIM_CREATED',
      entityId: body.entityId,
      data: { claimId: claim.id, predicate: body.predicate, value: body.value },
    });

    // Trigger async settling
    settlingService.settle().catch(err => app.log.error({ err }, 'Settling error'));

    return reply.status(201).send(claim);
  });

  // GET /claims/:id
  app.get('/claims/:id', {
    schema: {
      tags: ['Claims'],
      summary: 'Get claim by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const claim = await claimRepo.findById(id);
    if (!claim) return reply.status(404).send({ error: 'Claim not found' });
    return claim;
  });

  // POST /claims/:id/supersede
  app.post('/claims/:id/supersede', {
    schema: {
      tags: ['Claims'],
      summary: 'Manually supersede a claim',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['supersededById'],
        properties: { supersededById: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { supersededById: string };
    const claim = await claimRepo.findById(id);
    if (!claim) return reply.status(404).send({ error: 'Claim not found' });

    const updated = await claimRepo.supersede(id, body.supersededById);
    await auditRepo.create({
      type: 'CLAIM_SUPERSEDED',
      entityId: claim.entityId,
      data: { claimId: id, supersededById: body.supersededById },
    });
    return updated;
  });
}
