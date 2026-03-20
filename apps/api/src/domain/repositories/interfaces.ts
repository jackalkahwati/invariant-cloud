/**
 * Repository interfaces (ports), domain layer.
 * Infrastructure implementations must implement these.
 */

import type {
  Entity, EntityType,
  Source,
  Claim, ClaimStatus, ClaimWithRelations,
  Constraint, ConstraintViolation,
  Dependency, DependencyType,
  Contradiction, ContradictionWithClaims,
  Branch, BranchStatus,
  ActionProposal, ActionValidation,
  Observation,
  StateSnapshot,
  AuditEvent, AuditEventType,
} from '../entities/types.js';

// ── Generic ──────────────────────────────────────────────────

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// ── Entity ──────────────────────────────────────────────────

export interface IEntityRepository {
  findById(id: string): Promise<Entity | null>;
  findAll(filter?: { type?: EntityType; isActive?: boolean }): Promise<Entity[]>;
  create(data: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entity>;
  update(id: string, data: Partial<Entity>): Promise<Entity>;
  delete(id: string): Promise<void>;
}

// ── Source ──────────────────────────────────────────────────

export interface ISourceRepository {
  findById(id: string): Promise<Source | null>;
  findAll(): Promise<Source[]>;
  create(data: Omit<Source, 'id' | 'createdAt'>): Promise<Source>;
  update(id: string, data: Partial<Source>): Promise<Source>;
  getOrCreate(name: string, type: Source['type']): Promise<Source>;
}

// ── Claim ──────────────────────────────────────────────────

export interface ClaimFilter {
  entityId?: string;
  predicate?: string;
  status?: ClaimStatus;
  branchId?: string | null;   // null = canonical branch
  sourceId?: string;
}

export interface IClaimRepository {
  findById(id: string): Promise<ClaimWithRelations | null>;
  findAll(filter?: ClaimFilter): Promise<ClaimWithRelations[]>;
  findActive(entityId: string, predicate?: string): Promise<ClaimWithRelations[]>;
  create(data: Omit<Claim, 'id' | 'createdAt' | 'updatedAt'>): Promise<Claim>;
  update(id: string, data: Partial<Claim>): Promise<Claim>;
  supersede(id: string, supersededById: string): Promise<Claim>;
  invalidate(id: string): Promise<Claim>;
  countActive(): Promise<number>;
}

// ── Constraint ──────────────────────────────────────────────

export interface IConstraintRepository {
  findById(id: string): Promise<Constraint | null>;
  findAll(active?: boolean): Promise<Constraint[]>;
  create(data: Omit<Constraint, 'id' | 'createdAt' | 'updatedAt'>): Promise<Constraint>;
  createViolation(data: Omit<ConstraintViolation, 'id' | 'createdAt'>): Promise<ConstraintViolation>;
  deactivateViolations(constraintId: string, entityIds: string[]): Promise<void>;
  findActiveViolations(): Promise<ConstraintViolation[]>;
  countActiveViolations(): Promise<number>;
}

// ── Dependency ──────────────────────────────────────────────

export interface IDependencyRepository {
  findById(id: string): Promise<Dependency | null>;
  findAll(): Promise<Dependency[]>;
  findFrom(entityId: string, type?: DependencyType): Promise<Dependency[]>;
  findTo(entityId: string, type?: DependencyType): Promise<Dependency[]>;
  create(data: Omit<Dependency, 'id' | 'createdAt'>): Promise<Dependency>;
  delete(id: string): Promise<void>;
}

// ── Contradiction ──────────────────────────────────────────

export interface IContradictionRepository {
  findById(id: string): Promise<ContradictionWithClaims | null>;
  findAll(status?: Contradiction['status']): Promise<ContradictionWithClaims[]>;
  findForClaims(claimAId: string, claimBId: string): Promise<Contradiction | null>;
  create(data: Omit<Contradiction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contradiction>;
  update(id: string, data: Partial<Contradiction>): Promise<Contradiction>;
  countOpen(): Promise<number>;
}

// ── Branch ──────────────────────────────────────────────────

export interface IBranchRepository {
  findById(id: string): Promise<Branch | null>;
  findAll(status?: BranchStatus): Promise<Branch[]>;
  create(data: Omit<Branch, 'id' | 'createdAt' | 'updatedAt'>): Promise<Branch>;
  update(id: string, data: Partial<Branch>): Promise<Branch>;
  countOpen(): Promise<number>;
}

// ── Action ──────────────────────────────────────────────────

export interface IActionRepository {
  findProposalById(id: string): Promise<ActionProposal | null>;
  createProposal(data: Omit<ActionProposal, 'id' | 'createdAt' | 'updatedAt'>): Promise<ActionProposal>;
  updateProposal(id: string, data: Partial<ActionProposal>): Promise<ActionProposal>;
  createValidation(data: Omit<ActionValidation, 'id' | 'createdAt'>): Promise<ActionValidation>;
  findValidationsByProposalId(proposalId: string): Promise<ActionValidation[]>;
  findAll(filter?: { limit?: number; status?: string }): Promise<ActionProposal[]>;
}

// ── Observation ──────────────────────────────────────────────

export interface IObservationRepository {
  findById(id: string): Promise<Observation | null>;
  findUnprocessed(): Promise<Observation[]>;
  create(data: Omit<Observation, 'id' | 'createdAt'>): Promise<Observation>;
  markProcessed(id: string): Promise<void>;
}

// ── State Snapshot ──────────────────────────────────────────

export interface ISnapshotRepository {
  findLatest(): Promise<StateSnapshot | null>;
  create(data: Omit<StateSnapshot, 'id' | 'createdAt'>): Promise<StateSnapshot>;
  findAll(limit?: number): Promise<StateSnapshot[]>;
}

// ── Audit ──────────────────────────────────────────────────

export interface IAuditRepository {
  create(data: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<AuditEvent>;
  findById(id: string): Promise<AuditEvent | null>;
  findByEntity(entityId: string, limit?: number): Promise<AuditEvent[]>;
  findByType(type: AuditEventType | string, limit?: number): Promise<AuditEvent[]>;
  findRecent(limit?: number): Promise<AuditEvent[]>;
}
