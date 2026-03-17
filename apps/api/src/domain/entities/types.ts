/**
 * Core domain type definitions for the Coherence Engine.
 *
 * World state graph: G = (V, E, C, D, B)
 * where V=entities, E=claims, C=constraints, D=dependencies, B=branches
 */

// ============================================================
// ENTITY TYPES
// ============================================================

export type EntityType =
  | 'PERSON'
  | 'PROJECT'
  | 'REQUIREMENT'
  | 'FILE'
  | 'TASK'
  | 'SUBSYSTEM'
  | 'COMPONENT'
  | 'EXPERIMENT'
  | 'AGENT'
  | 'HYPOTHESIS'
  | 'CONSTRAINT_TARGET'
  | 'ENVIRONMENT_STATE'
  | 'GENERIC';

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description?: string;
  metadata?: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// SOURCE TYPES
// ============================================================

export type SourceType = 'AGENT' | 'HUMAN' | 'TOOL' | 'SYSTEM' | 'SENSOR';

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  trustScore: number; // [0,1]
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================
// CLAIM TYPES — structured assertions about entities
// ============================================================

export type ClaimStatus =
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'DISPUTED'
  | 'INVALIDATED'
  | 'BRANCH_SPECIFIC';

export interface Claim {
  id: string;
  entityId: string;
  predicate: string;
  value: unknown;
  confidence: number;    // [0,1] — computed via sigmoid formula
  sourceId: string;
  timestamp: Date;
  status: ClaimStatus;
  branchId?: string;
  supersededBy?: string;
  observationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimWithRelations extends Claim {
  entity: Entity;
  source: Source;
  branch?: Branch;
}

// ============================================================
// CONSTRAINT TYPES — rules that must hold
// ============================================================

export type ConstraintType =
  | 'NUMERIC_RANGE'
  | 'STATUS_DEPENDENCY'
  | 'VERIFICATION_REQUIRED'
  | 'MUTUAL_EXCLUSION'
  | 'COMPLETENESS'
  | 'CUSTOM';

/**
 * Structured constraint expression DSL.
 * Examples:
 *   { type: 'NUMERIC_RANGE', entityType: 'COMPONENT', predicate: 'mass', max: 20 }
 *   { type: 'STATUS_DEPENDENCY', ifPredicate: 'status', ifValue: 'complete', requiresPredicate: 'verificationStatus', requiresValue: 'complete' }
 */
export interface ConstraintExpression {
  type: ConstraintType;
  entityType?: string;
  predicate?: string;
  min?: number;
  max?: number;
  ifPredicate?: string;
  ifValue?: unknown;
  requiresPredicate?: string;
  requiresValue?: unknown;
  excludedValues?: unknown[];
  entityIds?: string[];
  [key: string]: unknown;
}

export interface Constraint {
  id: string;
  name: string;
  description: string;
  type: ConstraintType;
  expression: ConstraintExpression;
  entityIds: string[];
  weight: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConstraintViolation {
  id: string;
  constraintId: string;
  constraint?: Constraint;
  entityIds: string[];
  claimIds: string[];
  severity: number;
  description: string;
  isActive: boolean;
  createdAt: Date;
}

// ============================================================
// DEPENDENCY TYPES — signed typed relations
// ============================================================

/**
 * Dependency type semantics:
 * - SUPPORTS:    A supports B being valid (positive consensus)
 * - REQUIRES:    A requires B to hold (if B fails, A is suspect)
 * - IMPLIES:     A being true logically implies B
 * - INVALIDATES: A being true invalidates B
 * - EXCLUDES:    A and B cannot coexist as active claims
 * - MUTEX:       A and B are mutually exclusive states
 * - IMPLIES_NOT: A implies B is false
 */
export type DependencyType =
  | 'SUPPORTS'
  | 'REQUIRES'
  | 'IMPLIES'
  | 'INVALIDATES'
  | 'EXCLUDES'
  | 'MUTEX'
  | 'IMPLIES_NOT';

export interface Dependency {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: DependencyType;
  weight: number;
  description?: string;
  metadata?: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
}

// ============================================================
// CONTRADICTION TYPES
// ============================================================

export type ContradictionSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ContradictionStatus = 'OPEN' | 'RESOLVED' | 'BRANCHED';
export type ContradictionType =
  | 'NUMERIC_CONFLICT'
  | 'STATUS_CONFLICT'
  | 'TEMPORAL_CONFLICT'
  | 'MUTEX_TAG_CONFLICT'
  | 'RANGE_THRESHOLD_CONFLICT'
  | 'SEMANTIC';

export interface Contradiction {
  id: string;
  claimAId: string;
  claimBId: string;
  score: number;            // ContradictionScore(p,q)
  severity: ContradictionSeverity;
  type: ContradictionType;
  status: ContradictionStatus;
  branchId?: string;
  resolution?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContradictionWithClaims extends Contradiction {
  claimA: ClaimWithRelations;
  claimB: ClaimWithRelations;
}

// ============================================================
// BRANCH TYPES — alternative state paths
// ============================================================

export type BranchStatus = 'OPEN' | 'RESOLVED' | 'MERGED' | 'REJECTED';

export interface Branch {
  id: string;
  name: string;
  description?: string;
  parentBranchId?: string;
  status: BranchStatus;
  confidence: number;
  contradictionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// ACTION PROPOSAL TYPES
// ============================================================

export type ActionStatus =
  | 'PENDING'
  | 'VALID'
  | 'RISKY'
  | 'BLOCKED'
  | 'BRANCH_DEPENDENT';

export interface ActionProposal {
  id: string;
  operation: string;
  description?: string;
  parameters: Record<string, unknown>;
  impactedEntityIds: string[];
  sourceId?: string;
  branchId?: string;
  provenanceChain: ProvenanceRef[];
  status: ActionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProvenanceRef {
  claimId: string;
  entityId: string;
  predicate: string;
  confidence: number;
}

/**
 * ActionValidation — full result of coherence checking an action.
 *
 * DeltaPhi(a) = Phi(G after action) - Phi(G current)
 *
 * Psi(a,G) = mu1*ConstraintViolationRisk
 *           + mu2*DependencyBreakageRisk
 *           + mu3*ContradictionAmplification
 *           + mu4*UncertaintyExposure
 *           + mu5*ProvenanceFragility
 *
 * Admissibility:
 *   VALID   if DeltaPhi <= budget AND Psi <= epsilon
 *   RISKY   if slightly above threshold
 *   BLOCKED if well above threshold
 *   BRANCH_DEPENDENT if validity differs by active branch
 */
export interface ActionValidation {
  id: string;
  actionProposalId: string;
  admissibility: ActionStatus;

