/**
 * Invariant Plan Service
 *
 * Task decomposition and multi-step orchestration with coherence-aware execution.
 *
 * A Plan is a named, goal-directed sequence of PlanSteps.
 * Steps have prerequisite relationships (DAG) and are executed in topological order.
 *
 * Each step is validated against the coherence engine before execution.
 * If a step is BLOCKED by the engine, it is marked as BLOCKED and the plan
 * is evaluated for replanning.
 *
 * Execution model:
 *   PENDING → READY (all prerequisites met)
 *   READY   → RUNNING (assigned and started)
 *   RUNNING → COMPLETED | FAILED | BLOCKED
 *
 * Replanning: when state changes invalidate future steps, the plan transitions
 * to REPLANNING status. The planner can then update remaining steps.
 */

import type { PrismaPlanRepository } from '../../infrastructure/database/repositories/PlanRepository.js';
import type { ActionValidationService } from './ActionValidationService.js';
import type { TraceService } from './TraceService.js';

export class PlanService {
  constructor(
    private readonly planRepo: PrismaPlanRepository,
    private readonly actionValidator: ActionValidationService,
    private readonly traceService: TraceService,
  ) {}

  /**
   * Create a plan with its steps. Steps are ordered by `order` field.
   * `requires` is an array of step indices (0-based) within the plan,
   * resolved to actual step IDs after creation.
   */
  async createPlan(
    data: {
      name: string;
      goal: string;
      description?: string;
      agentId?: string;
      entityIds?: string[];
      steps: Array<{
        name: string;
        operation: string;
        description?: string;
        parameters?: Record<string, unknown>;
        entityIds?: string[];
        assignedTo?: string;
        requiresIndices?: number[]; // indices into steps array
      }>;
    },
    traceSessionId?: string,
  ) {
    const plan = await this.planRepo.createPlan({
      name: data.name,
      goal: data.goal,
      description: data.description,
      agentId: data.agentId,
      entityIds: data.entityIds,
    });

    // Create steps in order, collecting IDs for cross-reference
    const createdStepIds: string[] = [];

    for (let i = 0; i < data.steps.length; i++) {
      const stepData = data.steps[i]!;
      const requires = (stepData.requiresIndices ?? []).map(idx => createdStepIds[idx] ?? '').filter(Boolean);

      const step = await this.planRepo.createStep({
        planId: plan.id,
        name: stepData.name,
        operation: stepData.operation,
        description: stepData.description,
        parameters: stepData.parameters,
        entityIds: stepData.entityIds,
        assignedTo: stepData.assignedTo,
        order: i,
        requires,
      });

      createdStepIds.push(step.id);
    }

    // Mark plan as ACTIVE (moved out of DRAFT)
    await this.planRepo.updatePlanStatus(plan.id, 'ACTIVE');

    if (traceSessionId) {
      await this.traceService.record(traceSessionId, 'PLAN_CREATED', {
        planId: plan.id,
        planName: plan.name,
        goal: plan.goal,
        stepCount: data.steps.length,
      }, { entityIds: data.entityIds ?? [] });
    }

    return this.planRepo.findPlanById(plan.id);
  }

  /**
   * Get steps that are ready to execute (all prerequisites COMPLETED).
   */
  async getReadySteps(planId: string) {
    // Refresh READY status
    await this.refreshReadySteps(planId);
    const steps = await this.planRepo.findStepsByPlan(planId);
    return steps.filter(s => s.status === 'READY');
  }

