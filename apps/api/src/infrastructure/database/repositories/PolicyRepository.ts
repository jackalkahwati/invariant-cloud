import prisma, { type DbClient } from '../prisma.js';

export type PolicyRuleCreateInput = {
  name: string;
  description?: string;
  layer?: string;
  condition: Record<string, unknown>;
  effect: string;
  severity?: string;
  entityTypes?: string[];
  operations?: string[];
  priority?: number;
  metadata?: Record<string, unknown>;
};

export type ApprovalRequestCreateInput = {
  policyRuleId: string;
  actionProposalId?: string;
  requestedBy: string;
  reason: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
};

export class PrismaPolicyRepository {
  private readonly db: DbClient;

  constructor(client?: DbClient) {
    this.db = client ?? prisma;
  }

  // ── Policy Rules ─────────────────────────────────────────────────────────────

  async findRuleById(id: string) {
    return this.db.policyRule.findUnique({ where: { id } });
  }

  async findActiveRules() {
    return this.db.policyRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createRule(data: PolicyRuleCreateInput) {
    return this.db.policyRule.create({
      data: {
        name: data.name,
        description: data.description,
        layer: (data.layer ?? 'POLICY') as never,
        condition: data.condition as never,
        effect: data.effect as never,
        severity: (data.severity ?? 'MEDIUM') as never,
        entityTypes: data.entityTypes ?? [],
        operations: data.operations ?? [],
        priority: data.priority ?? 0,
        metadata: data.metadata as never,
        isActive: true,
      },
    });
  }

  async updateRule(id: string, data: Partial<PolicyRuleCreateInput & { isActive: boolean }>) {
    return this.db.policyRule.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.layer !== undefined && { layer: data.layer as never }),
        ...(data.condition !== undefined && { condition: data.condition as never }),
        ...(data.effect !== undefined && { effect: data.effect as never }),
        ...(data.severity !== undefined && { severity: data.severity as never }),
        ...(data.entityTypes !== undefined && { entityTypes: data.entityTypes }),
        ...(data.operations !== undefined && { operations: data.operations }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async deleteRule(id: string) {
    return this.db.policyRule.update({ where: { id }, data: { isActive: false } });
  }

  // ── Policy Evaluations ────────────────────────────────────────────────────────

  async recordEvaluation(data: {
    policyRuleId: string;
    actionProposalId?: string;
    entityIds: string[];
    triggered: boolean;
    effect?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.db.policyEvaluation.create({
      data: {
        policyRuleId: data.policyRuleId,
        actionProposalId: data.actionProposalId,
        entityIds: data.entityIds,
        triggered: data.triggered,
        effect: data.effect as never,
        reason: data.reason,
        metadata: data.metadata as never,
      },
    });
  }

  // ── Approval Requests ─────────────────────────────────────────────────────────

  async findApprovalById(id: string) {
    return this.db.approvalRequest.findUnique({
      where: { id },
      include: { policyRule: true },
    });
  }

  async findPendingApprovals() {
    return this.db.approvalRequest.findMany({
      where: { status: 'PENDING' },
      include: { policyRule: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findApprovalsByProposal(actionProposalId: string) {
    return this.db.approvalRequest.findMany({
      where: { actionProposalId },
      include: { policyRule: true },
    });
  }

  async createApproval(data: ApprovalRequestCreateInput) {
    return this.db.approvalRequest.create({
      data: {
        policyRuleId: data.policyRuleId,
        actionProposalId: data.actionProposalId,
        requestedBy: data.requestedBy,
        reason: data.reason,
        status: 'PENDING',
        expiresAt: data.expiresAt,
        metadata: data.metadata as never,
      },
    });
  }

  async decideApproval(id: string, decision: {
    approved: boolean;
    reviewedBy: string;
    reason?: string;
  }) {
    return this.db.approvalRequest.update({
      where: { id },
      data: {
        status: decision.approved ? 'APPROVED' : 'DENIED',
        reviewedBy: decision.reviewedBy,
        reviewedAt: new Date(),
        decision: decision.reason,
      },
    });
  }

  async expireOldApprovals() {
    const now = new Date();
    return this.db.approvalRequest.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
  }
}
