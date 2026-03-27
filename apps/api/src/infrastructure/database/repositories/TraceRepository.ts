import prisma, { type DbClient } from '../prisma.js';

export type TraceSessionCreateInput = {
  name: string;
  description?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
};

export type TraceEventCreateInput = {
  sessionId: string;
  type: string;
  entityIds?: string[];
  data: Record<string, unknown>;
  worldStateHash?: string;
  deltaPhiAfter?: number;
  coherenceAfter?: number;
  actorId?: string;
  metadata?: Record<string, unknown>;
};

export class PrismaTraceRepository {
  private readonly db: DbClient;

  constructor(client?: DbClient) {
    this.db = client ?? prisma;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────────

  async createSession(data: TraceSessionCreateInput) {
    return this.db.traceSession.create({
      data: {
        name: data.name,
        description: data.description,
        agentId: data.agentId,
        status: 'ACTIVE',
        metadata: data.metadata as never,
      },
    });
  }

  async findSessionById(id: string) {
    return this.db.traceSession.findUnique({ where: { id } });
  }

  async findActiveSessions() {
    return this.db.traceSession.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
  }

  async findAllSessions(limit = 50) {
    return this.db.traceSession.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async endSession(id: string, status: 'COMPLETED' | 'FAILED' = 'COMPLETED') {
    return this.db.traceSession.update({
      where: { id },
      data: { status, endedAt: new Date() },
    });
  }

  // ── Events ────────────────────────────────────────────────────────────────────

  async appendEvent(data: TraceEventCreateInput) {
    // Get next sequence number atomically-ish
    const last = await this.db.traceEvent.findFirst({
      where: { sessionId: data.sessionId },
      orderBy: { sequenceNumber: 'desc' },
      select: { sequenceNumber: true },
    });
    const sequenceNumber = (last?.sequenceNumber ?? -1) + 1;

    return this.db.traceEvent.create({
      data: {
        sessionId: data.sessionId,
        type: data.type as never,
        sequenceNumber,
        entityIds: data.entityIds ?? [],
        data: data.data as never,
        worldStateHash: data.worldStateHash,
        deltaPhiAfter: data.deltaPhiAfter,
        coherenceAfter: data.coherenceAfter,
        actorId: data.actorId,
        metadata: data.metadata as never,
      },
    });
  }

  async getTimeline(sessionId: string) {
    return this.db.traceEvent.findMany({
      where: { sessionId },
      orderBy: { sequenceNumber: 'asc' },
    });
  }

  async getTimelineSlice(sessionId: string, fromSeq: number, toSeq?: number) {
    return this.db.traceEvent.findMany({
      where: {
        sessionId,
        sequenceNumber: {
          gte: fromSeq,
          ...(toSeq !== undefined ? { lte: toSeq } : {}),
        },
      },
      orderBy: { sequenceNumber: 'asc' },
    });
  }

  async getEventsByType(sessionId: string, type: string) {
    return this.db.traceEvent.findMany({
      where: { sessionId, type: type as never },
      orderBy: { sequenceNumber: 'asc' },
    });
  }

  async countEvents(sessionId: string) {
    return this.db.traceEvent.count({ where: { sessionId } });
  }

  // ── Cross-session analytics ───────────────────────────────────────────────────

  async getRecentEvents(limit = 100) {
    return this.db.traceEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { session: { select: { name: true, agentId: true } } },
    });
  }
}
