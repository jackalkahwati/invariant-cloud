import type { IClaimRepository, ClaimFilter } from '../../../domain/repositories/interfaces.js';
import type { Claim, ClaimWithRelations } from '../../../domain/entities/types.js';
import prisma, { type DbClient } from '../prisma.js';

const claimInclude = {
  entity: true,
  source: true,
  branch: true,
} as const;

export class PrismaClaimRepository implements IClaimRepository {
  private readonly db: DbClient;

  constructor(client?: DbClient) {
    this.db = client ?? prisma;
  }

  async findById(id: string): Promise<ClaimWithRelations | null> {
    const claim = await this.db.claim.findUnique({
      where: { id },
      include: claimInclude,
    });
    return claim as ClaimWithRelations | null;
  }

  async findAll(filter?: ClaimFilter): Promise<ClaimWithRelations[]> {
    const claims = await this.db.claim.findMany({
      where: {
        ...(filter?.entityId ? { entityId: filter.entityId } : {}),
        ...(filter?.predicate ? { predicate: filter.predicate } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
        ...(filter?.sourceId ? { sourceId: filter.sourceId } : {}),
        ...(filter?.branchId !== undefined
          ? { branchId: filter.branchId }
          : {}),
      },
      include: claimInclude,
      orderBy: { timestamp: 'desc' },
    });
    return claims as ClaimWithRelations[];
  }

  async findActive(entityId: string, predicate?: string): Promise<ClaimWithRelations[]> {
    const claims = await this.db.claim.findMany({
      where: {
        entityId,
        status: 'ACTIVE',
        ...(predicate ? { predicate } : {}),
      },
      include: claimInclude,
      orderBy: { timestamp: 'desc' },
    });
    return claims as ClaimWithRelations[];
  }

  async create(data: Omit<Claim, 'id' | 'createdAt' | 'updatedAt'>): Promise<Claim> {
    return this.db.claim.create({
      data: {
        entityId: data.entityId,
        predicate: data.predicate,
        value: data.value as never,
        confidence: data.confidence,
        sourceId: data.sourceId,
        timestamp: data.timestamp,
        status: data.status,
        branchId: data.branchId,
        supersededBy: data.supersededBy,
        observationId: data.observationId,
      },
    }) as Promise<Claim>;
  }

  async update(id: string, data: Partial<Claim>): Promise<Claim> {
    return this.db.claim.update({
      where: { id },
      data: data as never,
    }) as Promise<Claim>;
  }

  async supersede(id: string, supersededById: string): Promise<Claim> {
    return this.db.claim.update({
      where: { id },
      data: { status: 'SUPERSEDED', supersededBy: supersededById },
    }) as Promise<Claim>;
  }

  async invalidate(id: string): Promise<Claim> {
    return this.db.claim.update({
      where: { id },
      data: { status: 'INVALIDATED' },
    }) as Promise<Claim>;
  }

  async countActive(): Promise<number> {
    return this.db.claim.count({ where: { status: 'ACTIVE' } });
  }
}
