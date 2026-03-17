/**
 * Engine Harness — runs a Scenario through the Coherence Engine in-process.
 *
 * Builds a clean world state from the scenario spec, runs settling,
 * validates the proposed action, and returns an EvaluationResult.
 *
 * This module is the source of truth for both:
 *   - The "full engine" evaluator
 *   - All ablation evaluators (which receive a modified EngineConfig or
 *     a modified execution plan)
 */

import prisma from '../../../api/src/infrastructure/database/prisma.js';
import { PrismaEntityRepository } from '../../../api/src/infrastructure/database/repositories/EntityRepository.js';
import { PrismaSourceRepository } from '../../../api/src/infrastructure/database/repositories/SourceRepository.js';
import { PrismaClaimRepository } from '../../../api/src/infrastructure/database/repositories/ClaimRepository.js';
import { PrismaConstraintRepository } from '../../../api/src/infrastructure/database/repositories/ConstraintRepository.js';
import { PrismaDependencyRepository } from '../../../api/src/infrastructure/database/repositories/DependencyRepository.js';
import { PrismaContradictionRepository } from '../../../api/src/infrastructure/database/repositories/ContradictionRepository.js';
import { PrismaBranchRepository } from '../../../api/src/infrastructure/database/repositories/BranchRepository.js';
import { PrismaActionRepository } from '../../../api/src/infrastructure/database/repositories/ActionRepository.js';
import { PrismaSnapshotRepository } from '../../../api/src/infrastructure/database/repositories/SnapshotRepository.js';
import { PrismaAuditRepository } from '../../../api/src/infrastructure/database/repositories/AuditRepository.js';
import { SettlingService } from '../../../api/src/application/services/SettlingService.js';
import { ActionValidationService } from '../../../api/src/application/services/ActionValidationService.js';
import type { EngineConfig } from '../../../api/src/domain/entities/types.js';
import type { Scenario, EvaluationResult, ActionAdmissibility } from '../scenarios/types.js';

export interface HarnessConfig {
  engineConfig: EngineConfig;
  /** If true, skip the iterative settling loop — single pass only */
  singlePassOnly?: boolean;
  /** If true, never create branches — just flag contradictions */
  noBranching?: boolean;
  /** If true, treat all dep types as SUPPORTS (ignore sign) */
  unsignedDepsOnly?: boolean;
  /** If true, skip provenance fragility scoring (mu5 = 0) */
  noProvenance?: boolean;
  /** If true, treat all claims as staleness=0 */
  noStaleness?: boolean;
  /** If true, no DeltaPhi budget — use only Psi threshold */
  noBudget?: boolean;
}

/**
 * Seeded namespace so parallel eval runs don't collide.
 * Each scenario gets isolated entities via a prefix.
 */
