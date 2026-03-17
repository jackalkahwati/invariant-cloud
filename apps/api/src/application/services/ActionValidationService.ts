/**
 * ActionValidationService — Validate proposed actions against the world state.
 *
 * For each action proposal, computes:
 *   DeltaPhi(a) = Phi(G after hypothetical action) - Phi(G current)
 *   Psi(a, G)  = mu1*CVR + mu2*DBR + mu3*CA + mu4*UE + mu5*PF
 *
 * Admissibility:
 *   VALID           if DeltaPhi <= budget AND Psi <= epsilon
 *   RISKY           if slightly above threshold
 *   BLOCKED         if well above threshold
 *   BRANCH_DEPENDENT if validity differs by active branch
 */

import type {
  IClaimRepository,
  IConstraintRepository,
  IDependencyRepository,
  IContradictionRepository,
  IBranchRepository,
  IActionRepository,
  IAuditRepository,
} from '../../domain/repositories/interfaces.js';
import type {
  ActionProposal,
  ActionValidation,
  EngineConfig,
  ProvenanceRef,
  ClaimWithRelations,
} from '../../domain/entities/types.js';
import {
  computePsi,
  classifyActionAdmissibility,
  computeStaleness,
  checkConstraintViolation,
} from './CoherenceEngine.js';
import { SettlingService } from './SettlingService.js';

export class ActionValidationService {
  constructor(
    private readonly claimRepo: IClaimRepository,
    private readonly constraintRepo: IConstraintRepository,
    private readonly dependencyRepo: IDependencyRepository,
    private readonly contradictionRepo: IContradictionRepository,
    private readonly branchRepo: IBranchRepository,
    private readonly actionRepo: IActionRepository,
    private readonly auditRepo: IAuditRepository,
    private readonly settlingService: SettlingService,
    private readonly config: EngineConfig,
  ) {}

  async validateAction(proposal: ActionProposal): Promise<ActionValidation> {
    const now = new Date();
    const reasons: string[] = [];

    // Fetch current world state
    const [activeClaims, constraints, deps, openContradictions, openBranches] =
      await Promise.all([
        this.claimRepo.findAll({ status: 'ACTIVE' }),
        this.constraintRepo.findAll(true),
        this.dependencyRepo.findAll(),
        this.contradictionRepo.findAll('OPEN'),
        this.branchRepo.findAll('OPEN'),
      ]);

    // Current Phi(G)
    const phiCurrent = await this.settlingService.computeCurrentPhi(now);

    // ── Compute Psi components ────────────────────────────────────

    // mu1: ConstraintViolationRisk — how likely does this action violate constraints?
    const constraintViolationRisk = await this.computeConstraintViolationRisk(
      proposal,
      activeClaims,
      constraints,
      reasons,
    );

    // mu2: DependencyBreakageRisk — does this action break required dependencies?
    const dependencyBreakageRisk = await this.computeDependencyBreakageRisk(
      proposal,
      activeClaims,
      deps,
      reasons,
    );

    // mu3: ContradictionAmplification — does this action worsen existing contradictions?
    const contradictionAmplification = this.computeContradictionAmplification(
      proposal,
      openContradictions,
      reasons,
    );

    // mu4: UncertaintyExposure — how uncertain are the claims supporting this action?
    const { uncertaintyExposure, provenanceChain } = await this.computeUncertaintyAndProvenance(
      proposal,
      activeClaims,
      now,
      reasons,
    );

    // mu5: ProvenanceFragility — how fragile is the provenance chain?
    const provenanceFragility = this.computeProvenanceFragility(provenanceChain, reasons);

    const psiScore = computePsi(
      {
        constraintViolationRisk,
        dependencyBreakageRisk,
        contradictionAmplification,
        uncertaintyExposure,
        provenanceFragility,
      },
      this.config.actionWeights,
    );

    // ── Compute DeltaPhi(a) ───────────────────────────────────────
    // Hypothetically apply action and recompute Phi
    const deltaPhi = await this.computeDeltaPhi(proposal, phiCurrent, reasons);

    // ── Branch dependence check ───────────────────────────────────
    const hasBranchDependence = openBranches.length > 0
      && proposal.impactedEntityIds.some(eid =>
        openContradictions.some(
          c => c.claimA?.entityId === eid || c.claimB?.entityId === eid
        )
      );

    if (hasBranchDependence) {
      reasons.push(`Action validity depends on unresolved branches (${openBranches.length} open)`);
    }

    const admissibility = classifyActionAdmissibility(
      deltaPhi,
      psiScore,
      this.config,
      hasBranchDependence,
    );

    if (admissibility === 'BLOCKED') {
      reasons.push(`DeltaPhi=${deltaPhi.toFixed(3)} exceeds budget ${this.config.actionBudget} or Psi=${psiScore.toFixed(3)} exceeds epsilon ${this.config.actionEpsilon}`);
    } else if (admissibility === 'RISKY') {
      reasons.push(`Action is risky: DeltaPhi=${deltaPhi.toFixed(3)}, Psi=${psiScore.toFixed(3)}`);
    }

    // ── Collect impacted entities ─────────────────────────────────
    const impactedEntityIds = [
      ...new Set([
        ...proposal.impactedEntityIds,
        ...activeClaims
          .filter(c => proposal.impactedEntityIds.includes(c.entityId))
          .flatMap(c => {
            // Include transitively impacted entities via dependencies
            return deps
              .filter(d => d.fromEntityId === c.entityId || d.toEntityId === c.entityId)
              .flatMap(d => [d.fromEntityId, d.toEntityId]);
          }),
      ]),
    ];

    // ── Persist validation ────────────────────────────────────────
    const validation = await this.actionRepo.createValidation({
      actionProposalId: proposal.id,
      admissibility,
      deltaPhi,
      psiScore,
      constraintViolationRisk,
      dependencyBreakageRisk,
      contradictionAmplification,
      uncertaintyExposure,
      provenanceFragility,
      impactedEntityIds,
      provenanceChain,
      reasons,
    });

    // Update proposal status
    await this.actionRepo.updateProposal(proposal.id, { status: admissibility });

    await this.auditRepo.create({
      type: 'ACTION_VALIDATED',
      data: {
        proposalId: proposal.id,
        operation: proposal.operation,
        admissibility,
        deltaPhi,
        psiScore,
        reasons,
      },
    });

    return validation;
  }

