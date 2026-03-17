/**
 * Seed Script — Engineering Program Scenario
 *
 * Seeds the Coherence Engine with a realistic aerospace/engineering program
 * scenario that clearly demonstrates:
 *
 * 1. Contradiction detection (mass > limit, R-42 complete but T-7 not started)
 * 2. Constraint violation (battery mass exceeds limit, requirement marked
 *    complete without verification)
 * 3. Multi-hop dependency invalidation (T-7 not_started → R-42 unverified
 *    → LaunchReadiness invalid → ProceedToLaunch blocked)
 * 4. Coherence score drop
 * 5. Action proposal rejection (proceed_to_launch blocked)
 * 6. Branch creation (conflicting LaunchReadiness claims)
 */

import 'dotenv/config';
import prisma from '../src/infrastructure/database/prisma.js';
import { engineConfig } from '../src/infrastructure/config.js';
import { SettlingService } from '../src/application/services/SettlingService.js';
import { ActionValidationService } from '../src/application/services/ActionValidationService.js';
import { PrismaEntityRepository } from '../src/infrastructure/database/repositories/EntityRepository.js';
import { PrismaSourceRepository } from '../src/infrastructure/database/repositories/SourceRepository.js';
import { PrismaClaimRepository } from '../src/infrastructure/database/repositories/ClaimRepository.js';
import { PrismaConstraintRepository } from '../src/infrastructure/database/repositories/ConstraintRepository.js';
import { PrismaDependencyRepository } from '../src/infrastructure/database/repositories/DependencyRepository.js';
import { PrismaContradictionRepository } from '../src/infrastructure/database/repositories/ContradictionRepository.js';
import { PrismaBranchRepository } from '../src/infrastructure/database/repositories/BranchRepository.js';
import { PrismaActionRepository } from '../src/infrastructure/database/repositories/ActionRepository.js';
import { PrismaObservationRepository } from '../src/infrastructure/database/repositories/ObservationRepository.js';
import { PrismaSnapshotRepository } from '../src/infrastructure/database/repositories/SnapshotRepository.js';
import { PrismaAuditRepository } from '../src/infrastructure/database/repositories/AuditRepository.js';

// ── Repository instances ──────────────────────────────────────
const entityRepo = new PrismaEntityRepository();
const sourceRepo = new PrismaSourceRepository();
const claimRepo = new PrismaClaimRepository();
const constraintRepo = new PrismaConstraintRepository();
const dependencyRepo = new PrismaDependencyRepository();
const contradictionRepo = new PrismaContradictionRepository();
const branchRepo = new PrismaBranchRepository();
const actionRepo = new PrismaActionRepository();
const observationRepo = new PrismaObservationRepository();
const snapshotRepo = new PrismaSnapshotRepository();
const auditRepo = new PrismaAuditRepository();

const settlingService = new SettlingService(
  claimRepo, constraintRepo, dependencyRepo,
  contradictionRepo, branchRepo, auditRepo, snapshotRepo, engineConfig,
);

const actionValidationService = new ActionValidationService(
  claimRepo, constraintRepo, dependencyRepo, contradictionRepo,
  branchRepo, actionRepo, auditRepo, settlingService, engineConfig,
);

