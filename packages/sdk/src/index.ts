/**
 * invariant-sdk — Invariant Coherence Engine SDK
 *
 * Complete typed client for every API endpoint exposed by the Coherence Engine.
 * Supports retry logic, configurable timeouts, SSE streaming, and full TypeScript
 * coverage across all resource domains.
 *
 * @example
 * ```ts
 * import { InvariantClient } from 'invariant-sdk';
 *
 * const client = new InvariantClient({
 *   baseUrl: 'https://api.invariant.me',
 *   apiKey: 'inv_abc123...',
 *   agentName: 'my-agent',
 * });
 *
 * const score = await client.world.getCoherence();
 * console.log(score.coherenceScore);
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface CoherenceSDKConfig {
  /** Base URL of the Coherence Engine API (no trailing slash) */
  baseUrl: string;
  /** API key with `inv_` prefix */
  apiKey: string;
  /** Optional name stamped on observations/claims published by this client */
  agentName?: string;
  /** Request timeout in milliseconds. Default: 30 000 */
  timeout?: number;
  /** Number of retry attempts for GET requests. Default: 3 */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 300 */
  retryBaseDelayMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error class
// ─────────────────────────────────────────────────────────────────────────────

export class InvariantError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly requestId: string | null;

  constructor(status: number, message: string, body: unknown, requestId: string | null = null) {
    super(message);
    this.name = 'InvariantError';
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain enumerations & primitive types
// ─────────────────────────────────────────────────────────────────────────────

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

export type SourceType = 'AGENT' | 'HUMAN' | 'TOOL' | 'SYSTEM' | 'SENSOR';

export type ClaimStatus =
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'DISPUTED'
  | 'INVALIDATED'
  | 'BRANCH_SPECIFIC';

export type ConstraintType =
  | 'NUMERIC_RANGE'
  | 'STATUS_DEPENDENCY'
  | 'VERIFICATION_REQUIRED'
  | 'MUTUAL_EXCLUSION'
  | 'COMPLETENESS'
  | 'CUSTOM';

export type DependencyType =
  | 'SUPPORTS'
  | 'REQUIRES'
  | 'IMPLIES'
  | 'INVALIDATES'
  | 'EXCLUDES'
  | 'MUTEX'
  | 'IMPLIES_NOT';

export type ContradictionSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ContradictionStatus = 'OPEN' | 'RESOLVED' | 'BRANCHED';
export type ContradictionType =
  | 'NUMERIC_CONFLICT'
  | 'STATUS_CONFLICT'
  | 'TEMPORAL_CONFLICT'
  | 'MUTEX_TAG_CONFLICT'
  | 'RANGE_THRESHOLD_CONFLICT'
  | 'SEMANTIC';

export type BranchStatus = 'OPEN' | 'RESOLVED' | 'MERGED' | 'REJECTED';

export type ActionStatus =
  | 'PENDING'
  | 'VALID'
  | 'RISKY'
  | 'BLOCKED'
  | 'BRANCH_DEPENDENT';

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
  | 'DEPENDENCY_PROPAGATED'
  | 'MANUAL_OVERRIDE'
  | string;

export type PolicyLayer =
  | 'INGESTION'
  | 'STATE'
  | 'POLICY'
  | 'PLAN'
  | 'EXECUTION'
  | 'TRACE';

export type PolicyEffect = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'ESCALATE' | 'WARN';

export type PolicySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PlanStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED';

export type PlanStepStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'SKIPPED';

export type TraceSessionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED';

export type WorkspaceTier = 'FREE' | 'STARTER' | 'TEAM' | 'ENTERPRISE';

// ─────────────────────────────────────────────────────────────────────────────
// Domain entity interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description?: string;
  metadata?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  trustScore: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Claim {
  id: string;
  entityId: string;
  predicate: string;
  value: unknown;
  confidence: number;
  sourceId: string;
  timestamp: string;
  status: ClaimStatus;
  branchId?: string;
  supersededBy?: string;
  observationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimWithRelations extends Claim {
  entity: Entity;
  source: Source;
  branch?: Branch;
}

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
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
}

export interface Dependency {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: DependencyType;
  weight: number;
  description?: string;
  metadata?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

export interface Contradiction {
  id: string;
  claimAId: string;
  claimBId: string;
  score: number;
  severity: ContradictionSeverity;
  type: ContradictionType;
  status: ContradictionStatus;
  branchId?: string;
  resolution?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContradictionWithClaims extends Contradiction {
  claimA: ClaimWithRelations;
  claimB: ClaimWithRelations;
}

export interface Branch {
  id: string;
  name: string;
  description?: string;
  parentBranchId?: string;
  status: BranchStatus;
  confidence: number;
  contradictionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProvenanceRef {
  claimId: string;
  entityId: string;
  predicate: string;
  confidence: number;
}

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
  createdAt: string;
  updatedAt: string;
}

export interface ActionValidation {
  id: string;
  actionProposalId: string;
  admissibility: ActionStatus;
  deltaPhi: number;
  psiScore: number;
  constraintViolationRisk: number;
  dependencyBreakageRisk: number;
  contradictionAmplification: number;
  uncertaintyExposure: number;
  provenanceFragility: number;
  propagatedRisk: number;
  impactedEntityIds: string[];
  provenanceChain: ProvenanceRef[];
  reasons: string[];
  createdAt: string;
}

export interface Observation {
  id: string;
  sourceId: string;
  type: string;
  content: Record<string, unknown>;
  entityIds: string[];
  processed: boolean;
  createdAt: string;
}

export interface StateSnapshot {
  id: string;
  phi: number;
  coherenceScore: number;
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
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  entityId?: string;
  branchId?: string;
  actorId?: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  layer: PolicyLayer;
  condition: Record<string, unknown>;
  effect: PolicyEffect;
  severity: PolicySeverity;
  entityTypes: string[];
  operations: string[];
  priority: number;
  isActive: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyApproval {
  id: string;
  policyRuleId: string;
  actionProposalId?: string;
  requestedBy: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  reviewedBy?: string;
  reviewReason?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyDecision {
  decision: PolicyEffect;
  matchedRules: PolicyRule[];
  requiresApproval: boolean;
  escalations: string[];
  warnings: string[];
}

export interface PlanStep {
  id: string;
  planId: string;
  name: string;
  operation: string;
  description?: string;
  parameters: Record<string, unknown>;
  entityIds: string[];
  assignedTo?: string;
  requiresIndices: number[];
  status: PlanStepStatus;
  sequenceIndex: number;
  traceSessionId?: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  name: string;
  goal: string;
  description?: string;
  agentId?: string;
  entityIds: string[];
  traceSessionId?: string;
  status: PlanStatus;
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanProgress {
  plan: Plan;
  totalSteps: number;
  completedSteps: number;
  runningSteps: number;
  failedSteps: number;
  blockedSteps: number;
  readySteps: number;
  percentComplete: number;
}

export interface TraceEvent {
  id: string;
  sessionId: string;
  type: string;
  sequenceNumber: number;
  entityIds: string[];
  data: Record<string, unknown>;
  deltaPhiAfter?: number;
  coherenceAfter?: number;
  actorId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface TraceSession {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  status: TraceSessionStatus;
  metadata?: Record<string, unknown>;
  startedAt: string;
  endedAt?: string;
}

export interface TraceSessionStats {
  eventCount: number;
  entityCount: number;
  phiDelta: number;
  duration?: number;
}

export interface TraceReplayResult {
  session: TraceSession;
  events: TraceEvent[];
  replayedUpTo?: number;
  stateAtReplay: Record<string, unknown>;
}

export interface WorkspaceApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  tier: WorkspaceTier;
  status: string;
  trialEndsAt?: string;
  claimsThisMonth: number;
  apiKeys: WorkspaceApiKeyRecord[];
}

export interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  apiKey: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  slug: string;
  tier: WorkspaceTier;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  workspace: AuthWorkspace | null;
}

export interface RegisterResponse {
  token: string;
  apiKey: string;
  user: AuthUser;
  workspace: AuthWorkspace;
}

export interface MeResponse {
  user: AuthUser;
  workspaces: Array<{
    workspace: WorkspaceInfo;
    role: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request input interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface ObservationInput {
  /** Source identifier — either sourceId or sourceName must be provided */
  sourceId?: string;
  /** Source name — will be created/looked up if sourceId is omitted */
  sourceName?: string;
  /** Observation type label */
  type: string;
  /** Arbitrary structured content */
  content: Record<string, unknown>;
  /** Entity IDs this observation pertains to */
  entityIds: string[];
  /** Inline claims to extract from this observation */
  claims?: Array<{
    entityId: string;
    predicate: string;
    value: unknown;
    confidence?: number;
  }>;
}

export interface ClaimInput {
  entityId: string;
  predicate: string;
  value: unknown;
  confidence?: number;
  sourceName: string;
  sourceType?: SourceType;
  branchId?: string;
  observationId?: string;
}

export interface CreateEntityInput {
  name: string;
  type: EntityType | string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateConstraintInput {
  name: string;
  description: string;
  type: ConstraintType;
  expression: ConstraintExpression;
  entityIds?: string[];
  weight?: number;
}

export interface CreateDependencyInput {
  fromEntityId: string;
  toEntityId: string;
  type: DependencyType;
  weight?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionInput {
  operation: string;
  description?: string;
  parameters?: Record<string, unknown>;
  impactedEntityIds: string[];
  sourceId?: string;
  branchId?: string;
}

export interface CreateBranchInput {
  name: string;
  description?: string;
  parentBranchId?: string;
  contradictionId?: string;
}

export interface CreatePlanInput {
  name: string;
  goal: string;
  description?: string;
  agentId?: string;
  entityIds?: string[];
  traceSessionId?: string;
  steps: Array<{
    name: string;
    operation: string;
    description?: string;
    parameters?: Record<string, unknown>;
    entityIds?: string[];
    assignedTo?: string;
    requiresIndices?: number[];
  }>;
}

export interface CreatePolicyRuleInput {
  name: string;
  description?: string;
  layer?: PolicyLayer;
  condition: Record<string, unknown>;
  effect: PolicyEffect;
  severity?: PolicySeverity;
  entityTypes?: string[];
  operations?: string[];
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface RequestApprovalInput {
  policyRuleId: string;
  actionProposalId?: string;
  requestedBy: string;
  reason: string;
  expiresInHours?: number;
}

export interface EvaluatePolicyInput {
  proposalId: string;
  operation: string;
  impactedEntityIds: string[];
  entityTypes?: string[];
  psiScore?: number;
  deltaPhi?: number;
  admissibility?: string;
  actorId?: string;
}

export interface CreateTraceSessionInput {
  name: string;
  description?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface AppendTraceEventInput {
  type: string;
  data: Record<string, unknown>;
  entityIds?: string[];
  deltaPhiAfter?: number;
  coherenceAfter?: number;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite response types
// ─────────────────────────────────────────────────────────────────────────────

export interface CoherenceScore {
  coherenceScore: number;
  phi: number;
  breakdown: {
    Vc: number;
    Vk: number;
    Vd: number;
    Vu: number;
    Vb: number;
  };
  weights: {
    lambdaC: number;
    lambdaK: number;
    lambdaD: number;
    lambdaU: number;
    lambdaB: number;
  };
  formula: string;
  coherenceFormula: string;
  timestamp: string;
}

export interface WorldSnapshot {
  coherenceScore: number;
  phi: number;
  entityCount: number;
  activeClaimCount: number;
  totalClaimCount: number;
  contradictionCount: number;
  openContradictionCount: number;
  branchCount: number;
  openBranchCount: number;
  constraintViolationCount: number;
  lastSnapshot: StateSnapshot | null;
  highRiskEntities: Array<{
    entityId: string;
    name: string;
    riskScore: number;
    reasons: string[];
  }>;
}

export interface SettleRoundSummary {
  round: number;
  contradictionsDetected: number;
  branchesCreated: number;
  claimsInvalidated: number;
  constraintViolationsFound: number;
  phiChange: number;
  monotonicity: boolean;
}

export interface SettleResult {
  rounds: number;
  converged: boolean;
  phiBefore: number;
  phiAfter: number;
  coherenceScoreBefore: number;
  coherenceScoreAfter: number;
  monotonicityMaintained: boolean;
  summary: SettleRoundSummary[];
}

export interface SearchResult {
  entities: Entity[];
  claims: ClaimWithRelations[];
}

export interface EntityState {
  entity: Entity;
  activeClaims: ClaimWithRelations[];
  dependencies: {
    from: Dependency[];
    to: Dependency[];
  };
  stateSnapshot: Record<string, unknown>;
}

export interface EntityHistory {
  entity: Entity;
  claims: ClaimWithRelations[];
  auditEvents: AuditEvent[];
}

export interface BranchDetail {
  branch: Branch;
  claims: ClaimWithRelations[];
  entityIds: string[];
}

export interface ActionImpact {
  proposal: ActionProposal;
  latestValidation: ActionValidation | null;
  impactedEntityIds: string[];
  provenanceChain: ProvenanceRef[];
  admissibility: ActionStatus;
  deltaPhi?: number;
  psiScore?: number;
  reasons: string[];
}

export interface ActionOverrideResult {
  proposal: ActionProposal;
  reason: string;
  overridden: boolean;
}

export interface ValidateActionResult {
  proposal: ActionProposal;
  validation: ActionValidation;
}

export interface ObservationIngestResult {
  observation: Observation;
  claimsCreated: Claim[];
}

export interface HealthStatus {
  status: string;
  timestamp: string;
}

export interface SimulateActionResult {
  proposal: ActionProposal;
  validation: ActionValidation;
  simulated: true;
}

export interface TraceSessionDetail {
  session: TraceSession;
  stats: TraceSessionStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE / streaming
// ─────────────────────────────────────────────────────────────────────────────

export interface CoherenceStreamEvent {
  type: 'coherence_update' | 'snapshot' | 'contradiction' | 'branch' | 'settle' | 'heartbeat' | string;
  data: CoherenceScore | WorldSnapshot | Record<string, unknown>;
  timestamp: string;
}

export type CoherenceStreamCallback = (event: CoherenceStreamEvent, close: () => void) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildQs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Core SDK class
// ─────────────────────────────────────────────────────────────────────────────

export class CoherenceEngineSDK {
  protected readonly baseUrl: string;
  protected readonly headers: Record<string, string>;
  protected readonly config: CoherenceSDKConfig;

  // Namespace accessors — all methods also exist flat on the class for BC
  readonly observations: ObservationsNamespace;
  readonly claims: ClaimsNamespace;
  readonly entities: EntitiesNamespace;
  readonly contradictions: ContradictionsNamespace;
  readonly branches: BranchesNamespace;
  readonly constraints: ConstraintsNamespace;
  readonly dependencies: DependenciesNamespace;
  readonly actions: ActionsNamespace;
  readonly world: WorldNamespace;
  readonly audit: AuditNamespace;
  readonly policy: PolicyNamespace;
  readonly trace: TraceNamespace;
  readonly plans: PlansNamespace;
  readonly workspace: WorkspaceNamespace;
  readonly auth: AuthNamespace;

  constructor(config: CoherenceSDKConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    };

    // Bind namespaces
    this.observations = new ObservationsNamespace(this);
    this.claims = new ClaimsNamespace(this);
    this.entities = new EntitiesNamespace(this);
    this.contradictions = new ContradictionsNamespace(this);
    this.branches = new BranchesNamespace(this);
    this.constraints = new ConstraintsNamespace(this);
    this.dependencies = new DependenciesNamespace(this);
    this.actions = new ActionsNamespace(this);
    this.world = new WorldNamespace(this);
    this.audit = new AuditNamespace(this);
    this.policy = new PolicyNamespace(this);
    this.trace = new TraceNamespace(this);
    this.plans = new PlansNamespace(this);
    this.workspace = new WorkspaceNamespace(this);
    this.auth = new AuthNamespace(this);
  }

  // ── Internal request engine ────────────────────────────────────────────────

  /** Core fetch wrapper with timeout support. Does NOT retry. */
  async _fetch<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeout ?? 30_000,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const requestId = response.headers.get('x-request-id');

    if (!response.ok) {
      let errorBody: unknown;
      try { errorBody = await response.json(); } catch { errorBody = response.statusText; }
      throw new InvariantError(
        response.status,
        `Invariant API error ${response.status}: ${JSON.stringify(errorBody)}`,
        errorBody,
        requestId,
      );
    }

    if (response.status === 204) return undefined as unknown as T;
    return response.json() as Promise<T>;
  }

  /**
   * Fetch with retry (exponential backoff). Used automatically for GET requests.
   * Retries only on network errors and 5xx responses (not 4xx).
   */
  async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const isGet = method === 'GET';
    const maxAttempts = isGet ? (this.config.retries ?? 3) + 1 : 1;
    const baseDelay = this.config.retryBaseDelayMs ?? 300;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this._fetch<T>(method, path, body);
      } catch (err) {
        lastError = err;
        const isRetryable =
          !(err instanceof InvariantError) ||
          (err.status >= 500 && err.status < 600);

        if (!isRetryable || attempt === maxAttempts) throw err;
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  // ── SSE streaming ──────────────────────────────────────────────────────────

  /**
   * Subscribe to the coherence live stream (GET /world/stream).
   * Calls `callback(event, close)` for each SSE message.
   * Returns a `close()` function to terminate the subscription.
   */
  subscribeToCoherence(callback: CoherenceStreamCallback): () => void {
    const controller = new AbortController();
    const url = `${this.baseUrl}/world/stream`;

    const run = async () => {
      const response = await fetch(url, {
        headers: { 'Accept': 'text/event-stream', 'X-API-Key': this.config.apiKey },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new InvariantError(response.status, 'SSE connection failed', null, null);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const close = () => controller.abort();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventType = 'message';
        let dataStr = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataStr = line.slice(5).trim();
          } else if (line === '') {
            if (dataStr) {
              try {
                const parsed = JSON.parse(dataStr) as { type?: string; data?: unknown; timestamp?: string };
                callback(
                  {
                    type: parsed.type ?? eventType,
                    data: (parsed.data ?? parsed) as CoherenceScore | WorldSnapshot | Record<string, unknown>,
                    timestamp: parsed.timestamp ?? new Date().toISOString(),
                  },
                  close,
                );
              } catch { /* ignore malformed SSE frames */ }
              dataStr = '';
              eventType = 'message';
            }
          }
        }
      }
    };

    run().catch(() => { /* stream ended or aborted */ });
    return () => controller.abort();
  }

  // ── Health (no auth required) ──────────────────────────────────────────────

  async health(): Promise<HealthStatus> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json() as Promise<HealthStatus>;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Backward-compatible flat API
  // The following methods delegate to the namespace objects so old callers
  // that use `client.validateAction(...)` etc. continue to work.
  // ─────────────────────────────────────────────────────────────────────────

  // Observations
  async publishObservation(input: ObservationInput): Promise<ObservationIngestResult> {
    return this.observations.create({
      ...input,
      sourceName: input.sourceName ?? (input.sourceId ? undefined : (this.config.agentName ?? 'sdk-agent')),
    });
  }

  // Claims
  async publishClaim(input: ClaimInput): Promise<Claim> {
    return this.claims.create({
      ...input,
      sourceName: input.sourceName ?? this.config.agentName ?? 'sdk-agent',
    });
  }

  async getClaim(id: string): Promise<ClaimWithRelations> {
    return this.claims.fetch(id);
  }

  // Entities
  async getEntityState(entityId: string): Promise<EntityState> {
    return this.entities.getState(entityId);
  }

  async getEntityHistory(entityId: string): Promise<EntityHistory> {
    return this.entities.getHistory(entityId);
  }

  async createEntity(data: CreateEntityInput): Promise<Entity> {
    return this.entities.create(data);
  }

  // Contradictions
  async getContradictions(status?: ContradictionStatus): Promise<Contradiction[]> {
    return this.contradictions.list(status ? { status } : {});
  }

  async getContradiction(id: string): Promise<ContradictionWithClaims> {
    return this.contradictions.fetch(id);
  }

  // Branches
  async getBranches(status?: BranchStatus): Promise<Branch[]> {
    return this.branches.list(status ? { status } : {});
  }

  async getBranch(id: string): Promise<BranchDetail> {
    return this.branches.fetch(id);
  }

  // Actions
  async validateAction(input: ActionInput): Promise<ValidateActionResult> {
    return this.actions.validate({
      ...input,
      sourceName: this.config.agentName ?? 'sdk-agent',
    } as ActionInput);
  }

  // World
  async getCoherenceScore(): Promise<CoherenceScore> {
    return this.world.getCoherence();
  }

  async getWorldSnapshot(): Promise<WorldSnapshot> {
    return this.world.getSnapshot();
  }

  async triggerSettling(): Promise<SettleResult> {
    return this.world.settle();
  }

  // Search
  async search(query: string, type?: 'entity' | 'claim' | 'all'): Promise<SearchResult> {
    return this.world.search(query, type);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Namespace base
// ─────────────────────────────────────────────────────────────────────────────

class Namespace {
  protected readonly sdk: CoherenceEngineSDK;
  constructor(sdk: CoherenceEngineSDK) {
    this.sdk = sdk;
  }
  protected _get<T>(path: string): Promise<T> {
    return this.sdk._request<T>('GET', path);
  }
  protected _post<T>(path: string, body?: unknown): Promise<T> {
    return this.sdk._request<T>('POST', path, body);
  }
  protected _patch<T>(path: string, body?: unknown): Promise<T> {
    return this.sdk._request<T>('PATCH', path, body);
  }
  protected _delete<T>(path: string): Promise<T> {
    return this.sdk._request<T>('DELETE', path);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Observations namespace
// ─────────────────────────────────────────────────────────────────────────────

class ObservationsNamespace extends Namespace {
  /**
   * POST /observations
   * Ingest a new observation and extract embedded claims.
   */
  create(input: ObservationInput): Promise<ObservationIngestResult> {
    return this._post('/observations', input);
  }

  /**
   * GET /observations/:id
   * Retrieve an observation by ID.
   */
  fetch(id: string): Promise<Observation> {
    return this._get(`/observations/${id}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claims namespace
// ─────────────────────────────────────────────────────────────────────────────

class ClaimsNamespace extends Namespace {
  /**
   * POST /claims
   * Assert a new claim about an entity.
   * Automatically supersedes any previous active claim for the same
   * entity + predicate on the canonical branch.
   */
  create(input: ClaimInput): Promise<Claim> {
    return this._post('/claims', input);
  }

  /**
   * GET /claims/:id
   * Retrieve a claim by ID (includes entity and source relations).
   */
  fetch(id: string): Promise<ClaimWithRelations> {
    return this._get(`/claims/${id}`);
  }

  /**
   * POST /claims/:id/supersede
   * Manually mark a claim as superseded by a newer claim.
   */
  supersede(id: string, supersededById: string): Promise<ClaimWithRelations> {
    return this._post(`/claims/${id}/supersede`, { supersededById });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entities namespace
// ─────────────────────────────────────────────────────────────────────────────

class EntitiesNamespace extends Namespace {
  /**
   * GET /entities
   * List all entities, optionally filtered by type or active status.
   */
  list(options: { type?: EntityType | string; active?: boolean } = {}): Promise<Entity[]> {
    return this._get(`/entities${buildQs({ type: options.type, active: options.active })}`);
  }

  /**
   * GET /entities/:id
   * Get an entity by ID.
   */
  fetch(id: string): Promise<Entity> {
    return this._get(`/entities/${id}`);
  }

  /**
   * GET /entities/:id/state
   * Current entity state: active claims, dependencies, and flat state snapshot.
   */
  getState(id: string): Promise<EntityState> {
    return this._get(`/entities/${id}/state`);
  }

  /**
   * GET /entities/:id/history
   * Full history: all claims + audit events for an entity.
   */
  getHistory(id: string): Promise<EntityHistory> {
    return this._get(`/entities/${id}/history`);
  }

  /**
   * POST /entities
   * Create a new entity.
   */
  create(input: CreateEntityInput): Promise<Entity> {
    return this._post('/entities', input);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contradictions namespace
// ─────────────────────────────────────────────────────────────────────────────

class ContradictionsNamespace extends Namespace {
  /**
   * GET /contradictions
   * List contradictions, optionally filtered by status.
   */
  list(options: { status?: ContradictionStatus } = {}): Promise<ContradictionWithClaims[]> {
    return this._get(`/contradictions${buildQs({ status: options.status })}`);
  }

  /**
   * GET /contradictions/:id
   * Get a contradiction by ID (includes claim A and claim B).
   */
  fetch(id: string): Promise<ContradictionWithClaims> {
    return this._get(`/contradictions/${id}`);
  }

  /**
   * POST /contradictions/:id/resolve
   * Resolve a contradiction with a human-readable resolution note.
   */
  resolve(id: string, resolution: string): Promise<Contradiction> {
    return this._post(`/contradictions/${id}/resolve`, { resolution });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Branches namespace
// ─────────────────────────────────────────────────────────────────────────────

class BranchesNamespace extends Namespace {
  /**
   * GET /branches
   * List branches, optionally filtered by status.
   */
  list(options: { status?: BranchStatus } = {}): Promise<Branch[]> {
    return this._get(`/branches${buildQs({ status: options.status })}`);
  }

  /**
   * GET /branches/:id
   * Get a branch by ID including its associated claims.
   */
  fetch(id: string): Promise<BranchDetail> {
    return this._get(`/branches/${id}`);
  }

  /**
   * POST /branches/:id/resolve
   * Resolve a branch — accept (RESOLVED/MERGED) or reject (REJECTED).
   */
  resolve(
    id: string,
    status: Extract<BranchStatus, 'RESOLVED' | 'MERGED' | 'REJECTED'>,
    resolution?: string,
  ): Promise<Branch> {
    return this._post(`/branches/${id}/resolve`, { status, resolution });
  }

  /**
   * POST /branches
   * Manually create a new branch.
   */
  create(input: CreateBranchInput): Promise<Branch> {
    return this._post('/branches', input);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constraints namespace
// ─────────────────────────────────────────────────────────────────────────────

class ConstraintsNamespace extends Namespace {
  /**
   * GET /constraints
   * List all constraints (optionally filter to active only).
   */
  list(options: { active?: boolean } = {}): Promise<Constraint[]> {
    return this._get(`/constraints${buildQs({ active: options.active })}`);
  }

  /**
   * POST /constraints
   * Create a new constraint rule.
   */
  create(input: CreateConstraintInput): Promise<Constraint> {
    return this._post('/constraints', input);
  }

  /**
   * GET /constraints/violations
   * List all currently active constraint violations.
   */
  violations(): Promise<ConstraintViolation[]> {
    return this._get('/constraints/violations');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependencies namespace
// ─────────────────────────────────────────────────────────────────────────────

class DependenciesNamespace extends Namespace {
  /**
   * GET /dependencies
   * List dependencies. Filter by fromEntityId or toEntityId.
   */
  list(options: { fromEntityId?: string; toEntityId?: string } = {}): Promise<Dependency[]> {
    return this._get(`/dependencies${buildQs(options)}`);
  }

  /**
   * POST /dependencies
   * Create a signed typed dependency between two entities.
   */
  create(input: CreateDependencyInput): Promise<Dependency> {
    return this._post('/dependencies', input);
  }

  /**
   * DELETE /dependencies/:id
   * Deactivate (soft-delete) a dependency.
   */
  remove(id: string): Promise<void> {
    return this._delete(`/dependencies/${id}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions namespace
// ─────────────────────────────────────────────────────────────────────────────

class ActionsNamespace extends Namespace {
  /**
   * POST /actions/propose
   * Create an action proposal without immediately validating it.
   */
  propose(input: ActionInput): Promise<ActionProposal> {
    return this._post('/actions/propose', input);
  }

  /**
   * POST /actions/validate
   * Propose and immediately validate an action against the current world state.
   * Returns both the proposal and the full validation result.
   */
  validate(input: ActionInput): Promise<ValidateActionResult> {
    return this._post('/actions/validate', input);
  }

  /**
   * POST /actions/simulate
   * Ephemeral dry-run — validates the action against all active constraints
   * without persisting any proposal or validation row to the database.
   */
  simulate(input: ActionInput): Promise<SimulateActionResult> {
    return this._post('/actions/simulate', input) as Promise<SimulateActionResult>;
  }

  /**
   * GET /actions/:id
   * Retrieve an action proposal and all its validation history.
   */
  fetch(id: string): Promise<{ proposal: ActionProposal; validations: ActionValidation[] }> {
    return this._get(`/actions/${id}`);
  }

  /**
   * GET /actions/:id/impact
   * Get the latest impact analysis for a proposal.
   */
  getImpact(id: string): Promise<ActionImpact> {
    return this._get(`/actions/${id}/impact`);
  }

  /**
   * POST /actions/:id/override
   * Manually override a BLOCKED action with an operator-provided reason.
   * The override is logged to the audit trail.
   */
  override(id: string, reason: string, operatorId?: string): Promise<ActionOverrideResult> {
    return this._post(`/actions/${id}/override`, { reason, operatorId });
  }

  /**
   * GET /actions
   * List recent action proposals.
   */
  list(options: { limit?: number; status?: ActionStatus } = {}): Promise<ActionProposal[]> {
    return this._get(`/actions${buildQs(options)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// World namespace
// ─────────────────────────────────────────────────────────────────────────────

class WorldNamespace extends Namespace {
  /**
   * GET /world/coherence
   * Current coherence score and full Phi(G) breakdown.
   */
  getCoherence(): Promise<CoherenceScore> {
    return this._get('/world/coherence');
  }

  /**
   * GET /world/snapshot
   * Current world state snapshot including entity/claim/contradiction counts
   * and the top high-risk entities.
   */
  getSnapshot(): Promise<WorldSnapshot> {
    return this._get('/world/snapshot');
  }

  /**
   * POST /world/settle
   * Manually trigger the discrete fixed-point settling loop.
   */
  settle(): Promise<SettleResult> {
    return this._post('/world/settle');
  }

  /**
   * GET /world/history
   * Recent world state snapshots (up to `limit` entries, default 20).
   */
  getHistory(limit?: number): Promise<StateSnapshot[]> {
    return this._get(`/world/history${buildQs({ limit })}`);
  }

  /**
   * GET /search
   * Search entities and claims by free text query.
   */
  search(q: string, type: 'entity' | 'claim' | 'all' = 'all'): Promise<SearchResult> {
    return this._get(`/search${buildQs({ q, type })}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit namespace
// ─────────────────────────────────────────────────────────────────────────────

class AuditNamespace extends Namespace {
  /**
   * GET /audit
   * Recent audit trail. Optionally filter by event type.
   */
  list(options: { limit?: number; type?: AuditEventType | string } = {}): Promise<AuditEvent[]> {
    return this._get(`/audit${buildQs(options)}`);
  }

  /**
   * GET /audit/:id
   * Get a specific audit event by ID.
   */
  fetch(id: string): Promise<AuditEvent> {
    return this._get(`/audit/${id}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy namespace
// ─────────────────────────────────────────────────────────────────────────────

class PolicyNamespace extends Namespace {
  // ── Rules ──────────────────────────────────────────────────────────────────

  /**
   * GET /policy/rules
   * List all active policy rules.
   */
  listRules(): Promise<PolicyRule[]> {
    return this._get('/policy/rules');
  }

  /**
   * POST /policy/rules
   * Create a new policy rule.
   */
  createRule(input: CreatePolicyRuleInput): Promise<PolicyRule> {
    return this._post('/policy/rules', input);
  }

  /**
   * GET /policy/rules/:id
   * Get a policy rule by ID.
   */
  getRule(id: string): Promise<PolicyRule> {
    return this._get(`/policy/rules/${id}`);
  }

  /**
   * PATCH /policy/rules/:id
   * Update a policy rule.
   */
  updateRule(id: string, updates: Partial<CreatePolicyRuleInput>): Promise<PolicyRule> {
    return this._patch(`/policy/rules/${id}`, updates);
  }

  /**
   * DELETE /policy/rules/:id
   * Deactivate a policy rule.
   */
  deleteRule(id: string): Promise<void> {
    return this._delete(`/policy/rules/${id}`);
  }

  /**
   * POST /policy/evaluate
   * Evaluate an action against all active policy rules.
   */
  evaluate(input: EvaluatePolicyInput): Promise<PolicyDecision> {
    return this._post('/policy/evaluate', input);
  }

  // ── Approvals ──────────────────────────────────────────────────────────────

  /**
   * GET /policy/approvals
   * List pending approval requests.
   */
  listApprovals(): Promise<PolicyApproval[]> {
    return this._get('/policy/approvals');
  }

  /**
   * POST /policy/approvals
   * Request approval for an action from a policy reviewer.
   */
  requestApproval(input: RequestApprovalInput): Promise<PolicyApproval> {
    return this._post('/policy/approvals', input);
  }

  /**
   * GET /policy/approvals/:id
   * Get an approval request by ID.
   */
  getApproval(id: string): Promise<PolicyApproval> {
    return this._get(`/policy/approvals/${id}`);
  }

  /**
   * POST /policy/approvals/:id/approve
   * Approve a pending approval request.
   * Maps to the server's POST /policy/approvals/:id/decide with approved=true.
   */
  approve(id: string, reviewedBy: string, reason?: string): Promise<PolicyApproval> {
    return this._post(`/policy/approvals/${id}/decide`, { approved: true, reviewedBy, reason });
  }

  /**
   * POST /policy/approvals/:id/reject
   * Reject a pending approval request.
   * Maps to the server's POST /policy/approvals/:id/decide with approved=false.
   */
  reject(id: string, reviewedBy: string, reason?: string): Promise<PolicyApproval> {
    return this._post(`/policy/approvals/${id}/decide`, { approved: false, reviewedBy, reason });
  }

  /**
   * GET /policy/escalations
   * List pending policy escalations (approvals that triggered an ESCALATE effect).
   */
  listEscalations(): Promise<PolicyApproval[]> {
    return this._get('/policy/escalations');
  }

  /**
   * POST /policy/escalations
   * Create a policy escalation record.
   */
  createEscalation(input: RequestApprovalInput): Promise<PolicyApproval> {
    return this._post('/policy/escalations', input);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trace namespace
// ─────────────────────────────────────────────────────────────────────────────

class TraceNamespace extends Namespace {
  // ── Sessions ────────────────────────────────────────────────────────────────

  /**
   * POST /trace/sessions
   * Start a new trace session.
   */
  createSession(input: CreateTraceSessionInput): Promise<TraceSession> {
    return this._post('/trace/sessions', input);
  }

  /**
   * GET /trace/sessions
   * List trace sessions.
   */
  listSessions(options: { active?: boolean; limit?: number } = {}): Promise<TraceSession[]> {
    return this._get(`/trace/sessions${buildQs(options)}`);
  }

  /**
   * GET /trace/sessions/:id
   * Get a trace session with aggregate stats.
   */
  getSession(id: string): Promise<TraceSessionDetail> {
    return this._get(`/trace/sessions/${id}`);
  }

  /**
   * POST /trace/sessions/:id/end
   * End a trace session.
   */
  endSession(id: string, status: 'COMPLETED' | 'FAILED' = 'COMPLETED'): Promise<TraceSession> {
    return this._post(`/trace/sessions/${id}/end`, { status });
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  /**
   * POST /trace/sessions/:id/events
   * Append an event to an active trace session.
   */
  appendEvent(sessionId: string, input: AppendTraceEventInput): Promise<TraceEvent> {
    return this._post(`/trace/sessions/${sessionId}/events`, input);
  }

  /**
   * GET /trace/sessions/:id/events
   * Get all events in a trace session (full timeline).
   */
  getEvents(sessionId: string): Promise<TraceEvent[]> {
    return this._get(`/trace/sessions/${sessionId}/events`);
  }

  /**
   * GET /trace/sessions/:id/replay
   * Replay a trace session, optionally stopping at a specific sequence number.
   */
  replay(sessionId: string, upToSeq?: number): Promise<TraceReplayResult> {
    return this._get(`/trace/sessions/${sessionId}/replay${buildQs({ upToSeq })}`);
  }

  // ── Timeline / cross-session ─────────────────────────────────────────────

  /**
   * GET /trace/timeline
   * Alias for recent cross-session events.
   */
  getTimeline(limit?: number): Promise<TraceEvent[]> {
    return this._get(`/trace/events/recent${buildQs({ limit })}`);
  }

  /**
   * POST /trace/timeline
   * Append an event outside of a named session context (uses a global session).
   * Note: the server implementation routes this to a default session.
   */
  appendToTimeline(input: AppendTraceEventInput & { sessionId: string }): Promise<TraceEvent> {
    return this._post(`/trace/sessions/${input.sessionId}/events`, input);
  }

  /**
   * GET /trace/diff
   * Compute a coherence diff between two trace sessions.
   */
  diff(sessionAId: string, sessionBId: string): Promise<Record<string, unknown>> {
    return this._get(`/trace/diff${buildQs({ a: sessionAId, b: sessionBId })}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plans namespace
// ─────────────────────────────────────────────────────────────────────────────

class PlansNamespace extends Namespace {
  /**
   * GET /plans
   * List plans. Pass `active: true` to return only active plans.
   */
  list(options: { active?: boolean; limit?: number } = {}): Promise<Plan[]> {
    return this._get(`/plans${buildQs(options)}`);
  }

  /**
   * POST /plans
   * Create a new plan with an ordered list of steps.
   */
  create(input: CreatePlanInput): Promise<Plan> {
    return this._post('/plans', input);
  }

  /**
   * GET /plans/:id
   * Get a plan with live progress summary.
   */
  fetch(id: string): Promise<PlanProgress> {
    return this._get(`/plans/${id}`);
  }

  /**
   * POST /plans/:id/decompose
   * Ask the engine to decompose the plan goal into subtasks.
   * (Endpoint reserved for future implementation.)
   */
  decompose(id: string): Promise<Plan> {
    return this._post(`/plans/${id}/decompose`);
  }

  /**
   * POST /plans/:id/execute
   * Trigger execution of the next ready step(s) in the plan.
   */
  execute(id: string): Promise<Plan> {
    return this._post(`/plans/${id}/execute`);
  }

  /**
   * GET /plans/:id/coherence-analysis
   * Run a coherence analysis over all steps in the plan.
   */
  coherenceAnalysis(id: string): Promise<{ planId: string; steps: Array<{ stepId: string; validation: ActionValidation }> }> {
    return this._get(`/plans/${id}/coherence-analysis`);
  }

  // ── Step lifecycle ──────────────────────────────────────────────────────────

  /**
   * GET /plans/:id/steps/ready
   * Get steps ready to execute (all prerequisites met).
   */
  getReadySteps(planId: string): Promise<PlanStep[]> {
    return this._get(`/plans/${planId}/steps/ready`);
  }

  /**
   * POST /plans/:planId/steps/:stepId/validate
   * Validate a step against the coherence engine.
   */
  validateStep(planId: string, stepId: string): Promise<ActionValidation> {
    return this._post(`/plans/${planId}/steps/${stepId}/validate`);
  }

  /**
   * POST /plans/:planId/steps/:stepId/start
   * Mark a step as RUNNING.
   */
  startStep(planId: string, stepId: string, options: { agentId?: string; traceSessionId?: string } = {}): Promise<PlanStep> {
    return this._post(`/plans/${planId}/steps/${stepId}/start`, options);
  }

  /**
   * POST /plans/:planId/steps/:stepId/complete
   * Mark a step as COMPLETED.
   */
  completeStep(planId: string, stepId: string, traceSessionId?: string): Promise<Plan> {
    return this._post(`/plans/${planId}/steps/${stepId}/complete`, { traceSessionId });
  }

  /**
   * POST /plans/:planId/tasks/:taskId/status
   * Update the status of a task/step with a detailed reason.
   * Maps internally to fail/block/complete depending on the status value.
   */
  updateTaskStatus(
    planId: string,
    taskId: string,
    status: PlanStepStatus,
    reason?: string,
    traceSessionId?: string,
  ): Promise<Plan> {
    if (status === 'FAILED') {
      return this._post(`/plans/${planId}/steps/${taskId}/fail`, { reason: reason ?? 'unspecified', traceSessionId });
    }
    if (status === 'BLOCKED') {
      return this._post(`/plans/${planId}/steps/${taskId}/block`, { reason: reason ?? 'unspecified', traceSessionId });
    }
    return this._post(`/plans/${planId}/steps/${taskId}/complete`, { traceSessionId });
  }

  /**
   * POST /plans/:planId/steps/:stepId/fail
   * Mark a step as FAILED.
   */
  failStep(planId: string, stepId: string, reason: string, replan?: boolean, traceSessionId?: string): Promise<Plan> {
    return this._post(`/plans/${planId}/steps/${stepId}/fail`, { reason, replan, traceSessionId });
  }

  /**
   * POST /plans/:planId/steps/:stepId/block
   * Mark a step as BLOCKED by the coherence engine.
   */
  blockStep(planId: string, stepId: string, reason: string, traceSessionId?: string): Promise<Plan> {
    return this._post(`/plans/${planId}/steps/${stepId}/block`, { reason, traceSessionId });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace namespace
// ─────────────────────────────────────────────────────────────────────────────

class WorkspaceNamespace extends Namespace {
  /**
   * GET /workspace
   * Get current workspace info, tier, and active API keys.
   */
  info(): Promise<WorkspaceInfo> {
    return this._get('/workspace');
  }

  /**
   * POST /workspace/api-keys
   * Generate a new API key. The raw key is returned ONCE and never stored.
   */
  createApiKey(name?: string): Promise<CreatedApiKey> {
    return this._post('/workspace/api-keys', { name });
  }

  /**
   * GET /workspace/api-keys
   * List all active API keys (prefixes only — no raw values).
   */
  listApiKeys(): Promise<WorkspaceApiKeyRecord[]> {
    return this._get('/workspace/api-keys');
  }

  /**
   * DELETE /workspace/api-keys/:id
   * Revoke (deactivate) an API key.
   */
  revokeApiKey(id: string): Promise<{ revoked: boolean }> {
    return this._delete(`/workspace/api-keys/${id}`);
  }

  /**
   * GET /workspace/usage
   * Get usage statistics for the current workspace.
   */
  getUsage(): Promise<{ claimsThisMonth: number; tier: WorkspaceTier; limits: Record<string, number> }> {
    return this._get('/workspace/usage');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth namespace
// ─────────────────────────────────────────────────────────────────────────────

class AuthNamespace extends Namespace {
  /**
   * POST /auth/login
   * Authenticate with email + password. Returns a JWT and workspace info.
   */
  login(email: string, password: string): Promise<LoginResponse> {
    return this._post('/auth/login', { email, password });
  }

  /**
   * POST /auth/register
   * Register a new user and workspace. Returns a JWT and a one-time API key.
   */
  register(input: {
    email: string;
    password: string;
    name?: string;
    workspaceName?: string;
  }): Promise<RegisterResponse> {
    return this._post('/auth/register', input);
  }

  /**
   * GET /auth/me
   * Get the currently authenticated user and their workspace memberships.
   * Requires a Bearer token (not an API key).
   */
  me(_bearerToken?: string): Promise<MeResponse> {
    return this._get('/auth/me');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aliases and exports
// ─────────────────────────────────────────────────────────────────────────────

/** Clean alias — prefer this name in new code. */
export const InvariantClient = CoherenceEngineSDK;
export type InvariantClient = CoherenceEngineSDK;

/** Factory function — backward compatible with original SDK. */
export function createCoherenceClient(config: CoherenceSDKConfig): CoherenceEngineSDK {
  return new CoherenceEngineSDK(config);
}

/** Convenience factory using the cleaner name. */
export function createInvariantClient(config: CoherenceSDKConfig): CoherenceEngineSDK {
  return new CoherenceEngineSDK(config);
}

export default CoherenceEngineSDK;