  private async computeConstraintViolationRisk(
    proposal: ActionProposal,
    claims: ClaimWithRelations[],
    constraints: Awaited<ReturnType<typeof this.constraintRepo.findAll>>,
    reasons: string[],
  ): Promise<number> {
    let risk = 0;
    const impacted = claims.filter(c => proposal.impactedEntityIds.includes(c.entityId));

    for (const constraint of constraints) {
      const violation = checkConstraintViolation(constraint, impacted);
      if (violation?.violated) {
        risk = Math.max(risk, violation.severity);
        reasons.push(`Constraint violation risk: ${violation.description}`);
      }
    }

    // Also check if operation name suggests constraint-violating intent
    const RISKY_OPERATIONS = ['proceed_to_launch', 'approve', 'finalize', 'release', 'deploy'];
    if (RISKY_OPERATIONS.some(op => proposal.operation.toLowerCase().includes(op))) {
      // Check for existing violations on impacted entities
      const existingViolations = await this.constraintRepo.findActiveViolations();
      const impactedViolations = existingViolations.filter(v =>
        v.entityIds.some(eid => proposal.impactedEntityIds.includes(eid))
      );
      if (impactedViolations.length > 0) {
        risk = Math.max(risk, 0.9);
        reasons.push(`Operation '${proposal.operation}' targets entities with ${impactedViolations.length} active constraint violations`);
      }
    }

    return Math.min(1, risk);
  }

  private async computeDependencyBreakageRisk(
    proposal: ActionProposal,
    claims: ClaimWithRelations[],
    deps: Awaited<ReturnType<typeof this.dependencyRepo.findAll>>,
    reasons: string[],
  ): Promise<number> {
    let risk = 0;

    // Find dependencies involving impacted entities
    const relevantDeps = deps.filter(d =>
      proposal.impactedEntityIds.includes(d.fromEntityId)
      || proposal.impactedEntityIds.includes(d.toEntityId)
    );

    for (const dep of relevantDeps) {
      if (dep.type === 'REQUIRES') {
        // Check if the required entity has no active claims
        const requiredClaims = claims.filter(c => c.entityId === dep.toEntityId);
        if (requiredClaims.length === 0) {
          risk = Math.max(risk, 0.8 * dep.weight);
          reasons.push(`Dependency breakage: ${dep.fromEntityId} requires ${dep.toEntityId} but no claims found`);
        }
      }

      if (dep.type === 'INVALIDATES') {
        // This entity's claims would invalidate downstream
        const downstreamClaims = claims.filter(c => c.entityId === dep.toEntityId);
        if (downstreamClaims.length > 0) {
          risk = Math.max(risk, 0.6 * dep.weight);
          reasons.push(`Action would trigger invalidation of ${downstreamClaims.length} downstream claims via ${dep.type} dependency`);
        }
      }
    }

    return Math.min(1, risk);
  }

