import type { IncomingMessage, ServerResponse } from 'http';
import { buildApp } from '../apps/api/src/app.js';

type FastifyApp = Awaited<ReturnType<typeof buildApp>>;
let app: FastifyApp | null = null;

async function getApp(): Promise<FastifyApp> {
  if (!app) {
    app = await buildApp();
  }
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const fastify = await getApp();
  fastify.server.emit('request', req, res);
}
