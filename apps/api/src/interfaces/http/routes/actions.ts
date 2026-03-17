import type { FastifyInstance } from 'fastify';
import {
  actionRepo, auditRepo, actionValidationService,
} from '../../../infrastructure/container.js';

export async function actionRoutes(app: FastifyInstance) {
  // POST /actions/propose
  app.post('/actions/propose', {
    schema: {
      tags: ['Actions'],
      summary: 'Propose an action for coherence validation',
      body: {
        type: 'object',
        required: ['operation', 'impactedEntityIds'],
        properties: {
          operation: { type: 'string' },
          description: { type: 'string' },
          parameters: { type: 'object' },
          impactedEntityIds: { type: 'array', items: { type: 'string' } },
          sourceId: { type: 'string' },
          branchId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      operation: string;
      description?: string;
      parameters?: Record<string, unknown>;
      impactedEntityIds: string[];
      sourceId?: string;
      branchId?: string;
    };

    const proposal = await actionRepo.createProposal({
      operation: body.operation,
      description: body.description,
      parameters: body.parameters ?? {},
      impactedEntityIds: body.impactedEntityIds,
      sourceId: body.sourceId,
      branchId: body.branchId,
      provenanceChain: [],
      status: 'PENDING',
    });

    await auditRepo.create({
      type: 'ACTION_PROPOSED',
      data: { proposalId: proposal.id, operation: proposal.operation },
    });

    return reply.status(201).send(proposal);
  });

  // POST /actions/validate — propose + immediately validate
  app.post('/actions/validate', {
    schema: {
      tags: ['Actions'],
      summary: 'Propose and immediately validate an action against world state',
      body: {
        type: 'object',
        required: ['operation', 'impactedEntityIds'],
        properties: {
          operation: { type: 'string' },
          description: { type: 'string' },
          parameters: { type: 'object' },
          impactedEntityIds: { type: 'array', items: { type: 'string' } },
          sourceId: { type: 'string' },
          branchId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      operation: string;
      description?: string;
      parameters?: Record<string, unknown>;
      impactedEntityIds: string[];
      sourceId?: string;
      branchId?: string;
    };

    const proposal = await actionRepo.createProposal({
      operation: body.operation,
      description: body.description,
      parameters: body.parameters ?? {},
      impactedEntityIds: body.impactedEntityIds,
      sourceId: body.sourceId,
      branchId: body.branchId,
      provenanceChain: [],
      status: 'PENDING',
    });

    const validation = await actionValidationService.validateAction(proposal);

    return reply.status(200).send({ proposal, validation });
  });

  // GET /actions/:id
  app.get('/actions/:id', {
    schema: {
      tags: ['Actions'],
      summary: 'Get action proposal by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const proposal = await actionRepo.findProposalById(id);
    if (!proposal) return reply.status(404).send({ error: 'Action proposal not found' });

    const validations = await actionRepo.findValidationsByProposalId(id);
    return { proposal, validations };
  });

  // GET /actions/:id/impact
  app.get('/actions/:id/impact', {
    schema: {
      tags: ['Actions'],
      summary: 'Get impact analysis for an action proposal',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const proposal = await actionRepo.findProposalById(id);
    if (!proposal) return reply.status(404).send({ error: 'Action proposal not found' });

    const validations = await actionRepo.findValidationsByProposalId(id);
    const latest = validations[0];

    return {
      proposal,
      latestValidation: latest,
      impactedEntityIds: latest?.impactedEntityIds ?? proposal.impactedEntityIds,
      provenanceChain: latest?.provenanceChain ?? [],
      admissibility: latest?.admissibility ?? 'PENDING',
      deltaPhi: latest?.deltaPhi,
      psiScore: latest?.psiScore,
      reasons: latest?.reasons ?? [],
    };
  });
}
