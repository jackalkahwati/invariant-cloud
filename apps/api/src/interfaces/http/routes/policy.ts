import type { FastifyInstance } from 'fastify';
import { policyService, policyRepo } from '../../../infrastructure/container.js';

export async function policyRoutes(app: FastifyInstance) {
  // ── Rules ──────────────────────────────────────────────────────────────────

  // GET /policy/rules
  app.get('/policy/rules', {
    schema: {
      tags: ['Policy'],
      summary: 'List all active policy rules',
    },
  }, async (_req, reply) => {
    const rules = await policyRepo.findActiveRules();
    return reply.send(rules);
  });

  // POST /policy/rules
  app.post('/policy/rules', {
    schema: {
      tags: ['Policy'],
      summary: 'Create a new policy rule',
      body: {
        type: 'object',
        required: ['name', 'condition', 'effect'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          layer: { type: 'string', enum: ['INGESTION', 'STATE', 'POLICY', 'PLAN', 'EXECUTION', 'TRACE'] },
          condition: { type: 'object' },
          effect: { type: 'string', enum: ['ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'ESCALATE', 'WARN'] },
          severity: { type: 'string', enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          entityTypes: { type: 'array', items: { type: 'string' } },
          operations: { type: 'array', items: { type: 'string' } },
          priority: { type: 'integer' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      name: string;
      description?: string;
      layer?: string;
      condition: Record<string, unknown>;
      effect: string;
      severity?: string;
      entityTypes?: string[];
      operations?: string[];
      priority?: number;
      metadata?: Record<string, unknown>;
    };
    const rule = await policyRepo.createRule(body);
    return reply.status(201).send(rule);
  });

  // GET /policy/rules/:id
  app.get('/policy/rules/:id', {
    schema: {
      tags: ['Policy'],
      summary: 'Get a policy rule by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rule = await policyRepo.findRuleById(id);
    if (!rule) return reply.status(404).send({ error: 'Policy rule not found' });
    return reply.send(rule);
  });

  // PATCH /policy/rules/:id
  app.patch('/policy/rules/:id', {
    schema: {
      tags: ['Policy'],
      summary: 'Update a policy rule',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: { type: 'object' },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const rule = await policyRepo.updateRule(id, body as never);
    return reply.send(rule);
  });

  // DELETE /policy/rules/:id
  app.delete('/policy/rules/:id', {
    schema: {
      tags: ['Policy'],
      summary: 'Deactivate a policy rule',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await policyRepo.deleteRule(id);
    return reply.status(204).send();
  });

  // ── Evaluate ───────────────────────────────────────────────────────────────

  // POST /policy/evaluate
  app.post('/policy/evaluate', {
    schema: {
      tags: ['Policy'],
      summary: 'Evaluate an action against all active policy rules',
      body: {
        type: 'object',
        required: ['proposalId', 'operation', 'impactedEntityIds'],
        properties: {
          proposalId: { type: 'string' },
          operation: { type: 'string' },
          impactedEntityIds: { type: 'array', items: { type: 'string' } },
          entityTypes: { type: 'array', items: { type: 'string' } },
          psiScore: { type: 'number' },
          deltaPhi: { type: 'number' },
          admissibility: { type: 'string' },
          actorId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      proposalId: string;
      operation: string;
      impactedEntityIds: string[];
      entityTypes?: string[];
      psiScore?: number;
      deltaPhi?: number;
      admissibility?: string;
      actorId?: string;
    };

    const decision = await policyService.evaluateProposal(body.proposalId, {
      operation: body.operation,
      impactedEntityIds: body.impactedEntityIds,
      entityTypes: body.entityTypes,
      psiScore: body.psiScore,
      deltaPhi: body.deltaPhi,
      admissibility: body.admissibility,
      actorId: body.actorId,
    });

    return reply.send(decision);
  });

  // ── Approvals ──────────────────────────────────────────────────────────────

  // GET /policy/approvals
  app.get('/policy/approvals', {
    schema: {
      tags: ['Policy'],
      summary: 'List pending approval requests',
    },
  }, async (_req, reply) => {
    const approvals = await policyRepo.findPendingApprovals();
    return reply.send(approvals);
  });

  // POST /policy/approvals
  app.post('/policy/approvals', {
    schema: {
      tags: ['Policy'],
      summary: 'Request approval for an action',
      body: {
        type: 'object',
        required: ['policyRuleId', 'requestedBy', 'reason'],
        properties: {
          policyRuleId: { type: 'string' },
          actionProposalId: { type: 'string' },
          requestedBy: { type: 'string' },
          reason: { type: 'string' },
          expiresInHours: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      policyRuleId: string;
      actionProposalId?: string;
      requestedBy: string;
      reason: string;
      expiresInHours?: number;
    };

    const approval = await policyService.requestApproval(
      body.policyRuleId,
      body.actionProposalId ?? '',
      body.requestedBy,
      body.reason,
      body.expiresInHours,
    );
    return reply.status(201).send(approval);
  });

  // GET /policy/approvals/:id
  app.get('/policy/approvals/:id', {
    schema: {
      tags: ['Policy'],
      summary: 'Get an approval request by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const approval = await policyRepo.findApprovalById(id);
    if (!approval) return reply.status(404).send({ error: 'Approval request not found' });
    return reply.send(approval);
  });

  // POST /policy/approvals/:id/decide
  app.post('/policy/approvals/:id/decide', {
    schema: {
      tags: ['Policy'],
      summary: 'Approve or deny a pending approval request',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['approved', 'reviewedBy'],
        properties: {
          approved: { type: 'boolean' },
          reviewedBy: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      approved: boolean;
      reviewedBy: string;
      reason?: string;
    };
    const result = await policyService.decideApproval(id, body.approved, body.reviewedBy, body.reason);
    return reply.send(result);
  });
}
