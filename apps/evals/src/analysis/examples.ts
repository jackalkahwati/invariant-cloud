/**
 * False Positive / False Negative Example Surfacing
 *
 * Identifies the most informative misclassification examples,
 * especially BLOCKED predicted as RISKY (dangerous false negatives).
 */

import type {
  ScenarioV2, EvaluationResult, ExampleFinding, ActionAdmissibility,
} from '../scenarios/types.js';

// ── Collect FP/FN examples ────────────────────────────────────────────────────

export function collectExamples(
  pairs: Array<{ scenario: ScenarioV2; result: EvaluationResult }>,
): ExampleFinding[] {
  const findings: ExampleFinding[] = [];

  for (const { scenario, result } of pairs) {
    const actual = scenario.expectedAction;
    const predicted = (result.actionAdmissibility ?? 'UNKNOWN') as ActionAdmissibility | 'UNKNOWN';

    if (predicted === actual) continue; // correct — skip

    const raw = result.rawScores;
    const finding: ExampleFinding = {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      familyId: scenario.familyId,
      evaluatorId: result.evaluatorId,
      actual,
      predicted,
      psiScore: raw?.psiScore ?? -1,
      deltaPhi: raw?.deltaPhi ?? -1,
      psiComponents: raw ? {
        constraintViolationRisk: raw.constraintViolationRisk,
        dependencyBreakageRisk: raw.dependencyBreakageRisk,
        contradictionAmplification: raw.contradictionAmplification,
        uncertaintyExposure: raw.uncertaintyExposure,
        provenanceFragility: raw.provenanceFragility,
      } : undefined,
      explanation: result.explanation,
      recommendation: deriveRecommendation(actual, predicted, raw),
    };

    findings.push(finding);
  }

  return findings;
}

// ── Filter to critical FN: BLOCKED predicted as RISKY or VALID ────────────────

export function getCriticalFalseNegatives(findings: ExampleFinding[]): ExampleFinding[] {
  return findings.filter(
    f => f.actual === 'BLOCKED' && (f.predicted === 'RISKY' || f.predicted === 'VALID')
  );
}

export function getFalsePositives(findings: ExampleFinding[]): ExampleFinding[] {
  return findings.filter(
    f => f.actual !== 'BLOCKED' && f.predicted === 'BLOCKED'
  );
}

export function getRiskyMisclassified(findings: ExampleFinding[]): ExampleFinding[] {
  return findings.filter(f => f.actual === 'RISKY' || f.predicted === 'RISKY');
}

// ── Recommendation derivation ─────────────────────────────────────────────────

function deriveRecommendation(
  actual: ActionAdmissibility,
  predicted: ActionAdmissibility | 'UNKNOWN',
  raw?: { psiScore: number; deltaPhi: number; constraintViolationRisk?: number; dependencyBreakageRisk?: number },
): string {
  if (actual === 'BLOCKED' && predicted === 'RISKY') {
    if (raw) {
      const cvr = raw.constraintViolationRisk ?? 0;
      const dbr = raw.dependencyBreakageRisk ?? 0;
      if (cvr < 0.1 && dbr < 0.1) {
        return `CVR=${cvr.toFixed(3)} DBR=${dbr.toFixed(3)} both near 0: check that impacted entities match violating entities. ` +
               `Lower epsilon from 0.6 → 0.35 to catch Psi=${raw.psiScore.toFixed(3)}.`;
      }
      if (raw.psiScore < 0.6 && raw.deltaPhi < 5.0) {
        return `Psi=${raw.psiScore.toFixed(3)} and DeltaPhi=${raw.deltaPhi.toFixed(3)} both below thresholds. ` +
               `Reduce epsilon to ${(raw.psiScore * 0.9).toFixed(2)} to catch this case.`;
      }
    }
    return 'BLOCKED misclassified as RISKY — consider lowering epsilon threshold.';
  }

  if (actual === 'BLOCKED' && predicted === 'VALID') {
    if (raw && raw.psiScore < 0.1) {
      return `Psi ≈ 0: all Psi components are near-zero. This likely indicates a scoping bug ` +
             `where the impacted entities do not include the constrained entity. ` +
             `Verify impactedEntityNames includes the entity with the constraint violation.`;
    }
    return 'BLOCKED misclassified as VALID — severe underfitting. Check impacted entity scoping.';
  }

  if (actual === 'VALID' && predicted === 'BLOCKED') {
    return 'VALID misclassified as BLOCKED — false alarm. Consider raising epsilon or budget thresholds.';
  }

  if (actual === 'RISKY' && predicted === 'BLOCKED') {
    return 'RISKY over-classified as BLOCKED. Engine is too sensitive — consider raising epsilon slightly.';
  }

  if (actual === 'RISKY' && predicted === 'VALID') {
    if (raw && raw.psiScore < 0.35) {
      return `Psi=${raw.psiScore.toFixed(3)} below RISKY band. Lower epsilon to 0.35 to capture this borderline case.`;
    }
    return 'RISKY under-classified as VALID. Lower epsilon threshold.';
  }

  if (actual === 'BRANCH_DEPENDENT' && predicted !== 'BRANCH_DEPENDENT') {
    return 'Open branch not detected. Check branch detection logic for this scenario.';
  }

  return `Misclassification: actual=${actual}, predicted=${predicted}.`;
}

