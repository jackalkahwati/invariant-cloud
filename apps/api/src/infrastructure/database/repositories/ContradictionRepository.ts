import type { IContradictionRepository } from '../../../domain/repositories/interfaces.js';
import type { Contradiction, ContradictionWithClaims } from '../../../domain/entities/types.js';
import prisma, { type DbClient } from '../prisma.js';

const contradictionInclude = {
  claimA: { include: { entity: true, source: true, branch: true } },
  claimB: { include: { entity: true, source: true, branch: true } },
} as const;

export class PrismaContradictionRepository implements IContradictionRepository {
  private readonly db: DbClient;

  constructor(client?: DbClient) {
    this.db = client ?? prisma;
  }

  async findById(id: string): Promise<ContradictionWithClaims | null> {
    const c = await this.db.contradiction.findUnique({
      where: { id },
      include: contradictionInclude,
    });
    return c as ContradictionWithClaims | null;
  }

  async findAll(status?: Contradiction['status']): Promise<ContradictionWithClaims[]> {
    const items = await this.db.contradiction.findMany({
      where: status ? { status } : {},
      include: contradictionInclude,
      orderBy: { score: 'desc' },
    });
    return items as ContradictionWithClaims[];
  }

  async findForClaims(claimAId: string, claimBId: string): Promise<Contradiction | null> {
    return this.db.contradiction.findFirst({
      where: {
        OR: [
          { claimAId, claimBId },
          { claimAId: claimBId, claimBId: claimAId },
        ],
      },
    }) as Promise<Contradiction | null>;
  }

  async create(data: Omit<Contradiction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contradiction> {
    return this.db.contradiction.create({ data }) as Promise<Contradiction>;
  }

  async update(id: string, data: Partial<Contradiction>): Promise<Contradiction> {
    return this.db.contradiction.update({
      where: { id },
      data,
    }) as Promise<Contradiction>;
  }

  async countOpen(): Promise<number> {
    return this.db.contradiction.count({ where: { status: 'OPEN' } });
  }
}
