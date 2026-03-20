/**
 * Coherence Engine, Fastify App Factory
 *
 * Exports buildApp() for use by both the local server (main.ts) and
 * the Vercel serverless handler (api/index.ts).
 */

import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { prisma } from './infrastructure/database/prisma.js';
import { corsAllowedExtraOrigins, serverConfig } from './infrastructure/config.js';
import { resolveInvariantAuth } from './interfaces/http/middleware/invariantAuth.js';
import {
  billableUnitsForRequest,
  resetMonthlyClaimsIfNeeded,
  tierMonthlyBillableCap,
} from './interfaces/http/middleware/usageLimits.js';
import { entityRoutes } from './interfaces/http/routes/entities.js';
import { claimRoutes } from './interfaces/http/routes/claims.js';
import { observationRoutes } from './interfaces/http/routes/observations.js';
import { contradictionRoutes } from './interfaces/http/routes/contradictions.js';
import { branchRoutes } from './interfaces/http/routes/branches.js';
import { constraintRoutes } from './interfaces/http/routes/constraints.js';
import { dependencyRoutes } from './interfaces/http/routes/dependencies.js';
import { actionRoutes } from './interfaces/http/routes/actions.js';
import { worldRoutes } from './interfaces/http/routes/world.js';
import { policyRoutes } from './interfaces/http/routes/policy.js';
import { traceRoutes } from './interfaces/http/routes/trace.js';
import { planRoutes } from './interfaces/http/routes/plans.js';
import { checkoutRoutes } from './interfaces/http/routes/checkout.js';
import { authRoutes } from './interfaces/http/routes/auth.js';
import { workspaceRoutes } from './interfaces/http/routes/workspace.js';
import { webhookRoutes } from './interfaces/http/routes/webhooks.js';
import { registerIdempotencyMiddleware } from './interfaces/http/middleware/idempotency.js';