  /**
   * Mark a step as RUNNING and record trace.
   */
  async startStep(stepId: string, agentId?: string, traceSessionId?: string) {
    const step = await this.planRepo.findStepById(stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    if (step.status !== 'READY') {
      throw new Error(`Step ${stepId} is not READY (status: ${step.status})`);
    }

    const updated = await this.planRepo.updateStepStatus(stepId, 'RUNNING', {
      startedAt: new Date(),
      assignedTo: agentId,
    });

    if (traceSessionId) {
      await this.traceService.record(traceSessionId, 'PLAN_STEP_STARTED', {
        stepId,
        stepName: step.name,
        operation: step.operation,
        planId: step.planId,
      }, { entityIds: step.entityIds });
    }

    return updated;
  }

  /**
   * Validate a step against the coherence engine before executing.
   * Returns the validation result, caller decides whether to proceed.
   */
  async validateStep(stepId: string) {
    const step = await this.planRepo.findStepById(stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    if (step.entityIds.length === 0) {
      return { admissibility: 'VALID', psiScore: 0, deltaPhi: 0, reasons: [] };
    }

    // Create proposal for this step
    const { PrismaActionRepository } = await import('../../infrastructure/database/repositories/ActionRepository.js');
    const actionRepo = new PrismaActionRepository();

    const proposal = await actionRepo.createProposal({
      operation: step.operation,
      description: step.description ?? step.name,
      parameters: step.parameters as Record<string, unknown>,
      impactedEntityIds: step.entityIds,
      provenanceChain: [],
      status: 'PENDING',
    });

    await this.planRepo.updateStepStatus(stepId, step.status, {
      actionProposalId: proposal.id,
    });

    const validation = await this.actionValidator.validateAction(proposal);
    return validation;
  }

  /**
   * Complete a step. Checks if plan is now fully done.
   */
  async completeStep(stepId: string, traceSessionId?: string) {
    const step = await this.planRepo.findStepById(stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    await this.planRepo.updateStepStatus(stepId, 'COMPLETED', {
      completedAt: new Date(),
    });

    if (traceSessionId) {
      await this.traceService.record(traceSessionId, 'PLAN_STEP_COMPLETED', {
        stepId,
        stepName: step.name,
        planId: step.planId,
      }, { entityIds: step.entityIds });
    }

    // Refresh ready steps for the plan
    await this.refreshReadySteps(step.planId);

    // Check if plan is complete
    const progress = await this.planRepo.getPlanProgress(step.planId);
    if (progress.completed === progress.total) {
      await this.planRepo.updatePlanStatus(step.planId, 'COMPLETED');
    }

    return this.planRepo.findPlanById(step.planId);
  }

  /**
   * Fail a step. Optionally mark plan as REPLANNING.
   */
  async failStep(stepId: string, reason: string, replan = false, traceSessionId?: string) {
    const step = await this.planRepo.findStepById(stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    await this.planRepo.updateStepStatus(stepId, 'FAILED', {
      completedAt: new Date(),
      failureReason: reason,
    });

    if (traceSessionId) {
      await this.traceService.record(traceSessionId, 'PLAN_STEP_FAILED', {
        stepId,
        stepName: step.name,
        planId: step.planId,
        reason,
      }, { entityIds: step.entityIds });
    }

    if (replan) {
      await this.planRepo.updatePlanStatus(step.planId, 'REPLANNING');
    }

    return this.planRepo.findPlanById(step.planId);
  }

  /**
   * Block a step due to coherence engine rejection.
   */
  async blockStep(stepId: string, reason: string, traceSessionId?: string) {
    const step = await this.planRepo.findStepById(stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    await this.planRepo.updateStepStatus(stepId, 'BLOCKED', {
      failureReason: reason,
    });

    // A blocked step means the plan needs replanning
    await this.planRepo.updatePlanStatus(step.planId, 'REPLANNING');

    if (traceSessionId) {
      await this.traceService.record(traceSessionId, 'PLAN_STEP_FAILED', {
        stepId,
        stepName: step.name,
        planId: step.planId,
        reason: `BLOCKED by coherence engine: ${reason}`,
        blockedBy: 'coherence_engine',
      }, { entityIds: step.entityIds });
    }

    return this.planRepo.findPlanById(step.planId);
  }

  /**
   * Get full plan with progress summary.
   */
  async getPlanWithProgress(planId: string) {
    const plan = await this.planRepo.findPlanById(planId);
    if (!plan) return null;

    const progress = await this.planRepo.getPlanProgress(planId);
    return { plan, progress };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────────

  private async refreshReadySteps(planId: string) {
    const readySteps = await this.planRepo.findReadySteps(planId);
    for (const step of readySteps) {
      await this.planRepo.updateStepStatus(step.id, 'READY');
    }
  }
}
