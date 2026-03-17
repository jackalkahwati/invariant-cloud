/**
 * Scenario Schema — the ground truth contract for all evals.
 *
 * Every scenario specifies:
 *   1. Initial world state (entities, claims, constraints, dependencies)
 *   2. Optional update sequence (for drift benchmarks)
 *   3. A proposed action to validate
 *   4. Ground truth answers (what the correct system output must be)
 *
 * Ground truth is determined by the spec author (us), not by any model.
 * This makes the eval adversarial to all systems including our own.
 */

// ── Category ──────────────────────────────────────────────────

export type ScenarioCategory =
  | 'contradiction'      // Can the system detect incompatible claims?
  | 'multi_hop'          // Can it propagate implications beyond one edge?
  | 'stale_state'        // Can it discount old claims correctly?
  | 'branch_sensitive'   // Does it preserve branches instead of collapsing?
  | 'action_safety'      // Does it block locally plausible / globally invalid actions?
  | 'long_horizon';      // Does it stay coherent after many sequential updates?

// ── Entity Setup ──────────────────────────────────────────────

export interface EntitySetup {
  name: string;
  type: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// ── Claim Setup ───────────────────────────────────────────────

export interface ClaimSetup {
  entityName: string;          // refers to entity by name
  predicate: string;
  value: unknown;
  confidence?: number;         // default 0.9
  sourceName?: string;         // default 'system'
  sourceType?: string;         // default 'SYSTEM'
  /** timestamp offset in seconds from "now" — negative = in the past */
  ageSeconds?: number;         // default 0 (fresh)
}

// ── Constraint Setup ──────────────────────────────────────────

export interface ConstraintSetup {
  name: string;
  description: string;
  type: string;
  expression: Record<string, unknown>;
  entityNames?: string[];
  weight?: number;
}

// ── Dependency Setup ──────────────────────────────────────────

export type DependencyTypeSpec =
  | 'SUPPORTS' | 'REQUIRES' | 'IMPLIES'
  | 'INVALIDATES' | 'EXCLUDES' | 'MUTEX' | 'IMPLIES_NOT';

export interface DependencySetup {
  fromEntityName: string;
  toEntityName: string;
  type: DependencyTypeSpec;
  weight?: number;
  description?: string;
}

// ── Update Step (for drift benchmarks) ───────────────────────

export interface UpdateStep {
  stepNumber: number;
  description: string;
  /** New claims to add at this step */
  addClaims?: ClaimSetup[];
  /** Claims to supersede (by entity+predicate) */
  supersedeClaims?: Array<{ entityName: string; predicate: string }>;
}

// ── Action Proposal ───────────────────────────────────────────

export interface ActionProposalSetup {
  operation: string;
  description: string;
  impactedEntityNames: string[];
  parameters?: Record<string, unknown>;
}

// ── Ground Truth ──────────────────────────────────────────────

export interface ContradictionGT {
  entityName: string;
  predicate: string;
  valueA: unknown;
  valueB: unknown;
  expectedSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export type ActionAdmissibility = 'VALID' | 'RISKY' | 'BLOCKED' | 'BRANCH_DEPENDENT';

export interface GroundTruth {
  /** Expected contradictions that must be detected */
  contradictions: ContradictionGT[];
  /** Whether at least one branch should be created */
  branchRequired: boolean;
  /** Correct action admissibility */
  actionAdmissibility: ActionAdmissibility;
  /** Entities that should be invalidated/downstream-affected */
  invalidatedEntityNames: string[];
  /** Coherence level description */
  coherenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL';
  /**
   * Reasoning steps that a correct explanation must include.
   * Used to score LLM explanations.
   */
  requiredReasoningKeywords: string[];
  /**
   * For action_safety scenarios: the single most important reason
   * the action should be blocked.
   */
  primaryBlockReason?: string;
}

// ── Full Scenario ─────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  category: ScenarioCategory;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';

  entities: EntitySetup[];
  claims: ClaimSetup[];
  constraints: ConstraintSetup[];
  dependencies: DependencySetup[];

  /** For long_horizon scenarios only */
  updateSequence?: UpdateStep[];

  proposedAction: ActionProposalSetup;
  groundTruth: GroundTruth;
}

// ── Evaluation Result ─────────────────────────────────────────

export interface ContradictionDetected {
  entityName?: string;
  predicate?: string;
  description: string;
  score?: number;
  severity?: string;
}

export interface EvaluationResult {
  scenarioId: string;
  evaluatorId: string;
  durationMs: number;
  error?: string;

  // Outputs
  contradictionsDetected: ContradictionDetected[];
  branchCreated: boolean;
  actionAdmissibility: ActionAdmissibility | 'UNKNOWN';
  invalidatedEntityNames: string[];
  coherenceScore?: number;        // numeric if available (our engine)
  explanation: string;
  rawOutput?: unknown;

  // Scored metrics (filled by scorer, not evaluator)
  metrics?: ScenarioMetrics;
}

export interface ScenarioMetrics {
  // Contradiction detection
  contradictionRecall: number;     // GT contradictions caught / total GT
  contradictionPrecision: number;  // correct detections / all detections
  contradictionF1: number;

  // Branch correctness
  branchPrecision: number;         // 1 if correct branch decision, 0 otherwise
  branchRecall: number;

  // Action classification
  actionCorrect: boolean;          // exact match with GT admissibility
  actionWithinRisk: boolean;       // within one tier (VALID↔RISKY or RISKY↔BLOCKED)

  // Dependency propagation
  invalidationRecall: number;      // GT invalidated entities caught / total
  invalidationPrecision: number;

  // Explanation quality
  reasoningKeywordCoverage: number; // fraction of GT reasoning keywords found

  // Composite
  overallScore: number;            // [0,1] weighted composite
}

// ── Aggregate Metrics ─────────────────────────────────────────

export interface AggregateMetrics {
  evaluatorId: string;
  scenarioCount: number;

  // Means across scenarios
  meanContradictionF1: number;
  meanBranchF1: number;
  actionAccuracy: number;           // fraction exactly correct
  actionWithinRiskRate: number;
  meanInvalidationF1: number;
  meanReasoningCoverage: number;
  meanOverallScore: number;

  // By category
  byCategory: Record<ScenarioCategory, {
    count: number;
    meanOverallScore: number;
    actionAccuracy: number;
  }>;

  // By difficulty
  byDifficulty: Record<string, {
    count: number;
    meanOverallScore: number;
  }>;
}
