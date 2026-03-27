import type { IConstraintRepository } from '../../../domain/repositories/interfaces.js';
import type { Constraint, ConstraintViolation } from '../../../domain/entities/types.js';
import prisma, { type DbClient } from '../prisma.js';

export class PrismaConstraintRepository implements IConstraintRepository {
  private readonly db: DbClient;

  constructor(client?: DbClient) {
    this.db = client ?? prisma;
  }

  async findById(id: string): Promise<Constraint | null> {
    return this.db.constraint.findUnique({ where: { id } }) as unknown as Promise<Constraint | null>;
  }

  async findAll(active?: boolean): Promise<Constraint[]> {
    return this.db.constraint.findMany({
      where: active !== undefined ? { isActive: active } : {},
      orderBy: { createdAt: 'asc' },
    }) as unknown as Promise<Constraint[]>;
  }

  async create(data: Omit<Constraint, 'id' | 'createdAt' | 'updatedAt'>): Promise<Constraint> {
    return this.db.constraint.create({
      data: {
        name: data.name,
        description: data.description,
        type: data.type,
        expression: data.expression as never,
        entityIds: data.entityIds,
        weight: data.weight,
        isActive: data.isActive,
      },
    }) as unknown as Promise<Constraint>;
  }

  async createViolation(
    data: Omit<ConstraintViolation, 'id' | 'createdAt'>,
  ): Promise<ConstraintViolation> {
    return this.db.constraintViolation.create({
      data: {
        constraintId: data.constraintId,
        entityIds: data.entityIds,
        claimIds: data.claimIds,
        severity: data.severity,
        description: data.description,
        isActive: data.isActive,
      },
    }) as unknown as Promise<ConstraintViolation>;
  }

  async deactivateViolations(constraintId: string, entityIds: string[]): Promise<void> {
    await this.db.constraintViolation.updateMany({
      where: {
        constraintId,
        entityIds: { hasSome: entityIds },
        isActive: true,
      },
      data: { isActive: false },
    });
  }

  async findActiveViolations(): Promise<ConstraintViolation[]> {
    return this.db.constraintViolation.findMany({
      where: { isActive: true },
      orderBy: { severity: 'desc' },
    }) as unknown as Promise<ConstraintViolation[]>;
  }

  async countActiveViolations(): Promise<number> {
    return this.db.constraintViolation.count({ where: { isActive: true } });
  }
}
