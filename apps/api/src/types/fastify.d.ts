import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by API auth preHandler for protected routes (not on /auth, /checkout, /docs, /health). */
    invariantAuth?: {
      master: boolean;
      workspaceId: string | null;
    };
  }
}
