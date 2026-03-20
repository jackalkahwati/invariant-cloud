import type { FastifyInstance } from 'fastify';
import { webhookService } from '../../../infrastructure/container.js';
import type { WebhookEvent } from '../../../application/services/WebhookService.js';

const VALID_EVENTS: WebhookEvent[] = [
  'action.blocked',
  'action.valid',
  'contradiction.detected',
  'coherence.drop',
  'plan.failed',
];

export async function webhookRoutes(app: FastifyInstance) {
  // POST /webhooks, register a webhook
  app.post('/webhooks', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Register a webhook endpoint',
      body: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url: { type: 'string', format: 'uri' },
          events: {
            type: 'array',
            items: {
              type: 'string',
              enum: VALID_EVENTS,
            },
            minItems: 1,
          },
          secret: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { url: string; events: WebhookEvent[]; secret?: string };
    const registration = webhookService.register(body);
    return reply.status(201).send(registration);
  });

  // GET /webhooks, list all registered webhooks
  app.get('/webhooks', {
    schema: {
      tags: ['Webhooks'],
      summary: 'List all registered webhooks',
    },
  }, async (_req, reply) => {
    return reply.send(webhookService.list());
  });

  // DELETE /webhooks/:id, remove a webhook
  app.delete('/webhooks/:id', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Remove a registered webhook',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const removed = webhookService.remove(id);
    if (!removed) return reply.status(404).send({ error: 'Webhook not found' });
    return reply.status(204).send();
  });

  // POST /webhooks/test/:id, send a test payload
  app.post('/webhooks/test/:id', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Send a test payload to a registered webhook',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await webhookService.test(id);
    if (result.error === 'Webhook not found') {
      return reply.status(404).send({ error: 'Webhook not found' });
    }
    return reply.send(result);
  });
}
