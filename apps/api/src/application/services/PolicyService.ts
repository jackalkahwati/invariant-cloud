/**
 * Invariant Policy Service
 *
 * Evaluates proposed actions against a declarative rule set.
 * Rules are stored in PolicyRule and evaluated in priority order.
 *
 * A condition is a structured expression:
 *   { type: 'psi_above', threshold: 0.5 }
 *   { type: 'operation_match', operations: ['deploy', 'release'] }
 *   { type: 'entity_type_match', entityTypes: ['AGENT', 'SUBSYSTEM'] }
 *   { type: 'and', conditions: [...] }
 *   { type: 'or', conditions: [...] }
 *
 * Effects (in order of severity):
 *   ALLOW → explicitly permit (stops evaluation)
 *   WARN → log warning and continue
 *   REQUIRE_APPROVAL → block and create ApprovalRequest
 *   ESCALATE → route to a supervisor
 *   DENY → hard block
 */

import type { PrismaPolicyRepository } from '../../infrastructure/database/repositories/PolicyRepository.js';

export type PolicyContext = {
  operation: string;
  impactedEntityIds: string[];
  entityTypes?: string[];  // resolved entity types for impacted entities
  psiScore?: number;
  deltaPhi?: number;
  admissibility?: string;
  actorId?: string;
};

export type PolicyDecision = {
  allowed: boolean;
  effect: string;           // ALLOW | WARN | REQUIRE_APPROVAL | ESCALATE | DENY
  triggeredRules: Array<{
    ruleId: string;
    ruleName: string;
    effect: string;
    reason: string;
  }>;
  requiresApproval: boolean;
  approvalReason?: string;
  warnings: string[];
};

export class PolicyService {
  constructor(private readonly policyRepo: PrismaPolicyRepository) {}

  /**
   * Evaluate all active policy rules against an action context.
   * Returns the aggregate decision.
   */
  async evaluateProposal(
    proposalId: string,
    context: PolicyContext,
  ): Promise<PolicyDecision> {
    const rules = await this.policyRepo.findActiveRules();

    const decision: PolicyDecision = {
      allowed: true,
      effect: 'ALLOW',
      triggeredRules: [],
      requiresApproval: false,
      warnings: [],
    };

    for (const rule of rules) {
      // Check scope filters
      if (rule.operations.length > 0) {
        const opMatch = rule.operations.some(op =>
          context.operation.toLowerCase().includes(op.toLowerCase())
        );
        if (!opMatch) continue;
      }

      if (rule.entityTypes.length > 0 && context.entityTypes) {
        const typeMatch = context.entityTypes.some(t =>
          rule.entityTypes.includes(t)
        );
        if (!typeMatch) continue;
      }

      // Evaluate condition
      const triggered = evaluateCondition(
        rule.condition as Record<string, unknown>,
        context,
      );

      // Record evaluation
      await this.policyRepo.recordEvaluation({
        policyRuleId: rule.id,
        actionProposalId: proposalId,
        entityIds: context.impactedEntityIds,
        triggered,
        effect: triggered ? rule.effect : undefined,
        reason: triggered ? `Rule "${rule.name}" triggered` : undefined,
      });

      if (!triggered) continue;

      decision.triggeredRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        effect: rule.effect,
        reason: `Rule "${rule.name}" (${rule.severity}) matched`,
      });

      // Apply effect
      switch (rule.effect) {
        case 'DENY':
          decision.allowed = false;
          decision.effect = 'DENY';
          // Deny is final, stop evaluating
          return decision;

        case 'REQUIRE_APPROVAL':
          decision.allowed = false;
          decision.effect = 'REQUIRE_APPROVAL';
          decision.requiresApproval = true;
          decision.approvalReason = `Policy rule "${rule.name}" requires approval`;
          break;

        case 'ESCALATE':
          if (decision.effect !== 'DENY') {
            decision.allowed = false;
            decision.effect = 'ESCALATE';
          }
          break;

        case 'WARN':
          decision.warnings.push(`Policy warning: ${rule.name}`);
          break;

        case 'ALLOW':
          // Explicit allow, keep going (lower-priority rules could still block)
          break;
      }
    }

    return decision;
  }

  /**
   * Request approval for a proposal.
   */
  async requestApproval(
    policyRuleId: string,
    proposalId: string,
    requestedBy: string,
    reason: string,
    expiresInHours = 24,
  ) {
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    return this.policyRepo.createApproval({
      policyRuleId,
      actionProposalId: proposalId,
      requestedBy,
      reason,
      expiresAt,
    });
  }

  /**
   * Decide on a pending approval request.
   */
  async decideApproval(
    requestId: string,
    approved: boolean,
    reviewedBy: string,
    reason?: string,
  ) {
    return this.policyRepo.decideApproval(requestId, { approved, reviewedBy, reason });
  }

  /**
   * Check if a proposal has all required approvals.
   */
  async hasRequiredApprovals(proposalId: string): Promise<boolean> {
    const approvals = await this.policyRepo.findApprovalsByProposal(proposalId);
    if (approvals.length === 0) return true;

    const pending = approvals.filter(a => a.status === 'PENDING');
    const denied = approvals.filter(a => a.status === 'DENIED');

    if (denied.length > 0) return false;
    if (pending.length > 0) return false;

    return approvals.every(a => a.status === 'APPROVED');
  }
}

// ── Condition Evaluator ──────────────────────────────────────────────────────

function evaluateCondition(
  condition: Record<string, unknown>,
  ctx: PolicyContext,
): boolean {
  const type = condition['type'] as string;

  switch (type) {
    case 'always':
      return true;

    case 'never':
      return false;

    case 'psi_above': {
      const threshold = condition['threshold'] as number;
      return (ctx.psiScore ?? 0) > threshold;
    }

    case 'psi_below': {
      const threshold = condition['threshold'] as number;
      return (ctx.psiScore ?? 0) < threshold;
    }

    case 'delta_phi_above': {
      const threshold = condition['threshold'] as number;
      return (ctx.deltaPhi ?? 0) > threshold;
    }

    case 'admissibility_is': {
      const expected = condition['value'] as string;
      return ctx.admissibility === expected;
    }

    case 'admissibility_in': {
      const values = condition['values'] as string[];
      return values.includes(ctx.admissibility ?? '');
    }

    case 'operation_match': {
      const ops = condition['operations'] as string[];
      return ops.some(op => ctx.operation.toLowerCase().includes(op.toLowerCase()));
    }

    case 'entity_type_match': {
      const types = condition['entityTypes'] as string[];
      return (ctx.entityTypes ?? []).some(t => types.includes(t));
    }

    case 'and': {
      const conditions = condition['conditions'] as Record<string, unknown>[];
      return conditions.every(c => evaluateCondition(c, ctx));
    }

    case 'or': {
      const conditions = condition['conditions'] as Record<string, unknown>[];
      return conditions.some(c => evaluateCondition(c, ctx));
    }

    case 'not': {
      const inner = condition['condition'] as Record<string, unknown>;
      return !evaluateCondition(inner, ctx);
    }

    default:
      // Unknown condition type, conservative: treat as triggered
      return false;
  }
}