const ALLOWED_ORIGINS = [
  'https://invariant.me',
  'https://www.invariant.me',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/** Vercel preview / production *.vercel.app (HTML and API share one host, but some clients still send Origin). */
function isVercelDeploymentOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

export async function buildApp() {
  const isProd = process.env['NODE_ENV'] === 'production';
  const app = Fastify({
    logger: isProd ? { level: 'info' } : false,
  });

  // CORS, lock down to known origins in production
  await app.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        ALLOWED_ORIGINS.includes(origin) ||
        corsAllowedExtraOrigins.includes(origin) ||
        isVercelDeploymentOrigin(origin)
      ) {
        return cb(null, true);
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  // ── Idempotency key middleware ────────────────────────────────────────────
  registerIdempotencyMiddleware(app);

  // ── X-Request-Id middleware ──────────────────────────────────────────────
  // Reads an existing X-Request-Id from the incoming request, or mints a
  // fresh UUID v4.  The value is attached to request.id and echoed back on
  // every response via the X-Request-Id header.
  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-request-id'];
    const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
    // Fastify stores request.id as a string, override it so downstream
    // code (loggers, error handlers) all see the same correlation ID.
    (req as unknown as Record<string, unknown>).id = requestId;
    reply.header('X-Request-Id', requestId);
  });

  // ── Rate limiting ────────────────────────────────────────────────────────
  // Global: 1 000 requests / minute keyed by API key (falls back to IP).
  // Auth endpoints use a stricter 20 req/min keyed by IP.
  await app.register(rateLimit, {
    global: true,
    max: serverConfig.apiRateLimitMax,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const key = req.headers['x-api-key'];
      return (Array.isArray(key) ? key[0] : key) ?? req.ip;
    },
    errorResponseBuilder: (_req, context) => ({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((context as unknown as { ttl: number }).ttl / 1000),
    }),
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // OpenAPI / Swagger
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Invariant API',
        description: 'The coherence layer for AI agents, validate actions, track world state, detect contradictions.',
        version: '1.0.0',
        contact: { name: 'Invariant', url: 'https://invariant.me' },
      },
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'X-API-Key',
            in: 'header',
          },
        },
      },
      security: [{ apiKey: [] }],
      tags: [
        // Agent Runtime
        { name: 'Actions', description: 'Agent Runtime, validate proposed actions against world state before execution' },
        { name: 'Trace', description: 'Agent Runtime, timeline recording, replay, and session debugging' },
        { name: 'Plans', description: 'Agent Runtime, task decomposition and coherence-aware orchestration' },
        { name: 'Policy', description: 'Agent Runtime, governance rules, approvals, and escalation' },
        // World State
        { name: 'World', description: 'World State, coherence score, snapshots, and settling' },
        { name: 'Entities', description: 'World State, persistent things tracked in the world graph' },
        { name: 'Claims', description: 'World State, typed, sourced assertions about entities' },
        { name: 'Observations', description: 'World State, raw inputs ingested and resolved into claims' },
        // Governance
        { name: 'Contradictions', description: 'Governance, detected inconsistencies between claims' },
        { name: 'Branches', description: 'Governance, alternative coherent state paths when contradictions cannot be resolved' },
        { name: 'Constraints', description: 'Governance, rules that must hold across entities' },
        { name: 'Dependencies', description: 'Governance, signed typed relations between entities (SUPPORTS, REQUIRES, INVALIDATES, …)' },
        // Platform
        { name: 'Auth', description: 'Platform, user registration, login, and JWT auth' },
        { name: 'Workspace', description: 'Platform, workspace management, API keys, and usage' },
        { name: 'Webhooks', description: 'Platform, outbound event webhooks for agent integrations' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
  });

  // API authentication: master API_KEY, workspace inv_* key, or JWT Bearer
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (path.startsWith('/docs') || path === '/health' || path.startsWith('/checkout') || path.startsWith('/auth/')) return;

    const auth = await resolveInvariantAuth(req);
    if (!auth) {
      return reply.status(401).send({ error: 'Invalid or missing API key' });
    }
    req.invariantAuth = auth;

    if (!auth.master && auth.workspaceId && serverConfig.enforceUsageCaps) {
      const units = billableUnitsForRequest(req.method, path);
      if (units > 0) {
        const w = await prisma.workspace.findUnique({ where: { id: auth.workspaceId } });
        if (!w) return reply.status(401).send({ error: 'Workspace not found' });
        const refreshed = await resetMonthlyClaimsIfNeeded(w);
        const cap = tierMonthlyBillableCap(refreshed.tier);
        if (refreshed.claimsThisMonth + units > cap) {
          return reply.status(429).send({
            error: 'Monthly billable usage limit exceeded. Upgrade your plan or wait for the next billing period.',
            tier: refreshed.tier,
            used: refreshed.claimsThisMonth,
            limit: cap,
          });
        }
      }
    }
  });

  // Count billable units only after successful responses (2xx), workspace callers only
  app.addHook('onResponse', async (req, reply) => {
    if (!serverConfig.enforceUsageCaps) return;
    const auth = req.invariantAuth;
    if (!auth || auth.master || !auth.workspaceId) return;
    const path = req.url.split('?')[0];
    if (path.startsWith('/docs') || path === '/health' || path.startsWith('/checkout') || path.startsWith('/auth/')) return;
    const units = billableUnitsForRequest(req.method, path);
    if (units <= 0) return;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return;
    await prisma.workspace.update({
      where: { id: auth.workspaceId },
      data: { claimsThisMonth: { increment: units } },
    });
  });

  // Health check (no auth required)
  app.get('/health', {
    schema: { tags: ['World'], summary: 'Health check' },
  }, async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Register all routes
  await app.register(entityRoutes);
  await app.register(claimRoutes);
  await app.register(observationRoutes);
  await app.register(contradictionRoutes);
  await app.register(branchRoutes);
  await app.register(constraintRoutes);
  await app.register(dependencyRoutes);
  await app.register(actionRoutes);
  await app.register(worldRoutes);
  // Layer 2: Policy
  await app.register(policyRoutes);
  // Layer 3: Trace
  await app.register(traceRoutes);
  // Layer 4: Plans
  await app.register(planRoutes);
  // Auth and Workspace (registered before API key hook would block them, /auth/ is skipped in preHandler)
  // Auth routes carry a tighter rate limit: 20 req/min per IP to deter brute-force.
  await app.register(async (authApp) => {
    await authApp.register(rateLimit, {
      max: 20,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.ip,
      errorResponseBuilder: (_req, context) => ({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((context as unknown as { ttl: number }).ttl / 1000),
      }),
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });
    await authApp.register(authRoutes);
  });
  await app.register(workspaceRoutes);
  // Webhooks
  await app.register(webhookRoutes);
  // Billing
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    // Store raw buffer for Stripe webhook signature verification
    (req as unknown as Record<string, unknown>).rawBody = body;
    try {
      done(null, JSON.parse(body.toString()));
    } catch (e) {
      done(e as Error, undefined);
    }
  });
  await app.register(checkoutRoutes);

  // Global error handler
  app.setErrorHandler((err, req, reply) => {
    app.log.error({ err, url: req.url, method: req.method }, 'Unhandled error');
    if (err.statusCode) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    return reply.status(500).send({ error: 'Internal server error' });
  });

  await app.ready();
  return app;
}
