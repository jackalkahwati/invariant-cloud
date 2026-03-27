import type { ISnapshotRepository } from '../../../domain/repositories/interfaces.js';
import type { StateSnapshot } from '../../../domain/entities/types.js';
import prisma, { type DbClient } from '../prisma.js';

export class PrismaSnapshotRepository implements ISnapshotRepository {
  private readonly db: DbClient;

  constructor(client?: DbClient) {
    this.db = client ?? prisma;
  }

  async findLatest(): Promise<StateSnapshot | null> {
    return this.db.stateSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
    }) as unknown as Promise<StateSnapshot | null>;
  }

  async create(data: Omit<StateSnapshot, 'id' | 'createdAt'>): Promise<StateSnapshot> {
    return this.db.stateSnapshot.create({ data: data as never }) as unknown as Promise<StateSnapshot>;
  }

  async findAll(limit = 20): Promise<StateSnapshot[]> {
    return this.db.stateSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) as unknown as Promise<StateSnapshot[]>;
  }
}
