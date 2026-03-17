import type { FastifyInstance } from 'fastify';
import { entityRepo, claimRepo, dependencyRepo, auditRepo } from '../../../infrastructure/container.js';

export async function entityRoutes(app: FastifyInstance) {
  // GET /entities
  app.get('/entities', {
    schema: {
      tags: ['Entities'],
      summary: 'List all entities',
      querystring: { type: 'object', properties: { type: { type: 'string' }, active: { type: 'boolean' } } },
    },
  }, async (req) => {
    const query = req.query as { type?: string; active?: boolean };
    return entityRepo.findAll({
      type: query.type as never,
      isActive: query.active,
    });
  });

  // GET /entities/:id
  app.get('/entities/:id', {
    schema: {
      tags: ['Entities'],
      summary: 'Get entity by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const entity = await entityRepo.findById(id);
    if (!entity) return reply.status(404).send({ error: 'Entity not found' });
    return entity;
  });

  // GET /entities/:id/state — current active claims for entity
  app.get('/entities/:id/state', {
    schema: {
      tags: ['Entities'],
      summary: 'Get current state of entity (active claims)',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const entity = await entityRepo.findById(id);
    if (!entity) return reply.status(404).send({ error: 'Entity not found' });

    const claims = await claimRepo.findActive(id);
    const deps = await Promise.all([
      dependencyRepo.findFrom(id),
      dependencyRepo.findTo(id),
    ]);

    return {
      entity,
      activeClaims: claims,
      dependencies: { from: deps[0], to: deps[1] },
      stateSnapshot: claims.reduce<Record<string, unknown>>((acc, c) => {
        acc[c.predicate] = c.value;
        return acc;
      }, {}),
    };
  });

  // GET /entities/:id/history
  app.get('/entities/:id/history', {
    schema: {
      tags: ['Entities'],
      summary: 'Get entity history (all claims + audit events)',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const entity = await entityRepo.findById(id);
    if (!entity) return reply.status(404).send({ error: 'Entity not found' });

    const [claims, events] = await Promise.all([
      claimRepo.findAll({ entityId: id }),
      auditRepo.findByEntity(id),
    ]);

    return { entity, claims, auditEvents: events };
  });

  // POST /entities
  app.post('/entities', {
    schema: {
      tags: ['Entities'],
      summary: 'Create a new entity',
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { name: string; type: string; description?: string; metadata?: Record<string, unknown> };
    const entity = await entityRepo.create({
      name: body.name,
      type: body.type as never,
      description: body.description,
      metadata: body.metadata,
      isActive: true,
    });
    await auditRepo.create({ type: 'ENTITY_CREATED', entityId: entity.id, data: { name: entity.name, type: entity.type } });
    return reply.status(201).send(entity);
  });
}
