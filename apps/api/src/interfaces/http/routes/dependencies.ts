import type { FastifyInstance } from 'fastify';
import { dependencyRepo, entityRepo, auditRepo } from '../../../infrastructure/container.js';

export async function dependencyRoutes(app: FastifyInstance) {
  // GET /dependencies
  app.get('/dependencies', {
    schema: {
      tags: ['Dependencies'],
      summary: 'List all active dependencies',
      querystring: {
        type: 'object',
        properties: {
          fromEntityId: { type: 'string' },
          toEntityId: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const query = req.query as { fromEntityId?: string; toEntityId?: string };
    if (query.fromEntityId) return dependencyRepo.findFrom(query.fromEntityId);
    if (query.toEntityId) return dependencyRepo.findTo(query.toEntityId);
    return dependencyRepo.findAll();
  });

  // POST /dependencies
  app.post('/dependencies', {
    schema: {
      tags: ['Dependencies'],
      summary: 'Create a signed typed dependency between entities',
      body: {
        type: 'object',
        required: ['fromEntityId', 'toEntityId', 'type'],
        properties: {
          fromEntityId: { type: 'string' },
          toEntityId: { type: 'string' },
          type: {
            type: 'string',
            enum: ['SUPPORTS', 'REQUIRES', 'IMPLIES', 'INVALIDATES', 'EXCLUDES', 'MUTEX', 'IMPLIES_NOT'],
          },
          weight: { type: 'number', minimum: 0, maximum: 1 },
          description: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      fromEntityId: string;
      toEntityId: string;
      type: string;
      weight?: number;
      description?: string;
      metadata?: Record<string, unknown>;
    };

    const [from, to] = await Promise.all([
      entityRepo.findById(body.fromEntityId),
      entityRepo.findById(body.toEntityId),
    ]);
    if (!from) return reply.status(404).send({ error: 'fromEntity not found' });
    if (!to) return reply.status(404).send({ error: 'toEntity not found' });

    const dep = await dependencyRepo.create({
      fromEntityId: body.fromEntityId,
      toEntityId: body.toEntityId,
      type: body.type as never,
      weight: body.weight ?? 1.0,
      description: body.description,
      metadata: body.metadata,
      isActive: true,
    });

    await auditRepo.create({
      type: 'DEPENDENCY_PROPAGATED',
      entityId: body.fromEntityId,
      data: { dependencyId: dep.id, type: body.type, fromEntityId: body.fromEntityId, toEntityId: body.toEntityId },
    });

    return reply.status(201).send(dep);
  });

  // DELETE /dependencies/:id
  app.delete('/dependencies/:id', {
    schema: {
      tags: ['Dependencies'],
      summary: 'Deactivate a dependency',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await dependencyRepo.delete(id);
    return reply.status(204).send();
  });
}
