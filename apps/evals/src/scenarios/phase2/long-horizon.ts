/**
 * Phase 2 — Long-Horizon Multi-Update Scenarios
 *
 * Tests the engine's ability to track coherence over sequences of updates.
 * Each scenario simulates a series of state changes and asks whether
 * a final action should be admitted given the cumulative history.
 *
 * Key patterns:
 *  - Gradual degradation: each update worsens a metric slightly
 *  - Recovery trajectory: system improving over sequence of updates
 *  - Oscillation: system bouncing around threshold
 *  - Compound effects: multiple independent degradations compound
 *
 * 15 scenarios: 5 BLOCKED · 5 RISKY · 5 VALID
 */

import { ScenarioV2, ScenarioFamily } from '../types';

const FAMILY: ScenarioFamily = 'long_horizon';

// ─── BLOCKED (5) — cumulative state worsens across update sequence ─────────────

const longHorizonBlocked: ScenarioV2[] = [
  {
    id: 'lhz-blk-001',
    name: 'Gradual CPU degradation: 5-update sequence ending in violation',
    description:
      'SystemCore.cpu_load_pct progressed: 60 → 72 → 81 → 88 → 97 over 5 updates. ' +
      'Final state 97 violates <= 90. Action approve_workload at end of sequence → BLOCKED.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'gradual_degradation', 'multi_update'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'system-core', name: 'SystemCore', type: 'system' }],
      claims: [
        { entityId: 'system-core', attribute: 'cpu_load_pct', value: '97', confidence: 0.97, source: 'monitor-t5' },
        { entityId: 'system-core', attribute: 'update_sequence', value: '5', confidence: 0.99, source: 'event-log' },
      ],
      constraints: [
        { entityId: 'system-core', attribute: 'cpu_load_pct', operator: '<=', threshold: 90, description: 'CPU cap' },
      ],
      updateHistory: [
        { entityId: 'system-core', attribute: 'cpu_load_pct', values: ['60', '72', '81', '88', '97'], timestamps_s: [0, 300, 600, 900, 1200] },
      ],
      actions: [{ id: 'approve_workload', name: 'approve_workload', impactedEntityNames: ['SystemCore'] }],
    },
  },

  {
    id: 'lhz-blk-002',
    name: 'Compound degradation: 3 independent metrics all degrade to violation',
    description:
      'DataCluster: over 6 updates, cpu_load_pct, memory_used_pct, and error_rate ' +
      'all independently degrade to violate their constraints simultaneously.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'compound_degradation', 'multi_metric'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'data-cluster', name: 'DataCluster', type: 'system' }],
      claims: [
        { entityId: 'data-cluster', attribute: 'cpu_load_pct', value: '94', confidence: 0.97, source: 'cluster-mon' },
        { entityId: 'data-cluster', attribute: 'memory_used_pct', value: '93', confidence: 0.97, source: 'cluster-mon' },
        { entityId: 'data-cluster', attribute: 'error_rate', value: '0.08', confidence: 0.96, source: 'cluster-mon' },
      ],
      constraints: [
        { entityId: 'data-cluster', attribute: 'cpu_load_pct', operator: '<=', threshold: 85, description: 'CPU limit' },
        { entityId: 'data-cluster', attribute: 'memory_used_pct', operator: '<=', threshold: 85, description: 'Memory limit' },
        { entityId: 'data-cluster', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
      ],
      actions: [{ id: 'scale_cluster', name: 'scale_cluster', impactedEntityNames: ['DataCluster'] }],
    },
  },

  {
    id: 'lhz-blk-003',
    name: 'Oscillating metric crosses threshold: final state violates constraint',
    description:
      'ServiceEndpoint.error_rate oscillated: 0.02 → 0.07 → 0.03 → 0.09 → 0.12. ' +
      'Final state 0.12 violates <= 0.05. Despite prior recovery, current state BLOCKED.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'oscillation', 'final_state_violation'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'svc-endpoint', name: 'ServiceEndpoint', type: 'service' }],
      claims: [
        { entityId: 'svc-endpoint', attribute: 'error_rate', value: '0.12', confidence: 0.97, source: 'metrics-t5' },
      ],
      constraints: [
        { entityId: 'svc-endpoint', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
      ],
      updateHistory: [
        { entityId: 'svc-endpoint', attribute: 'error_rate', values: ['0.02', '0.07', '0.03', '0.09', '0.12'], timestamps_s: [0, 180, 360, 540, 720] },
      ],
      actions: [{ id: 'deploy_service', name: 'deploy_service', impactedEntityNames: ['ServiceEndpoint'] }],
    },
  },

  {
    id: 'lhz-blk-004',
    name: 'Provenance chain accumulates fragility over 4 updates',
    description:
      'ReportArtifact: each update added another derivation step. ' +
      'After 4 updates, provenanceConfidence = 0.06 (each step 0.5^4=0.0625). ' +
      'PF ≈ 0.94 + constraint violation → BLOCKED.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'provenance_accumulation', 'multi_update'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'report-artifact', name: 'ReportArtifact', type: 'artifact' }],
      claims: [
        {
          entityId: 'report-artifact',
          attribute: 'accuracy_score',
          value: '0.55',
          confidence: 0.3,
          source: 'derived-4hop',
          provenanceConfidence: 0.06,
        },
      ],
      constraints: [
        { entityId: 'report-artifact', attribute: 'accuracy_score', operator: '>=', threshold: 0.9, description: 'Report accuracy requirement' },
      ],
      actions: [{ id: 'release_report', name: 'release_report', impactedEntityNames: ['ReportArtifact'] }],
    },
  },

  {
    id: 'lhz-blk-005',
    name: 'Dependency graph grows to critical mass: final action on overloaded hub',
    description:
      'Over 5 update rounds, NetworkHub accumulated 4 constraint violations ' +
      'from progressive load increase. Final action reconfigure_hub → BLOCKED.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'progressive_overload', 'hub_overloaded'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'network-hub', name: 'NetworkHub', type: 'system' }],
      claims: [
        { entityId: 'network-hub', attribute: 'packet_loss_pct', value: '12', confidence: 0.97, source: 'nmon' },
        { entityId: 'network-hub', attribute: 'throughput_gbps', value: '1.8', confidence: 0.96, source: 'nmon' },
        { entityId: 'network-hub', attribute: 'cpu_load_pct', value: '96', confidence: 0.96, source: 'nmon' },
        { entityId: 'network-hub', attribute: 'active_sessions', value: '48000', confidence: 0.95, source: 'nmon' },
      ],
      constraints: [
        { entityId: 'network-hub', attribute: 'packet_loss_pct', operator: '<=', threshold: 2, description: 'Max packet loss' },
        { entityId: 'network-hub', attribute: 'throughput_gbps', operator: '>=', threshold: 8, description: 'Min throughput' },
        { entityId: 'network-hub', attribute: 'cpu_load_pct', operator: '<=', threshold: 85, description: 'CPU cap' },
        { entityId: 'network-hub', attribute: 'active_sessions', operator: '<=', threshold: 40000, description: 'Max sessions' },
      ],
      actions: [{ id: 'reconfigure_hub', name: 'reconfigure_hub', impactedEntityNames: ['NetworkHub'] }],
    },
  },
];

