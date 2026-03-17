/**
 * Invariant Trace Service
 *
 * Records structured timelines of agent/system activity.
 * Each TraceSession is a named sequence of TraceEvents with
 * structured payloads, world-state snapshots, and sequence numbers.
 *
 * Supports:
 *  - Live event recording (appendEvent)
 *  - Timeline retrieval (getTimeline)
 *  - Session replay (replay) — returns events in order for step-through debugging
 *  - Cross-session summaries
 */

import type { PrismaTraceRepository } from '../../infrastructure/database/repositories/TraceRepository.js';

export type ReplayFrame = {
  sequenceNumber: number;
  type: string;
  entityIds: string[];
  data: Record<string, unknown>;
  deltaPhiAfter?: number;
  coherenceAfter?: number;
  actorId?: string;
  createdAt: Date;
  // Derived fields for replay display
  summary: string;
};

export class TraceService {
  constructor(private readonly traceRepo: PrismaTraceRepository) {}

  /**
   * Start a new named trace session.
   */
  async startSession(name: string, agentId?: string, description?: string) {
    return this.traceRepo.createSession({ name, agentId, description });
  }

  /**
   * End a session (mark as COMPLETED or FAILED).
   */
  async endSession(sessionId: string, status: 'COMPLETED' | 'FAILED' = 'COMPLETED') {
    return this.traceRepo.endSession(sessionId, status);
  }

  /**
   * Append a typed event to a session.
   */
  async record(
    sessionId: string,
    type: string,
    data: Record<string, unknown>,
    opts?: {
      entityIds?: string[];
      deltaPhiAfter?: number;
      coherenceAfter?: number;
      actorId?: string;
    },
  ) {
    return this.traceRepo.appendEvent({
      sessionId,
      type,
      data,
      entityIds: opts?.entityIds,
      deltaPhiAfter: opts?.deltaPhiAfter,
      coherenceAfter: opts?.coherenceAfter,
      actorId: opts?.actorId,
    });
  }

  /**
   * Convenience: record a claim event.
   */
  async recordClaimAdded(
    sessionId: string,
    entityId: string,
    predicate: string,
    value: unknown,
    confidence: number,
  ) {
    return this.record(sessionId, 'CLAIM_ADDED', {
      entityId, predicate, value, confidence,
    }, { entityIds: [entityId] });
  }

  /**
   * Convenience: record an action validation event.
   */
  async recordActionValidated(
    sessionId: string,
    proposalId: string,
    admissibility: string,
    psiScore: number,
    deltaPhi: number,
    reasons: string[],
    entityIds: string[],
    deltaPhiAfter?: number,
    coherenceAfter?: number,
  ) {
    return this.record(sessionId, 'ACTION_VALIDATED', {
      proposalId, admissibility, psiScore, deltaPhi, reasons,
    }, { entityIds, deltaPhiAfter, coherenceAfter });
  }

  /**
   * Convenience: record a policy trigger event.
   */
  async recordPolicyTriggered(
    sessionId: string,
    ruleId: string,
    ruleName: string,
    effect: string,
    proposalId: string,
    entityIds: string[],
  ) {
    return this.record(sessionId, 'POLICY_TRIGGERED', {
      ruleId, ruleName, effect, proposalId,
    }, { entityIds });
  }

  /**
   * Convenience: record a settling round.
   */
  async recordSettlingRound(
    sessionId: string,
    round: number,
    phiAfter: number,
    coherenceAfter: number,
    changes: number,
  ) {
    return this.record(sessionId, 'SETTLING_ROUND', {
      round, phiAfter, coherenceAfter, changes,
    }, { deltaPhiAfter: phiAfter, coherenceAfter });
  }

  /**
   * Get full ordered timeline for a session.
   */
  async getTimeline(sessionId: string): Promise<ReplayFrame[]> {
    const events = await this.traceRepo.getTimeline(sessionId);
    return events.map(e => ({
      sequenceNumber: e.sequenceNumber,
      type: e.type,
      entityIds: e.entityIds,
      data: e.data as Record<string, unknown>,
      deltaPhiAfter: e.deltaPhiAfter ?? undefined,
      coherenceAfter: e.coherenceAfter ?? undefined,
      actorId: e.actorId ?? undefined,
      createdAt: e.createdAt,
      summary: summarizeEvent(e.type, e.data as Record<string, unknown>),
    }));
  }