  deltaPhi: number;                   // coherence cost
  psiScore: number;                   // total inconsistency score
  constraintViolationRisk: number;    // mu1 component
  dependencyBreakageRisk: number;     // mu2 component
  contradictionAmplification: number; // mu3 component
  uncertaintyExposure: number;        // mu4 component
  provenanceFragility: number;        // mu5 component
  propagatedRisk: number;             // mu6 component: transitive risk via dependency graph

  impactedEntityIds: string[];
  provenanceChain: ProvenanceRef[];
  reasons: string[];
  createdAt: Date;
}

// ============================================================
// OBSERVATION TYPES
// ============================================================

export interface Observation {
  id: string;
  sourceId: string;
  type: string;
  content: Record<string, unknown>;
  entityIds: string[];
  processed: boolean;
  createdAt: Date;
}

// ============================================================
// STATE SNAPSHOT
// ============================================================

export interface StateSnapshot {
  id: string;
  phi: number;              // total incoherence energy Phi(G)
  coherenceScore: number;   // CoherenceScore = 100 * exp(-k * Phi_norm)
  entityCount: number;
  claimCount: number;
  activeClaimCount: number;
  contradictionCount: number;
  openContradictionCount: number;
  branchCount: number;
  openBranchCount: number;
  constraintViolationCount: number;
  lambdaC: number;
  lambdaK: number;
  lambdaD: number;
  lambdaU: number;
  lambdaB: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================
// AUDIT EVENT
// ============================================================

export type AuditEventType =
  | 'ENTITY_CREATED'
  | 'CLAIM_CREATED'
  | 'CLAIM_SUPERSEDED'
  | 'CLAIM_INVALIDATED'
  | 'CONTRADICTION_DETECTED'
  | 'BRANCH_CREATED'
  | 'BRANCH_RESOLVED'
  | 'CONSTRAINT_VIOLATED'
  | 'ACTION_PROPOSED'
  | 'ACTION_VALIDATED'
  | 'SETTLING_PASS'
  | 'SNAPSHOT_TAKEN'
  | 'OBSERVATION_INGESTED'
  | 'DEPENDENCY_PROPAGATED';

export interface AuditEvent {
  id: string;
  type: AuditEventType | string;
  entityId?: string;
  branchId?: string;
  actorId?: string;
  data: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================
// COHERENCE WEIGHTS CONFIG
// ============================================================

export interface CoherenceWeights {
  lambdaC: number;  // constraint violation weight
  lambdaK: number;  // contradiction weight
  lambdaD: number;  // dependency mismatch weight
  lambdaU: number;  // uncertainty/staleness weight
  lambdaB: number;  // unresolved branch burden weight
  kScale: number;   // coherence score scaling constant
}

export interface ActionWeights {
  mu1: number;   // constraint violation risk weight
  mu2: number;   // dependency breakage risk weight
  mu3: number;   // contradiction amplification weight
  mu4: number;   // uncertainty exposure weight
  mu5: number;   // provenance fragility weight
  mu6?: number;  // propagated risk weight (graph-propagated transitive risk)
}

export interface EngineConfig {
  coherenceWeights: CoherenceWeights;
  actionWeights: ActionWeights;
  stalenessLambda: number;                    // decay constant for staleness
  contradictionThreshold: number;             // score above which to flag contradiction
  branchThreshold: number;                    // score above which to create branch
  actionBudget: number;                       // DeltaPhi budget for action admissibility
  actionEpsilon: number;                      // Psi threshold for action admissibility
  settlingMaxRounds?: number;                 // max settling iterations (default 50)
  // Phase 1: propagated risk via dependency graph traversal
  propagatedRiskGlobalThreshold?: number;     // θ_global: propagated risk alone triggers BLOCKED (default 0.70)
  propagationHops?: number;                   // k: max BFS depth for graph traversal (default 4)
  propagationDecay?: number;                  // δ: per-hop risk decay factor (default 0.7)
}
