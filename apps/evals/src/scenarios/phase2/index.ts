/**
 * Phase 2 Scenario Registry
 *
 * Exports all 165 Phase 2 scenarios across 8 benchmark families:
 *   calibration   (40)  — action admissibility calibration
 *   staleness     (25)  — stale-claim stress tests
 *   provenance    (20)  — provenance fragility
 *   settling      (25)  — fixed-point settling vs single-pass
 *   budget        (20)  — coherence budget (DeltaPhi)
 *   branching_ext (20)  — extended branching
 *   signed_deps   (20)  — signed dependency invalidation
 *   long_horizon  (15)  — multi-update horizon
 */

import { ScenarioV2, ScenarioFamily } from '../types';
import { generateCalibrationScenarios } from './calibration.js';
import { generateStalenessScenarios } from './staleness.js';
import { generateProvenanceScenarios } from './provenance.js';
import { generateSettlingScenarios } from './settling.js';
import { generateBudgetScenarios } from './budget.js';
import { generateBranchingScenarios } from './branching.js';
import { generateSignedDepsScenarios } from './signed-deps.js';
import { generateLongHorizonScenarios } from './long-horizon.js';

export function generateAllScenariosV2(): ScenarioV2[] {
  return [
    ...generateCalibrationScenarios(),
    ...generateStalenessScenarios(),
    ...generateProvenanceScenarios(),
    ...generateSettlingScenarios(),
    ...generateBudgetScenarios(),
    ...generateBranchingScenarios(),
    ...generateSignedDepsScenarios(),
    ...generateLongHorizonScenarios(),
  ];
}

export function getScenariosByFamily(family: ScenarioFamily): ScenarioV2[] {
  return generateAllScenariosV2().filter(s => s.familyId === family);
}

export function getScenarioById(id: string): ScenarioV2 | undefined {
  return generateAllScenariosV2().find(s => s.id === id);
}

/** Summary of scenario counts per family. */
export function getPhase2Summary(): Record<string, number> {
  const all = generateAllScenariosV2();
  const summary: Record<string, number> = {};
  for (const s of all) {
    summary[s.familyId] = (summary[s.familyId] ?? 0) + 1;
  }
  return summary;
}

// Re-export individual generators for selective use
export {
  generateCalibrationScenarios,
  generateStalenessScenarios,
  generateProvenanceScenarios,
  generateSettlingScenarios,
  generateBudgetScenarios,
  generateBranchingScenarios,
  generateSignedDepsScenarios,
  generateLongHorizonScenarios,
};
