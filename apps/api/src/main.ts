/**
 * Coherence Engine — API Entry Point
 *
 * Fastify server with OpenAPI documentation, API key auth, and all routes.
 */

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { serverConfig } from './infrastructure/config.js';
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

const app = Fastify({
  logger: {
    level: serverConfig.logLevel,
    transport: process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
});

// CORS
await app.register(cors, { origin: true });

// OpenAPI / Swagger
await app.register(swagger, {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'Coherence Engine API',
      description: 'The coherence layer for agents — a shared world-state and truth-maintenance engine.',
      version: '1.0.0',
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
      { name: 'Entities', description: 'Persistent things in the world' },
      { name: 'Claims', description: 'Structured assertions about entities' },
      { name: 'Observations', description: 'Raw inputs that generate claims' },
      { name: 'Contradictions', description: 'Detected inconsistencies' },
      { name: 'Branches', description: 'Alternative coherent state paths' },
      { name: 'Constraints', description: 'Rules that must hold' },
      { name: 'Dependencies', description: 'Signed typed relations between entities' },
      { name: 'Actions', description: 'Proposed actions validated against world state' },
      { name: 'World', description: 'World state, coherence score, and audit trail' },
      { name: 'Policy', description: 'Governance rules, approvals, and escalation' },
      { name: 'Trace', description: 'Timeline recording, replay, and session debugging' },
      { name: 'Plans', description: 'Task decomposition and coherence-aware orchestration' },
      { name: 'Auth', description: 'User registration, login, and JWT auth' },
      { name: 'Workspace', description: 'Workspace management, API keys, and usage' },
    ],
  },
});

await app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: { docExpansion: 'list', deepLinking: false },
});

// API Key authentication hook
app.addHook('preHandler', async (req, reply) => {
  // Skip auth for docs, health, public checkout, and auth endpoints
  if (req.url.startsWith('/docs') || req.url === '/health' || req.url.startsWith('/checkout') || req.url.startsWith('/auth/')) return;

  const key = req.headers['x-api-key'];
  if (key !== serverConfig.apiKey) {
    return reply.status(401).send({ error: 'Invalid or missing API key' });
  }
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
// Auth and Workspace (registered before API key hook would block them — /auth/ is skipped in preHandler)
await app.register(authRoutes);
await app.register(workspaceRoutes);
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

// Start
try {
  await app.listen({ port: serverConfig.port, host: serverConfig.host });
  app.log.info(`Coherence Engine API running on ${serverConfig.host}:${serverConfig.port}`);
  app.log.info(`API Docs: http://localhost:${serverConfig.port}/docs`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