// ─── RISKY (5) — cumulative state is concerning but not yet violated ──────────

const longHorizonRisky: ScenarioV2[] = [
  {
    id: 'lhz-rsk-001',
    name: 'Upward trend: 3 updates trending toward constraint boundary',
    description:
      'ComputeNode.cpu_load_pct: 55 → 68 → 76 (trend toward 85 limit). ' +
      'Still within constraint but trajectory alarming. RISKY.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'upward_trend', 'approaching_threshold'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'compute-node', name: 'ComputeNode', type: 'system' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'compute-node', attribute: 'cpu_load_pct', value: '76', confidence: 0.95, source: 'monitor-t3' },
      ],
      constraints: [
        { entityId: 'compute-node', attribute: 'cpu_load_pct', operator: '<=', threshold: 85, description: 'CPU cap' },
      ],
      updateHistory: [
        { entityId: 'compute-node', attribute: 'cpu_load_pct', values: ['55', '68', '76'], timestamps_s: [0, 600, 1200] },
      ],
      dependencies: [
        { fromEntityId: 'compute-node', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      actions: [{ id: 'run_batch_job', name: 'run_batch_job', impactedEntityNames: ['ComputeNode'] }],
    },
  },

  {
    id: 'lhz-rsk-002',
    name: 'Intermittent violations: occasional crossings, currently within range',
    description:
      'ServiceInstance.error_rate: 0.01 → 0.06 (violated) → 0.02 → 0.07 (violated) → 0.03. ' +
      'Currently 0.03 (within SLO) but history shows instability. RISKY.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'intermittent_violation', 'unstable'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'svc-instance', name: 'ServiceInstance', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'svc-instance', attribute: 'error_rate', value: '0.03', confidence: 0.9, source: 'metrics' },
      ],
      constraints: [
        { entityId: 'svc-instance', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
      ],
      updateHistory: [
        { entityId: 'svc-instance', attribute: 'error_rate', values: ['0.01', '0.06', '0.02', '0.07', '0.03'], timestamps_s: [0, 180, 360, 540, 720] },
      ],
      dependencies: [
        { fromEntityId: 'svc-instance', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      actions: [{ id: 'approve_deployment', name: 'approve_deployment', impactedEntityNames: ['ServiceInstance'] }],
    },
  },

  {
    id: 'lhz-rsk-003',
    name: 'Stale data worsening over time: staleness accumulates',
    description:
      'MLModel metrics last refreshed t=1200s ago. Confidence was 0.95 but fell to 0.65 over time. ' +
      'Current UE = staleness(1200) × (1-0.65) ≈ 0.70 × 0.35 ≈ 0.25. RISKY.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'accumulating_staleness', 'confidence_decay'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'ml-model', name: 'MLModel', type: 'artifact' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'ml-model', attribute: 'accuracy', value: '0.92', confidence: 0.65, source: 'eval-pipeline', staleness_s: 1200 },
        { entityId: 'ml-model', attribute: 'f1_score', value: '0.91', confidence: 0.65, source: 'eval-pipeline', staleness_s: 1200 },
      ],
      constraints: [
        { entityId: 'ml-model', attribute: 'accuracy', operator: '>=', threshold: 0.9, description: 'Min accuracy' },
      ],
      dependencies: [
        { fromEntityId: 'ml-model', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      actions: [{ id: 'deploy_model', name: 'deploy_model', impactedEntityNames: ['MLModel'] }],
    },
  },

  {
    id: 'lhz-rsk-004',
    name: 'Multiple sequential config updates: net state has moderate risk',
    description:
      'Config entity updated 4 times. Each update reduced pool_size slightly. ' +
      'Current pool_size = 18 (above minimum 10), but downward trend. RISKY.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'sequential_config_updates', 'downward_trend'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'db-config', name: 'DatabaseConfig', type: 'system' },
        { id: 'service-target', name: 'ServiceTarget', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'db-config', attribute: 'pool_size', value: '18', confidence: 0.9, source: 'config-mgr-t4' },
        { entityId: 'service-target', attribute: 'ready_state', value: 'ok', confidence: 0.82, source: 'health-check' },
      ],
      constraints: [
        { entityId: 'db-config', attribute: 'pool_size', operator: '>=', threshold: 10, description: 'Min pool size' },
      ],
      updateHistory: [
        { entityId: 'db-config', attribute: 'pool_size', values: ['50', '35', '28', '18'], timestamps_s: [0, 600, 1200, 1800] },
      ],
      dependencies: [
        { fromEntityId: 'service-target', toEntityId: 'db-config', type: 'REQUIRES', attribute: 'pool_size' },
        { fromEntityId: 'service-target', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      actions: [{ id: 'deploy_service', name: 'deploy_service', impactedEntityNames: ['ServiceTarget'] }],
    },
  },

  {
    id: 'lhz-rsk-005',
    name: 'Long horizon: data system missing upstream dependency after updates',
    description:
      'Over 6 updates, DataSystem has accumulated stale data. ' +
      'DataSystem REQUIRES PrereqNode (no claims) → DBR fires → RISKY.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'dependency_break', 'multi_update'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'data-system', name: 'DataSystem', type: 'system' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'data-system', attribute: 'record_count', value: '1500000', confidence: 0.75, source: 'source-a', staleness_s: 1200 },
        { entityId: 'data-system', attribute: 'schema_hash', value: 'abc123', confidence: 0.8, source: 'schema-reg-a', staleness_s: 1200 },
      ],
      constraints: [],
      dependencies: [
        { fromEntityId: 'data-system', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      actions: [{ id: 'release_report', name: 'release_report', impactedEntityNames: ['DataSystem'] }],
    },
  },
];

// ─── VALID (5) — long trajectory remains stable, final state clean ─────────────

const longHorizonValid: ScenarioV2[] = [
  {
    id: 'lhz-vld-001',
    name: 'Stable metric over 5 updates: consistently within constraint',
    description:
      'SystemCore.cpu_load_pct: 45 → 42 → 48 → 44 → 41 over 5 updates. ' +
      'All within <= 90. Action approve_workload → VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'stable_trajectory', 'consistent'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'system-core', name: 'SystemCore', type: 'system' }],
      claims: [
        { entityId: 'system-core', attribute: 'cpu_load_pct', value: '41', confidence: 0.97, source: 'monitor-t5', staleness_s: 30 },
      ],
      constraints: [
        { entityId: 'system-core', attribute: 'cpu_load_pct', operator: '<=', threshold: 90, description: 'CPU cap' },
      ],
      updateHistory: [
        { entityId: 'system-core', attribute: 'cpu_load_pct', values: ['45', '42', '48', '44', '41'], timestamps_s: [0, 300, 600, 900, 1200] },
      ],
      actions: [{ id: 'approve_workload', name: 'approve_workload', impactedEntityNames: ['SystemCore'] }],
    },
  },

  {
    id: 'lhz-vld-002',
    name: 'Recovery trajectory: metric improved from near-violation to healthy',
    description:
      'ServiceEndpoint.error_rate: 0.08 → 0.05 → 0.03 → 0.01 over 4 updates. ' +
      'Currently 0.01, well within SLO. Action approve_deployment → VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'recovery_trajectory', 'improving'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'svc-endpoint', name: 'ServiceEndpoint', type: 'service' }],
      claims: [
        { entityId: 'svc-endpoint', attribute: 'error_rate', value: '0.01', confidence: 0.97, source: 'metrics-t4', staleness_s: 60 },
      ],
      constraints: [
        { entityId: 'svc-endpoint', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
      ],
      updateHistory: [
        { entityId: 'svc-endpoint', attribute: 'error_rate', values: ['0.08', '0.05', '0.03', '0.01'], timestamps_s: [0, 300, 600, 900] },
      ],
      actions: [{ id: 'approve_deployment', name: 'approve_deployment', impactedEntityNames: ['ServiceEndpoint'] }],
    },
  },

  {
    id: 'lhz-vld-003',
    name: 'Config updates all kept pool_size above minimum',
    description:
      'DatabaseConfig.pool_size: 80 → 75 → 70 → 65 over 4 updates. ' +
      'Still 65 >> minimum 10. ServiceTarget healthy. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'stable_config', 'above_minimum'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'db-config', name: 'DatabaseConfig', type: 'system' },
        { id: 'service-target', name: 'ServiceTarget', type: 'service' },
      ],
      claims: [
        { entityId: 'db-config', attribute: 'pool_size', value: '65', confidence: 0.97, source: 'config-mgr', staleness_s: 60 },
        { entityId: 'service-target', attribute: 'ready_state', value: 'ready', confidence: 0.95, source: 'health-check', staleness_s: 30 },
      ],
      constraints: [
        { entityId: 'db-config', attribute: 'pool_size', operator: '>=', threshold: 10, description: 'Min pool size' },
      ],
      dependencies: [
        { fromEntityId: 'service-target', toEntityId: 'db-config', type: 'REQUIRES', attribute: 'pool_size' },
      ],
      actions: [{ id: 'deploy_service', name: 'deploy_service', impactedEntityNames: ['ServiceTarget'] }],
    },
  },

  {
    id: 'lhz-vld-004',
    name: 'ML model freshly retrained: accuracy improved across all updates',
    description:
      'MLModel.accuracy: 0.88 → 0.91 → 0.94 → 0.97 across 3 retraining cycles. ' +
      'Current accuracy 0.97 satisfies >= 0.95. Fresh eval pipeline. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'improving_accuracy', 'ml'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'ml-model', name: 'MLModel', type: 'artifact' }],
      claims: [
        { entityId: 'ml-model', attribute: 'accuracy', value: '0.97', confidence: 0.96, source: 'eval-pipeline-t3', staleness_s: 120 },
      ],
      constraints: [
        { entityId: 'ml-model', attribute: 'accuracy', operator: '>=', threshold: 0.95, description: 'Target accuracy' },
      ],
      updateHistory: [
        { entityId: 'ml-model', attribute: 'accuracy', values: ['0.88', '0.91', '0.94', '0.97'], timestamps_s: [0, 3600, 7200, 10800] },
      ],
      actions: [{ id: 'deploy_model', name: 'deploy_model', impactedEntityNames: ['MLModel'] }],
    },
  },

  {
    id: 'lhz-vld-005',
    name: 'Complex system with 10 updates: all metrics remained stable',
    description:
      'ProductionSystem tracked over 10 update cycles. ' +
      'All 4 monitored metrics stayed well within constraints throughout. ' +
      'Final state clean, fresh claims. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'long_sequence', 'stable_multi_metric'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'prod-system', name: 'ProductionSystem', type: 'system' }],
      claims: [
        { entityId: 'prod-system', attribute: 'cpu_load_pct', value: '48', confidence: 0.97, source: 'monitor', staleness_s: 30 },
        { entityId: 'prod-system', attribute: 'memory_used_pct', value: '55', confidence: 0.97, source: 'monitor', staleness_s: 30 },
        { entityId: 'prod-system', attribute: 'error_rate', value: '0.002', confidence: 0.97, source: 'metrics', staleness_s: 15 },
        { entityId: 'prod-system', attribute: 'response_time_ms', value: '35', confidence: 0.96, source: 'bench', staleness_s: 60 },
      ],
      constraints: [
        { entityId: 'prod-system', attribute: 'cpu_load_pct', operator: '<=', threshold: 85, description: 'CPU cap' },
        { entityId: 'prod-system', attribute: 'memory_used_pct', operator: '<=', threshold: 85, description: 'Memory cap' },
        { entityId: 'prod-system', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
      ],
      actions: [{ id: 'finalize_release', name: 'finalize_release', impactedEntityNames: ['ProductionSystem'] }],
    },
  },
];

// ─── Export ───────────────────────────────────────────────────────────────────

export function generateLongHorizonScenarios(): ScenarioV2[] {
  return [...longHorizonBlocked, ...longHorizonRisky, ...longHorizonValid];
}
