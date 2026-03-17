import type { ISnapshotRepository } from '../../../domain/repositories/interfaces.js';
import type { StateSnapshot } from '../../../domain/entities/types.js';
import prisma from '../prisma.js';

export class PrismaSnapshotRepository implements ISnapshotRepository {
  async findLatest(): Promise<StateSnapshot | null> {
    return prisma.stateSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
    }) as Promise<StateSnapshot | null>;
  }

  async create(data: Omit<StateSnapshot, 'id' | 'createdAt'>): Promise<StateSnapshot> {
    return prisma.stateSnapshot.create({ data }) as Promise<StateSnapshot>;
  }

  async findAll(limit = 20): Promise<StateSnapshot[]> {
    return prisma.stateSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) as Promise<StateSnapshot[]>;
  }
}
