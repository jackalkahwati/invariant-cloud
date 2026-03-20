/**
 * Idempotency key middleware for Fastify.
 *
 * Reads the `Idempotency-Key` header on POST requests to designated routes.
 * If present and seen within the last 24 hours, returns the cached response
 * with `X-Idempotent-Replayed: true`.
 *
 * Only 2xx responses are cached.
 *
 * Applies to: POST /claims, POST /observations, POST /actions/propose, POST /actions/validate
 */

import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';

interface CacheEntry {
  statusCode: number;
  payload: string;
  expiresAt: number; // unix ms
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory idempotency cache. Keyed by `${idempotencyKey}:${routePath}`.
const cache = new Map<string, CacheEntry>();

// Routes that participate in idempotency checks (POST only)
const IDEMPOTENT_ROUTES = new Set([
  '/claims',
  '/observations',
  '/actions/propose',
  '/actions/validate',
]);

/** Prune expired entries to prevent unbounded memory growth. */
function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export function registerIdempotencyMiddleware(app: FastifyInstance): void {
  // Attach raw body buffer before the JSON parser fires so we can hash it.
  // (app.ts registers a custom content-type parser for Stripe; this hook fires earlier.)

  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST') return;

    // Normalise path: strip query string and trailing slash
    const path = req.url.split('?')[0]?.replace(/\/$/, '') ?? '';
    if (!IDEMPOTENT_ROUTES.has(path)) return;

    const rawKey = req.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!idempotencyKey) return;

    // Prune stale entries opportunistically (cheap enough for typical traffic)
    pruneExpired();

    const cacheKey = `${idempotencyKey}:${path}`;
    const cached = cache.get(cacheKey);
    if (!cached || cached.expiresAt <= Date.now()) return;

    // Replay cached response
    reply.header('X-Idempotent-Replayed', 'true');
    reply.status(cached.statusCode);
    return reply.send(JSON.parse(cached.payload));
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.method !== 'POST') return payload;

    const path = req.url.split('?')[0]?.replace(/\/$/, '') ?? '';
    if (!IDEMPOTENT_ROUTES.has(path)) return payload;

    const rawKey = req.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!idempotencyKey) return payload;

    // Only cache 2xx responses
    const statusCode = reply.statusCode;
    if (statusCode < 200 || statusCode >= 300) return payload;

    // Only cache string payloads (JSON responses)
    if (typeof payload !== 'string') return payload;

    // Avoid re-caching a replayed response
    if (reply.getHeader('X-Idempotent-Replayed')) return payload;

    const cacheKey = `${idempotencyKey}:${path}`;
    cache.set(cacheKey, {
      statusCode,
      payload,
      expiresAt: Date.now() + TTL_MS,
    });

    return payload;
  });
}
