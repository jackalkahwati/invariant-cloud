import type { IObservationRepository } from '../../../domain/repositories/interfaces.js';
import type { Observation } from '../../../domain/entities/types.js';
import prisma from '../prisma.js';

export class PrismaObservationRepository implements IObservationRepository {
  async findById(id: string): Promise<Observation | null> {
    const o = await prisma.observation.findUnique({ where: { id } });
    if (!o) return null;
    return { ...o, content: o.content as Record<string, unknown> };
  }

  async findUnprocessed(): Promise<Observation[]> {
    const items = await prisma.observation.findMany({
      where: { processed: false },
      orderBy: { createdAt: 'asc' },
    });
    return items.map(o => ({ ...o, content: o.content as Record<string, unknown> }));
  }

  async create(data: Omit<Observation, 'id' | 'createdAt'>): Promise<Observation> {
    const o = await prisma.observation.create({
      data: {
        sourceId: data.sourceId,
        type: data.type,
        content: data.content as never,
        entityIds: data.entityIds,
        processed: data.processed,
      },
    });
    return { ...o, content: o.content as Record<string, unknown> };
  }

  async markProcessed(id: string): Promise<void> {
    await prisma.observation.update({ where: { id }, data: { processed: true } });
  }
}