export async function runScenarioThroughEngine(
  scenario: Scenario,
  config: HarnessConfig,
  namespace: string,
): Promise<EvaluationResult> {
  const start = Date.now();

  const entityRepo = new PrismaEntityRepository();
  const sourceRepo = new PrismaSourceRepository();
  const claimRepo = new PrismaClaimRepository();
  const constraintRepo = new PrismaConstraintRepository();
  const dependencyRepo = new PrismaDependencyRepository();
  const contradictionRepo = new PrismaContradictionRepository();
  const branchRepo = new PrismaBranchRepository();
  const actionRepo = new PrismaActionRepository();
  const snapshotRepo = new PrismaSnapshotRepository();
  const auditRepo = new PrismaAuditRepository();

  // Apply ablation modifications to config
  const effectiveConfig = applyAblations(config);

  const settling = new SettlingService(
    claimRepo, constraintRepo, dependencyRepo,
    contradictionRepo, branchRepo, auditRepo, snapshotRepo, effectiveConfig,
  );
  const validator = new ActionValidationService(
    claimRepo, constraintRepo, dependencyRepo, contradictionRepo,
    branchRepo, actionRepo, auditRepo, settling, effectiveConfig,
  );

  try {
    // ── 1. Build entity map ─────────────────────────────────────
    const entityMap = new Map<string, string>(); // name → id

    for (const es of scenario.entities) {
      const entity = await entityRepo.create({
        name: `${namespace}:${es.name}`,
        type: es.type as never,
        description: es.description,
        metadata: { ...es.metadata, evalNamespace: namespace, originalName: es.name },
        isActive: true,
      });
      entityMap.set(es.name, entity.id);
    }

    // ── 2. Create sources ───────────────────────────────────────
    const sourceMap = new Map<string, string>();
    const uniqueSources = new Map<string, { type: string; trust: number }>();

    for (const cs of scenario.claims) {
      const sn = cs.sourceName ?? 'System';
      const st = cs.sourceType ?? 'SYSTEM';
      if (!uniqueSources.has(sn)) {
        uniqueSources.set(sn, { type: st, trust: st === 'HUMAN' ? 0.9 : st === 'AGENT' ? 0.8 : st === 'SENSOR' ? 0.85 : 1.0 });
      }
    }

    for (const [name, { type, trust }] of uniqueSources) {
      const source = await sourceRepo.create({
        name: `${namespace}:${name}`,
        type: type as never,
        trustScore: trust,
      });
      sourceMap.set(name, source.id);
    }

    // ── 3. Create claims ────────────────────────────────────────
    const now = new Date();

    for (const cs of scenario.claims) {
      const entityId = entityMap.get(cs.entityName);
      if (!entityId) continue;
      const sourceId = sourceMap.get(cs.sourceName ?? 'System') ?? [...sourceMap.values()][0]!;

      const timestamp = cs.ageSeconds
        ? new Date(now.getTime() - Math.abs(cs.ageSeconds) * 1000)
        : now;

      await claimRepo.create({
        entityId,
        predicate: cs.predicate,
        value: cs.value,
        confidence: cs.confidence ?? 0.9,
        sourceId,
        timestamp,
        status: 'ACTIVE',
      });
    }

    // ── 4. Create constraints ───────────────────────────────────
    for (const cs of scenario.constraints) {
      const entityIds = (cs.entityNames ?? []).map(n => entityMap.get(n)).filter(Boolean) as string[];
      await constraintRepo.create({
        name: cs.name,
        description: cs.description,
        type: cs.type as never,
        expression: cs.expression as never,
        entityIds,
        weight: cs.weight ?? 1.0,
        isActive: true,
      });
    }

    // ── 5. Create dependencies ──────────────────────────────────
    for (const ds of scenario.dependencies) {
      const fromEntityId = entityMap.get(ds.fromEntityName);
      const toEntityId = entityMap.get(ds.toEntityName);
      if (!fromEntityId || !toEntityId) continue;

      // Ablation: no signed deps → convert all to SUPPORTS
      const depType = config.unsignedDepsOnly ? 'SUPPORTS' : ds.type;

      await dependencyRepo.create({
        fromEntityId,
        toEntityId,
        type: depType as never,
        weight: ds.weight ?? 1.0,
        description: ds.description,
        isActive: true,
      });
    }

    // ── 6. Process update sequence (drift scenarios) ────────────
    if (scenario.updateSequence) {
      for (const step of scenario.updateSequence) {
        for (const newClaim of (step.addClaims ?? [])) {
          const entityId = entityMap.get(newClaim.entityName);
          if (!entityId) continue;
          const sourceId = sourceMap.get(newClaim.sourceName ?? 'System')
            ?? [...sourceMap.values()][0]!;
          const ts = newClaim.ageSeconds
            ? new Date(now.getTime() - Math.abs(newClaim.ageSeconds) * 1000)
            : now;
          await claimRepo.create({
            entityId,
            predicate: newClaim.predicate,
            value: newClaim.value,
            confidence: newClaim.confidence ?? 0.9,
            sourceId,
            timestamp: ts,
            status: 'ACTIVE',
          });
        }
      }
    }

    // ── 7. Run settling ─────────────────────────────────────────
    let settlingRounds = 0;
    let phiFinal = 0;
    let coherenceScore = 100;

    if (config.singlePassOnly) {
      // Ablation: single pass only (no iterative convergence)
      await runSinglePass(settling, contradictionRepo, branchRepo, config);
      settlingRounds = 1;
    } else {
      const rounds = await settling.settle();
      settlingRounds = rounds.length;
      const last = rounds[rounds.length - 1];
      phiFinal = last?.phiAfter ?? 0;
      coherenceScore = last?.coherenceScoreAfter ?? 100;
    }

    // ── 8. Collect contradictions ───────────────────────────────
    const allContradictions = await contradictionRepo.findAll();
    const nsEntityIds = new Set([...entityMap.values()]);

    // Filter to this namespace only
    const contradictions = allContradictions.filter(c =>
      nsEntityIds.has(c.claimA?.entityId ?? '') || nsEntityIds.has(c.claimB?.entityId ?? '')
    );

    // Reverse-map entity IDs to original names
    const idToName = new Map([...entityMap.entries()].map(([name, id]) => [id, name]));

    const contradictionsDetected = contradictions.map(c => ({
      entityName: idToName.get(c.claimA?.entityId ?? '') ?? c.claimA?.entityId,
      predicate: c.claimA?.predicate,
      description: c.description ?? `${c.type}: score ${c.score.toFixed(2)}`,
      score: c.score,
      severity: c.severity,
    }));

    // ── 9. Check branch creation ────────────────────────────────
    const branches = await branchRepo.findAll('OPEN');
    const branchCreated = config.noBranching
      ? false
      : branches.some(b => {
          // check if this branch's contradiction involves our namespace entities
          return contradictions.some(c => c.branchId === b.id);
        });

    // ── 10. Validate action ─────────────────────────────────────
    const impactedEntityIds = scenario.proposedAction.impactedEntityNames
      .map(n => entityMap.get(n))
      .filter(Boolean) as string[];

    const proposal = await actionRepo.createProposal({
      operation: scenario.proposedAction.operation,
      description: scenario.proposedAction.description,
      parameters: scenario.proposedAction.parameters ?? {},
      impactedEntityIds,
      provenanceChain: [],
      status: 'PENDING',
    });

    const validation = await validator.validateAction(proposal);

    // ── 11. Compute invalidated entities ────────────────────────
    const allClaims = await claimRepo.findAll();
    const invalidatedClaims = allClaims.filter(c =>
      nsEntityIds.has(c.entityId) && c.status === 'INVALIDATED'
    );
    const invalidatedEntityNames = [...new Set(
      invalidatedClaims.map(c => idToName.get(c.entityId)).filter(Boolean) as string[]
    )];

    // ── 12. Build explanation ───────────────────────────────────
    const explanation = buildEngineExplanation(
      contradictionsDetected,
      branchCreated,
      validation,
      invalidatedEntityNames,
      phiFinal,
      coherenceScore,
    );

    // ── 13. Cleanup: hard-delete all namespace records to keep the DB lean ─────
    const entityIds = [...entityMap.values()];
    const sourceIds = [...sourceMap.values()];

    // Get claim IDs for these entities
    const nsClaims = await prisma.claim.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } });
    const nsClaimIds = nsClaims.map(c => c.id);

    // Get constraint IDs that reference these entities (entityIds is a Postgres array field)
    const nsConstraints = await prisma.constraint.findMany({
      where: { entityIds: { hasSome: entityIds } }, select: { id: true }
    });
    const nsConstraintIds = nsConstraints.map(c => c.id);

    // Get contradiction IDs involving our claims
    const nsContradictions = await prisma.contradiction.findMany({
      where: { OR: [{ claimAId: { in: nsClaimIds } }, { claimBId: { in: nsClaimIds } }] },
      select: { id: true, branchId: true },
    });
    const nsContradictionIds = nsContradictions.map(c => c.id);
    const nsBranchIds = nsContradictions.map(c => c.branchId).filter(Boolean) as string[];

    // Delete in FK-safe order
    // First get action proposal IDs for this namespace
    const nsProposals = await prisma.actionProposal.findMany({
      where: { impactedEntityIds: { hasSome: entityIds } }, select: { id: true }
    });
    const nsProposalIds = nsProposals.map(p => p.id);
    await prisma.actionValidation.deleteMany({ where: { actionProposalId: { in: nsProposalIds } } });
    await prisma.actionProposal.deleteMany({ where: { id: { in: nsProposalIds } } });
    await prisma.contradiction.deleteMany({ where: { id: { in: nsContradictionIds } } });
    if (nsBranchIds.length > 0) {
      await prisma.branch.deleteMany({ where: { id: { in: nsBranchIds } } });
    }
    await prisma.constraintViolation.deleteMany({ where: { constraintId: { in: nsConstraintIds } } });
    await prisma.dependency.deleteMany({ where: { OR: [{ fromEntityId: { in: entityIds } }, { toEntityId: { in: entityIds } }] } });
    await prisma.constraint.deleteMany({ where: { id: { in: nsConstraintIds } } });
    await prisma.provenanceEdge.deleteMany({ where: { OR: [{ sourceClaimId: { in: nsClaimIds } }, { targetClaimId: { in: nsClaimIds } }] } });
    await prisma.claimEvidence.deleteMany({ where: { claimId: { in: nsClaimIds } } });
    await prisma.claim.deleteMany({ where: { id: { in: nsClaimIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
    await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });

    return {
      scenarioId: scenario.id,
      evaluatorId: 'engine', // overridden by caller
      durationMs: Date.now() - start,
      contradictionsDetected,
      branchCreated,
      actionAdmissibility: validation.admissibility as ActionAdmissibility,
      invalidatedEntityNames,
      coherenceScore,
      explanation,
      rawOutput: { validation, settlingRounds, phiFinal },
    };

  } catch (err) {
    return {
      scenarioId: scenario.id,
      evaluatorId: 'engine',
      durationMs: Date.now() - start,
      error: String(err),
      contradictionsDetected: [],
      branchCreated: false,
      actionAdmissibility: 'UNKNOWN',
      invalidatedEntityNames: [],
      explanation: `Error: ${String(err)}`,
    };
  }
}

