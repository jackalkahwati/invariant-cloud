/**
 * Phase 2 — Extended Branching Scenarios
 *
 * Focuses on BRANCH_DEPENDENT classification and related edge cases:
 *  - Multiple open branches on impacted entity
 *  - Nested/dependent branches
 *  - Branch resolution leading to VALID vs BLOCKED outcomes
 *  - Branch on non-impacted entity (should not trigger BRANCH_DEPENDENT)
 *
 * 20 scenarios: 12 BRANCH_DEPENDENT · 4 BLOCKED · 4 VALID
 */

import { ScenarioV2, ScenarioFamily } from '../types';

const FAMILY: ScenarioFamily = 'branching_ext';

// ─── BRANCH_DEPENDENT (12) ────────────────────────────────────────────────────

const branchDependent: ScenarioV2[] = [
  {
    id: 'brx-brd-001',
    name: 'Two simultaneous open branches on impacted entity',
    description:
      'AppServer has open branches on both cpu_load_pct AND memory_free_gb. ' +
      'Multiple unresolved branches → BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'multiple_branches'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'app-server', name: 'AppServer', type: 'service' }],
      claims: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', value: '40', confidence: 0.75, source: 'monitor-a' },
        { entityId: 'app-server', attribute: 'cpu_load_pct', value: '88', confidence: 0.75, source: 'monitor-b' },
        { entityId: 'app-server', attribute: 'memory_free_gb', value: '12', confidence: 0.75, source: 'agent-a' },
        { entityId: 'app-server', attribute: 'memory_free_gb', value: '1.2', confidence: 0.75, source: 'agent-b' },
      ],
      branches: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', isOpen: true, candidates: ['40', '88'] },
        { entityId: 'app-server', attribute: 'memory_free_gb', isOpen: true, candidates: ['12', '1.2'] },
      ],
      constraints: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', operator: '<=', threshold: 80, description: 'CPU cap' },
      ],
      actions: [{ id: 'deploy_app', name: 'deploy_app', impactedEntityNames: ['AppServer'] }],
    },
  },

  {
    id: 'brx-brd-002',
    name: 'Branch on critical safety attribute',
    description:
      'ReactorCoolant.flow_lpm: 70 (sensor-new) vs 18 (sensor-legacy). ' +
      'Either could be correct. Safety-critical → BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'safety_critical', 'sensor_conflict'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'reactor-coolant', name: 'ReactorCoolant', type: 'component' }],
      claims: [
        { entityId: 'reactor-coolant', attribute: 'flow_lpm', value: '70', confidence: 0.78, source: 'sensor-new' },
        { entityId: 'reactor-coolant', attribute: 'flow_lpm', value: '18', confidence: 0.78, source: 'sensor-legacy' },
      ],
      branches: [
        { entityId: 'reactor-coolant', attribute: 'flow_lpm', isOpen: true, candidates: ['70', '18'] },
      ],
      constraints: [
        { entityId: 'reactor-coolant', attribute: 'flow_lpm', operator: '>=', threshold: 50, description: 'Min coolant flow' },
      ],
      actions: [{ id: 'activate_reactor', name: 'activate_reactor', impactedEntityNames: ['ReactorCoolant'] }],
    },
  },

  {
    id: 'brx-brd-003',
    name: 'Dependent branch: child entity branch depends on parent branch outcome',
    description:
      'ConfigParent has open branch. ConfigDerived depends on ConfigParent and also has branch. ' +
      'Action on ServiceTarget (depends on ConfigDerived). Nested branch → BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'nested_branch', 'dependent_branch'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [
        { id: 'config-parent', name: 'ConfigParent', type: 'system' },
        { id: 'config-derived', name: 'ConfigDerived', type: 'system' },
        { id: 'service-target', name: 'ServiceTarget', type: 'service' },
      ],
      claims: [
        { entityId: 'config-parent', attribute: 'pool_size', value: '20', confidence: 0.75, source: 'config-a' },
        { entityId: 'config-parent', attribute: 'pool_size', value: '5', confidence: 0.75, source: 'config-b' },
        { entityId: 'config-derived', attribute: 'max_connections', value: '100', confidence: 0.7, source: 'derived-a' },
        { entityId: 'config-derived', attribute: 'max_connections', value: '25', confidence: 0.7, source: 'derived-b' },
        { entityId: 'service-target', attribute: 'capacity', value: '80', confidence: 0.65, source: 'estimated' },
      ],
      branches: [
        { entityId: 'config-parent', attribute: 'pool_size', isOpen: true, candidates: ['20', '5'] },
        { entityId: 'config-derived', attribute: 'max_connections', isOpen: true, candidates: ['100', '25'] },
      ],
      dependencies: [
        { fromEntityId: 'config-derived', toEntityId: 'config-parent', type: 'REQUIRES', attribute: 'pool_size' },
        { fromEntityId: 'service-target', toEntityId: 'config-derived', type: 'REQUIRES', attribute: 'max_connections' },
      ],
      constraints: [],
      actions: [{ id: 'deploy_service', name: 'deploy_service', impactedEntityNames: ['ServiceTarget'] }],
    },
  },

  {
    id: 'brx-brd-004',
    name: 'Branch with equal confidence sources: genuinely ambiguous',
    description:
      'NetworkDevice.throughput_gbps: 1.2 (vendor-report) vs 8.5 (field-test), both confidence 0.8. ' +
      'Ambiguous measurement context → BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'equal_confidence', 'ambiguous'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'network-device', name: 'NetworkDevice', type: 'component' }],
      claims: [
        { entityId: 'network-device', attribute: 'throughput_gbps', value: '1.2', confidence: 0.8, source: 'vendor-report' },
        { entityId: 'network-device', attribute: 'throughput_gbps', value: '8.5', confidence: 0.8, source: 'field-test' },
      ],
      branches: [
        { entityId: 'network-device', attribute: 'throughput_gbps', isOpen: true, candidates: ['1.2', '8.5'] },
      ],
      constraints: [
        { entityId: 'network-device', attribute: 'throughput_gbps', operator: '>=', threshold: 5, description: 'Min throughput' },
      ],
      actions: [{ id: 'deploy_network', name: 'deploy_network', impactedEntityNames: ['NetworkDevice'] }],
    },
  },

  {
    id: 'brx-brd-005',
    name: 'Branch on financial compliance attribute',
    description:
      'ComplianceSystem.risk_score: 0.15 (internal-model) vs 0.72 (external-audit). ' +
      'Action approve_transaction impacts ComplianceSystem → BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'compliance', 'approve'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'compliance-sys', name: 'ComplianceSystem', type: 'system' }],
      claims: [
        { entityId: 'compliance-sys', attribute: 'risk_score', value: '0.15', confidence: 0.82, source: 'internal-model' },
        { entityId: 'compliance-sys', attribute: 'risk_score', value: '0.72', confidence: 0.82, source: 'external-audit' },
      ],
      branches: [
        { entityId: 'compliance-sys', attribute: 'risk_score', isOpen: true, candidates: ['0.15', '0.72'] },
      ],
      constraints: [
        { entityId: 'compliance-sys', attribute: 'risk_score', operator: '<=', threshold: 0.5, description: 'Max risk score' },
      ],
      actions: [{ id: 'approve_transaction', name: 'approve_transaction', impactedEntityNames: ['ComplianceSystem'] }],
    },
  },

  {
    id: 'brx-brd-006',
    name: 'Branch from concurrent writes to shared config',
    description:
      'SharedConfig.timeout_ms: 500 (operator-a) vs 30000 (operator-b). ' +
      'Action deploy_service impacts SharedConfig → BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'concurrent_write', 'config'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'shared-config', name: 'SharedConfig', type: 'system' }],
      claims: [
        { entityId: 'shared-config', attribute: 'timeout_ms', value: '500', confidence: 0.79, source: 'operator-a' },
        { entityId: 'shared-config', attribute: 'timeout_ms', value: '30000', confidence: 0.79, source: 'operator-b' },
      ],
      branches: [
        { entityId: 'shared-config', attribute: 'timeout_ms', isOpen: true, candidates: ['500', '30000'] },
      ],
      constraints: [],
      actions: [{ id: 'deploy_service', name: 'deploy_service', impactedEntityNames: ['SharedConfig'] }],
    },
  },

  {
    id: 'brx-brd-007',
    name: 'Branch resolving to BLOCKED if bad candidate wins',
    description:
      'BatteryPack.charge_pct: 75 (charger-a) vs 5 (charger-b). ' +
      'If 5 wins, BLOCKED by constraint. Unresolved → BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'potential_blocked', 'battery'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'battery-pack', name: 'BatteryPack', type: 'component' }],
      claims: [
        { entityId: 'battery-pack', attribute: 'charge_pct', value: '75', confidence: 0.77, source: 'charger-a' },
        { entityId: 'battery-pack', attribute: 'charge_pct', value: '5', confidence: 0.77, source: 'charger-b' },
      ],
      branches: [
        { entityId: 'battery-pack', attribute: 'charge_pct', isOpen: true, candidates: ['75', '5'] },
      ],
      constraints: [
        { entityId: 'battery-pack', attribute: 'charge_pct', operator: '>=', threshold: 20, description: 'Min charge for deployment' },
      ],
      actions: [{ id: 'deploy_payload', name: 'deploy_payload', impactedEntityNames: ['BatteryPack'] }],
    },
  },

  {
    id: 'brx-brd-008',
    name: 'Version branch: breaking vs compatible API version',
    description:
      'APIModule.version: 4.0.0 (registry-main) vs 5.0.0-rc (registry-staging). ' +
      'Branched version affects downstream compatibility. BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'version_conflict', 'api'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [
        { id: 'api-module', name: 'APIModule', type: 'service' },
        { id: 'downstream-svc', name: 'DownstreamService', type: 'service' },
      ],
      claims: [
        { entityId: 'api-module', attribute: 'version', value: '4.0.0', confidence: 0.8, source: 'registry-main' },
        { entityId: 'api-module', attribute: 'version', value: '5.0.0-rc', confidence: 0.8, source: 'registry-staging' },
        { entityId: 'downstream-svc', attribute: 'compatible_api', value: '4.x', confidence: 0.9, source: 'config' },
      ],
      branches: [
        { entityId: 'api-module', attribute: 'version', isOpen: true, candidates: ['4.0.0', '5.0.0-rc'] },
      ],
      constraints: [],
      actions: [{ id: 'release_api', name: 'release_api', impactedEntityNames: ['APIModule'] }],
    },
  },

  {
    id: 'brx-brd-009',
    name: 'Sensor drift branch: two calibration readings diverge',
    description:
      'ThrusterSystem.pressure_bar gradually drifted. Two sensors now show 140 vs 78. ' +
      'Unknown which is correct → BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'sensor_drift', 'calibration'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'thruster-sys', name: 'ThrusterSystem', type: 'subsystem' }],
      claims: [
        { entityId: 'thruster-sys', attribute: 'pressure_bar', value: '140', confidence: 0.76, source: 'sensor-primary' },
        { entityId: 'thruster-sys', attribute: 'pressure_bar', value: '78', confidence: 0.76, source: 'sensor-secondary' },
      ],
      branches: [
        { entityId: 'thruster-sys', attribute: 'pressure_bar', isOpen: true, candidates: ['140', '78'] },
      ],
      constraints: [
        { entityId: 'thruster-sys', attribute: 'pressure_bar', operator: '>=', threshold: 100, description: 'Min ignition pressure' },
      ],
      actions: [{ id: 'ignite_thrusters', name: 'ignite_thrusters', impactedEntityNames: ['ThrusterSystem'] }],
    },
  },

  {
    id: 'brx-brd-010',
    name: 'Branch from A/B test: two configs in flight',
    description:
      'MLModel.deployment_config: config-a (latency-optimized) vs config-b (accuracy-optimized). ' +
      'Both valid but different risk profiles. BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'ab_test', 'config_split'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'ml-model', name: 'MLModel', type: 'artifact' }],
      claims: [
        { entityId: 'ml-model', attribute: 'latency_ms', value: '12', confidence: 0.82, source: 'config-a-bench' },
        { entityId: 'ml-model', attribute: 'latency_ms', value: '85', confidence: 0.82, source: 'config-b-bench' },
        { entityId: 'ml-model', attribute: 'accuracy', value: '0.91', confidence: 0.82, source: 'config-a-eval' },
        { entityId: 'ml-model', attribute: 'accuracy', value: '0.97', confidence: 0.82, source: 'config-b-eval' },
      ],
      branches: [
        { entityId: 'ml-model', attribute: 'latency_ms', isOpen: true, candidates: ['12', '85'] },
        { entityId: 'ml-model', attribute: 'accuracy', isOpen: true, candidates: ['0.91', '0.97'] },
      ],
      constraints: [
        { entityId: 'ml-model', attribute: 'accuracy', operator: '>=', threshold: 0.95, description: 'Min accuracy' },
      ],
      actions: [{ id: 'deploy_model', name: 'deploy_model', impactedEntityNames: ['MLModel'] }],
    },
  },

  {
    id: 'brx-brd-011',
    name: 'Schema version branch in data pipeline',
    description:
      'DataPipeline.schema_version: 3.0 (legacy-registry) vs 4.0 (new-registry). ' +
      'Consumer ServiceA depends on DataPipeline. Branch on data contract → BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'schema_version', 'data_pipeline'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [
        { id: 'data-pipeline', name: 'DataPipeline', type: 'system' },
        { id: 'service-a', name: 'ServiceA', type: 'service' },
      ],
      claims: [
        { entityId: 'data-pipeline', attribute: 'schema_version', value: '3.0', confidence: 0.79, source: 'legacy-registry' },
        { entityId: 'data-pipeline', attribute: 'schema_version', value: '4.0', confidence: 0.79, source: 'new-registry' },
        { entityId: 'service-a', attribute: 'compatible_schema', value: '3.0', confidence: 0.9, source: 'config' },
      ],
      branches: [
        { entityId: 'data-pipeline', attribute: 'schema_version', isOpen: true, candidates: ['3.0', '4.0'] },
      ],
      dependencies: [
        { fromEntityId: 'service-a', toEntityId: 'data-pipeline', type: 'REQUIRES', attribute: 'schema_version' },
      ],
      constraints: [],
      actions: [{ id: 'release_package', name: 'release_package', impactedEntityNames: ['DataPipeline'] }],
    },
  },

  {
    id: 'brx-brd-012',
    name: 'Rollback candidate: production vs rollback state both claimed',
    description:
      'ProductionDB.row_count: 5000000 (prod-scan) vs 1200000 (backup-scan). ' +
      'Both simultaneously active from different data access paths. BRANCH_DEPENDENT.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'rollback', 'db_state'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'production-db', name: 'ProductionDB', type: 'system' }],
      claims: [
        { entityId: 'production-db', attribute: 'row_count', value: '5000000', confidence: 0.8, source: 'prod-scan' },
        { entityId: 'production-db', attribute: 'row_count', value: '1200000', confidence: 0.8, source: 'backup-scan' },
      ],
      branches: [
        { entityId: 'production-db', attribute: 'row_count', isOpen: true, candidates: ['5000000', '1200000'] },
      ],
      constraints: [],
      actions: [{ id: 'run_migration', name: 'run_migration', impactedEntityNames: ['ProductionDB'] }],
    },
  },
];

