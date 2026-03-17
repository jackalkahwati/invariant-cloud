import type { IEntityRepository } from '../../../domain/repositories/interfaces.js';
import type { Entity, EntityType } from '../../../domain/entities/types.js';
import prisma from '../prisma.js';

export class PrismaEntityRepository implements IEntityRepository {
  async findById(id: string): Promise<Entity | null> {
    return prisma.entity.findUnique({ where: { id } }) as Promise<Entity | null>;
  }

  async findAll(filter?: { type?: EntityType; isActive?: boolean }): Promise<Entity[]> {
    return prisma.entity.findMany({
      where: {
        ...(filter?.type ? { type: filter.type } : {}),
        ...(filter?.isActive !== undefined ? { isActive: filter.isActive } : {}),
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<Entity[]>;
  }

  async create(data: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entity> {
    return prisma.entity.create({
      data: {
        name: data.name,
        type: data.type,
        description: data.description,
        metadata: data.metadata ?? {},
        isActive: data.isActive,
      },
    }) as Promise<Entity>;
  }

  async update(id: string, data: Partial<Entity>): Promise<Entity> {
    return prisma.entity.update({
      where: { id },
      data,
    }) as Promise<Entity>;
  }

  async delete(id: string): Promise<void> {
    await prisma.entity.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
