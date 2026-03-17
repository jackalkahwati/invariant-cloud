/**
 * LLM Baseline Evaluators A, B, C, D
 *
 * Each calls Claude with a different information presentation and parses
 * the structured JSON response. The LLM is asked to output the same
 * schema as the engine so we can score all systems on the same metrics.
 *
 * Important: These baselines are designed to be *fair* to the LLM —
 * good prompts, full context in A, etc. The goal is to test whether
 * the architecture adds value over a competent LLM, not to rig the comparison.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Scenario, EvaluationResult, ActionAdmissibility } from '../scenarios/types.js';
import type { Evaluator } from '../engine/evaluators.js';
import {
  buildPlainLLMPrompt,
  buildRAGPrompt,
  buildMemoryStorePrompt,
  buildRulesOnlyPrompt,
  SYSTEM_PROMPT,
} from './prompts.js';

// Parse LLM JSON response robustly
interface LLMResponse {
  contradictionsDetected: Array<{ description: string; entityName?: string; predicate?: string }>;
  branchCreated: boolean;
  actionAdmissibility: string;
  invalidatedEntityNames: string[];
  explanation: string;
}

async function callClaude(
  client: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  model = 'claude-haiku-4-5-20251001',
): Promise<LLMResponse> {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1]! : text;

  try {
    const parsed = JSON.parse(jsonStr.trim()) as Partial<LLMResponse>;
    return {
      contradictionsDetected: parsed.contradictionsDetected ?? [],
      branchCreated: parsed.branchCreated ?? false,
      actionAdmissibility: parsed.actionAdmissibility ?? 'UNKNOWN',
      invalidatedEntityNames: parsed.invalidatedEntityNames ?? [],
      explanation: parsed.explanation ?? text,
    };
  } catch {
    // If JSON parsing fails, extract what we can from text
    const admissibility = text.includes('BLOCKED') ? 'BLOCKED'
      : text.includes('RISKY') ? 'RISKY'
      : text.includes('BRANCH_DEPENDENT') ? 'BRANCH_DEPENDENT'
      : text.includes('VALID') ? 'VALID'
      : 'UNKNOWN';

    return {
      contradictionsDetected: [],
      branchCreated: text.toLowerCase().includes('branch'),
      actionAdmissibility: admissibility,
      invalidatedEntityNames: [],
      explanation: text,
    };
  }
}

function makeLLMEvaluator(
  id: string,
  name: string,
  description: string,
  buildPrompt: (scenario: Scenario) => string,
  client: Anthropic,
): Evaluator {
  return {
    id,
    name,
    description,

    async run(scenario: Scenario): Promise<EvaluationResult> {
      const start = Date.now();

      try {
        const userPrompt = buildPrompt(scenario);
        const llmResponse = await callClaude(client, SYSTEM_PROMPT, userPrompt);

        return {
          scenarioId: scenario.id,
          evaluatorId: id,
          durationMs: Date.now() - start,
          contradictionsDetected: llmResponse.contradictionsDetected,
          branchCreated: llmResponse.branchCreated,
          actionAdmissibility: llmResponse.actionAdmissibility as ActionAdmissibility,
          invalidatedEntityNames: llmResponse.invalidatedEntityNames,
          explanation: llmResponse.explanation,
          rawOutput: llmResponse,
        };
      } catch (err) {
        return {
          scenarioId: scenario.id,
          evaluatorId: id,
          durationMs: Date.now() - start,
          error: String(err),
          contradictionsDetected: [],
          branchCreated: false,
          actionAdmissibility: 'UNKNOWN',
          invalidatedEntityNames: [],
          explanation: `Error: ${String(err)}`,
        };
      }
    },
  };
}

export function createLLMBaselines(apiKey: string): Evaluator[] {
  const client = new Anthropic({ apiKey });

  return [
    makeLLMEvaluator(
      'baseline_a_plain_llm',
      'Baseline A: Plain LLM',
      'All facts in a single prompt. No structure, no retrieval, no graph.',
      buildPlainLLMPrompt,
      client,
    ),
    makeLLMEvaluator(
      'baseline_b_rag',
      'Baseline B: LLM + RAG',
      'Retrieval-augmented: only top-k facts relevant to impacted entities are provided.',
      buildRAGPrompt,
      client,
    ),
    makeLLMEvaluator(
      'baseline_c_memory',
      'Baseline C: LLM + Memory Store',
      'Summarized entity state (most recent claim per predicate). No conflicting history visible.',
      buildMemoryStorePrompt,
      client,
    ),
    makeLLMEvaluator(
      'baseline_d_rules',
      'Baseline D: Rules Without Settling',
      'Structured rules + single-hop deps. No branching, no iterative propagation, no coherence budget.',
      buildRulesOnlyPrompt,
      client,
    ),
  ];
}
