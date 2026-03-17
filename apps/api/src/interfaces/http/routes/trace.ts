import type { FastifyInstance } from 'fastify';
import { traceService, traceRepo } from '../../../infrastructure/container.js';

export async function traceRoutes(app: FastifyInstance) {
  // ── Sessions ───────────────────────────────────────────────────────────────

  // POST /trace/sessions
  app.post('/trace/sessions', {
    schema: {
      tags: ['Trace'],
      summary: 'Start a new trace session',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          agentId: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      name: string;
      description?: string;
      agentId?: string;
      metadata?: Record<string, unknown>;
    };
    const session = await traceService.startSession(body.name, body.agentId, body.description);
    return reply.status(201).send(session);
  });

  // GET /trace/sessions
  app.get('/trace/sessions', {
    schema: {
      tags: ['Trace'],
      summary: 'List trace sessions',
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
    const sessions = active
      ? await traceRepo.findActiveSessions()
      : await traceRepo.findAllSessions(limit ?? 50);
    return reply.send(sessions);
  });

  // GET /trace/sessions/:id
  app.get('/trace/sessions/:id', {
    schema: {
      tags: ['Trace'],
      summary: 'Get a trace session by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await traceRepo.findSessionById(id);
    if (!session) return reply.status(404).send({ error: 'Trace session not found' });
    const stats = await traceService.getSessionStats(id);
    return reply.send({ session, stats });
  });

  // POST /trace/sessions/:id/end
  app.post('/trace/sessions/:id/end', {
    schema: {
      tags: ['Trace'],
      summary: 'End a trace session',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['COMPLETED', 'FAILED'] },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { status?: 'COMPLETED' | 'FAILED' };
    const session = await traceService.endSession(id, body.status ?? 'COMPLETED');
    return reply.send(session);
  });

  // ── Events ─────────────────────────────────────────────────────────────────

  // POST /trace/sessions/:id/events
  app.post('/trace/sessions/:id/events', {
    schema: {
      tags: ['Trace'],
      summary: 'Append an event to a trace session',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['type', 'data'],
        properties: {
          type: { type: 'string' },
          entityIds: { type: 'array', items: { type: 'string' } },
          data: { type: 'object' },
          deltaPhiAfter: { type: 'number' },
          coherenceAfter: { type: 'number' },
          actorId: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      type: string;
      entityIds?: string[];
      data: Record<string, unknown>;
      deltaPhiAfter?: number;
      coherenceAfter?: number;
      actorId?: string;
      metadata?: Record<string, unknown>;
    };

    const event = await traceService.record(id, body.type, body.data, {
      entityIds: body.entityIds,
      deltaPhiAfter: body.deltaPhiAfter,
      coherenceAfter: body.coherenceAfter,
      actorId: body.actorId,
    });
    return reply.status(201).send(event);
  });

  // GET /trace/sessions/:id/events
  app.get('/trace/sessions/:id/events', {
    schema: {
      tags: ['Trace'],
      summary: 'Get all events in a trace session (timeline)',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const timeline = await traceService.getTimeline(id);
    return reply.send(timeline);
  });

  // ── Replay ─────────────────────────────────────────────────────────────────

  // GET /trace/sessions/:id/replay
  app.get('/trace/sessions/:id/replay', {
    schema: {
      tags: ['Trace'],
      summary: 'Replay a trace session for step-through debugging',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      querystring: {
        type: 'object',
        properties: {
          upToSeq: { type: 'integer', description: 'Stop replay at this sequence number' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { upToSeq } = req.query as { upToSeq?: number };

    const result = await traceService.replay(id, upToSeq);
    return reply.send(result);
  });

  // ── Cross-session ──────────────────────────────────────────────────────────

  // GET /trace/events/recent
  app.get('/trace/events/recent', {
    schema: {
      tags: ['Trace'],
      summary: 'Get recent trace events across all sessions',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const { limit } = req.query as { limit?: number };
    const events = await traceRepo.getRecentEvents(limit ?? 100);
    return reply.send(events);
  });
}
