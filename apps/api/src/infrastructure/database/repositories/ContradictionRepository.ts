import type { IContradictionRepository } from '../../../domain/repositories/interfaces.js';
import type { Contradiction, ContradictionWithClaims } from '../../../domain/entities/types.js';
import prisma from '../prisma.js';

const contradictionInclude = {
  claimA: { include: { entity: true, source: true, branch: true } },
  claimB: { include: { entity: true, source: true, branch: true } },
} as const;

export class PrismaContradictionRepository implements IContradictionRepository {
  async findById(id: string): Promise<ContradictionWithClaims | null> {
    const c = await prisma.contradiction.findUnique({
      where: { id },
      include: contradictionInclude,
    });
    return c as ContradictionWithClaims | null;
  }

  async findAll(status?: Contradiction['status']): Promise<ContradictionWithClaims[]> {
    const items = await prisma.contradiction.findMany({
      where: status ? { status } : {},
      include: contradictionInclude,
      orderBy: { score: 'desc' },
    });
    return items as ContradictionWithClaims[];
  }

  async findForClaims(claimAId: string, claimBId: string): Promise<Contradiction | null> {
    return prisma.contradiction.findFirst({
      where: {
        OR: [
          { claimAId, claimBId },
          { claimAId: claimBId, claimBId: claimAId },
        ],
      },
    }) as Promise<Contradiction | null>;
  }

  async create(data: Omit<Contradiction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contradiction> {
    return prisma.contradiction.create({ data }) as Promise<Contradiction>;
  }

  async update(id: string, data: Partial<Contradiction>): Promise<Contradiction> {
    return prisma.contradiction.update({
      where: { id },
      data,
    }) as Promise<Contradiction>;
  }

  async countOpen(): Promise<number> {
    return prisma.contradiction.count({ where: { status: 'OPEN' } });
  }
}
