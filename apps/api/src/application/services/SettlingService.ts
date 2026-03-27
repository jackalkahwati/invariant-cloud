/**
 * SettlingService, Discrete Fixed-Point Reconciliation
 *
 * Implements the settling operator T:
 *   G^(r+1) = T(G^(r))
 *
 * Convergence when G^(r+1) = G^(r) (no further changes).
 *
 * T is a deterministic reconciliation pass over the typed claim graph:
 *   1. Detect new contradictions
 *   2. Create branches when contradiction threshold is exceeded
 *   3. Propagate dependency invalidations
 *   4. Reevaluate constraints
 *   5. Recompute confidence
 *   6. Reevaluate action validity caches
 *   7. Record audit events
 *
 * Monotonicity invariant: Phi(G^(r+1)) <= Phi(G^(r))
 * (except during intentional branch expansion)
 */

import type {
  IClaimRepository,
  IConstraintRepository,
  IDependencyRepository,
  IContradictionRepository,
  IBranchRepository,
  IAuditRepository,
  ISnapshotRepository,
} from '../../domain/repositories/interfaces.js';
import type { EngineConfig, ClaimWithRelations } from '../../domain/entities/types.js';
import {
  computePhi,
  computeCoherenceScore,
  computeConfidence,
  computeStaleness,
  checkConstraintViolation,
  classifyContradictionSeverity,
  computePhiBreakdown,
} from './CoherenceEngine.js';
import { ContradictionDetectorRegistry } from './ContradictionDetector.js';

export interface SettlingResult {
  round: number;
  converged: boolean;
  phiBefore: number;
  phiAfter: number;
  coherenceScoreBefore: number;
  coherenceScoreAfter: number;
  contradictionsDetected: number;
  branchesCreated: number;
  claimsInvalidated: number;
  constraintViolationsFound: number;
  confidenceUpdates: number;
  monotonicity: boolean;  // Phi decreased or stayed same
}

export class SettlingService {
  private detector: ContradictionDetectorRegistry;
  private readonly MAX_ROUNDS: number;

  constructor(
    private readonly claimRepo: IClaimRepository,
    private readonly constraintRepo: IConstraintRepository,
    private readonly dependencyRepo: IDependencyRepository,
    private readonly contradictionRepo: IContradictionRepository,
    private readonly branchRepo: IBranchRepository,
    private readonly auditRepo: IAuditRepository,
    private readonly snapshotRepo: ISnapshotRepository,
    private readonly config: EngineConfig,
  ) {
    this.detector = new ContradictionDetectorRegistry();
    this.MAX_ROUNDS = config.settlingMaxRounds ?? 50;
  }

  /**
   * Run the discrete fixed-point settling loop until convergence.
   * G^* = lim_{r->inf} T^r(G^0)
   */
  async settle(): Promise<SettlingResult[]> {
    const rounds: SettlingResult[] = [];
    const now = new Date();

    // Compute initial Phi
    let phi = await this.computeCurrentPhi(now);

    for (let round = 0; round < this.MAX_ROUNDS; round++) {
      const phiBefore = phi;
      const coherenceBefore = computeCoherenceScore(phiBefore, this.config.coherenceWeights.kScale);

      const result = await this.runSinglePass(now);

      phi = await this.computeCurrentPhi(now);
      const phiAfter = phi;
      const coherenceAfter = computeCoherenceScore(phiAfter, this.config.coherenceWeights.kScale);

      const settlingResult: SettlingResult = {
        round,
        converged: false,
        phiBefore,
        phiAfter,
        coherenceScoreBefore: coherenceBefore,
        coherenceScoreAfter: coherenceAfter,
        monotonicity: phiAfter <= phiBefore + 1e-9, // allow floating point tolerance
        ...result,
      };

      rounds.push(settlingResult);

      await this.auditRepo.create({
        type: 'SETTLING_PASS',
        data: {
          round,
          phiBefore,
          phiAfter,
          monotonicity: settlingResult.monotonicity,
          changes: result.contradictionsDetected + result.claimsInvalidated + result.constraintViolationsFound,
        },
      });

      // Convergence check: no changes occurred
      const anyChanges =
        result.contradictionsDetected > 0
        || result.branchesCreated > 0
        || result.claimsInvalidated > 0
        || result.constraintViolationsFound > 0
        || result.confidenceUpdates > 0;

      if (!anyChanges) {
        settlingResult.converged = true;

        // Take a snapshot on convergence
        await this.takeSnapshot(phiAfter, coherenceAfter);
        break;
      }
    }

    return rounds;
  }