  private computeContradictionAmplification(
    proposal: ActionProposal,
    contradictions: Awaited<ReturnType<typeof this.contradictionRepo.findAll>>,
    reasons: string[],
  ): number {
    // Count contradictions involving impacted entities
    const relatedContradictions = contradictions.filter(c =>
      proposal.impactedEntityIds.includes(c.claimA?.entityId ?? '')
      || proposal.impactedEntityIds.includes(c.claimB?.entityId ?? '')
    );

    if (relatedContradictions.length === 0) return 0;

    const avgScore = relatedContradictions.reduce((s, c) => s + c.score, 0)
      / relatedContradictions.length;

    reasons.push(
      `${relatedContradictions.length} existing contradictions involve impacted entities (avg score: ${avgScore.toFixed(2)})`
    );

    return Math.min(1, avgScore * (1 + relatedContradictions.length * 0.1));
  }

  private async computeUncertaintyAndProvenance(
    proposal: ActionProposal,
    claims: ClaimWithRelations[],
    now: Date,
    reasons: string[],
  ): Promise<{ uncertaintyExposure: number; provenanceChain: ProvenanceRef[] }> {
    const impactedClaims = claims.filter(c => proposal.impactedEntityIds.includes(c.entityId));

    if (impactedClaims.length === 0) {
      return { uncertaintyExposure: 0.5, provenanceChain: [] };
    }

    // Mean staleness across impacted claims
    const meanStaleness = impactedClaims.reduce(
      (s, c) => s + computeStaleness(c.timestamp, now, this.config.stalenessLambda),
      0,
    ) / impactedClaims.length;

    // Mean confidence
    const meanConfidence = impactedClaims.reduce((s, c) => s + c.confidence, 0)
      / impactedClaims.length;

    const uncertaintyExposure = meanStaleness * (1 - meanConfidence);

    if (uncertaintyExposure > 0.3) {
      reasons.push(`High uncertainty exposure: staleness=${meanStaleness.toFixed(2)}, confidence=${meanConfidence.toFixed(2)}`);
    }

    const provenanceChain: ProvenanceRef[] = impactedClaims.map(c => ({
      claimId: c.id,
      entityId: c.entityId,
      predicate: c.predicate,
      confidence: c.confidence,
    }));

    return { uncertaintyExposure: Math.min(1, uncertaintyExposure), provenanceChain };
  }

  private computeProvenanceFragility(
    provenanceChain: ProvenanceRef[],
    reasons: string[],
  ): number {
    if (provenanceChain.length === 0) return 1.0;  // no provenance = maximally fragile

    // Fragility = 1 - (mean confidence of provenance chain)
    const meanConf = provenanceChain.reduce((s, p) => s + p.confidence, 0)
      / provenanceChain.length;

    const fragility = 1 - meanConf;

    if (fragility > 0.5) {
      reasons.push(`Fragile provenance chain: mean confidence=${meanConf.toFixed(2)}`);
    }

    return fragility;
  }

  /**
   * Hypothetical DeltaPhi: estimate how much the action would increase incoherence.
   * Since we can't actually execute the action in v1, we estimate from Psi components
   * and the violation pattern.
   *
   * DeltaPhi approximation = Psi * scale_factor + existing_violation_load
   */
  private async computeDeltaPhi(
    proposal: ActionProposal,
    phiCurrent: number,
    reasons: string[],
  ): Promise<number> {
    const existingViolations = await this.constraintRepo.findActiveViolations();
    const impactedViolations = existingViolations.filter(v =>
      v.entityIds.some(eid => proposal.impactedEntityIds.includes(eid))
    );

    // Base DeltaPhi from existing violations on impacted entities
    const violationLoad = impactedViolations.reduce((s, v) => s + v.severity, 0);

    // Scale by phi relative to a reference
    const phiReference = 5.0;
    const phiFraction = Math.min(1, phiCurrent / phiReference);

    const deltaPhi = violationLoad * 1.5 + phiFraction * 2.0;

    if (deltaPhi > 0) {
      reasons.push(`Estimated DeltaPhi=${deltaPhi.toFixed(3)} based on ${impactedViolations.length} existing violations on impacted entities`);
    }

    return deltaPhi;
  }
}
