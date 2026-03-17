/**
 * Prompt construction for LLM baselines.
 *
 * Each baseline variant gets a different view of the same scenario:
 *   A: All facts in one prompt (no structure)
 *   B: Facts + simulated RAG retrieval (top-k relevant)
 *   C: Structured memory summary (entities + most recent claims)
 *   D: Structured graph (rules without settling — no branching, no coherence)
 */

import type { Scenario } from '../scenarios/types.js';

export const SYSTEM_PROMPT = `You are a system that analyzes world state information and determines whether a proposed action is safe to execute. You must:

1. Detect any contradictions in the provided facts
2. Identify if any branching (parallel realities) is needed
3. Classify the proposed action as: VALID, RISKY, BLOCKED, or BRANCH_DEPENDENT
4. Identify any entities that should be considered invalidated
5. Provide reasoning

Respond in this exact JSON format:
{
  "contradictionsDetected": [
    { "description": "...", "entityName": "...", "predicate": "..." }
  ],
  "branchCreated": true | false,
  "actionAdmissibility": "VALID" | "RISKY" | "BLOCKED" | "BRANCH_DEPENDENT",
  "invalidatedEntityNames": ["..."],
  "explanation": "..."
}`;

// ── Baseline A: Plain LLM ─────────────────────────────────────

export function buildPlainLLMPrompt(scenario: Scenario): string {
  const facts: string[] = [];

  for (const claim of scenario.claims) {
    const age = claim.ageSeconds
      ? ` [asserted ${Math.abs(claim.ageSeconds)} seconds ago]`
      : '';
    facts.push(`- ${claim.entityName}.${claim.predicate} = ${JSON.stringify(claim.value)} (confidence: ${claim.confidence ?? 0.9}, source: ${claim.sourceName ?? 'system'}${age})`);
  }

  const constraints = scenario.constraints.map(c =>
    `- ${c.name}: ${c.description}`
  );

  const deps = scenario.dependencies.map(d =>
    `- ${d.fromEntityName} --[${d.type}]--> ${d.toEntityName}: ${d.description ?? ''}`
  );

  return `Scenario: ${scenario.description}

FACTS:
${facts.join('\n')}

CONSTRAINTS:
${constraints.join('\n')}

DEPENDENCIES:
${deps.join('\n')}

PROPOSED ACTION:
Operation: ${scenario.proposedAction.operation}
Description: ${scenario.proposedAction.description}
Impacted entities: ${scenario.proposedAction.impactedEntityNames.join(', ')}

Analyze the facts and determine if the proposed action is safe to execute.`;
}

// ── Baseline B: LLM + RAG ─────────────────────────────────────

/**
 * Simulates RAG by retrieving only the most "relevant" facts to the proposed action.
 * Relevance = mentions any of the impacted entity names.
 * This tests whether retrieval-only approaches miss global context.
 */
export function buildRAGPrompt(scenario: Scenario): string {
  const impactedNames = new Set(scenario.proposedAction.impactedEntityNames.map(n => n.toLowerCase()));

  // Retrieve: claims, constraints, deps that mention impacted entities
  const retrievedClaims = scenario.claims.filter(c =>
    impactedNames.has(c.entityName.toLowerCase())
  );

  // Top-k = min(8, relevant) to simulate realistic RAG
  const topK = retrievedClaims.slice(0, 8);

  // Also retrieve directly referenced constraints
  const retrievedConstraints = scenario.constraints.filter(c =>
    (c.entityNames ?? []).some(n => impactedNames.has(n.toLowerCase()))
  );

  const retrievedDeps = scenario.dependencies.filter(d =>
    impactedNames.has(d.fromEntityName.toLowerCase()) || impactedNames.has(d.toEntityName.toLowerCase())
  );

  const facts = topK.map(c =>
    `- ${c.entityName}.${c.predicate} = ${JSON.stringify(c.value)} (confidence: ${c.confidence ?? 0.9}, source: ${c.sourceName ?? 'system'})`
  );

  const constraints = retrievedConstraints.map(c => `- ${c.name}: ${c.description}`);
  const deps = retrievedDeps.map(d => `- ${d.fromEntityName} --[${d.type}]--> ${d.toEntityName}`);

  const totalFacts = scenario.claims.length;
  const retrieved = topK.length;

  return `Scenario: ${scenario.description}

[RAG: Retrieved ${retrieved} of ${totalFacts} facts relevant to the proposed action]

RETRIEVED FACTS:
${facts.join('\n') || '(none retrieved)'}

RETRIEVED CONSTRAINTS:
${constraints.join('\n') || '(none)'}

RETRIEVED DEPENDENCIES:
${deps.join('\n') || '(none)'}

PROPOSED ACTION:
Operation: ${scenario.proposedAction.operation}
Description: ${scenario.proposedAction.description}
Impacted entities: ${scenario.proposedAction.impactedEntityNames.join(', ')}

Based on the retrieved context, analyze if the proposed action is safe.`;
}