  /**
   * Run a single reconciliation pass T(G).
   */
  private async runSinglePass(now: Date): Promise<Omit<SettlingResult, 'round' | 'converged' | 'phiBefore' | 'phiAfter' | 'coherenceScoreBefore' | 'coherenceScoreAfter' | 'monotonicity'>> {
    let contradictionsDetected = 0;
    let branchesCreated = 0;
    let claimsInvalidated = 0;
    let constraintViolationsFound = 0;
    let confidenceUpdates = 0;

    // ── Step 1: Detect contradictions in active claims ──────────
    const activeClaims = await this.claimRepo.findAll({ status: 'ACTIVE' });
    const detections = this.detector.detectInSet(activeClaims);

    for (const { claimA, claimB, result } of detections) {
      // Check if already known
      const existing = await this.contradictionRepo.findForClaims(claimA.id, claimB.id);
      if (existing) continue;

      const severity = classifyContradictionSeverity(result.score);
      const contradiction = await this.contradictionRepo.create({
        claimAId: claimA.id,
        claimBId: claimB.id,
        score: result.score,
        severity,
        type: result.type,
        status: 'OPEN',
        description: result.description,
      });
      contradictionsDetected++;

      await this.auditRepo.create({
        type: 'CONTRADICTION_DETECTED',
        data: {
          contradictionId: contradiction.id,
          claimAId: claimA.id,
          claimBId: claimB.id,
          score: result.score,
          severity,
          type: result.type,
          description: result.description,
        },
      });

      // ── Step 2: Create branch if score exceeds branch threshold ──
      if (result.score >= this.config.branchThreshold) {
        const branch = await this.branchRepo.create({
          name: `Branch: ${result.description.slice(0, 60)}`,
          description: `Auto-created from contradiction between claims ${claimA.id} and ${claimB.id}`,
          status: 'OPEN',
          confidence: 0.5,
          contradictionId: contradiction.id,
          metadata: { score: result.score, type: result.type },
        });
        branchesCreated++;

        // Update contradiction with branch reference
        await this.contradictionRepo.update(contradiction.id, {
          status: 'BRANCHED',
          branchId: branch.id,
        });

        await this.auditRepo.create({
          type: 'BRANCH_CREATED',
          data: {
            branchId: branch.id,
            contradictionId: contradiction.id,
            reason: 'contradiction_threshold_exceeded',
            score: result.score,
          },
        });
      }
    }

    // ── Step 3: Propagate dependency invalidations ───────────────
    const deps = await this.dependencyRepo.findAll();
    for (const dep of deps) {
      if (dep.type !== 'INVALIDATES' && dep.type !== 'REQUIRES') continue;

      const fromClaims = activeClaims.filter(c => c.entityId === dep.fromEntityId);
      const toClaims = activeClaims.filter(c => c.entityId === dep.toEntityId);

      if (dep.type === 'INVALIDATES' && fromClaims.length > 0 && toClaims.length > 0) {
        // from entity's state invalidates to entity's claims
        for (const toClaim of toClaims) {
          if (toClaim.status === 'ACTIVE') {
            await this.claimRepo.invalidate(toClaim.id);
            claimsInvalidated++;

            await this.auditRepo.create({
              type: 'DEPENDENCY_PROPAGATED',
              entityId: dep.toEntityId,
              data: {
                dependencyId: dep.id,
                depType: dep.type,
                fromEntityId: dep.fromEntityId,
                toEntityId: dep.toEntityId,
                invalidatedClaimId: toClaim.id,
              },
            });
          }
        }
      }
    }

    // ── Step 4: Reevaluate constraints ───────────────────────────
    const constraints = await this.constraintRepo.findAll(true);
    const currentActiveClaims = await this.claimRepo.findAll({ status: 'ACTIVE' });

    for (const constraint of constraints) {
      // Deactivate old violations for this constraint first
      const relevantEntityIds = constraint.entityIds.length > 0
        ? constraint.entityIds
        : [...new Set(currentActiveClaims.map(c => c.entityId))];

      await this.constraintRepo.deactivateViolations(constraint.id, relevantEntityIds);

      const violation = checkConstraintViolation(constraint, currentActiveClaims);
      if (violation?.violated) {
        const affectedClaims = currentActiveClaims.filter(c =>
          (constraint.entityIds.length === 0 || constraint.entityIds.includes(c.entityId))
        );

        await this.constraintRepo.createViolation({
          constraintId: constraint.id,
          entityIds: [...new Set(affectedClaims.map(c => c.entityId))],
          claimIds: affectedClaims.map(c => c.id).slice(0, 10),
          severity: violation.severity,
          description: violation.description,
          isActive: true,
        });
        constraintViolationsFound++;

        await this.auditRepo.create({
          type: 'CONSTRAINT_VIOLATED',
          data: {
            constraintId: constraint.id,
            constraintName: constraint.name,
            severity: violation.severity,
            description: violation.description,
          },
        });
      }
    }

    // ── Step 5: Recompute confidence for active claims ───────────
    const refreshedClaims = await this.claimRepo.findAll({ status: 'ACTIVE' });
    // Hoist contradiction query outside the per-claim loop (fixes N+1 query)
    const allContradictions = await this.contradictionRepo.findAll('OPEN');

    for (const claim of refreshedClaims) {
      const staleness = computeStaleness(claim.timestamp, now, this.config.stalenessLambda);
      const sourceTrust = claim.source.trustScore;

      // Count corroborating claims (same entity+predicate, different source)
      const corroborating = refreshedClaims.filter(
        c => c.entityId === claim.entityId
          && c.predicate === claim.predicate
          && c.id !== claim.id
          && JSON.stringify(c.value) === JSON.stringify(claim.value)
      );
      const total = refreshedClaims.filter(
        c => c.entityId === claim.entityId && c.predicate === claim.predicate
      );
      const corroboration = total.length > 1 ? corroborating.length / (total.length - 1) : 0;

      // Count contradictions applying to this claim
      const claimContradictions = allContradictions.filter(
        c => c.claimAId === claim.id || c.claimBId === claim.id
      );
      const contradictionPressure = Math.min(1, claimContradictions.length * 0.3);

      const newConfidence = computeConfidence({
        sourceTrust,
        corroboration,
        contradictionPressure,
        staleness,
      });

      // Only update if meaningfully different
      if (Math.abs(newConfidence - claim.confidence) > 0.01) {
        await this.claimRepo.update(claim.id, { confidence: newConfidence });
        confidenceUpdates++;
      }
    }

    return {
      contradictionsDetected,
      branchesCreated,
      claimsInvalidated,
      constraintViolationsFound,
      confidenceUpdates,
    };
  }

