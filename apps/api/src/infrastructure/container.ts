/**
 * Dependency injection container — assembles all services and repositories.
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
import { SettlingService } from '../application/services/SettlingService.js';
import { ActionValidationService } from '../application/services/ActionValidationService.js';
import { engineConfig } from './config.js';

// Repositories
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

// Services
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

export { engineConfig };
