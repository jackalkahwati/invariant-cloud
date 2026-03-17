/**
 * Coherence Engine Agent SDK
 *
 * Lightweight client for agents to interact with the Coherence Engine.
 * An agent can:
 *   - Publish observations
 *   - Publish claims
 *   - Fetch current entity state
 *   - Fetch contradictions
 *   - Inspect branches
 *   - Validate action before execution
 *   - Query coherence score
 */

export interface CoherenceSDKConfig {
  baseUrl: string;
  apiKey: string;
  agentName?: string;
  timeout?: number;
}

export interface ObservationInput {
  type: string;
  content: Record<string, unknown>;
  entityIds: string[];
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
  branchId?: string;
}

export interface ActionInput {
  operation: string;
  description?: string;
  parameters?: Record<string, unknown>;
  impactedEntityIds: string[];
  branchId?: string;
}

export interface CoherenceScore {
  coherenceScore: number;
  phi: number;
  breakdown: {
    Vc: number; Vk: number; Vd: number; Vu: number; Vb: number;
  };
}

export class CoherenceEngineSDK {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private sourceId?: string;

  constructor(private readonly config: CoherenceSDKConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.config.timeout ?? 30_000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Coherence Engine API error ${response.status}: ${JSON.stringify(error)}`);
    }

    return response.json() as Promise<T>;
  }

  // ── Observation ─────────────────────────────────────────────

  async publishObservation(input: ObservationInput): Promise<{
    observation: unknown;
    claimsCreated: unknown[];
  }> {
    return this.request('POST', '/observations', {
      sourceName: this.config.agentName ?? 'sdk-agent',
      sourceType: 'AGENT',
      ...input,
    });
  }

  // ── Claims ──────────────────────────────────────────────────

  async publishClaim(input: ClaimInput): Promise<unknown> {
    return this.request('POST', '/claims', {
      ...input,
      sourceName: this.config.agentName ?? 'sdk-agent',
      sourceType: 'AGENT',
    });
  }

  async getClaim(id: string): Promise<unknown> {
    return this.request('GET', `/claims/${id}`);
  }

  // ── Entity ──────────────────────────────────────────────────

  async getEntityState(entityId: string): Promise<{
    entity: unknown;
    activeClaims: unknown[];
    stateSnapshot: Record<string, unknown>;
    dependencies: unknown;
  }> {
    return this.request('GET', `/entities/${entityId}/state`);
  }

  async getEntityHistory(entityId: string): Promise<unknown> {
    return this.request('GET', `/entities/${entityId}/history`);
  }

  async createEntity(data: {
    name: string;
    type: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.request('POST', '/entities', data);
  }

  // ── Contradictions ──────────────────────────────────────────

  async getContradictions(status?: 'OPEN' | 'RESOLVED' | 'BRANCHED'): Promise<unknown[]> {
    const qs = status ? `?status=${status}` : '';
    return this.request('GET', `/contradictions${qs}`);
  }

  async getContradiction(id: string): Promise<unknown> {
    return this.request('GET', `/contradictions/${id}`);
  }

  // ── Branches ────────────────────────────────────────────────

  async getBranches(status?: 'OPEN' | 'RESOLVED' | 'MERGED' | 'REJECTED'): Promise<unknown[]> {
    const qs = status ? `?status=${status}` : '';
    return this.request('GET', `/branches${qs}`);
  }

  async getBranch(id: string): Promise<unknown> {
    return this.request('GET', `/branches/${id}`);
  }

  // ── Action Validation ───────────────────────────────────────

  /**
   * Validate an action before executing it.
   * Returns the validation result including:
   *   - admissibility: VALID | RISKY | BLOCKED | BRANCH_DEPENDENT
   *   - deltaPhi: coherence cost
   *   - psiScore: inconsistency score
   *   - reasons: explanation
   */
  async validateAction(input: ActionInput): Promise<{
    proposal: unknown;
    validation: {
      admissibility: string;
      deltaPhi: number;
      psiScore: number;
      constraintViolationRisk: number;
      dependencyBreakageRisk: number;
      contradictionAmplification: number;
      uncertaintyExposure: number;
      provenanceFragility: number;
      impactedEntityIds: string[];
      reasons: string[];
    };
  }> {
    return this.request('POST', '/actions/validate', {
      ...input,
      sourceName: this.config.agentName ?? 'sdk-agent',
    });
  }

  // ── World Coherence ─────────────────────────────────────────

  async getCoherenceScore(): Promise<CoherenceScore> {
    return this.request('GET', '/world/coherence');
  }

  async getWorldSnapshot(): Promise<unknown> {
    return this.request('GET', '/world/snapshot');
  }

  async triggerSettling(): Promise<unknown> {
    return this.request('POST', '/world/settle');
  }

  // ── Search ──────────────────────────────────────────────────

  async search(query: string, type?: 'entity' | 'claim' | 'all'): Promise<{
    entities: unknown[];
    claims: unknown[];
  }> {
    const qs = `?q=${encodeURIComponent(query)}${type ? `&type=${type}` : ''}`;
    return this.request('GET', `/search${qs}`);
  }

  // ── Health ──────────────────────────────────────────────────

  async health(): Promise<{ status: string; timestamp: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }
}

// Factory function for convenience
export function createCoherenceClient(config: CoherenceSDKConfig): CoherenceEngineSDK {
  return new CoherenceEngineSDK(config);
}

export default CoherenceEngineSDK;
