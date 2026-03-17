/**
 * Engine Evaluators — Full system + 6 ablations.
 *
 * Each evaluator is a named function that takes a Scenario and returns
 * an EvaluationResult. The evaluatorId identifies which variant ran.
 *
 * Ablation matrix:
 *   1. no_branching      — contradictions flagged but no branches created
 *   2. no_settling       — single pass only, no iterative convergence
 *   3. unsigned_deps     — all dependencies treated as SUPPORTS
 *   4. no_provenance     — mu5=0 in Psi (no provenance fragility scoring)
 *   5. no_staleness      — lambda_s=0, all claims equally weighted
 *   6. no_budget         — DeltaPhi budget=Infinity, only Psi enforced
 */

import { engineConfig } from '../../../api/src/infrastructure/config.js';
import { runScenarioThroughEngine, type HarnessConfig } from './harness.js';
import type { Scenario, EvaluationResult } from '../scenarios/types.js';

export interface Evaluator {
  id: string;
  name: string;
  description: string;
  run(scenario: Scenario, namespace: string): Promise<EvaluationResult>;
}

// ── Full Engine ────────────────────────────────────────────────

export const fullEngineEvaluator: Evaluator = {
  id: 'engine_full',
  name: 'Full Coherence Engine',
  description: 'Complete engine: branching + settling + signed deps + provenance + staleness + budget',

  async run(scenario, namespace) {
    const result = await runScenarioThroughEngine(scenario, { engineConfig }, namespace);
    return { ...result, evaluatorId: this.id };
  },
};

// ── Ablation 1: No Branching ───────────────────────────────────

export const noBranchingEvaluator: Evaluator = {
  id: 'ablation_no_branching',
  name: 'Ablation: No Branching',
  description: 'Contradictions flagged but no branches created. Tests if explicit branching adds value.',

  async run(scenario, namespace) {
    const cfg: HarnessConfig = {
      engineConfig: { ...engineConfig, branchThreshold: Infinity }, // never branch
      noBranching: true,
    };
    const result = await runScenarioThroughEngine(scenario, cfg, namespace);
    return { ...result, evaluatorId: this.id };
  },
};

// ── Ablation 2: No Settling (single pass) ─────────────────────

export const noSettlingEvaluator: Evaluator = {
  id: 'ablation_no_settling',
  name: 'Ablation: No Fixed-Point Settling',
  description: 'Single reconciliation pass only — no iterative convergence. Tests if settling loop matters.',

  async run(scenario, namespace) {
    const cfg: HarnessConfig = {
      engineConfig,
      singlePassOnly: true,
    };
    const result = await runScenarioThroughEngine(scenario, cfg, namespace);
    return { ...result, evaluatorId: this.id };
  },
};

// ── Ablation 3: Unsigned Dependencies ─────────────────────────

export const unsignedDepsEvaluator: Evaluator = {
  id: 'ablation_unsigned_deps',
  name: 'Ablation: Unsigned Dependencies',
  description: 'All dependencies treated as SUPPORTS — no INVALIDATES, REQUIRES, etc. Tests signed dep value.',

  async run(scenario, namespace) {
    const cfg: HarnessConfig = {
      engineConfig,
      unsignedDepsOnly: true,
    };
    const result = await runScenarioThroughEngine(scenario, cfg, namespace);
    return { ...result, evaluatorId: this.id };
  },
};

// ── Ablation 4: No Provenance ──────────────────────────────────

export const noProvenanceEvaluator: Evaluator = {
  id: 'ablation_no_provenance',
  name: 'Ablation: No Provenance',
  description: 'ProvenanceFragility scoring disabled (mu5=0). Tests if provenance-aware validation matters.',

  async run(scenario, namespace) {
    const cfg: HarnessConfig = {
      engineConfig: {
        ...engineConfig,
        actionWeights: { ...engineConfig.actionWeights, mu5: 0 },
      },
      noProvenance: true,
    };
    const result = await runScenarioThroughEngine(scenario, cfg, namespace);
    return { ...result, evaluatorId: this.id };
  },
};

// ── Ablation 5: No Staleness ───────────────────────────────────

export const noStalenessEvaluator: Evaluator = {
  id: 'ablation_no_staleness',
  name: 'Ablation: No Staleness',
  description: 'All claims treated as equally fresh (lambda_s=0). Tests if temporal decay matters.',

  async run(scenario, namespace) {
    const cfg: HarnessConfig = {
      engineConfig,
      noStaleness: true,
    };
    const result = await runScenarioThroughEngine(scenario, cfg, namespace);
    return { ...result, evaluatorId: this.id };
  },
};

// ── Ablation 6: No Budget ──────────────────────────────────────

export const noBudgetEvaluator: Evaluator = {
  id: 'ablation_no_budget',
  name: 'Ablation: No Coherence Budget',
  description: 'DeltaPhi budget=Infinity — only Psi threshold enforced. Tests if DeltaPhi adds structure.',

  async run(scenario, namespace) {
    const cfg: HarnessConfig = {
      engineConfig: { ...engineConfig, actionBudget: Infinity },
      noBudget: true,
    };
    const result = await runScenarioThroughEngine(scenario, cfg, namespace);
    return { ...result, evaluatorId: this.id };
  },
};

// ── All Engine Evaluators ──────────────────────────────────────

export const allEngineEvaluators: Evaluator[] = [
  fullEngineEvaluator,
  noBranchingEvaluator,
  noSettlingEvaluator,
  unsignedDepsEvaluator,
  noProvenanceEvaluator,
  noStalenessEvaluator,
  noBudgetEvaluator,
];

export const ablationEvaluators: Evaluator[] = [
  noBranchingEvaluator,
  noSettlingEvaluator,
  unsignedDepsEvaluator,
  noProvenanceEvaluator,
  noStalenessEvaluator,
  noBudgetEvaluator,
];
