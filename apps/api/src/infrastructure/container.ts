/**
 * Dependency injection container, assembles all services and repositories.
 *
 * Layers:
 *   Layer 1: State (existing), Entity, Claim, Constraint, Dependency, Contradiction, Branch
 *   Layer 2: Policy, PolicyRule, ApprovalRequest, PolicyEvaluation
 *   Layer 3: Trace , TraceSession, TraceEvent
 *   Layer 4: Plan  , Plan, PlanStep
 */

import { PrismaEntityRepository } from './database/repositories/EntityRepository.js';
import { PrismaSourceRepository } from './database/repositories/SourceRepository.js';
import { PrismaClaimRepository } from './database/repositories/ClaimRepository.js';
import { PrismaConstraintRepository } from './database/repositories/ConstraintRepository.js';
import { PrismaDependencyRepository } from './database/repositories/DependencyRepository.js';
import { PrismaContradictionRepository } from './database/repositories/ContradictionRepository.js';
import { PrismaBranchRepository } from './database/repositories/BranchRepository.js';
import { PrismaActionRepository } from './database/repositories/ActionRepository.js';
import { PrismaObservationRepository } from './database/repositories/ObservationRepository.js';
import { PrismaSnapshotRepository } from './database/repositories/SnapshotRepository.js';
import { PrismaAuditRepository } from './database/repositories/AuditRepository.js';
import { PrismaPolicyRepository } from './database/repositories/PolicyRepository.js';
import { PrismaTraceRepository } from './database/repositories/TraceRepository.js';
import { PrismaPlanRepository } from './database/repositories/PlanRepository.js';
import { SettlingService } from '../application/services/SettlingService.js';
import { ActionValidationService } from '../application/services/ActionValidationService.js';
import { PolicyService } from '../application/services/PolicyService.js';
import { TraceService } from '../application/services/TraceService.js';
import { PlanService } from '../application/services/PlanService.js';
import { WebhookService } from '../application/services/WebhookService.js';
import { engineConfig } from './config.js';

// ── Layer 1: State repositories ────────────────────────────────────────────────
export const entityRepo = new PrismaEntityRepository();
export const sourceRepo = new PrismaSourceRepository();
export const claimRepo = new PrismaClaimRepository();
export const constraintRepo = new PrismaConstraintRepository();
export const dependencyRepo = new PrismaDependencyRepository();
export const contradictionRepo = new PrismaContradictionRepository();
export const branchRepo = new PrismaBranchRepository();
export const actionRepo = new PrismaActionRepository();
export const observationRepo = new PrismaObservationRepository();
export const snapshotRepo = new PrismaSnapshotRepository();
export const auditRepo = new PrismaAuditRepository();

// ── Layer 2: Policy repositories ──────────────────────────────────────────────
export const policyRepo = new PrismaPolicyRepository();

// ── Layer 3: Trace repositories ───────────────────────────────────────────────
export const traceRepo = new PrismaTraceRepository();

// ── Layer 4: Plan repositories ────────────────────────────────────────────────
export const planRepo = new PrismaPlanRepository();

// ── Layer 1: State services ────────────────────────────────────────────────────
export const settlingService = new SettlingService(
  claimRepo,
  constraintRepo,
  dependencyRepo,
  contradictionRepo,
  branchRepo,
  auditRepo,
  snapshotRepo,
  engineConfig,
);

export const actionValidationService = new ActionValidationService(
  claimRepo,
  constraintRepo,
  dependencyRepo,
  contradictionRepo,
  branchRepo,
  actionRepo,
  auditRepo,
  settlingService,
  engineConfig,
);

// ── Layer 2: Policy services ──────────────────────────────────────────────────
export const policyService = new PolicyService(policyRepo);

// ── Layer 3: Trace services ───────────────────────────────────────────────────
export const traceService = new TraceService(traceRepo);

// ── Layer 4: Plan services ────────────────────────────────────────────────────
export const planService = new PlanService(planRepo, actionValidationService, traceService);

// ── Webhook service ───────────────────────────────────────────────────────────
export const webhookService = new WebhookService();

export { engineConfig };
