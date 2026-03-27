import type { IBranchRepository } from '../../../domain/repositories/interfaces.js';
import type { Branch, BranchStatus } from '../../../domain/entities/types.js';
import prisma, { type DbClient } from '../prisma.js';

export class PrismaBranchRepository implements IBranchRepository {
  private readonly db: DbClient;

  constructor(client?: DbClient) {
    this.db = client ?? prisma;
  }

  async findById(id: string): Promise<Branch | null> {
    return this.db.branch.findUnique({ where: { id } }) as Promise<Branch | null>;
  }

  async findAll(status?: BranchStatus): Promise<Branch[]> {
    return this.db.branch.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
    }) as Promise<Branch[]>;
  }

  async create(data: Omit<Branch, 'id' | 'createdAt' | 'updatedAt'>): Promise<Branch> {
    return this.db.branch.create({
      data: {
        name: data.name,
        description: data.description,
        parentBranchId: data.parentBranchId,
        status: data.status,
        confidence: data.confidence,
        contradictionId: data.contradictionId,
        metadata: (data.metadata ?? {}) as never,
      },
    }) as Promise<Branch>;
  }

  async update(id: string, data: Partial<Branch>): Promise<Branch> {
    return this.db.branch.update({
      where: { id },
      data: data as never,
    }) as Promise<Branch>;
  }

  async countOpen(): Promise<number> {
    return this.db.branch.count({ where: { status: 'OPEN' } });
  }
}
