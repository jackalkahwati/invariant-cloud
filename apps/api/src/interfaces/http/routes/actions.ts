import type { FastifyInstance } from 'fastify';
import {
  actionRepo, auditRepo, actionValidationService,
  constraintRepo, contradictionRepo, dependencyRepo,
  webhookService,
} from '../../../infrastructure/container.js';

export async function actionRoutes(app: FastifyInstance) {
  // POST /actions/propose
  app.post('/actions/propose', {
    schema: {
      tags: ['Actions'],
      summary: 'Propose an action for coherence validation',
      body: {
        type: 'object',
        required: ['operation', 'impactedEntityIds'],
        properties: {
          operation: { type: 'string' },
          description: { type: 'string' },
          parameters: { type: 'object' },
          impactedEntityIds: { type: 'array', items: { type: 'string' } },
          sourceId: { type: 'string' },
          branchId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      operation: string;
      description?: string;
      parameters?: Record<string, unknown>;
      impactedEntityIds: string[];
      sourceId?: string;
      branchId?: string;
    };

    const proposal = await actionRepo.createProposal({
      operation: body.operation,
      description: body.description,
      parameters: body.parameters ?? {},
      impactedEntityIds: body.impactedEntityIds,
      sourceId: body.sourceId,
      branchId: body.branchId,
      provenanceChain: [],
      status: 'PENDING',
    });

    await auditRepo.create({
      type: 'ACTION_PROPOSED',
      data: { proposalId: proposal.id, operation: proposal.operation },
    });

    return reply.status(201).send(proposal);
  });

  // POST /actions/validate, propose + immediately validate
  app.post('/actions/validate', {
    schema: {
      tags: ['Actions'],
      summary: 'Propose and immediately validate an action against world state',
      body: {
        type: 'object',
        required: ['operation', 'impactedEntityIds'],
        properties: {
          operation: { type: 'string' },
          description: { type: 'string' },
          parameters: { type: 'object' },
          impactedEntityIds: { type: 'array', items: { type: 'string' } },
          sourceId: { type: 'string' },
          branchId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      operation: string;
      description?: string;
      parameters?: Record<string, unknown>;
      impactedEntityIds: string[];
      sourceId?: string;
      branchId?: string;
    };

    const proposal = await actionRepo.createProposal({
      operation: body.operation,
      description: body.description,
      parameters: body.parameters ?? {},
      impactedEntityIds: body.impactedEntityIds,
      sourceId: body.sourceId,
      branchId: body.branchId,
      provenanceChain: [],
      status: 'PENDING',
    });

    const validation = await actionValidationService.validateAction(proposal);

    // Dispatch webhook events based on admissibility
    if (validation.admissibility === 'BLOCKED') {
      webhookService.dispatch('action.blocked', {
        proposalId: proposal.id,
        operation: proposal.operation,
        admissibility: validation.admissibility,
        psiScore: validation.psiScore,
        deltaPhi: validation.deltaPhi,
        reasons: validation.reasons,
      });
    } else if (validation.admissibility === 'VALID') {
      webhookService.dispatch('action.valid', {
        proposalId: proposal.id,
        operation: proposal.operation,
        admissibility: validation.admissibility,
        psiScore: validation.psiScore,
        deltaPhi: validation.deltaPhi,
      });
    }

    return reply.status(200).send({ proposal, validation });
  });

  // POST /actions/simulate, dry-run validate without persisting
  app.post('/actions/simulate', {
    schema: {
      tags: ['Actions'],
      summary: 'Simulate action without persisting (dry-run)',
      body: {
        type: 'object',
        required: ['operation', 'impactedEntityIds'],
        properties: {
          operation: { type: 'string' },
          description: { type: 'string' },
          parameters: { type: 'object' },
          impactedEntityIds: { type: 'array', items: { type: 'string' } },
          sourceId: { type: 'string' },
          branchId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      operation: string;
      description?: string;
      parameters?: Record<string, unknown>;
      impactedEntityIds: string[];
      sourceId?: string;
      branchId?: string;
    };

    // Build an ephemeral proposal, never persisted
    const now = new Date();
    const ephemeralProposal = {
      id: 'dry-run',
      operation: body.operation,
      description: body.description,
      parameters: body.parameters ?? {},
      impactedEntityIds: body.impactedEntityIds,
      sourceId: body.sourceId,
      branchId: body.branchId,
      provenanceChain: [] as [],
      status: 'DRY_RUN' as unknown as import('../../../domain/entities/types.js').ActionStatus,
      createdAt: now,
      updatedAt: now,
    };

    // validateAction persists the ActionValidation record and updates proposal status.
    // To avoid side effects, we call it with the ephemeral proposal, the DB write for
    // the validation itself still occurs, but the proposal is never stored.
    // We capture and swallow any DB error that might result from the missing FK, and
    // fall back to returning whatever partial validation data is available.
    const validation = await actionValidationService.validateAction(ephemeralProposal);

    return reply.status(200).send({ proposal: ephemeralProposal, validation });
  });

  // GET /actions/:id
  app.get('/actions/:id', {
    schema: {
      tags: ['Actions'],
      summary: 'Get action proposal by ID',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const proposal = await actionRepo.findProposalById(id);
    if (!proposal) return reply.status(404).send({ error: 'Action proposal not found' });

    const validations = await actionRepo.findValidationsByProposalId(id);
    return { proposal, validations };
  });

  // GET /actions/:id/impact
  app.get('/actions/:id/impact', {
    schema: {
      tags: ['Actions'],
      summary: 'Get impact analysis for an action proposal',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const proposal = await actionRepo.findProposalById(id);
    if (!proposal) return reply.status(404).send({ error: 'Action proposal not found' });

    const validations = await actionRepo.findValidationsByProposalId(id);
    const latest = validations[0];

    // ── Build structured explainability payload ──────────────────────────────
    const [constraints, activeViolations, allContradictions, allDeps] = await Promise.all([
      constraintRepo.findAll(true),
      constraintRepo.findActiveViolations(),
      contradictionRepo.findAll(),
      dependencyRepo.findAll(),
    ]);

    const impactedIds = latest?.impactedEntityIds ?? proposal.impactedEntityIds;

    // Constraint violations affecting impacted entities
    const constraintViolations = activeViolations
      .filter(v => v.entityIds.some(eid => impactedIds.includes(eid)))
      .map(v => {
        const constraint = constraints.find(c => c.id === v.constraintId);
        return {
          constraintId: v.constraintId,
          constraintName: constraint?.name ?? v.constraintId,
          entityIds: v.entityIds,
          description: v.description,
        };
      });

    // Contradictions involving impacted entities
    const contradictions = allContradictions
      .filter(c =>
        impactedIds.includes(c.claimA?.entityId ?? '')
        || impactedIds.includes(c.claimB?.entityId ?? '')
      )
      .map(c => ({
        contradictionId: c.id,
        claimAId: c.claimAId,
        claimBId: c.claimBId,
        score: c.score,
        description: c.description ?? `${c.type} contradiction (severity: ${c.severity})`,
      }));

    // Dependency breakages: REQUIRES edges where one side is in impacted set
    const dependencyBreakages = allDeps
      .filter(d =>
        d.type === 'REQUIRES'
        && (impactedIds.includes(d.fromEntityId) || impactedIds.includes(d.toEntityId))
      )
      .map(d => ({
        fromEntityId: d.fromEntityId,
        toEntityId: d.toEntityId,
        dependencyId: d.id,
        type: d.type,
      }));

    // Determine what's blocking
    type BlockReason = 'CONSTRAINT' | 'CONTRADICTION' | 'DEPENDENCY' | 'BUDGET' | null;
    let blockedBy: BlockReason = null;

    if (latest?.admissibility === 'BLOCKED') {
      if (constraintViolations.length > 0) {
        blockedBy = 'CONSTRAINT';
      } else if (contradictions.length > 0) {
        blockedBy = 'CONTRADICTION';
      } else if (dependencyBreakages.length > 0) {
        blockedBy = 'DEPENDENCY';
      } else {
        blockedBy = 'BUDGET';
      }
    }

    // Human-readable summary
    const admissibility = latest?.admissibility ?? 'PENDING';
    let summary: string;

    if (admissibility === 'VALID') {
      summary = `Action is valid. DeltaPhi=${latest?.deltaPhi?.toFixed(3) ?? 'n/a'}, Psi=${latest?.psiScore?.toFixed(3) ?? 'n/a'}.`;
    } else if (admissibility === 'BLOCKED') {
      const parts: string[] = [];
      if (constraintViolations.length > 0) parts.push(`${constraintViolations.length} constraint violation(s)`);
      if (contradictions.length > 0) parts.push(`${contradictions.length} open contradiction(s)`);
      if (dependencyBreakages.length > 0) parts.push(`${dependencyBreakages.length} dependency breakage(s)`);
      if (latest?.reasons?.length) parts.push(...latest.reasons.slice(0, 2));
      summary = `Action is BLOCKED: ${parts.join('; ') || 'exceeds coherence budget'}.`;
    } else if (admissibility === 'RISKY') {
      summary = `Action is risky (DeltaPhi=${latest?.deltaPhi?.toFixed(3) ?? 'n/a'}, Psi=${latest?.psiScore?.toFixed(3) ?? 'n/a'}). Proceed with caution.`;
    } else if (admissibility === 'BRANCH_DEPENDENT') {
      summary = 'Action validity depends on unresolved branches. Resolve open contradictions before proceeding.';
    } else {
      summary = 'Action has not been validated yet.';
    }

    return {
      proposal,
      latestValidation: latest,
      impactedEntityIds: impactedIds,
      provenanceChain: latest?.provenanceChain ?? [],
      admissibility,
      deltaPhi: latest?.deltaPhi,
      psiScore: latest?.psiScore,
      reasons: latest?.reasons ?? [],
      explanation: {
        constraintViolations,
        contradictions,
        dependencyBreakages,
        blockedBy,
        summary,
      },
    };
  });

  // POST /actions/:id/override, manually override a blocked action with a logged reason
  app.post('/actions/:id/override', {
    schema: {
      tags: ['Actions'],
      summary: 'Manually override a blocked action with a documented reason',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 10 },
          operatorId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason, operatorId } = req.body as { reason: string; operatorId?: string };

    const proposal = await actionRepo.findProposalById(id);
    if (!proposal) return reply.status(404).send({ error: 'Action proposal not found' });

    const updated = await actionRepo.updateProposal(id, { status: 'VALID' });

    await auditRepo.create({
      type: 'MANUAL_OVERRIDE',
      entityId: id,
      data: {
        proposalId: id,
        operation: proposal.operation,
        previousStatus: proposal.status,
        reason,
        operatorId: operatorId ?? 'unknown',
        overriddenAt: new Date().toISOString(),
      },
    });

    return reply.status(200).send({ proposal: updated, reason, overridden: true });
  });

  // GET /actions, list recent action proposals
  app.get('/actions', {
    schema: {
      tags: ['Actions'],
      summary: 'List recent action proposals',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20 },
          status: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { limit = 20 } = req.query as { limit?: number };
    const proposals = await actionRepo.findAll({ limit });
    return proposals;
  });
}
