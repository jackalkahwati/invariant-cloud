import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env['LOG_LEVEL'] === 'debug'
      ? ['query', 'error', 'warn']
      : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;

/**
 * The transaction client type Prisma passes into $transaction callbacks.
 * Repos accept this type so they can be used inside a transaction
 * (e.g. for test isolation via rollback) or with the global singleton.
 */
export type DbClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