// ── Render FP/FN report ───────────────────────────────────────────────────────

export function renderExamplesReport(findings: ExampleFinding[]): string {
  if (findings.length === 0) return '  (none)';

  const lines: string[] = [];

  const critFN = getCriticalFalseNegatives(findings);
  const fps = getFalsePositives(findings);
  const other = findings.filter(f => !critFN.includes(f) && !fps.includes(f));

  if (critFN.length > 0) {
    lines.push('  ── Critical False Negatives (BLOCKED → predicted RISKY or VALID) ──');
    lines.push('');
    for (const f of critFN) {
      lines.push(...renderFinding(f));
      lines.push('');
    }
  }

  if (fps.length > 0) {
    lines.push('  ── False Positives (non-BLOCKED → predicted BLOCKED) ──');
    lines.push('');
    for (const f of fps) {
      lines.push(...renderFinding(f));
      lines.push('');
    }
  }

  if (other.length > 0) {
    lines.push('  ── Other Misclassifications ──');
    lines.push('');
    for (const f of other) {
      lines.push(...renderFinding(f));
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderFinding(f: ExampleFinding): string[] {
  const lines: string[] = [];
  lines.push(`  [${f.scenarioId}] ${f.scenarioName}`);
  lines.push(`    Family: ${f.familyId}  |  Actual: ${f.actual}  Predicted: ${f.predicted}`);

  if (f.psiScore >= 0) {
    lines.push(`    Psi=${f.psiScore.toFixed(4)}  DeltaPhi=${f.deltaPhi.toFixed(4)}`);
    if (f.psiComponents) {
      const c = f.psiComponents;
      lines.push(
        `    Components: CVR=${(c.constraintViolationRisk ?? 0).toFixed(3)} ` +
        `DBR=${(c.dependencyBreakageRisk ?? 0).toFixed(3)} ` +
        `CA=${(c.contradictionAmplification ?? 0).toFixed(3)} ` +
        `UE=${(c.uncertaintyExposure ?? 0).toFixed(3)} ` +
        `PF=${(c.provenanceFragility ?? 0).toFixed(3)}`
      );
    }
  }

  lines.push(`    Explanation: ${f.explanation.slice(0, 120)}${f.explanation.length > 120 ? '…' : ''}`);
  lines.push(`    → ${f.recommendation}`);
  return lines;
}

// ── Summary statistics ────────────────────────────────────────────────────────

export function examplesSummary(findings: ExampleFinding[]): string {
  const critFN = getCriticalFalseNegatives(findings);
  const fps = getFalsePositives(findings);
  const total = findings.length;

  const lines = [
    `Total misclassifications: ${total}`,
    `  Critical FN (BLOCKED→RISKY/VALID): ${critFN.length}`,
    `  False Positives (→BLOCKED):        ${fps.length}`,
    `  Other:                             ${total - critFN.length - fps.length}`,
  ];

  if (critFN.length > 0) {
    const psiVals = critFN.filter(f => f.psiScore >= 0).map(f => f.psiScore);
    const avgPsi = psiVals.length > 0 ? psiVals.reduce((s, v) => s + v, 0) / psiVals.length : 0;
    lines.push(`  Avg Psi for critical FN: ${avgPsi.toFixed(4)}`);
    lines.push(`  → These require epsilon ≤ ${(avgPsi * 1.1).toFixed(2)} to be correctly classified`);
  }

  return lines.join('\n');
}
