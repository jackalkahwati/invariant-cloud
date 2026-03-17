import type { IDependencyRepository } from '../../../domain/repositories/interfaces.js';
import type { Dependency, DependencyType } from '../../../domain/entities/types.js';
import prisma from '../prisma.js';

export class PrismaDependencyRepository implements IDependencyRepository {
  async findById(id: string): Promise<Dependency | null> {
    return prisma.dependency.findUnique({ where: { id } }) as Promise<Dependency | null>;
  }

  async findAll(): Promise<Dependency[]> {
    return prisma.dependency.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    }) as Promise<Dependency[]>;
  }

  async findFrom(entityId: string, type?: DependencyType): Promise<Dependency[]> {
    return prisma.dependency.findMany({
      where: {
        fromEntityId: entityId,
        isActive: true,
        ...(type ? { type } : {}),
      },
    }) as Promise<Dependency[]>;
  }

  async findTo(entityId: string, type?: DependencyType): Promise<Dependency[]> {
    return prisma.dependency.findMany({
      where: {
        toEntityId: entityId,
        isActive: true,
        ...(type ? { type } : {}),
      },
    }) as Promise<Dependency[]>;
  }

  async create(data: Omit<Dependency, 'id' | 'createdAt'>): Promise<Dependency> {
    return prisma.dependency.create({
      data: {
        fromEntityId: data.fromEntityId,
        toEntityId: data.toEntityId,
        type: data.type,
        weight: data.weight,
        description: data.description,
        metadata: (data.metadata ?? {}) as never,
        isActive: data.isActive,
      },
    }) as Promise<Dependency>;
  }

  async delete(id: string): Promise<void> {
    await prisma.dependency.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
