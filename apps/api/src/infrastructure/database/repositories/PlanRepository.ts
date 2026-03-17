import prisma from '../prisma.js';

export type PlanCreateInput = {
  name: string;
  description?: string;
  goal: string;
  agentId?: string;
  entityIds?: string[];
  metadata?: Record<string, unknown>;
};

export type PlanStepCreateInput = {
  planId: string;
  name: string;
  description?: string;
  operation: string;
  parameters?: Record<string, unknown>;
  entityIds?: string[];
  assignedTo?: string;
  order: number;
  requires?: string[];
  metadata?: Record<string, unknown>;
};

export class PrismaPlanRepository {
  // ── Plans ─────────────────────────────────────────────────────────────────────

  async createPlan(data: PlanCreateInput) {
    return prisma.plan.create({
      data: {
        name: data.name,
        description: data.description,
        goal: data.goal,
        agentId: data.agentId,
        status: 'DRAFT',
        entityIds: data.entityIds ?? [],
        metadata: data.metadata as never,
      },
    });
  }

  async findPlanById(id: string) {
    return prisma.plan.findUnique({
      where: { id },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async findActivePlans() {
    return prisma.plan.findMany({
      where: { status: { in: ['ACTIVE', 'REPLANNING'] } },
      include: { steps: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllPlans(limit = 50) {
    return prisma.plan.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async updatePlanStatus(id: string, status: string) {
    return prisma.plan.update({
      where: { id },
      data: { status: status as never },
    });
  }

  // ── Steps ─────────────────────────────────────────────────────────────────────

  async createStep(data: PlanStepCreateInput) {
    return prisma.planStep.create({
      data: {
        planId: data.planId,
        name: data.name,
        description: data.description,
        operation: data.operation,
        parameters: (data.parameters ?? {}) as never,
        entityIds: data.entityIds ?? [],
        status: 'PENDING',
        assignedTo: data.assignedTo,
        order: data.order,
        requires: data.requires ?? [],
        metadata: data.metadata as never,
      },
    });
  }

  async findStepById(id: string) {
    return prisma.planStep.findUnique({
      where: { id },
      include: { plan: true },
    });
  }

  async findStepsByPlan(planId: string) {
    return prisma.planStep.findMany({
      where: { planId },
      orderBy: { order: 'asc' },
    });
  }

  async findReadySteps(planId: string) {
    // Steps that are PENDING and have all required steps COMPLETED
    const steps = await this.findStepsByPlan(planId);
    const completedIds = new Set(
      steps.filter(s => s.status === 'COMPLETED').map(s => s.id)
    );
    return steps.filter(s =>
      s.status === 'PENDING' &&
      (s.requires as string[]).every(reqId => completedIds.has(reqId))
    );
  }

  async updateStepStatus(id: string, status: string, extra?: {
    startedAt?: Date;
    completedAt?: Date;
    failureReason?: string;
    actionProposalId?: string;
    assignedTo?: string;
  }) {
    return prisma.planStep.update({
      where: { id },
      data: {
        status: status as never,
        ...(extra?.startedAt !== undefined && { startedAt: extra.startedAt }),
        ...(extra?.completedAt !== undefined && { completedAt: extra.completedAt }),
        ...(extra?.failureReason !== undefined && { failureReason: extra.failureReason }),
        ...(extra?.actionProposalId !== undefined && { actionProposalId: extra.actionProposalId }),
        ...(extra?.assignedTo !== undefined && { assignedTo: extra.assignedTo }),
      },
    });
  }

  async getPlanProgress(planId: string) {
    const steps = await this.findStepsByPlan(planId);
    const total = steps.length;
    const completed = steps.filter(s => s.status === 'COMPLETED').length;
    const failed = steps.filter(s => s.status === 'FAILED').length;
    const blocked = steps.filter(s => s.status === 'BLOCKED').length;
    const running = steps.filter(s => s.status === 'RUNNING').length;
    const pending = steps.filter(s => s.status === 'PENDING').length;
    const ready = steps.filter(s => s.status === 'READY').length;
    return { total, completed, failed, blocked, running, pending, ready };
  }
}
