import type { IAuditRepository } from '../../../domain/repositories/interfaces.js';
import type { AuditEvent, AuditEventType } from '../../../domain/entities/types.js';
import prisma from '../prisma.js';

export class PrismaAuditRepository implements IAuditRepository {
  async create(data: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<AuditEvent> {
    return prisma.auditEvent.create({
      data: {
        type: data.type,
        entityId: data.entityId,
        branchId: data.branchId,
        actorId: data.actorId,
        data: data.data as never,
      },
    }) as Promise<AuditEvent>;
  }

  async findById(id: string): Promise<AuditEvent | null> {
    const e = await prisma.auditEvent.findUnique({ where: { id } });
    if (!e) return null;
    return { ...e, data: e.data as Record<string, unknown> };
  }

  async findByEntity(entityId: string, limit = 50): Promise<AuditEvent[]> {
    const items = await prisma.auditEvent.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return items.map(e => ({ ...e, data: e.data as Record<string, unknown> }));
  }

  async findByType(type: AuditEventType | string, limit = 50): Promise<AuditEvent[]> {
    const items = await prisma.auditEvent.findMany({
      where: { type },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return items.map(e => ({ ...e, data: e.data as Record<string, unknown> }));
  }

  async findRecent(limit = 50): Promise<AuditEvent[]> {
    const items = await prisma.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return items.map(e => ({ ...e, data: e.data as Record<string, unknown> }));
  }
}
