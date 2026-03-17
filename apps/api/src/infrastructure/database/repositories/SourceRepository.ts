import type { ISourceRepository } from '../../../domain/repositories/interfaces.js';
import type { Source } from '../../../domain/entities/types.js';
import prisma from '../prisma.js';

export class PrismaSourceRepository implements ISourceRepository {
  async findById(id: string): Promise<Source | null> {
    return prisma.source.findUnique({ where: { id } }) as Promise<Source | null>;
  }

  async findAll(): Promise<Source[]> {
    return prisma.source.findMany({ orderBy: { createdAt: 'desc' } }) as Promise<Source[]>;
  }

  async create(data: Omit<Source, 'id' | 'createdAt'>): Promise<Source> {
    return prisma.source.create({
      data: {
        name: data.name,
        type: data.type,
        trustScore: data.trustScore,
        metadata: data.metadata ?? {},
      },
    }) as Promise<Source>;
  }

  async update(id: string, data: Partial<Source>): Promise<Source> {
    return prisma.source.update({ where: { id }, data }) as Promise<Source>;
  }

  async getOrCreate(name: string, type: Source['type']): Promise<Source> {
    const existing = await prisma.source.findFirst({ where: { name, type } });
    if (existing) return existing as Source;
    return this.create({ name, type, trustScore: 0.8, isActive: true } as never);
  }
}
