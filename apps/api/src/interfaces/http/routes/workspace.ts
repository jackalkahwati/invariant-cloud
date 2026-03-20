import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { authConfig } from '../../../infrastructure/config.js';

async function getWorkspaceFromRequest(req: { headers: Record<string, string | string[] | undefined> }): Promise<string | null> {
  // Try API key first
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) {
    const allKeys = await prisma.workspaceApiKey.findMany({ where: { isActive: true } });
    for (const k of allKeys) {
      if (await bcrypt.compare(apiKey, k.keyHash)) {
        await prisma.workspaceApiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
        return k.workspaceId;
      }
    }
    return null;
  }
  // Try JWT Bearer
  const auth = req.headers['authorization'] as string | undefined;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), authConfig.jwtSecret) as { userId: string };
      const membership = await prisma.workspaceMember.findFirst({ where: { userId: payload.userId } });
      return membership?.workspaceId ?? null;
    } catch { return null; }
  }
  return null;
}

export async function workspaceRoutes(app: FastifyInstance) {
  // GET /workspace, workspace info + usage + API keys
  app.get('/workspace', {
    schema: { tags: ['Workspace'], summary: 'Get current workspace info, tier, and API keys' },
  }, async (req, reply) => {
    const workspaceId = await getWorkspaceFromRequest(req as Parameters<typeof getWorkspaceFromRequest>[0]);
    if (!workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        apiKeys: {
          where: { isActive: true },
          select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
        },
      },
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    return reply.send({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      tier: workspace.tier,
      status: workspace.status,
      trialEndsAt: workspace.trialEndsAt,
      claimsThisMonth: workspace.claimsThisMonth,
      apiKeys: workspace.apiKeys,
    });
  });

  // POST /workspace/api-keys, generate a new API key
  app.post<{ Body: { name?: string } }>('/workspace/api-keys', {
    schema: {
      tags: ['Workspace'],
      summary: 'Generate a new API key for the workspace',
      body: { type: 'object', properties: { name: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const workspaceId = await getWorkspaceFromRequest(req as Parameters<typeof getWorkspaceFromRequest>[0]);
    if (!workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

    const rawKey = 'inv_' + crypto.randomBytes(24).toString('hex');
    const keyHash = await bcrypt.hash(rawKey, 10);
    const keyPrefix = rawKey.slice(0, 12);

    const keyRecord = await prisma.workspaceApiKey.create({
      data: {
        workspaceId,
        name: req.body.name ?? 'API Key',
        keyPrefix,
        keyHash,
      },
    });

    return reply.status(201).send({
      id:        keyRecord.id,
      name:      keyRecord.name,
      keyPrefix: keyRecord.keyPrefix,
      apiKey:    rawKey, // returned ONCE
      createdAt: keyRecord.createdAt,
    });
  });

  // DELETE /workspace/api-keys/:id, revoke an API key
  app.delete<{ Params: { id: string } }>('/workspace/api-keys/:id', {
    schema: { tags: ['Workspace'], summary: 'Revoke an API key' },
  }, async (req, reply) => {
    const workspaceId = await getWorkspaceFromRequest(req as Parameters<typeof getWorkspaceFromRequest>[0]);
    if (!workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

    await prisma.workspaceApiKey.updateMany({
      where: { id: req.params.id, workspaceId },
      data:  { isActive: false },
    });

    return reply.send({ revoked: true });
  });
}
