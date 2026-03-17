import type { IConstraintRepository } from '../../../domain/repositories/interfaces.js';
import type { Constraint, ConstraintViolation } from '../../../domain/entities/types.js';
import prisma from '../prisma.js';

export class PrismaConstraintRepository implements IConstraintRepository {
  async findById(id: string): Promise<Constraint | null> {
    return prisma.constraint.findUnique({ where: { id } }) as Promise<Constraint | null>;
  }

  async findAll(active?: boolean): Promise<Constraint[]> {
    return prisma.constraint.findMany({
      where: active !== undefined ? { isActive: active } : {},
      orderBy: { createdAt: 'asc' },
    }) as Promise<Constraint[]>;
  }

  async create(data: Omit<Constraint, 'id' | 'createdAt' | 'updatedAt'>): Promise<Constraint> {
    return prisma.constraint.create({
      data: {
        name: data.name,
        description: data.description,
        type: data.type,
        expression: data.expression as never,
        entityIds: data.entityIds,
        weight: data.weight,
        isActive: data.isActive,
      },
    }) as Promise<Constraint>;
  }

  async createViolation(
    data: Omit<ConstraintViolation, 'id' | 'createdAt'>,
  ): Promise<ConstraintViolation> {
    return prisma.constraintViolation.create({
      data: {
        constraintId: data.constraintId,
        entityIds: data.entityIds,
        claimIds: data.claimIds,
        severity: data.severity,
        description: data.description,
        isActive: data.isActive,
      },
    }) as Promise<ConstraintViolation>;
  }

  async deactivateViolations(constraintId: string, entityIds: string[]): Promise<void> {
    await prisma.constraintViolation.updateMany({
      where: {
        constraintId,
        entityIds: { hasSome: entityIds },
        isActive: true,
      },
      data: { isActive: false },
    });
  }

  async findActiveViolations(): Promise<ConstraintViolation[]> {
    return prisma.constraintViolation.findMany({
      where: { isActive: true },
      orderBy: { severity: 'desc' },
    }) as Promise<ConstraintViolation[]>;
  }

  async countActiveViolations(): Promise<number> {
    return prisma.constraintViolation.count({ where: { isActive: true } });
  }
}
