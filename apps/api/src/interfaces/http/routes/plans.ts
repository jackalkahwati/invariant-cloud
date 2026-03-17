import type { FastifyInstance } from 'fastify';
import { planService, planRepo } from '../../../infrastructure/container.js';

export async function planRoutes(app: FastifyInstance) {
  // ── Plans ──────────────────────────────────────────────────────────────────

  // POST /plans
  app.post('/plans', {
    schema: {
      tags: ['Plans'],
      summary: 'Create a new plan with steps',
      body: {
        type: 'object',
        required: ['name', 'goal', 'steps'],
        properties: {
          name: { type: 'string' },
          goal: { type: 'string' },
          description: { type: 'string' },
          agentId: { type: 'string' },
          entityIds: { type: 'array', items: { type: 'string' } },
          traceSessionId: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'operation'],
              properties: {
                name: { type: 'string' },
                operation: { type: 'string' },
                description: { type: 'string' },
                parameters: { type: 'object' },
                entityIds: { type: 'array', items: { type: 'string' } },
                assignedTo: { type: 'string' },
                requiresIndices: { type: 'array', items: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      name: string;
      goal: string;
      description?: string;
      agentId?: string;
      entityIds?: string[];
      traceSessionId?: string;
      steps: Array<{
        name: string;
        operation: string;
        description?: string;
        parameters?: Record<string, unknown>;
        entityIds?: string[];
        assignedTo?: string;
        requiresIndices?: number[];
      }>;
    };

    const plan = await planService.createPlan(body, body.traceSessionId);
    return reply.status(201).send(plan);
  });

  // GET /plans
  app.get('/plans', {
    schema: {
      tags: ['Plans'],
      summary: 'List plans',
      querystring: {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
          limit: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const { active, limit } = req.query as { active?: boolean; limit?: number };
    const plans = active
      ? await planRepo.findActivePlans()
      : await planRepo.findAllPlans(limit ?? 50);
    return reply.send(plans);
  });

  // GET /plans/:id
  app.get('/plans/:id', {
    schema: {
      tags: ['Plans'],
      summary: 'Get a plan with progress summary',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await planService.getPlanWithProgress(id);
    if (!result) return reply.status(404).send({ error: 'Plan not found' });
    return reply.send(result);
  });

  // ── Steps ──────────────────────────────────────────────────────────────────

  // GET /plans/:id/steps/ready
  app.get('/plans/:id/steps/ready', {
    schema: {
      tags: ['Plans'],
      summary: 'Get steps ready to execute (all prerequisites met)',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const steps = await planService.getReadySteps(id);
    return reply.send(steps);
  });

  // POST /plans/:planId/steps/:stepId/validate
  app.post('/plans/:planId/steps/:stepId/validate', {
    schema: {
      tags: ['Plans'],
      summary: 'Validate a step against the coherence engine',
      params: {
        type: 'object',
        properties: { planId: { type: 'string' }, stepId: { type: 'string' } },
        required: ['planId', 'stepId'],
      },
    },
  }, async (req, reply) => {
    const { stepId } = req.params as { planId: string; stepId: string };
    const validation = await planService.validateStep(stepId);
    return reply.send(validation);
  });

  // POST /plans/:planId/steps/:stepId/start
  app.post('/plans/:planId/steps/:stepId/start', {
    schema: {
      tags: ['Plans'],
      summary: 'Mark a step as RUNNING',
      params: {
        type: 'object',
        properties: { planId: { type: 'string' }, stepId: { type: 'string' } },
        required: ['planId', 'stepId'],
      },
      body: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          traceSessionId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { stepId } = req.params as { planId: string; stepId: string };
    const body = req.body as { agentId?: string; traceSessionId?: string };
    const result = await planService.startStep(stepId, body.agentId, body.traceSessionId);
    return reply.send(result);
  });

  // POST /plans/:planId/steps/:stepId/complete
  app.post('/plans/:planId/steps/:stepId/complete', {
    schema: {
      tags: ['Plans'],
      summary: 'Mark a step as COMPLETED',
      params: {
        type: 'object',
        properties: { planId: { type: 'string' }, stepId: { type: 'string' } },
        required: ['planId', 'stepId'],
      },
      body: {
        type: 'object',
        properties: { traceSessionId: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { stepId } = req.params as { planId: string; stepId: string };
    const body = req.body as { traceSessionId?: string };
    const plan = await planService.completeStep(stepId, body.traceSessionId);
    return reply.send(plan);
  });

  // POST /plans/:planId/steps/:stepId/fail
  app.post('/plans/:planId/steps/:stepId/fail', {
    schema: {
      tags: ['Plans'],
      summary: 'Mark a step as FAILED',
      params: {
        type: 'object',
        properties: { planId: { type: 'string' }, stepId: { type: 'string' } },
        required: ['planId', 'stepId'],
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string' },
          replan: { type: 'boolean' },
          traceSessionId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { stepId } = req.params as { planId: string; stepId: string };
    const body = req.body as { reason: string; replan?: boolean; traceSessionId?: string };
    const plan = await planService.failStep(stepId, body.reason, body.replan, body.traceSessionId);
    return reply.send(plan);
  });

  // POST /plans/:planId/steps/:stepId/block
  app.post('/plans/:planId/steps/:stepId/block', {
    schema: {
      tags: ['Plans'],
      summary: 'Mark a step as BLOCKED by the coherence engine',
      params: {
        type: 'object',
        properties: { planId: { type: 'string' }, stepId: { type: 'string' } },
        required: ['planId', 'stepId'],
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string' },
          traceSessionId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { stepId } = req.params as { planId: string; stepId: string };
    const body = req.body as { reason: string; traceSessionId?: string };
    const plan = await planService.blockStep(stepId, body.reason, body.traceSessionId);
    return reply.send(plan);
  });
}