// ─── BLOCKED (4) — Branch resolved → constraint violated ─────────────────────

const branchBlocked: ScenarioV2[] = [
  {
    id: 'brx-blk-001',
    name: 'Branch resolved: only valid candidate still violates constraint',
    description:
      'AppServer.cpu_load_pct resolved to single source: 93 (constraint <= 80). ' +
      'No longer branched — BLOCKED by constraint.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'branch_resolved', 'constraint_violation'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'app-server', name: 'AppServer', type: 'service' }],
      claims: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', value: '93', confidence: 0.95, source: 'monitor-authoritative' },
      ],
      constraints: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', operator: '<=', threshold: 80, description: 'CPU cap' },
      ],
      actions: [{ id: 'deploy_app', name: 'deploy_app', impactedEntityNames: ['AppServer'] }],
    },
  },

  {
    id: 'brx-blk-002',
    name: 'Both candidates violate constraint: BLOCKED regardless of branch',
    description:
      'BatteryPack.charge_pct: 12 and 8 — both below minimum 20. ' +
      'Even if branched, both outcomes violate constraint → BLOCKED.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'both_candidates_violate'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'battery-pack', name: 'BatteryPack', type: 'component' }],
      claims: [
        { entityId: 'battery-pack', attribute: 'charge_pct', value: '12', confidence: 0.88, source: 'charger-a' },
        { entityId: 'battery-pack', attribute: 'charge_pct', value: '8', confidence: 0.85, source: 'charger-b' },
      ],
      constraints: [
        { entityId: 'battery-pack', attribute: 'charge_pct', operator: '>=', threshold: 20, description: 'Min charge' },
      ],
      actions: [{ id: 'deploy_payload', name: 'deploy_payload', impactedEntityNames: ['BatteryPack'] }],
    },
  },

  {
    id: 'brx-blk-003',
    name: 'Unrelated entity branch, impacted entity has hard constraint violation',
    description:
      'OtherSystem has a branch (not impacted). ReactorCoolant.flow_lpm = 12 violates >= 50. ' +
      'Action impacts ReactorCoolant → BLOCKED (branch on OtherSystem is irrelevant).',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'unrelated_branch', 'direct_violation'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'other-sys', name: 'OtherSystem', type: 'system' },
        { id: 'reactor-coolant', name: 'ReactorCoolant', type: 'component' },
      ],
      claims: [
        { entityId: 'other-sys', attribute: 'status', value: 'ok', confidence: 0.75, source: 'agent-a' },
        { entityId: 'other-sys', attribute: 'status', value: 'degraded', confidence: 0.75, source: 'agent-b' },
        { entityId: 'reactor-coolant', attribute: 'flow_lpm', value: '12', confidence: 0.97, source: 'flow-sensor' },
      ],
      branches: [
        { entityId: 'other-sys', attribute: 'status', isOpen: true, candidates: ['ok', 'degraded'] },
      ],
      constraints: [
        { entityId: 'reactor-coolant', attribute: 'flow_lpm', operator: '>=', threshold: 50, description: 'Min coolant flow' },
      ],
      actions: [{ id: 'activate_reactor', name: 'activate_reactor', impactedEntityNames: ['ReactorCoolant'] }],
    },
  },

  {
    id: 'brx-blk-004',
    name: 'Branch closed but violation discovered: constraint check reveals BLOCKED',
    description:
      'ThrusterSystem.pressure_bar single claim 55 (not branched). ' +
      'Constraint >= 100 violated. Pure constraint violation → BLOCKED.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'no_branch', 'single_claim_violation'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'thruster-sys', name: 'ThrusterSystem', type: 'subsystem' }],
      claims: [
        { entityId: 'thruster-sys', attribute: 'pressure_bar', value: '55', confidence: 0.96, source: 'sensor-calibrated' },
      ],
      constraints: [
        { entityId: 'thruster-sys', attribute: 'pressure_bar', operator: '>=', threshold: 100, description: 'Min ignition pressure' },
      ],
      actions: [{ id: 'ignite_thrusters', name: 'ignite_thrusters', impactedEntityNames: ['ThrusterSystem'] }],
    },
  },
];

