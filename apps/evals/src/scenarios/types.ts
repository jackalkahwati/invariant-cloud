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

// ── Phase 2: Scenario Family ──────────────────────────────────

export type ScenarioFamily =
  | 'atlas'          // Phase 1: Project Atlas benchmark
  | 'branch'         // Phase 1: branching scenarios
  | 'drift'          // Phase 1: drift/long-horizon
  | 'calibration'    // Phase 2: action admissibility calibration
  | 'staleness'      // Phase 2: stale-claim stress
  | 'provenance'     // Phase 2: provenance fragility
  | 'settling'       // Phase 2: fixed-point settling vs single-pass
  | 'budget'         // Phase 2: coherence budget (DeltaPhi)
  | 'branching_ext'  // Phase 2: extended branching scenarios
  | 'signed_deps'    // Phase 2: signed dependency invalidation
  | 'long_horizon';  // Phase 2: multi-update horizon

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
  /** Phase 2: which benchmark family this belongs to */
  familyId?: ScenarioFamily;
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

// ── Phase 2: Raw Psi Components ───────────────────────────────

export interface RawScores {
  psiScore: number;
  deltaPhi: number;
  constraintViolationRisk: number;
  dependencyBreakageRisk: number;
  contradictionAmplification: number;
  uncertaintyExposure: number;
  provenanceFragility: number;
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

  /** Phase 2: raw Psi/DeltaPhi breakdown for threshold analysis */
  rawScores?: RawScores;

  // Scored metrics (filled by scorer, not evaluator)
  metrics?: ScenarioMetrics;
}

// ── Phase 2: Confusion Matrix ─────────────────────────────────

export interface ConfusionEntry {
  actual: ActionAdmissibility;
  predicted: ActionAdmissibility | 'UNKNOWN';
  count: number;
}

export interface PerClassMetrics {
  class: ActionAdmissibility;
  precision: number;
  recall: number;
  f1: number;
  support: number;  // GT instances of this class
}

// ── Phase 2: Threshold Recommendation ────────────────────────

export interface ThresholdResult {
  epsilon: number;
  budget: number;
  actionAccuracy: number;
  blockedRecall: number;
  blockedPrecision: number;
  macroF1: number;
  perClass: Record<string, { precision: number; recall: number; f1: number }>;
}

// ── Phase 2: False Positive / Negative Examples ───────────────

export interface ExampleFinding {
  scenarioId: string;
  scenarioName: string;
  familyId: string;
  evaluatorId: string;
  actual: ActionAdmissibility;
  predicted: ActionAdmissibility | 'UNKNOWN';
  psiScore: number;
  deltaPhi: number;
  psiComponents?: Partial<RawScores>;
  explanation: string;
  recommendation: string;
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

// ── Phase 2 Scenario Schema (ScenarioV2) ──────────────────────
//
// Simplified schema used by Phase 2 benchmark families.
// Entities are referenced by local id within the scenario.
// A v2 harness adapter translates this into DB operations.

export interface EntitySetupV2 {
  id: string;         // local scenario-scoped id for cross-referencing
  name: string;       // entity name registered in DB
  type: string;
}

export interface ClaimSetupV2 {
  entityId: string;           // references EntitySetupV2.id
  attribute: string;          // predicate
  value: string;
  confidence?: number;        // default 0.9
  source?: string;            // source name; default 'system'
  /** How many seconds old this claim is (simulates staleness). */
  staleness_s?: number;
  /** Confidence of the provenance chain (0–1). Used for PF computation. */
  provenanceConfidence?: number;
}

export interface ConstraintSetupV2 {
  entityId: string;
  attribute: string;
  operator: '>=' | '<=' | '>' | '<' | '==' | '!=';
  threshold: number;
  description?: string;
  /** Severity multiplier (0–1). Default 1.0. */
  severity?: number;
}

export interface DependencySetupV2 {
  fromEntityId: string;
  toEntityId: string;
  type: DependencyTypeSpec;
  attribute?: string;
}

export interface ContradictionSetupV2 {
  entityId: string;
  attribute: string;
  valueA: string;
  valueB: string;
  sourceA: string;
  sourceB: string;
}

export interface BranchSetupV2 {
  entityId: string;
  attribute: string;
  isOpen: boolean;
  candidates: string[];
}

export interface InvalidationSetupV2 {
  entityId: string;
  attribute: string;
  reason: string;
}

export interface ActionSetupV2 {
  id: string;
  name: string;
  /** References EntitySetupV2.name (not id) */
  impactedEntityNames: string[];
}

export interface UpdateHistoryEntryV2 {
  entityId: string;
  attribute: string;
  values: string[];
  /** Seconds offset from epoch start of scenario */
  timestamps_s: number[];
}

export interface ScenarioSetupV2 {
  entities: EntitySetupV2[];
  claims: ClaimSetupV2[];
  constraints?: ConstraintSetupV2[];
  dependencies?: DependencySetupV2[];
  contradictions?: ContradictionSetupV2[];
  branches?: BranchSetupV2[];
  invalidations?: InvalidationSetupV2[];
  actions: ActionSetupV2[];
  updateHistory?: UpdateHistoryEntryV2[];
}

export interface ScenarioV2 {
  id: string;
  name: string;
  description: string;
  familyId: ScenarioFamily;
  category: string;
  tags?: string[];
  /** Ground-truth expected action classification. */
  expectedAction: ActionAdmissibility;
  setup: ScenarioSetupV2;
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

  // Phase 2: by family
  byFamily?: Record<string, {
    count: number;
    meanOverallScore: number;
    actionAccuracy: number;
  }>;
}
