import type { FastifyInstance } from 'fastify';
import {
  observationRepo, sourceRepo, claimRepo, entityRepo, auditRepo, settlingService,
} from '../../../infrastructure/container.js';

export async function observationRoutes(app: FastifyInstance) {
  // POST /observations — ingest an observation and extract claims
  app.post('/observations', {
    schema: {
      tags: ['Observations'],
      summary: 'Ingest a new observation and extract claims',
      body: {
        type: 'object',
        required: ['sourceId', 'type', 'content', 'entityIds'],
        properties: {
          sourceId: { type: 'string' },
          sourceName: { type: 'string' },
          type: { type: 'string' },
          content: { type: 'object' },
          entityIds: { type: 'array', items: { type: 'string' } },
          claims: {
            type: 'array',
            items: {
              type: 'object',
              required: ['entityId', 'predicate', 'value'],
              properties: {
                entityId: { type: 'string' },
                predicate: { type: 'string' },
                value: {},
                confidence: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      sourceId?: string;
      sourceName?: string;
      type: string;
      content: Record<string, unknown>;
      entityIds: string[];
      claims?: Array<{
        entityId: string;
        predicate: string;
        value: unknown;
        confidence?: number;
      }>;
    };

    // Resolve source
    let source;
    if (body.sourceId) {
      source = await sourceRepo.findById(body.sourceId);
      if (!source) return reply.status(404).send({ error: 'Source not found' });
    } else if (body.sourceName) {
      source = await sourceRepo.getOrCreate(body.sourceName, 'SYSTEM');
    } else {
      return reply.status(400).send({ error: 'sourceId or sourceName required' });
    }

    // Create observation
    const observation = await observationRepo.create({
      sourceId: source.id,
      type: body.type,
      content: body.content,
      entityIds: body.entityIds,
      processed: false,
    });

    const createdClaims = [];

    // Extract claims from observation
    if (body.claims && body.claims.length > 0) {
      for (const claimData of body.claims) {
        const entity = await entityRepo.findById(claimData.entityId);
        if (!entity) continue;

        // Supersede existing active claim for same predicate on canonical branch
        const existingActive = await claimRepo.findActive(claimData.entityId, claimData.predicate);
        for (const existing of existingActive) {
          if (!existing.branchId) {
            const newClaim = await claimRepo.create({
              entityId: claimData.entityId,
              predicate: claimData.predicate,
              value: claimData.value,
              confidence: claimData.confidence ?? source.trustScore,
              sourceId: source.id,
              timestamp: new Date(),
              status: 'ACTIVE',
              observationId: observation.id,
            });
            await claimRepo.supersede(existing.id, newClaim.id);
            createdClaims.push(newClaim);
            continue;
          }
        }

        if (existingActive.filter(c => !c.branchId).length === 0) {
          const newClaim = await claimRepo.create({
            entityId: claimData.entityId,
            predicate: claimData.predicate,
            value: claimData.value,
            confidence: claimData.confidence ?? source.trustScore,
            sourceId: source.id,
            timestamp: new Date(),
            status: 'ACTIVE',
            observationId: observation.id,
          });
          createdClaims.push(newClaim);
        }
      }
    }

    await observationRepo.markProcessed(observation.id);

    await auditRepo.create({
      type: 'OBSERVATION_INGESTED',
      data: {
        observationId: observation.id,
        type: body.type,
        claimsCreated: createdClaims.length,
        entityIds: body.entityIds,
      },
    });

    // Trigger async settling
    settlingService.settle().catch(err => app.log.error({ err }, 'Settling error'));

    return reply.status(201).send({ observation, claimsCreated: createdClaims });
  });

  // GET /observations/:id
  app.get('/observations/:id', {
    schema: {
      tags: ['Observations'],
      summary: 'Get observation by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const obs = await observationRepo.findById(id);
    if (!obs) return reply.status(404).send({ error: 'Observation not found' });
    return obs;
  });
}