  async computeCurrentPhi(now: Date): Promise<number> {
    const [violations, contradictions, deps, claims, branches] = await Promise.all([
      this.constraintRepo.findActiveViolations(),
      this.contradictionRepo.findAll('OPEN'),
      this.dependencyRepo.findAll(),
      this.claimRepo.findAll({ status: 'ACTIVE' }),
      this.branchRepo.findAll('OPEN'),
    ]);

    // Compute violated deps count
    let violatedDeps = 0;
    const claimMap = buildClaimMap(claims);
    for (const dep of deps) {
      if (!dep.isActive) continue;
      if (dep.type === 'REQUIRES') {
        const from = claimMap.get(dep.fromEntityId);
        const to = claimMap.get(dep.toEntityId);
        if (from && from.size > 0 && (!to || to.size === 0)) {
          violatedDeps++;
        }
      }
    }

    return computePhi(
      {
        activeViolations: violations,
        openContradictions: contradictions,
        violatedDependencies: violatedDeps,
        activeClaims: claims,
        openBranches: branches.length,
      },
      this.config.coherenceWeights,
      now,
      this.config.stalenessLambda,
    );
  }

  async computeCurrentPhiBreakdown(now?: Date) {
    const t = now ?? new Date();
    const [violations, contradictions, deps, claims, branches] = await Promise.all([
      this.constraintRepo.findActiveViolations(),
      this.contradictionRepo.findAll('OPEN'),
      this.dependencyRepo.findAll(),
      this.claimRepo.findAll({ status: 'ACTIVE' }),
      this.branchRepo.findAll('OPEN'),
    ]);

    let violatedDeps = 0;
    const claimMap = buildClaimMap(claims);
    for (const dep of deps) {
      if (!dep.isActive) continue;
      if (dep.type === 'REQUIRES') {
        const from = claimMap.get(dep.fromEntityId);
        const to = claimMap.get(dep.toEntityId);
        if (from && from.size > 0 && (!to || to.size === 0)) {
          violatedDeps++;
        }
      }
    }

    return computePhiBreakdown(
      {
        activeViolations: violations,
        openContradictions: contradictions,
        violatedDependencies: violatedDeps,
        activeClaims: claims,
        openBranches: branches.length,
      },
      this.config.coherenceWeights,
      t,
      this.config.stalenessLambda,
    );
  }

  private async takeSnapshot(phi: number, coherenceScore: number): Promise<void> {
    const [entities, claims, contradictions, branches, violations] = await Promise.all([
      this.claimRepo.findAll(),
      this.claimRepo.findAll({ status: 'ACTIVE' }),
      this.contradictionRepo.findAll('OPEN'),
      this.branchRepo.findAll('OPEN'),
      this.constraintRepo.findActiveViolations(),
    ]);

    await this.snapshotRepo.create({
      phi,
      coherenceScore,
      entityCount: new Set(claims.map(c => c.entityId)).size,
      claimCount: entities.length,
      activeClaimCount: claims.length,
      contradictionCount: (await this.contradictionRepo.findAll()).length,
      openContradictionCount: contradictions.length,
      branchCount: (await this.branchRepo.findAll()).length,
      openBranchCount: branches.length,
      constraintViolationCount: violations.length,
      lambdaC: this.config.coherenceWeights.lambdaC,
      lambdaK: this.config.coherenceWeights.lambdaK,
      lambdaD: this.config.coherenceWeights.lambdaD,
      lambdaU: this.config.coherenceWeights.lambdaU,
      lambdaB: this.config.coherenceWeights.lambdaB,
    });

    await this.auditRepo.create({
      type: 'SNAPSHOT_TAKEN',
      data: { phi, coherenceScore },
    });
  }
}

function buildClaimMap(
  claims: ClaimWithRelations[],
): Map<string, Map<string, unknown>> {
  const map = new Map<string, Map<string, unknown>>();
  for (const claim of claims) {
    if (!map.has(claim.entityId)) {
      map.set(claim.entityId, new Map());
    }
    map.get(claim.entityId)!.set(claim.predicate, claim.value);
  }
  return map;
}
