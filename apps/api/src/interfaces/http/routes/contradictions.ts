import type { FastifyInstance } from 'fastify';
import { contradictionRepo, branchRepo, auditRepo } from '../../../infrastructure/container.js';

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
