import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { authConfig, serverConfig } from '../../../infrastructure/config.js';

export type InvariantRequestAuth = {
  master: boolean;
  workspaceId: string | null;
};

type HeaderBag = Record<string, string | string[] | undefined>;

/**
 * Resolves caller: shared master API_KEY, a workspace inv_* key, or JWT Bearer (first workspace membership).
 */
export async function resolveInvariantAuth(req: { headers: HeaderBag }): Promise<InvariantRequestAuth | null> {
  const apiKeyRaw = req.headers['x-api-key'];
  const apiKey = (Array.isArray(apiKeyRaw) ? apiKeyRaw[0] : apiKeyRaw) ?? undefined;

  if (apiKey && apiKey === serverConfig.apiKey) {
    return { master: true, workspaceId: null };
  }

  if (apiKey) {
    const prefix = apiKey.slice(0, 12);
    const candidates = await prisma.workspaceApiKey.findMany({
      where: { isActive: true, keyPrefix: prefix },
    });
    for (const k of candidates) {
      if (await bcrypt.compare(apiKey, k.keyHash)) {
        await prisma.workspaceApiKey.update({
          where: { id: k.id },
          data: { lastUsedAt: new Date() },
        });
        return { master: false, workspaceId: k.workspaceId };
      }
    }
  }

  const auth = req.headers['authorization'];
  const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (bearer) {
    try {
      const payload = jwt.verify(bearer, authConfig.jwtSecret) as { userId: string };
      const membership = await prisma.workspaceMember.findFirst({ where: { userId: payload.userId } });
      if (membership) {
        return { master: false, workspaceId: membership.workspaceId };
      }
    } catch {
      /* invalid token */
    }
  }

  return null;
}
