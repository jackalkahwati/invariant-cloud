import type { IncomingMessage, ServerResponse } from 'http';

// Vercel compiles this file as CJS (no "type":"module" in root package.json).
// apps/api is ESM ("type":"module"), so we must use a dynamic import() to
// load the compiled ESM output — require() would throw ERR_REQUIRE_ESM.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getApp(): Promise<any> {
  if (!app) {
    // Dynamic import works from CJS → ESM
    const mod = await import('../apps/api/dist/app.js');
    app = await mod.buildApp();
  }
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const fastify = await getApp();
  fastify.server.emit('request', req, res);
}
