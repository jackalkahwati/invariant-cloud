import type { FastifyInstance } from 'fastify';
import { branchRepo, claimRepo, auditRepo } from '../../../infrastructure/container.js';

export async function branchRoutes(app: FastifyInstance) {
  // GET /branches
  app.get('/branches', {
    schema: {
      tags: ['Branches'],
      summary: 'List all branches',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['OPEN', 'RESOLVED', 'MERGED', 'REJECTED'] },
        },
      },
    },
  }, async (req) => {
    const query = req.query as { status?: 'OPEN' | 'RESOLVED' | 'MERGED' | 'REJECTED' };
    return branchRepo.findAll(query.status);
  });

  // GET /branches/:id
  app.get('/branches/:id', {
    schema: {
      tags: ['Branches'],
      summary: 'Get branch by ID with supporting claims',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const branch = await branchRepo.findById(id);
    if (!branch) return reply.status(404).send({ error: 'Branch not found' });

    const claims = await claimRepo.findAll({ branchId: id });
    const entityIds = [...new Set(claims.map(c => c.entityId))];

    return { branch, claims, entityIds };
  });

  // POST /branches/:id/resolve
  app.post('/branches/:id/resolve', {
    schema: {
      tags: ['Branches'],
      summary: 'Resolve a branch (accept or reject)',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['RESOLVED', 'MERGED', 'REJECTED'] },
          resolution: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { status: 'RESOLVED' | 'MERGED' | 'REJECTED'; resolution?: string };
    const branch = await branchRepo.findById(id);
    if (!branch) return reply.status(404).send({ error: 'Branch not found' });

    const updated = await branchRepo.update(id, {
      status: body.status,
      metadata: { ...branch.metadata, resolution: body.resolution },
    });

    await auditRepo.create({
      type: 'BRANCH_RESOLVED',
      branchId: id,
      data: { status: body.status, resolution: body.resolution },
    });

    return updated;
  });

  // POST /branches — manually create a branch
  app.post('/branches', {
    schema: {
      tags: ['Branches'],
      summary: 'Create a new branch manually',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          parentBranchId: { type: 'string' },
          contradictionId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      name: string;
      description?: string;
      parentBranchId?: string;
      contradictionId?: string;
    };

    const branch = await branchRepo.create({
      name: body.name,
      description: body.description,
      parentBranchId: body.parentBranchId,
      status: 'OPEN',
      confidence: 0.5,
      contradictionId: body.contradictionId,
    });

    await auditRepo.create({
      type: 'BRANCH_CREATED',
      branchId: branch.id,
      data: { name: body.name, reason: 'manual' },
    });

    return reply.status(201).send(branch);
  });
}