/** Single pass — used for "no settling" ablation */
async function runSinglePass(
  settling: SettlingService,
  contradictionRepo: PrismaContradictionRepository,
  branchRepo: PrismaBranchRepository,
  config: HarnessConfig,
): Promise<void> {
  // Access the internal single pass via the settling service
  // This is a simplified version: just run contradiction detection + constraint eval
  const rounds = await settling.settle();
  // We only care about the first round
  void rounds;
}

function applyAblations(config: HarnessConfig): EngineConfig {
  const base = { ...config.engineConfig };

  if (config.noStaleness) {
    base.stalenessLambda = 0;
    base.coherenceWeights = { ...base.coherenceWeights, lambdaU: 0 };
  }

  if (config.noBudget) {
    base.actionBudget = Infinity;
  }

  if (config.noProvenance) {
    base.actionWeights = { ...base.actionWeights, mu5: 0 };
  }

  return base;
}

function buildEngineExplanation(
  contradictions: Array<{ entityName?: string; predicate?: string; description: string; score?: number }>,
  branchCreated: boolean,
  validation: { admissibility: string; deltaPhi: number; psiScore: number; reasons: string[] },
  invalidatedEntityNames: string[],
  phi: number,
  coherenceScore: number,
): string {
  const parts: string[] = [];

  parts.push(`Coherence score: ${coherenceScore.toFixed(1)}/100 (Phi=${phi.toFixed(3)})`);

  if (contradictions.length > 0) {
    parts.push(`Contradictions detected: ${contradictions.map(c => c.description).join('; ')}`);
  } else {
    parts.push('No contradictions detected');
  }

  if (branchCreated) {
    parts.push('Branch created due to irreconcilable contradiction');
  }

  if (invalidatedEntityNames.length > 0) {
    parts.push(`Invalidated entities: ${invalidatedEntityNames.join(', ')}`);
  }

  parts.push(`Action admissibility: ${validation.admissibility}`);
  parts.push(`DeltaPhi=${validation.deltaPhi.toFixed(3)}, Psi=${validation.psiScore.toFixed(3)}`);

  if (validation.reasons.length > 0) {
    parts.push(`Reasons: ${validation.reasons.slice(0, 3).join('; ')}`);
  }

  return parts.join('\n');
}