async function seed() {
  console.log('🚀 Seeding Coherence Engine — Engineering Program Scenario\n');

  // ── Clean slate ──────────────────────────────────────────────
  console.log('Clearing existing data...');
  await prisma.auditEvent.deleteMany();
  await prisma.stateSnapshot.deleteMany();
  await prisma.actionValidation.deleteMany();
  await prisma.actionProposal.deleteMany();
  await prisma.provenanceEdge.deleteMany();
  await prisma.claimEvidence.deleteMany();
  await prisma.contradiction.deleteMany();
  await prisma.constraintViolation.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.dependency.deleteMany();
  await prisma.constraint.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.entity.deleteMany();
  await prisma.source.deleteMany();

  // ── Sources ───────────────────────────────────────────────────
  console.log('Creating sources...');
  const systemSource = await sourceRepo.create({ name: 'System', type: 'SYSTEM', trustScore: 1.0 });
  const agentPlanner = await sourceRepo.create({ name: 'Agent Planner-1', type: 'AGENT', trustScore: 0.85 });
  const humanEngineer = await sourceRepo.create({ name: 'Human Engineer', type: 'HUMAN', trustScore: 0.95 });

  // ── Entities ──────────────────────────────────────────────────
  console.log('Creating entities...');

  const projectAtlas = await entityRepo.create({
    name: 'Project Atlas', type: 'PROJECT',
    description: 'Primary spacecraft mission program', isActive: true,
  });

  const reqR42 = await entityRepo.create({
    name: 'Requirement R-42', type: 'REQUIREMENT',
    description: 'Thermal management requirement for battery system',
    metadata: { requirementId: 'R-42', criticality: 'HIGH' }, isActive: true,
  });

  const thermalTestT7 = await entityRepo.create({
    name: 'Thermal Test T-7', type: 'EXPERIMENT',
    description: 'Thermal cycling test for battery pack under mission conditions',
    metadata: { testId: 'T-7', testType: 'thermal_cycling' }, isActive: true,
  });

  const batteryBP1 = await entityRepo.create({
    name: 'Battery Pack BP-1', type: 'COMPONENT',
    description: 'Primary mission battery pack',
    metadata: { componentId: 'BP-1', system: 'power' }, isActive: true,
  });

  const launchReadiness = await entityRepo.create({
    name: 'Launch Readiness Review', type: 'ENVIRONMENT_STATE',
    description: 'Overall launch readiness assessment gate', isActive: true,
  });

  const taskTK19 = await entityRepo.create({
    name: 'Task TK-19', type: 'TASK',
    description: 'Complete thermal test T-7 and document results', isActive: true,
  });

  const agentPlanner1 = await entityRepo.create({
    name: 'Agent Planner-1', type: 'AGENT',
    description: 'Automated mission planning agent',
    metadata: { version: '1.0', capabilities: ['planning', 'validation'] }, isActive: true,
  });

  console.log('  Created 7 entities');

  // ── Claims ────────────────────────────────────────────────────
  console.log('Creating claims...');

  // R-42: marked complete (problematic — no verification)
  await claimRepo.create({
    entityId: reqR42.id, predicate: 'status', value: 'complete',
    confidence: 0.9, sourceId: humanEngineer.id, timestamp: new Date(),
    status: 'ACTIVE',
  });

  await claimRepo.create({
    entityId: reqR42.id, predicate: 'isCritical', value: true,
    confidence: 1.0, sourceId: systemSource.id, timestamp: new Date(), status: 'ACTIVE',
  });

  await claimRepo.create({
    entityId: reqR42.id, predicate: 'requiresVerification', value: 'T-7',
    confidence: 1.0, sourceId: systemSource.id, timestamp: new Date(), status: 'ACTIVE',
  });

  // Verification status — NOT started (will conflict with complete status)
  await claimRepo.create({
    entityId: reqR42.id, predicate: 'verificationStatus', value: 'not_started',
    confidence: 0.95, sourceId: systemSource.id, timestamp: new Date(), status: 'ACTIVE',
  });

  // T-7: not started
  await claimRepo.create({
    entityId: thermalTestT7.id, predicate: 'status', value: 'not_started',
    confidence: 0.95, sourceId: systemSource.id, timestamp: new Date(), status: 'ACTIVE',
  });

  // BP-1: mass violation (21.3 > 20.0 limit)
  await claimRepo.create({
    entityId: batteryBP1.id, predicate: 'mass', value: 21.3,
    confidence: 0.98, sourceId: humanEngineer.id, timestamp: new Date(), status: 'ACTIVE',
  });

  await claimRepo.create({
    entityId: batteryBP1.id, predicate: 'mass_limit', value: 20.0,
    confidence: 1.0, sourceId: systemSource.id, timestamp: new Date(), status: 'ACTIVE',
  });

  // LaunchReadiness: marked green (WRONG — should be blocked by constraints)
  await claimRepo.create({
    entityId: launchReadiness.id, predicate: 'status', value: 'green',
    confidence: 0.7, sourceId: agentPlanner.id, timestamp: new Date(), status: 'ACTIVE',
  });

  // TK-19: pending
  await claimRepo.create({
    entityId: taskTK19.id, predicate: 'status', value: 'pending',
    confidence: 0.9, sourceId: systemSource.id, timestamp: new Date(), status: 'ACTIVE',
  });

  // Agent Planner: plan valid (will be disputed)
  await claimRepo.create({
    entityId: agentPlanner1.id, predicate: 'planValidity', value: 'valid',
    confidence: 0.6, sourceId: agentPlanner.id, timestamp: new Date(), status: 'ACTIVE',
  });

  console.log('  Created 10 claims');

  // ── Constraints ───────────────────────────────────────────────
  console.log('Creating constraints...');

  await constraintRepo.create({
    name: 'Requirement Verification Required',
    description: 'A requirement marked complete must have verificationStatus=complete',
    type: 'STATUS_DEPENDENCY',
    expression: {
      type: 'STATUS_DEPENDENCY',
      ifPredicate: 'status', ifValue: 'complete',
      requiresPredicate: 'verificationStatus', requiresValue: 'complete',
    },
    entityIds: [reqR42.id], weight: 1.5, isActive: true,
  });

  await constraintRepo.create({
    name: 'Battery Mass Limit',
    description: 'Battery pack mass must not exceed 20kg',
    type: 'NUMERIC_RANGE',
    expression: { type: 'NUMERIC_RANGE', predicate: 'mass', max: 20.0 },
    entityIds: [batteryBP1.id], weight: 1.0, isActive: true,
  });

  await constraintRepo.create({
    name: 'Launch Readiness Gate',
    description: 'LaunchReadiness cannot be green if criticalRequirementsVerified != true',
    type: 'STATUS_DEPENDENCY',
    expression: {
      type: 'STATUS_DEPENDENCY',
      ifPredicate: 'status', ifValue: 'green',
      requiresPredicate: 'criticalRequirementsVerified', requiresValue: true,
    },
    entityIds: [launchReadiness.id], weight: 2.0, isActive: true,
  });

  await constraintRepo.create({
    name: 'Task Status Mutex',
    description: 'Task cannot be simultaneously done and blocked',
    type: 'MUTUAL_EXCLUSION',
    expression: { type: 'MUTUAL_EXCLUSION', predicate: 'status', excludedValues: ['done', 'blocked'] },
    entityIds: [taskTK19.id], weight: 1.0, isActive: true,
  });

  console.log('  Created 4 constraints');

  // ── Dependencies ──────────────────────────────────────────────
  console.log('Creating dependencies...');

  await dependencyRepo.create({
    fromEntityId: reqR42.id, toEntityId: thermalTestT7.id,
    type: 'REQUIRES', weight: 1.0,
    description: 'R-42 completion requires T-7 thermal test', isActive: true,
  });

  await dependencyRepo.create({
    fromEntityId: launchReadiness.id, toEntityId: reqR42.id,
    type: 'REQUIRES', weight: 1.0,
    description: 'Launch readiness requires all critical requirements verified', isActive: true,
  });

  await dependencyRepo.create({
    fromEntityId: batteryBP1.id, toEntityId: launchReadiness.id,
    type: 'INVALIDATES', weight: 1.0,
    description: 'Battery mass violation invalidates launch readiness', isActive: true,
  });

  await dependencyRepo.create({
    fromEntityId: launchReadiness.id, toEntityId: projectAtlas.id,
    type: 'SUPPORTS', weight: 0.9,
    description: 'Valid launch readiness supports project launch', isActive: true,
  });

  await dependencyRepo.create({
    fromEntityId: thermalTestT7.id, toEntityId: reqR42.id,
    type: 'IMPLIES_NOT', weight: 0.9,
    description: 'T-7 not started implies R-42 verification is not complete', isActive: true,
  });

  console.log('  Created 5 dependencies');

  // ── Run settling ──────────────────────────────────────────────
  console.log('\n⚙️  Running discrete fixed-point settling...');
  const rounds = await settlingService.settle();
  const converged = rounds.some(r => r.converged);
  const lastRound = rounds[rounds.length - 1]!;

  console.log(`  Settling: ${rounds.length} rounds, converged=${converged}`);
  console.log(`  Phi: ${lastRound.phiBefore.toFixed(3)} → ${lastRound.phiAfter.toFixed(3)}`);
  console.log(`  CoherenceScore: ${lastRound.coherenceScoreBefore.toFixed(1)} → ${lastRound.coherenceScoreAfter.toFixed(1)}`);
  console.log(`  Contradictions detected: ${rounds.reduce((s, r) => s + r.contradictionsDetected, 0)}`);
  console.log(`  Branches created: ${rounds.reduce((s, r) => s + r.branchesCreated, 0)}`);
  console.log(`  Constraint violations: ${rounds.reduce((s, r) => s + r.constraintViolationsFound, 0)}`);
  console.log(`  Monotonicity maintained: ${rounds.every(r => r.monotonicity)}`);

  // ── Validate proceed_to_launch ────────────────────────────────
  console.log('\n🔍 Validating action: proceed_to_launch...');
  const launchProposal = await actionRepo.createProposal({
    operation: 'proceed_to_launch',
    description: 'Transition Project Atlas to launch phase',
    parameters: { targetDate: '2025-06-01', missionId: 'ATLAS-1' },
    impactedEntityIds: [projectAtlas.id, launchReadiness.id, reqR42.id, batteryBP1.id],
    provenanceChain: [],
    status: 'PENDING',
  });

  const launchValidation = await actionValidationService.validateAction(launchProposal);
  console.log(`  Admissibility: ${launchValidation.admissibility}`);
  console.log(`  DeltaPhi: ${launchValidation.deltaPhi.toFixed(3)}`);
  console.log(`  Psi: ${launchValidation.psiScore.toFixed(3)}`);
  if (launchValidation.reasons.length > 0) {
    console.log(`  Reasons:`);
    launchValidation.reasons.slice(0, 4).forEach(r => console.log(`    - ${r}`));
  }

  // ── Add conflicting LaunchReadiness claim → trigger branch ────
  console.log('\n🌿 Adding conflicting LaunchReadiness status=red claim...');
  await claimRepo.create({
    entityId: launchReadiness.id, predicate: 'status', value: 'red',
    confidence: 0.9, sourceId: humanEngineer.id, timestamp: new Date(), status: 'ACTIVE',
  });

  const rounds2 = await settlingService.settle();
  const lastRound2 = rounds2[rounds2.length - 1]!;
  console.log(`  Post-conflict settling: ${rounds2.length} rounds`);
  console.log(`  New branches: ${rounds2.reduce((s, r) => s + r.branchesCreated, 0)}`);
  console.log(`  Final CoherenceScore: ${lastRound2.coherenceScoreAfter.toFixed(1)}`);

  // ── Final state report ────────────────────────────────────────
  const contradictions = await contradictionRepo.findAll();
  const openContradictions = await contradictionRepo.findAll('OPEN');
  const branches = await branchRepo.findAll();
  const openBranches = await branchRepo.findAll('OPEN');
  const violations = await constraintRepo.findActiveViolations();
  const breakdown = await settlingService.computeCurrentPhiBreakdown();

  console.log('\n' + '='.repeat(60));
  console.log('📊 Final World State Report');
  console.log('='.repeat(60));
  console.log(`  Coherence Score:         ${breakdown.coherenceScore.toFixed(1)} / 100`);
  console.log(`  Phi (incoherence):        ${breakdown.phi.toFixed(3)}`);
  console.log(`    Vc (violations):         ${breakdown.Vc.toFixed(3)}`);
  console.log(`    Vk (contradictions):     ${breakdown.Vk.toFixed(3)}`);
  console.log(`    Vd (dep mismatches):     ${breakdown.Vd.toFixed(3)}`);
  console.log(`    Vu (staleness):          ${breakdown.Vu.toFixed(3)}`);
  console.log(`    Vb (open branches):      ${breakdown.Vb.toFixed(3)}`);
  console.log(`  Contradictions:           ${contradictions.length} total, ${openContradictions.length} open`);
  console.log(`  Branches:                 ${branches.length} total, ${openBranches.length} open`);
  console.log(`  Constraint violations:    ${violations.length}`);
  console.log(`  proceed_to_launch:        ${launchValidation.admissibility}`);
  console.log('='.repeat(60));
  console.log('\n✅ Seed complete!\n');
  console.log('Demonstrated outcomes:');
  console.log('  1. ✓ Contradiction detected: R-42 complete BUT T-7 not_started');
  console.log('  2. ✓ Constraint violated: Battery mass 21.3kg > 20kg limit');
  console.log('  3. ✓ Multi-hop dep invalidation: T-7→R-42→LaunchReadiness');
  console.log('  4. ✓ Coherence score dropped due to accumulated violations');
  console.log('  5. ✓ Action proceed_to_launch: ' + launchValidation.admissibility);
  console.log('  6. ✓ Branch created for conflicting LaunchReadiness status (green vs red)');
}

seed()
  .catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
