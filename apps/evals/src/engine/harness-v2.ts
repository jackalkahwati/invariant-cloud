/**
 * Phase 2 Engine Harness — runs a ScenarioV2 through the Coherence Engine.
 *
 * Translates the simplified Phase 2 ScenarioV2 schema into DB operations,
 * runs settling + action validation, and returns an EvaluationResult with
 * rawScores populated (Psi components + DeltaPhi for threshold analysis).
 *
 * Key differences from harness.ts (v1):
 *  - Uses ScenarioV2 instead of Scenario
 *  - Entities referenced by local `id` within scenario setup
 *  - Constraints expressed as { attribute, operator, threshold } → NUMERIC_RANGE
 *  - Actions are listed as array; evaluates first action unless actionIndex specified
 *  - Extracts rawScores (CVR, DBR, CA, UE, PF) from validation result
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
import type {
  ScenarioV2,
  EvaluationResult,
  ActionAdmissibility,
  RawScores,
} from '../scenarios/types.js';
import type { HarnessConfig } from './harness.js';

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runScenarioV2ThroughEngine(
  scenario: ScenarioV2,
  config: HarnessConfig,
  namespace: string,
  actionIndex = 0,
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

  const effectiveConfig = applyV2Ablations(config);

  const settling = new SettlingService(
    claimRepo, constraintRepo, dependencyRepo,
    contradictionRepo, branchRepo, auditRepo, snapshotRepo, effectiveConfig,
  );
  const validator = new ActionValidationService(
    claimRepo, constraintRepo, dependencyRepo, contradictionRepo,
    branchRepo, actionRepo, auditRepo, settling, effectiveConfig,
  );

  try {
    const { setup } = scenario;

    // ── 1. Build entity maps ───────────────────────────────────────────────────
    // localId → DB id
    const entityIdMap = new Map<string, string>();
    // entity name → DB id
    const entityNameMap = new Map<string, string>();

    for (const e of setup.entities) {
      const entity = await entityRepo.create({
        name: `${namespace}:${e.name}`,
        type: normalizeEntityType(e.type) as never,
        description: undefined,
        metadata: { evalNamespace: namespace, originalName: e.name, localId: e.id },
        isActive: true,
      });
      entityIdMap.set(e.id, entity.id);
      entityNameMap.set(e.name, entity.id);
    }

    // ── 2. Create sources ──────────────────────────────────────────────────────
    const sourceMap = new Map<string, string>();

    const uniqueSourceNames = new Set<string>();
    for (const c of setup.claims) {
      uniqueSourceNames.add(c.source ?? 'system');
    }

    for (const sourceName of uniqueSourceNames) {
      const source = await sourceRepo.create({
        name: `${namespace}:${sourceName}`,
        type: 'SYSTEM' as never,
        trustScore: 1.0,
      });
      sourceMap.set(sourceName, source.id);
    }

    // ── 3. Create claims ───────────────────────────────────────────────────────
    const now = new Date();

    for (const cs of setup.claims) {
      const entityDbId = entityIdMap.get(cs.entityId);
      if (!entityDbId) continue;

      const sourceName = cs.source ?? 'system';
      const sourceId = sourceMap.get(sourceName) ?? [...sourceMap.values()][0]!;

      const timestamp = cs.staleness_s
        ? new Date(now.getTime() - cs.staleness_s * 1000)
        : now;

      await claimRepo.create({
        entityId: entityDbId,
        predicate: cs.attribute,
        value: coerceClaimValue(cs.value),
        confidence: cs.confidence ?? 0.9,
        sourceId,
        timestamp,
        status: 'ACTIVE',
      });

      // If provenanceConfidence is specified, create a provenance edge
      // reflecting a weakened chain (stored in source trust score approximation)
      if (cs.provenanceConfidence !== undefined && cs.provenanceConfidence < 1.0) {
        // Update source trustScore to approximate provenance chain confidence
        await prisma.source.update({
          where: { id: sourceId },
          data: { trustScore: cs.provenanceConfidence },
        });
      }
    }

    // ── 4. Create constraints ──────────────────────────────────────────────────
    for (const cs of setup.constraints ?? []) {
      const entityDbId = entityIdMap.get(cs.entityId);
      if (!entityDbId) continue;

      await constraintRepo.create({
        name: `${namespace}:${cs.entityId}:${cs.attribute}`,
        description: cs.description ?? `${cs.attribute} ${cs.operator} ${cs.threshold}`,
        type: 'NUMERIC_RANGE' as never,
        expression: buildConstraintExpression(cs.attribute, cs.operator, cs.threshold, entityDbId),
        entityIds: [entityDbId],
        weight: cs.severity ?? 1.0,
        isActive: true,
      });
    }

    // ── 5. Create dependencies ─────────────────────────────────────────────────
    for (const ds of setup.dependencies ?? []) {
      const fromDbId = entityIdMap.get(ds.fromEntityId);
      const toDbId = entityIdMap.get(ds.toEntityId);
      if (!fromDbId || !toDbId) continue;

      const depType = config.unsignedDepsOnly ? 'SUPPORTS' : ds.type;

      await dependencyRepo.create({
        fromEntityId: fromDbId,
        toEntityId: toDbId,
        type: depType as never,
        weight: 1.0,
        description: ds.attribute ? `attribute: ${ds.attribute}` : undefined,
        isActive: true,
      });
    }

    // ── 6. Create explicit contradictions ──────────────────────────────────────
    // (some scenarios pre-seed known contradictions rather than having the engine detect them)
    for (const ctr of setup.contradictions ?? []) {
      const entityDbId = entityIdMap.get(ctr.entityId);
      if (!entityDbId) continue;

      // Get or create sources
      const srcAId = sourceMap.get(ctr.sourceA) ?? (await sourceRepo.create({
        name: `${namespace}:${ctr.sourceA}`,
        type: 'SYSTEM' as never,
        trustScore: 1.0,
      })).id;

      const srcBId = sourceMap.get(ctr.sourceB) ?? (await sourceRepo.create({
        name: `${namespace}:${ctr.sourceB}`,
        type: 'SYSTEM' as never,
        trustScore: 1.0,
      })).id;

      // Create the two conflicting claims
      const claimA = await claimRepo.create({
        entityId: entityDbId,
        predicate: ctr.attribute,
        value: ctr.valueA,
        confidence: 0.8,
        sourceId: srcAId,
        timestamp: now,
        status: 'ACTIVE',
      });

      const claimB = await claimRepo.create({
        entityId: entityDbId,
        predicate: ctr.attribute,
        value: ctr.valueB,
        confidence: 0.8,
        sourceId: srcBId,
        timestamp: now,
        status: 'ACTIVE',
      });

      // Register contradiction directly
      await contradictionRepo.create({
        claimAId: claimA.id,
        claimBId: claimB.id,
        type: 'NUMERIC_CONFLICT' as never,
        description: `Contradictory values for ${ctr.attribute}: ${ctr.valueA} vs ${ctr.valueB}`,
        score: 0.8,
        severity: 'HIGH' as never,
        status: 'OPEN' as never,
        branchId: null,
      });
    }

    // ── 7. Mark invalidations ──────────────────────────────────────────────────
    for (const inv of setup.invalidations ?? []) {
      const entityDbId = entityIdMap.get(inv.entityId);
      if (!entityDbId) continue;

      // Find and invalidate claims on this entity/attribute
      const claims = await claimRepo.findAll();
      const toInvalidate = claims.filter(c =>
        c.entityId === entityDbId && c.predicate === inv.attribute
      );
      for (const claim of toInvalidate) {
        await claimRepo.update(claim.id, { status: 'INVALIDATED' });
      }
    }

    // ── 8. Create branches (open) ──────────────────────────────────────────────
    for (const br of setup.branches ?? []) {
      if (!br.isOpen) continue;
      const entityDbId = entityIdMap.get(br.entityId);
      if (!entityDbId) continue;

      // Find or create the contradiction for this entity+attribute.
      // Keep contradiction status OPEN so ActionValidationService's hasBranchDependence
      // check (openBranches > 0 && openContradictions on entity) fires correctly.
      const allContradictions = await contradictionRepo.findAll();
      let matching = (allContradictions as Array<{ id: string; claimA?: { entityId?: string; predicate?: string } }>)
        .find(c => c.claimA?.entityId === entityDbId && c.claimA?.predicate === br.attribute);

      if (!matching) {
        // No pre-existing contradiction — create one from conflicting claims on this entity/attribute
        const entityClaims = await claimRepo.findAll('ACTIVE');
        const relevantClaims = (entityClaims as Array<{ id: string; entityId: string; predicate: string }>)
          .filter(c => c.entityId === entityDbId && c.predicate === br.attribute);

        if (relevantClaims.length >= 2) {
          // Use the default system source
          const defaultSourceId = sourceMap.get('system') ?? [...sourceMap.values()][0];
          const newContradiction = await contradictionRepo.create({
            claimAId: relevantClaims[0]!.id,
            claimBId: relevantClaims[1]!.id,
            type: 'NUMERIC_CONFLICT' as never,
            description: `Conflicting values for ${br.attribute}: candidates [${br.candidates.join(', ')}]`,
            score: 0.9,
            severity: 'HIGH' as never,
            status: 'OPEN' as never,
            branchId: null,
          });
          matching = { id: newContradiction.id, claimA: { entityId: entityDbId, predicate: br.attribute } };
          void defaultSourceId; // suppress unused warning
        }
      }

      if (matching) {
        await branchRepo.create({
          name: `branch:${br.attribute}:[${br.candidates.join('|')}]`,
          contradictionId: matching.id,
          status: 'OPEN' as never,
          description: `Open branch on ${br.attribute}: candidates [${br.candidates.join(', ')}]`,
        });
      }
    }

    // ── 9. Run settling ────────────────────────────────────────────────────────
    let settlingRounds = 0;
    let phiFinal = 0;
    let coherenceScore = 100;

    if (config.singlePassOnly) {
      await settling.settle();
      settlingRounds = 1;
    } else {
      const rounds = await settling.settle();
      settlingRounds = rounds.length;
      const last = rounds[rounds.length - 1];
      phiFinal = last?.phiAfter ?? 0;
      coherenceScore = last?.coherenceScoreAfter ?? 100;
    }

    // ── 10. Collect contradictions in namespace ────────────────────────────────
    const allContradictions = await contradictionRepo.findAll();
    const nsEntityIds = new Set([...entityIdMap.values()]);

    const contradictions = allContradictions.filter(c =>
      nsEntityIds.has((c as { claimA?: { entityId?: string } }).claimA?.entityId ?? '') ||
      nsEntityIds.has((c as { claimB?: { entityId?: string } }).claimB?.entityId ?? '')
    );

    const idToName = new Map([...entityIdMap.entries()].map(([lid, dbId]) => {
      const e = setup.entities.find(e => e.id === lid);
      return [dbId, e?.name ?? lid];
    }));

    const contradictionsDetected = contradictions.map(c => ({
      entityName: idToName.get((c as { claimA?: { entityId?: string } }).claimA?.entityId ?? ''),
      predicate: (c as { claimA?: { predicate?: string } }).claimA?.predicate,
      description: (c as { description?: string }).description ?? `Contradiction score ${(c as { score: number }).score.toFixed(2)}`,
      score: (c as { score: number }).score,
      severity: (c as { severity?: number }).severity,
    }));

    // ── 11. Check branch state ─────────────────────────────────────────────────
    const branches = await branchRepo.findAll('OPEN');
    const branchCreated = config.noBranching ? false :
      branches.some(b => contradictions.some(c => (c as { branchId?: string }).branchId === b.id));

    // ── 12. Validate action ────────────────────────────────────────────────────
    const action = setup.actions[actionIndex];
    if (!action) {
      throw new Error(`No action at index ${actionIndex} in scenario ${scenario.id}`);
    }

    const impactedEntityIds = action.impactedEntityNames
      .map(name => entityNameMap.get(name))
      .filter(Boolean) as string[];

    const proposal = await actionRepo.createProposal({
      operation: action.name,
      description: `${action.name} — ${scenario.description}`,
      parameters: {},
      impactedEntityIds,
      provenanceChain: [],
      status: 'PENDING',
    });

    const validation = await validator.validateAction(proposal);

    // ── 13. Extract rawScores from validation ──────────────────────────────────
    const rawScores: RawScores | undefined = extractRawScores(validation);

    // ── 14. Collect invalidated entities ──────────────────────────────────────
    const allClaims = await claimRepo.findAll();
    const invalidatedClaims = allClaims.filter(c =>
      nsEntityIds.has(c.entityId) && c.status === 'INVALIDATED'
    );
    const invalidatedEntityNames = [...new Set(
      invalidatedClaims.map(c => idToName.get(c.entityId)).filter(Boolean) as string[]
    )];

    // ── 15. Build explanation ──────────────────────────────────────────────────
    const explanation = buildV2Explanation(
      contradictionsDetected,
      branchCreated,
      validation,
      invalidatedEntityNames,
      phiFinal,
      coherenceScore,
      rawScores,
    );

    // ── 16. Cleanup ────────────────────────────────────────────────────────────
    await cleanupNamespace(
      [...entityIdMap.values()],
      [...sourceMap.values()],
      prisma,
    );

    return {
      scenarioId: scenario.id,
      evaluatorId: 'engine-v2',
      durationMs: Date.now() - start,
      contradictionsDetected,
      branchCreated,
      actionAdmissibility: validation.admissibility as ActionAdmissibility,
      invalidatedEntityNames,
      coherenceScore,
      explanation,
      rawScores,
      rawOutput: { validation, settlingRounds, phiFinal },
    };

  } catch (err) {
    return {
      scenarioId: scenario.id,
      evaluatorId: 'engine-v2',
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

// ─── Raw score extraction ──────────────────────────────────────────────────────

function extractRawScores(validation: unknown): RawScores | undefined {
  if (!validation || typeof validation !== 'object') return undefined;
  const v = validation as Record<string, unknown>;

  // ActionValidationService may expose these directly or via breakdown
  const psiScore = asNumber(v['psiScore']);
  const deltaPhi = asNumber(v['deltaPhi']);

  if (psiScore === undefined && deltaPhi === undefined) return undefined;

  // Psi component breakdown (populated by ActionValidationService)
  const breakdown = (v['psiBreakdown'] ?? v['breakdown']) as Record<string, unknown> | undefined;

  return {
    psiScore: psiScore ?? 0,
    deltaPhi: deltaPhi ?? 0,
    constraintViolationRisk: asNumber(breakdown?.['constraintViolationRisk'] ?? v['constraintViolationRisk']) ?? 0,
    dependencyBreakageRisk: asNumber(breakdown?.['dependencyBreakageRisk'] ?? v['dependencyBreakageRisk']) ?? 0,
    contradictionAmplification: asNumber(breakdown?.['contradictionAmplification'] ?? v['contradictionAmplification']) ?? 0,
    uncertaintyExposure: asNumber(breakdown?.['uncertaintyExposure'] ?? v['uncertaintyExposure']) ?? 0,
    provenanceFragility: asNumber(breakdown?.['provenanceFragility'] ?? v['provenanceFragility']) ?? 0,
  };
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? undefined : n;
  }
  return undefined;
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanupNamespace(
  entityIds: string[],
  sourceIds: string[],
  db: typeof prisma,
): Promise<void> {
  if (entityIds.length === 0) return;

  const nsClaims = await db.claim.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } });
  const nsClaimIds = nsClaims.map(c => c.id);

  const nsConstraints = await db.constraint.findMany({
    where: { entityIds: { hasSome: entityIds } }, select: { id: true }
  });
  const nsConstraintIds = nsConstraints.map(c => c.id);

  const nsContradictions = await db.contradiction.findMany({
    where: { OR: [{ claimAId: { in: nsClaimIds } }, { claimBId: { in: nsClaimIds } }] },
    select: { id: true, branchId: true },
  });
  const nsContradictionIds = nsContradictions.map(c => c.id);
  // Collect branch IDs from both contradiction.branchId and branch.contradictionId
  const nsBranchIdsFromContradiction = nsContradictions.map(c => c.branchId).filter(Boolean) as string[];
  const nsBranchesFromContradictionId = nsContradictionIds.length > 0
    ? await db.branch.findMany({
        where: { contradictionId: { in: nsContradictionIds } },
        select: { id: true },
      })
    : [];
  const nsBranchIds = [
    ...new Set([...nsBranchIdsFromContradiction, ...nsBranchesFromContradictionId.map(b => b.id)]),
  ];

  const nsProposals = await db.actionProposal.findMany({
    where: { impactedEntityIds: { hasSome: entityIds } }, select: { id: true }
  });
  const nsProposalIds = nsProposals.map(p => p.id);

  await db.actionValidation.deleteMany({ where: { actionProposalId: { in: nsProposalIds } } });
  await db.actionProposal.deleteMany({ where: { id: { in: nsProposalIds } } });
  await db.contradiction.deleteMany({ where: { id: { in: nsContradictionIds } } });
  if (nsBranchIds.length > 0) {
    await db.branch.deleteMany({ where: { id: { in: nsBranchIds } } });
  }
  await db.constraintViolation.deleteMany({ where: { constraintId: { in: nsConstraintIds } } });
  await db.dependency.deleteMany({ where: { OR: [{ fromEntityId: { in: entityIds } }, { toEntityId: { in: entityIds } }] } });
  await db.constraint.deleteMany({ where: { id: { in: nsConstraintIds } } });
  await db.provenanceEdge.deleteMany({ where: { OR: [{ sourceClaimId: { in: nsClaimIds } }, { targetClaimId: { in: nsClaimIds } }] } });
  await db.claimEvidence.deleteMany({ where: { claimId: { in: nsClaimIds } } });
  await db.claim.deleteMany({ where: { id: { in: nsClaimIds } } });
  await db.entity.deleteMany({ where: { id: { in: entityIds } } });
  await db.source.deleteMany({ where: { id: { in: sourceIds } } });
}

// ─── Ablations ────────────────────────────────────────────────────────────────

function applyV2Ablations(config: HarnessConfig): EngineConfig {
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

// ─── Explanation builder ──────────────────────────────────────────────────────

function buildV2Explanation(
  contradictions: Array<{ description: string }>,
  branchCreated: boolean,
  validation: unknown,
  invalidatedEntityNames: string[],
  phi: number,
  coherenceScore: number,
  rawScores?: RawScores,
): string {
  const v = validation as Record<string, unknown>;
  const parts: string[] = [];

  parts.push(`Coherence: ${coherenceScore.toFixed(1)}/100 (Phi=${phi.toFixed(3)})`);

  if (rawScores) {
    parts.push(
      `Psi=${rawScores.psiScore.toFixed(3)} ` +
      `[CVR=${rawScores.constraintViolationRisk.toFixed(3)} ` +
      `DBR=${rawScores.dependencyBreakageRisk.toFixed(3)} ` +
      `CA=${rawScores.contradictionAmplification.toFixed(3)} ` +
      `UE=${rawScores.uncertaintyExposure.toFixed(3)} ` +
      `PF=${rawScores.provenanceFragility.toFixed(3)}] ` +
      `DeltaPhi=${rawScores.deltaPhi.toFixed(3)}`
    );
  }

  if (contradictions.length > 0) {
    parts.push(`Contradictions: ${contradictions.map(c => c.description).join('; ')}`);
  }

  if (branchCreated) parts.push('Branch created');

  if (invalidatedEntityNames.length > 0) {
    parts.push(`Invalidated: ${invalidatedEntityNames.join(', ')}`);
  }

  const admissibility = v['admissibility'] ?? 'UNKNOWN';
  const reasons = (v['reasons'] as string[] | undefined) ?? [];
  parts.push(`Decision: ${admissibility}${reasons.length ? ` — ${reasons.join('; ')}` : ''}`);

  return parts.join(' | ');
}

// ── Entity type normalizer ─────────────────────────────────────────────────────

const ENTITY_TYPE_MAP: Record<string, string> = {
  component: 'COMPONENT',
  subsystem: 'SUBSYSTEM',
  system: 'GENERIC',
  artifact: 'FILE',
  service: 'AGENT',
  agent: 'AGENT',
  person: 'PERSON',
  project: 'PROJECT',
  task: 'TASK',
  file: 'FILE',
  requirement: 'REQUIREMENT',
  experiment: 'EXPERIMENT',
  hypothesis: 'HYPOTHESIS',
  environment: 'ENVIRONMENT_STATE',
  generic: 'GENERIC',
};

function normalizeEntityType(raw: string): string {
  return ENTITY_TYPE_MAP[raw.toLowerCase()] ?? raw.toUpperCase();
}

// ── Claim value coercion ──────────────────────────────────────────────────────
// Numeric strings like '45.0' → 45.0 so checkConstraintViolation can compare them.

function coerceClaimValue(v: unknown): unknown {
  if (typeof v === 'string') {
    const n = Number(v);
    if (!isNaN(n) && v.trim() !== '') return n;
  }
  return v;
}

// ── Constraint expression builder ─────────────────────────────────────────────
// Maps V2 { attribute, operator, threshold } → engine NUMERIC_RANGE expression

function buildConstraintExpression(
  attribute: string,
  operator: string,
  threshold: number,
  entityId: string,
): Record<string, unknown> {
  const expr: Record<string, unknown> = {
    type: 'NUMERIC_RANGE',
    predicate: attribute,
    entityIds: [entityId],
  };

  switch (operator) {
    case '>=': case '>':
      expr['min'] = threshold;
      break;
    case '<=': case '<':
      expr['max'] = threshold;
      break;
    case '==': case '===':
      expr['min'] = threshold;
      expr['max'] = threshold;
      break;
  }

  return expr;
}