// ─── VALID (4) — Branch on unrelated entity, or action unaffected ─────────────

const branchValid: ScenarioV2[] = [
  {
    id: 'brx-vld-001',
    name: 'Branch on non-impacted entity: VALID for action on clean entity',
    description:
      'UnrelatedService has open branch. CleanService has no violations, no open branches. ' +
      'Action impacts CleanService only → VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'unrelated_branch', 'clean_target'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'unrelated-svc', name: 'UnrelatedService', type: 'service' },
        { id: 'clean-svc', name: 'CleanService', type: 'service' },
      ],
      claims: [
        { entityId: 'unrelated-svc', attribute: 'status', value: 'ok', confidence: 0.75, source: 'monitor-a' },
        { entityId: 'unrelated-svc', attribute: 'status', value: 'degraded', confidence: 0.75, source: 'monitor-b' },
        { entityId: 'clean-svc', attribute: 'cpu_load_pct', value: '35', confidence: 0.97, source: 'monitor', staleness_s: 30 },
      ],
      branches: [
        { entityId: 'unrelated-svc', attribute: 'status', isOpen: true, candidates: ['ok', 'degraded'] },
      ],
      constraints: [
        { entityId: 'clean-svc', attribute: 'cpu_load_pct', operator: '<=', threshold: 80, description: 'CPU cap' },
      ],
      actions: [{ id: 'deploy_app', name: 'deploy_app', impactedEntityNames: ['CleanService'] }],
    },
  },

  {
    id: 'brx-vld-002',
    name: 'Closed branch (resolved): action now VALID',
    description:
      'AppServer.cpu_load_pct branch resolved to single value 42. ' +
      'Constraint <= 80 satisfied. No open branches on impacted entity → VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'resolved_branch', 'clean'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'app-server', name: 'AppServer', type: 'service' }],
      claims: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', value: '42', confidence: 0.97, source: 'monitor', staleness_s: 30 },
      ],
      constraints: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', operator: '<=', threshold: 80, description: 'CPU cap' },
      ],
      actions: [{ id: 'deploy_app', name: 'deploy_app', impactedEntityNames: ['AppServer'] }],
    },
  },

  {
    id: 'brx-vld-003',
    name: 'Branch on upstream non-impacted entity in otherwise clean graph',
    description:
      'UpstreamConfig has open branch but DataService (the action target) ' +
      'has no dependency on UpstreamConfig. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'upstream_branch', 'no_dependency'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'upstream-config', name: 'UpstreamConfig', type: 'system' },
        { id: 'data-service', name: 'DataService', type: 'service' },
      ],
      claims: [
        { entityId: 'upstream-config', attribute: 'version', value: 'v1', confidence: 0.78, source: 'reg-a' },
        { entityId: 'upstream-config', attribute: 'version', value: 'v2', confidence: 0.78, source: 'reg-b' },
        { entityId: 'data-service', attribute: 'throughput_gbps', value: '8.5', confidence: 0.96, source: 'bench', staleness_s: 60 },
      ],
      branches: [
        { entityId: 'upstream-config', attribute: 'version', isOpen: true, candidates: ['v1', 'v2'] },
      ],
      constraints: [],
      actions: [{ id: 'release_api', name: 'release_api', impactedEntityNames: ['DataService'] }],
    },
  },

  {
    id: 'brx-vld-004',
    name: 'Both candidates in branch satisfy constraint: outcome VALID either way',
    description:
      'ReactorCoolant.flow_lpm: 65 (sensor-a) vs 80 (sensor-b). ' +
      'Both > 50 minimum. Either candidate satisfies constraint. ' +
      'Engine may still classify as BRANCH_DEPENDENT, but actual risk is VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'both_candidates_satisfy', 'reactor'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'reactor-coolant', name: 'ReactorCoolant', type: 'component' }],
      claims: [
        { entityId: 'reactor-coolant', attribute: 'flow_lpm', value: '65', confidence: 0.9, source: 'sensor-a' },
      ],
      constraints: [
        { entityId: 'reactor-coolant', attribute: 'flow_lpm', operator: '>=', threshold: 50, description: 'Min coolant flow' },
      ],
      actions: [{ id: 'activate_reactor', name: 'activate_reactor', impactedEntityNames: ['ReactorCoolant'] }],
    },
  },
];

// ─── Export ───────────────────────────────────────────────────────────────────

export function generateBranchingScenarios(): ScenarioV2[] {
  return [...branchDependent, ...branchBlocked, ...branchValid];
}