  /**
   * Replay a session — returns ordered frames with derived display fields.
   * Optionally stop at a specific sequence number for step-through debugging.
   */
  async replay(sessionId: string, upToSeq?: number): Promise<{
    session: { id: string; name: string; agentId?: string | null; startedAt: Date };
    frames: ReplayFrame[];
    stats: {
      totalEvents: number;
      actionsProposed: number;
      actionsBlocked: number;
      contradictionsDetected: number;
      policyTriggered: number;
      settlingRounds: number;
      finalCoherence?: number;
    };
  }> {
    const session = await this.traceRepo.findSessionById(sessionId);
    if (!session) throw new Error(`TraceSession not found: ${sessionId}`);

    const events = upToSeq !== undefined
      ? await this.traceRepo.getTimelineSlice(sessionId, 0, upToSeq)
      : await this.traceRepo.getTimeline(sessionId);

    const frames = events.map(e => ({
      sequenceNumber: e.sequenceNumber,
      type: e.type,
      entityIds: e.entityIds,
      data: e.data as Record<string, unknown>,
      deltaPhiAfter: e.deltaPhiAfter ?? undefined,
      coherenceAfter: e.coherenceAfter ?? undefined,
      actorId: e.actorId ?? undefined,
      createdAt: e.createdAt,
      summary: summarizeEvent(e.type, e.data as Record<string, unknown>),
    }));

    const stats = {
      totalEvents: frames.length,
      actionsProposed: frames.filter(f => f.type === 'ACTION_PROPOSED').length,
      actionsBlocked: frames.filter(
        f => f.type === 'ACTION_VALIDATED' &&
             (f.data['admissibility'] === 'BLOCKED' || f.data['admissibility'] === 'REQUIRE_APPROVAL')
      ).length,
      contradictionsDetected: frames.filter(f => f.type === 'CONTRADICTION_DETECTED').length,
      policyTriggered: frames.filter(f => f.type === 'POLICY_TRIGGERED').length,
      settlingRounds: frames.filter(f => f.type === 'SETTLING_ROUND').length,
      finalCoherence: frames.filter(f => f.coherenceAfter !== undefined).at(-1)?.coherenceAfter,
    };

    return {
      session: {
        id: session.id,
        name: session.name,
        agentId: session.agentId,
        startedAt: session.startedAt,
      },
      frames,
      stats,
    };
  }

  /**
   * Get summary statistics for a session.
   */
  async getSessionStats(sessionId: string) {
    const timeline = await this.getTimeline(sessionId);
    const actionFrames = timeline.filter(f => f.type === 'ACTION_VALIDATED');
    const lastCoherence = timeline.filter(f => f.coherenceAfter !== undefined).at(-1);

    return {
      eventCount: timeline.length,
      actionCount: actionFrames.length,
      blockedCount: actionFrames.filter(f => f.data['admissibility'] === 'BLOCKED').length,
      riskyCount: actionFrames.filter(f => f.data['admissibility'] === 'RISKY').length,
      validCount: actionFrames.filter(f => f.data['admissibility'] === 'VALID').length,
      branchDependentCount: actionFrames.filter(f => f.data['admissibility'] === 'BRANCH_DEPENDENT').length,
      finalCoherence: lastCoherence?.coherenceAfter,
      contradictions: timeline.filter(f => f.type === 'CONTRADICTION_DETECTED').length,
      policyTriggers: timeline.filter(f => f.type === 'POLICY_TRIGGERED').length,
    };
  }
}

// ── Event Summary Generator ──────────────────────────────────────────────────

function summarizeEvent(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case 'CLAIM_ADDED':
      return `Claim added: ${data['predicate']}=${JSON.stringify(data['value'])} (conf=${data['confidence']})`;
    case 'CLAIM_INVALIDATED':
      return `Claim invalidated: ${data['predicate']} on entity ${data['entityId']}`;
    case 'CONTRADICTION_DETECTED':
      return `Contradiction detected: ${data['description'] ?? 'unknown'}`;
    case 'BRANCH_OPENED':
      return `Branch opened: ${data['branchName'] ?? data['branchId']}`;
    case 'BRANCH_RESOLVED':
      return `Branch resolved: ${data['branchName'] ?? data['branchId']}`;
    case 'ACTION_PROPOSED':
      return `Action proposed: ${data['operation']} on ${(data['impactedEntityIds'] as string[] | undefined)?.join(', ')}`;
    case 'ACTION_VALIDATED':
      return `Action ${data['admissibility']}: ${data['operation'] ?? ''} psi=${(data['psiScore'] as number)?.toFixed(3)} deltaPhi=${(data['deltaPhi'] as number)?.toFixed(3)}`;
    case 'POLICY_TRIGGERED':
      return `Policy triggered: "${data['ruleName']}" → ${data['effect']}`;
    case 'APPROVAL_REQUESTED':
      return `Approval requested by ${data['requestedBy']}: ${data['reason']}`;
    case 'APPROVAL_DECIDED':
      return `Approval ${data['decision']}: ${data['reason']}`;
    case 'SETTLING_ROUND':
      return `Settling round ${data['round']}: Φ=${(data['phiAfter'] as number)?.toFixed(3)} coherence=${(data['coherenceAfter'] as number)?.toFixed(1)} changes=${data['changes']}`;
    case 'PLAN_CREATED':
      return `Plan created: "${data['planName']}" — ${data['goal']}`;
    case 'PLAN_STEP_STARTED':
      return `Step started: ${data['stepName']} (${data['operation']})`;
    case 'PLAN_STEP_COMPLETED':
      return `Step completed: ${data['stepName']}`;
    case 'PLAN_STEP_FAILED':
      return `Step failed: ${data['stepName']} — ${data['reason']}`;
    default:
      return `${type}: ${JSON.stringify(data).slice(0, 80)}`;
  }
}
