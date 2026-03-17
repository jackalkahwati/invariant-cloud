import type { FastifyInstance } from 'fastify';
import { constraintRepo, auditRepo } from '../../../infrastructure/container.js';

export async function constraintRoutes(app: FastifyInstance) {
  // GET /constraints
  app.get('/constraints', {
    schema: {
      tags: ['Constraints'],
      summary: 'List all constraints',
      querystring: {
        type: 'object',
        properties: { active: { type: 'boolean' } },
      },
    },
  }, async (req) => {
    const query = req.query as { active?: boolean };
    return constraintRepo.findAll(query.active);
  });

  // POST /constraints
  app.post('/constraints', {
    schema: {
      tags: ['Constraints'],
      summary: 'Create a new constraint',
      body: {
        type: 'object',
        required: ['name', 'description', 'type', 'expression'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          type: {
            type: 'string',
            enum: ['NUMERIC_RANGE', 'STATUS_DEPENDENCY', 'VERIFICATION_REQUIRED', 'MUTUAL_EXCLUSION', 'COMPLETENESS', 'CUSTOM'],
          },
          expression: { type: 'object' },
          entityIds: { type: 'array', items: { type: 'string' } },
          weight: { type: 'number', minimum: 0, maximum: 10 },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      name: string;
      description: string;
      type: string;
      expression: Record<string, unknown>;
      entityIds?: string[];
      weight?: number;
    };

    const constraint = await constraintRepo.create({
      name: body.name,
      description: body.description,
      type: body.type as never,
      expression: body.expression as never,
      entityIds: body.entityIds ?? [],
      weight: body.weight ?? 1.0,
      isActive: true,
    });

    await auditRepo.create({
      type: 'CONSTRAINT_VIOLATED',
      data: { constraintId: constraint.id, name: constraint.name, action: 'created' },
    });

    return reply.status(201).send(constraint);
  });

  // GET /constraints/violations
  app.get('/constraints/violations', {
    schema: {
      tags: ['Constraints'],
      summary: 'List active constraint violations',
    },
  }, async () => {
    return constraintRepo.findActiveViolations();
  });
}