// ── Baseline C: LLM + Memory Store ───────────────────────────

/**
 * Simulates a memory store: most recent state per entity (no history),
 * plus summarized constraints (no raw expression).
 * Tests whether summarized memory misses conflict signals.
 */
export function buildMemoryStorePrompt(scenario: Scenario): string {
  // Build "current state" per entity: take latest claim per predicate
  const entityState = new Map<string, Map<string, unknown>>();

  // Sort by ageSeconds ascending so most recent comes last
  const sorted = [...scenario.claims].sort(
    (a, b) => (a.ageSeconds ?? 0) - (b.ageSeconds ?? 0)
  );

  for (const c of sorted) {
    if (!entityState.has(c.entityName)) entityState.set(c.entityName, new Map());
    entityState.get(c.entityName)!.set(c.predicate, c.value);
  }

  const memoryLines: string[] = [];
  for (const [entityName, predicates] of entityState) {
    const state = [...predicates.entries()].map(([p, v]) => `${p}=${JSON.stringify(v)}`).join(', ');
    memoryLines.push(`${entityName}: {${state}}`);
  }

  const constraintSummaries = scenario.constraints.map(c =>
    `- ${c.name}: ${c.description}`
  );

  // NOTE: memory store intentionally does NOT show conflicting claims from different sources
  // — this is the key weakness being tested

  return `Scenario: ${scenario.description}

[MEMORY STORE: Current entity state (most recent claim per predicate, no history)]

CURRENT WORLD STATE:
${memoryLines.join('\n')}

ACTIVE CONSTRAINTS:
${constraintSummaries.join('\n')}

DEPENDENCIES (summary):
${scenario.dependencies.map(d => `- ${d.fromEntityName} → ${d.toEntityName} [${d.type}]`).join('\n')}

PROPOSED ACTION:
Operation: ${scenario.proposedAction.operation}
Description: ${scenario.proposedAction.description}
Impacted entities: ${scenario.proposedAction.impactedEntityNames.join(', ')}

Based on current memory state, analyze if this action is safe.`;
}

// ── Baseline D: Rules Without Settling ───────────────────────

/**
 * Structured rules + graph, but:
 *   - No branch creation (just flag conflicts)
 *   - No iterative settling (single-hop check only)
 *   - No coherence budget (binary valid/invalid)
 *   - No provenance scoring
 * Tests if the architecture beats a pure rule-check approach.
 */
export function buildRulesOnlyPrompt(scenario: Scenario): string {
  const facts = scenario.claims.map(c =>
    `- ${c.entityName}.${c.predicate} = ${JSON.stringify(c.value)} (confidence: ${c.confidence ?? 0.9})`
  );

  const rules = scenario.constraints.map(c => `- RULE: ${c.description}`);

  const deps = scenario.dependencies.map(d =>
    `- ${d.fromEntityName} --[${d.type}]--> ${d.toEntityName}`
  );

  return `Scenario: ${scenario.description}

[RULE-BASED SYSTEM: Check each rule independently. Do NOT create branches. Do NOT propagate multi-hop chains. Just check direct constraint violations.]

CURRENT FACTS:
${facts.join('\n')}

RULES TO CHECK:
${rules.join('\n')}

DIRECT DEPENDENCIES (single hop only):
${deps.join('\n')}

PROPOSED ACTION:
Operation: ${scenario.proposedAction.operation}
Description: ${scenario.proposedAction.description}
Impacted entities: ${scenario.proposedAction.impactedEntityNames.join(', ')}

Check each rule independently. Flag any direct violations. Classify the action.`;
}
