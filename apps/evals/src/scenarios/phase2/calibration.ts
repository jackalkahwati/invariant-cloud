/**
 * Phase 2 — Action Calibration Scenarios
 *
 * Key design principle: impacted entities MUST be the same entities that carry
 * constraint violations.  The Atlas Phase-1 bug occurred because impacted =
 * [Launch, Mission] while the violation lived on Battery → CVR = 0.
 *
 * 40 scenarios: 10 BLOCKED · 10 RISKY · 10 VALID · 10 BRANCH_DEPENDENT
 */

import { ScenarioV2, ScenarioFamily } from '../types';

const FAMILY: ScenarioFamily = 'calibration';

// ─── BLOCKED (10) ────────────────────────────────────────────────────────────

const blocked: ScenarioV2[] = [
  {
    id: 'cal-blk-001',
    name: 'Thruster ignition with pressure below threshold',
    description:
      'ThrusterSystem.pressure_bar = 45 violates pressure_bar >= 100. ' +
      'Action ignite_thrusters directly impacts ThrusterSystem → CVR high.',
    familyId: FAMILY,
    category: 'contradiction',
    tags: ['blocked', 'constraint_violation', 'direct_impact'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'thruster-sys', name: 'ThrusterSystem', type: 'subsystem' },
        { id: 'mission-ctrl', name: 'MissionControl', type: 'system' },
      ],
      claims: [
        {
          entityId: 'thruster-sys',
          attribute: 'pressure_bar',
          value: '45',
          confidence: 0.95,
          source: 'sensor-feed',
        },
        {
          entityId: 'thruster-sys',
          attribute: 'status',
          value: 'standby',
          confidence: 0.95,
          source: 'sensor-feed',
        },
      ],
      constraints: [
        {
          entityId: 'thruster-sys',
          attribute: 'pressure_bar',
          operator: '>=',
          threshold: 100,
          description: 'Minimum ignition pressure',
        },
      ],
      actions: [
        {
          id: 'ignite_thrusters',
          name: 'ignite_thrusters',
          impactedEntityNames: ['ThrusterSystem'],
        },
      ],
    },
  },

  {
    id: 'cal-blk-002',
    name: 'Fuel release valve open with tank pressure critical',
    description:
      'FuelTank.pressure_psi = 3200 exceeds max 3000. ' +
      'Action open_release_valve impacts FuelTank directly.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'constraint_violation', 'safety_critical'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'fuel-tank', name: 'FuelTank', type: 'component' },
        { id: 'valve-ctrl', name: 'ValveController', type: 'system' },
      ],
      claims: [
        {
          entityId: 'fuel-tank',
          attribute: 'pressure_psi',
          value: '3200',
          confidence: 0.98,
          source: 'pressure-sensor',
        },
        {
          entityId: 'fuel-tank',
          attribute: 'fill_level_pct',
          value: '87',
          confidence: 0.97,
          source: 'level-sensor',
        },
      ],
      constraints: [
        {
          entityId: 'fuel-tank',
          attribute: 'pressure_psi',
          operator: '<=',
          threshold: 3000,
          description: 'Maximum safe tank pressure',
        },
      ],
      actions: [
        {
          id: 'open_release_valve',
          name: 'open_release_valve',
          impactedEntityNames: ['FuelTank'],
        },
      ],
    },
  },

  {
    id: 'cal-blk-003',
    name: 'Deploy with battery charge critically low',
    description:
      'BatteryPack.charge_pct = 8 violates charge_pct >= 20. ' +
      'Action deploy_payload impacts BatteryPack.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'battery', 'deploy'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'battery-pack', name: 'BatteryPack', type: 'component' }],
      claims: [
        {
          entityId: 'battery-pack',
          attribute: 'charge_pct',
          value: '8',
          confidence: 0.99,
          source: 'battery-monitor',
        },
        {
          entityId: 'battery-pack',
          attribute: 'temperature_c',
          value: '38',
          confidence: 0.97,
          source: 'thermal-sensor',
        },
      ],
      constraints: [
        {
          entityId: 'battery-pack',
          attribute: 'charge_pct',
          operator: '>=',
          threshold: 20,
          description: 'Minimum charge for deployment',
        },
      ],
      actions: [
        {
          id: 'deploy_payload',
          name: 'deploy_payload',
          impactedEntityNames: ['BatteryPack'],
        },
      ],
    },
  },

  {
    id: 'cal-blk-004',
    name: 'Antenna slew with controller temperature overheating',
    description:
      'AntennaController.temp_c = 95 exceeds max 85. ' +
      'Action slew_antenna directly impacts AntennaController.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'thermal', 'antenna'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'ant-ctrl', name: 'AntennaController', type: 'subsystem' }],
      claims: [
        {
          entityId: 'ant-ctrl',
          attribute: 'temp_c',
          value: '95',
          confidence: 0.96,
          source: 'thermal-monitor',
        },
        {
          entityId: 'ant-ctrl',
          attribute: 'pointing_az',
          value: '180',
          confidence: 0.9,
          source: 'encoder',
        },
      ],
      constraints: [
        {
          entityId: 'ant-ctrl',
          attribute: 'temp_c',
          operator: '<=',
          threshold: 85,
          description: 'Maximum safe controller temperature',
        },
      ],
      actions: [
        {
          id: 'slew_antenna',
          name: 'slew_antenna',
          impactedEntityNames: ['AntennaController'],
        },
      ],
    },
  },

  {
    id: 'cal-blk-005',
    name: 'Mission finalize with multiple violated constraints',
    description:
      'MissionComputer has both cpu_load_pct = 98 (> 90) and memory_free_mb = 12 (< 50). ' +
      'Action finalize_mission directly impacts MissionComputer → stacked violations.',
    familyId: FAMILY,
    category: 'multi_constraint',
    tags: ['blocked', 'stacked_violations', 'finalize'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'mission-comp', name: 'MissionComputer', type: 'system' }],
      claims: [
        {
          entityId: 'mission-comp',
          attribute: 'cpu_load_pct',
          value: '98',
          confidence: 0.99,
          source: 'os-monitor',
        },
        {
          entityId: 'mission-comp',
          attribute: 'memory_free_mb',
          value: '12',
          confidence: 0.99,
          source: 'os-monitor',
        },
      ],
      constraints: [
        {
          entityId: 'mission-comp',
          attribute: 'cpu_load_pct',
          operator: '<=',
          threshold: 90,
          description: 'Max CPU load during finalization',
        },
        {
          entityId: 'mission-comp',
          attribute: 'memory_free_mb',
          operator: '>=',
          threshold: 50,
          description: 'Minimum free memory during finalization',
        },
      ],
      actions: [
        {
          id: 'finalize_mission',
          name: 'finalize_mission',
          impactedEntityNames: ['MissionComputer'],
        },
      ],
    },
  },

  {
    id: 'cal-blk-006',
    name: 'Release software build with test pass rate below threshold',
    description:
      'BuildArtifact.test_pass_rate = 0.72 violates test_pass_rate >= 0.95. ' +
      'Action release_build directly impacts BuildArtifact.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'software', 'release'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'build-artifact', name: 'BuildArtifact', type: 'artifact' }],
      claims: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          value: '0.72',
          confidence: 0.99,
          source: 'ci-pipeline',
        },
        {
          entityId: 'build-artifact',
          attribute: 'coverage_pct',
          value: '61',
          confidence: 0.99,
          source: 'ci-pipeline',
        },
      ],
      constraints: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          operator: '>=',
          threshold: 0.95,
          description: 'Minimum test pass rate for release',
        },
      ],
      actions: [
        {
          id: 'release_build',
          name: 'release_build',
          impactedEntityNames: ['BuildArtifact'],
        },
      ],
    },
  },

  {
    id: 'cal-blk-007',
    name: 'Approve structural inspection with crack severity exceeding limit',
    description:
      'StructuralComponent.crack_index = 0.82 exceeds 0.50. ' +
      'Action approve_inspection directly impacts StructuralComponent.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'structural', 'approve'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'struct-comp', name: 'StructuralComponent', type: 'component' }],
      claims: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          value: '0.82',
          confidence: 0.93,
          source: 'ndt-inspection',
        },
        {
          entityId: 'struct-comp',
          attribute: 'age_years',
          value: '12',
          confidence: 0.99,
          source: 'asset-registry',
        },
      ],
      constraints: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          operator: '<=',
          threshold: 0.5,
          description: 'Maximum allowable crack index',
        },
      ],
      actions: [
        {
          id: 'approve_inspection',
          name: 'approve_inspection',
          impactedEntityNames: ['StructuralComponent'],
        },
      ],
    },
  },

  {
    id: 'cal-blk-008',
    name: 'Deploy microservice with error rate exceeding SLO',
    description:
      'ServiceInstance.error_rate = 0.08 exceeds 0.01 SLO. ' +
      'Action deploy_service directly impacts ServiceInstance.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'slo_breach', 'deploy'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'svc-instance', name: 'ServiceInstance', type: 'service' }],
      claims: [
        {
          entityId: 'svc-instance',
          attribute: 'error_rate',
          value: '0.08',
          confidence: 0.98,
          source: 'metrics-collector',
        },
        {
          entityId: 'svc-instance',
          attribute: 'p99_latency_ms',
          value: '1200',
          confidence: 0.98,
          source: 'metrics-collector',
        },
      ],
      constraints: [
        {
          entityId: 'svc-instance',
          attribute: 'error_rate',
          operator: '<=',
          threshold: 0.01,
          description: 'Maximum error rate SLO',
        },
      ],
      actions: [
        {
          id: 'deploy_service',
          name: 'deploy_service',
          impactedEntityNames: ['ServiceInstance'],
        },
      ],
    },
  },

  {
    id: 'cal-blk-009',
    name: 'Activate reactor with coolant flow insufficient',
    description:
      'ReactorCoolant.flow_lpm = 15 violates flow_lpm >= 50. ' +
      'Action activate_reactor directly impacts ReactorCoolant.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'coolant', 'safety_critical'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'reactor-coolant', name: 'ReactorCoolant', type: 'component' }],
      claims: [
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          value: '15',
          confidence: 0.97,
          source: 'flow-sensor',
        },
        {
          entityId: 'reactor-coolant',
          attribute: 'temp_inlet_c',
          value: '22',
          confidence: 0.97,
          source: 'temp-sensor',
        },
      ],
      constraints: [
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          operator: '>=',
          threshold: 50,
          description: 'Minimum coolant flow for reactor activation',
        },
      ],
      actions: [
        {
          id: 'activate_reactor',
          name: 'activate_reactor',
          impactedEntityNames: ['ReactorCoolant'],
        },
      ],
    },
  },

  {
    id: 'cal-blk-010',
    name: 'Proceed to launch with guidance accuracy out of spec',
    description:
      'GuidanceSystem.accuracy_m = 450 exceeds max 100. ' +
      'Action proceed_to_launch directly impacts GuidanceSystem.',
    familyId: FAMILY,
    category: 'constraint',
    tags: ['blocked', 'guidance', 'launch'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'guidance-sys', name: 'GuidanceSystem', type: 'subsystem' }],
      claims: [
        {
          entityId: 'guidance-sys',
          attribute: 'accuracy_m',
          value: '450',
          confidence: 0.94,
          source: 'gps-check',
        },
        {
          entityId: 'guidance-sys',
          attribute: 'lock_status',
          value: 'partial',
          confidence: 0.9,
          source: 'gps-check',
        },
      ],
      constraints: [
        {
          entityId: 'guidance-sys',
          attribute: 'accuracy_m',
          operator: '<=',
          threshold: 100,
          description: 'Maximum allowed guidance error for launch',
        },
      ],
      actions: [
        {
          id: 'proceed_to_launch',
          name: 'proceed_to_launch',
          impactedEntityNames: ['GuidanceSystem'],
        },
      ],
    },
  },
];

// ─── RISKY (10) ──────────────────────────────────────────────────────────────

const risky: ScenarioV2[] = [
  {
    id: 'cal-rsk-001',
    name: 'Deploy with moderate CPU load and open contradiction',
    description:
      'ServerNode.cpu_load_pct = 78 (threshold 80), plus open contradiction on memory. ' +
      'Action deploy_app directly impacts ServerNode → CVR moderate, CA non-zero.',
    familyId: FAMILY,
    category: 'borderline',
    tags: ['risky', 'borderline_constraint', 'contradiction'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'server-node', name: 'ServerNode', type: 'service' }],
      claims: [
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          value: '78',
          confidence: 0.85,
          source: 'monitoring',
        },
        {
          entityId: 'server-node',
          attribute: 'memory_free_gb',
          value: '2.1',
          confidence: 0.7,
          source: 'agent-a',
        },
        {
          entityId: 'server-node',
          attribute: 'memory_free_gb',
          value: '8.5',
          confidence: 0.65,
          source: 'agent-b',
        },
      ],
      constraints: [
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          operator: '<=',
          threshold: 80,
          description: 'CPU load cap for deployment',
        },
      ],
      contradictions: [
        {
          entityId: 'server-node',
          attribute: 'memory_free_gb',
          valueA: '2.1',
          valueB: '8.5',
          sourceA: 'agent-a',
          sourceB: 'agent-b',
        },
      ],
      actions: [
        {
          id: 'deploy_app',
          name: 'deploy_app',
          impactedEntityNames: ['ServerNode'],
        },
      ],
    },
  },

  {
    id: 'cal-rsk-002',
    name: 'Approve with low-confidence claims on impacted entity',
    description:
      'PipelineStage has no constraint violation but claims have confidence 0.55. ' +
      'Action approve_stage impacts PipelineStage → UE elevated.',
    familyId: FAMILY,
    category: 'uncertainty',
    tags: ['risky', 'low_confidence', 'approve'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'pipeline-stage', name: 'PipelineStage', type: 'artifact' }],
      claims: [
        {
          entityId: 'pipeline-stage',
          attribute: 'test_pass_rate',
          value: '0.88',
          confidence: 0.55,
          source: 'legacy-ci',
          staleness_s: 7200,
        },
        {
          entityId: 'pipeline-stage',
          attribute: 'coverage_pct',
          value: '74',
          confidence: 0.52,
          source: 'legacy-ci',
          staleness_s: 7200,
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'approve_stage',
          name: 'approve_stage',
          impactedEntityNames: ['PipelineStage'],
        },
      ],
    },
  },

  {
    id: 'cal-rsk-003',
    name: 'Release with moderately stale claims and dependency warning',
    description:
      'DataPackage claims are 3600s old. Downstream consumer depends on DataPackage. ' +
      'Action release_package impacts DataPackage → staleness-driven UE.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'stale_claims', 'dependency'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'data-pkg', name: 'DataPackage', type: 'artifact' },
        { id: 'consumer', name: 'DataConsumer', type: 'service' },
      ],
      claims: [
        {
          entityId: 'data-pkg',
          attribute: 'schema_version',
          value: '3.1',
          confidence: 0.88,
          source: 'schema-registry',
          staleness_s: 3600,
        },
        {
          entityId: 'data-pkg',
          attribute: 'row_count',
          value: '1500000',
          confidence: 0.88,
          source: 'etl-job',
          staleness_s: 3600,
        },
      ],
      dependencies: [
        {
          fromEntityId: 'consumer',
          toEntityId: 'data-pkg',
          type: 'REQUIRES',
          attribute: 'schema_version',
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'release_package',
          name: 'release_package',
          impactedEntityNames: ['DataPackage'],
        },
      ],
    },
  },

  {
    id: 'cal-rsk-004',
    name: 'Finalize orbit burn with borderline delta-v budget',
    description:
      'PropulsionModule.dv_remaining_ms = 52 just above threshold 50. ' +
      'Action finalize_burn impacts PropulsionModule → near-violation, moderate risk.',
    familyId: FAMILY,
    category: 'borderline',
    tags: ['risky', 'borderline_threshold', 'finalize'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'prop-module', name: 'PropulsionModule', type: 'subsystem' }],
      claims: [
        {
          entityId: 'prop-module',
          attribute: 'dv_remaining_ms',
          value: '52',
          confidence: 0.78,
          source: 'nav-computer',
        },
        {
          entityId: 'prop-module',
          attribute: 'fuel_kg',
          value: '6.2',
          confidence: 0.78,
          source: 'flow-meter',
        },
      ],
      constraints: [
        {
          entityId: 'prop-module',
          attribute: 'dv_remaining_ms',
          operator: '>=',
          threshold: 50,
          description: 'Minimum delta-v reserve',
        },
      ],
      actions: [
        {
          id: 'finalize_burn',
          name: 'finalize_burn',
          impactedEntityNames: ['PropulsionModule'],
        },
      ],
    },
  },

  {
    id: 'cal-rsk-005',
    name: 'Deploy with single open branch on impacted subsystem attribute',
    description:
      'StorageArray has an open branch on capacity_tb. ' +
      'Action deploy_storage impacts StorageArray → BRANCH_DEPENDENT… but only on one attribute. ' +
      'If branch resolves bad, this could become BLOCKED.',
    familyId: FAMILY,
    category: 'branch_uncertainty',
    tags: ['risky', 'branch', 'deploy'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'storage-arr', name: 'StorageArray', type: 'component' }],
      claims: [
        {
          entityId: 'storage-arr',
          attribute: 'capacity_tb',
          value: '100',
          confidence: 0.72,
          source: 'provisioner-a',
        },
        {
          entityId: 'storage-arr',
          attribute: 'iops',
          value: '45000',
          confidence: 0.85,
          source: 'benchmark',
        },
      ],
      constraints: [
        {
          entityId: 'storage-arr',
          attribute: 'capacity_tb',
          operator: '>=',
          threshold: 80,
          description: 'Minimum capacity for deployment',
        },
      ],
      actions: [
        {
          id: 'deploy_storage',
          name: 'deploy_storage',
          impactedEntityNames: ['StorageArray'],
        },
      ],
    },
  },

  {
    id: 'cal-rsk-006',
    name: 'Approve drug batch with partial provenance chain',
    description:
      'DrugBatch claims sourced from intermediate system with confidence 0.6 provenance. ' +
      'Action approve_batch impacts DrugBatch → PF elevated.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['risky', 'provenance', 'approve'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'drug-batch', name: 'DrugBatch', type: 'artifact' }],
      claims: [
        {
          entityId: 'drug-batch',
          attribute: 'purity_pct',
          value: '98.5',
          confidence: 0.62,
          source: 'lab-system-v1',
          provenanceConfidence: 0.6,
        },
        {
          entityId: 'drug-batch',
          attribute: 'contaminant_ppm',
          value: '2.1',
          confidence: 0.58,
          source: 'lab-system-v1',
          provenanceConfidence: 0.6,
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'approve_batch',
          name: 'approve_batch',
          impactedEntityNames: ['DrugBatch'],
        },
      ],
    },
  },

  {
    id: 'cal-rsk-007',
    name: 'Finalize sensor calibration with contradictory readings',
    description:
      'CalibrationTarget has two conflicting reference readings. ' +
      'Action finalize_calibration impacts CalibrationTarget → CA non-zero.',
    familyId: FAMILY,
    category: 'contradiction',
    tags: ['risky', 'contradiction', 'calibration'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'cal-target', name: 'CalibrationTarget', type: 'component' }],
      claims: [
        {
          entityId: 'cal-target',
          attribute: 'reference_temp_c',
          value: '20.3',
          confidence: 0.82,
          source: 'reference-sensor-a',
        },
        {
          entityId: 'cal-target',
          attribute: 'reference_temp_c',
          value: '21.9',
          confidence: 0.79,
          source: 'reference-sensor-b',
        },
      ],
      contradictions: [
        {
          entityId: 'cal-target',
          attribute: 'reference_temp_c',
          valueA: '20.3',
          valueB: '21.9',
          sourceA: 'reference-sensor-a',
          sourceB: 'reference-sensor-b',
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'finalize_calibration',
          name: 'finalize_calibration',
          impactedEntityNames: ['CalibrationTarget'],
        },
      ],
    },
  },

  {
    id: 'cal-rsk-008',
    name: 'Release API with deprecation dependency partially broken',
    description:
      'APIModule depends on LegacyAdapter which has no claims (no longer publishing). ' +
      'Action release_api impacts APIModule → DBR elevated from broken dependency.',
    familyId: FAMILY,
    category: 'dependency_break',
    tags: ['risky', 'dependency_break', 'release'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'api-module', name: 'APIModule', type: 'service' },
        { id: 'legacy-adapter', name: 'LegacyAdapter', type: 'service' },
      ],
      claims: [
        {
          entityId: 'api-module',
          attribute: 'version',
          value: '4.2.0',
          confidence: 0.95,
          source: 'registry',
        },
      ],
      dependencies: [
        {
          fromEntityId: 'api-module',
          toEntityId: 'legacy-adapter',
          type: 'INVALIDATES',
          attribute: 'compatibility_mode',
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'release_api',
          name: 'release_api',
          impactedEntityNames: ['APIModule'],
        },
      ],
    },
  },

  {
    id: 'cal-rsk-009',
    name: 'Deploy model with accuracy below target but above minimum',
    description:
      'MLModel.accuracy = 0.87 — above hard minimum 0.80, below target 0.90. ' +
      'Action deploy_model impacts MLModel → marginal CVR.',
    familyId: FAMILY,
    category: 'borderline',
    tags: ['risky', 'ml_accuracy', 'deploy'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'ml-model', name: 'MLModel', type: 'artifact' }],
      claims: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          value: '0.87',
          confidence: 0.91,
          source: 'eval-pipeline',
        },
        {
          entityId: 'ml-model',
          attribute: 'f1_score',
          value: '0.85',
          confidence: 0.91,
          source: 'eval-pipeline',
        },
      ],
      constraints: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          operator: '>=',
          threshold: 0.8,
          description: 'Hard minimum accuracy',
        },
      ],
      actions: [
        {
          id: 'deploy_model',
          name: 'deploy_model',
          impactedEntityNames: ['MLModel'],
        },
      ],
    },
  },

  {
    id: 'cal-rsk-010',
    name: 'Activate backup power with stale voltage readings',
    description:
      'BackupPower.voltage_v readings are 5400s old. ' +
      'Action activate_backup impacts BackupPower → staleness-driven UE.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'stale', 'power'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'backup-power', name: 'BackupPower', type: 'component' }],
      claims: [
        {
          entityId: 'backup-power',
          attribute: 'voltage_v',
          value: '48.2',
          confidence: 0.9,
          source: 'power-monitor',
          staleness_s: 5400,
        },
        {
          entityId: 'backup-power',
          attribute: 'capacity_ah',
          value: '200',
          confidence: 0.88,
          source: 'power-monitor',
          staleness_s: 5400,
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'activate_backup',
          name: 'activate_backup',
          impactedEntityNames: ['BackupPower'],
        },
      ],
    },
  },
];

// ─── VALID (10) ───────────────────────────────────────────────────────────────

const valid: ScenarioV2[] = [
  {
    id: 'cal-vld-001',
    name: 'Deploy with all constraints satisfied and fresh claims',
    description:
      'WebServer.cpu_load_pct = 35 (< 80), fresh high-confidence claims. ' +
      'Action deploy_app impacts WebServer → VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'nominal', 'deploy'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'web-server', name: 'WebServer', type: 'service' }],
      claims: [
        {
          entityId: 'web-server',
          attribute: 'cpu_load_pct',
          value: '35',
          confidence: 0.95,
          source: 'monitoring',
          staleness_s: 30,
        },
        {
          entityId: 'web-server',
          attribute: 'memory_free_gb',
          value: '12',
          confidence: 0.95,
          source: 'monitoring',
          staleness_s: 30,
        },
      ],
      constraints: [
        {
          entityId: 'web-server',
          attribute: 'cpu_load_pct',
          operator: '<=',
          threshold: 80,
          description: 'CPU cap for deployment',
        },
      ],
      actions: [
        {
          id: 'deploy_app',
          name: 'deploy_app',
          impactedEntityNames: ['WebServer'],
        },
      ],
    },
  },

  {
    id: 'cal-vld-002',
    name: 'Release with 100% test pass rate',
    description:
      'BuildArtifact.test_pass_rate = 1.0, coverage_pct = 92. All constraints satisfied.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'software', 'release'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'build-artifact', name: 'BuildArtifact', type: 'artifact' }],
      claims: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          value: '1.0',
          confidence: 0.99,
          source: 'ci-pipeline',
          staleness_s: 60,
        },
        {
          entityId: 'build-artifact',
          attribute: 'coverage_pct',
          value: '92',
          confidence: 0.99,
          source: 'ci-pipeline',
          staleness_s: 60,
        },
      ],
      constraints: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          operator: '>=',
          threshold: 0.95,
          description: 'Minimum test pass rate',
        },
      ],
      actions: [
        {
          id: 'release_build',
          name: 'release_build',
          impactedEntityNames: ['BuildArtifact'],
        },
      ],
    },
  },

  {
    id: 'cal-vld-003',
    name: 'Approve inspection with nominal structural health',
    description:
      'StructuralComponent.crack_index = 0.12 well below 0.50 limit. High-confidence scan.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'structural', 'approve'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'struct-comp', name: 'StructuralComponent', type: 'component' }],
      claims: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          value: '0.12',
          confidence: 0.97,
          source: 'ultrasound-scan',
          staleness_s: 120,
        },
      ],
      constraints: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          operator: '<=',
          threshold: 0.5,
          description: 'Maximum allowable crack index',
        },
      ],
      actions: [
        {
          id: 'approve_inspection',
          name: 'approve_inspection',
          impactedEntityNames: ['StructuralComponent'],
        },
      ],
    },
  },

  {
    id: 'cal-vld-004',
    name: 'Ignite thrusters with nominal pressure and temperature',
    description:
      'ThrusterSystem.pressure_bar = 150 (>= 100), temp_c = 22 (<= 80). All nominal.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'thruster', 'launch'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'thruster-sys', name: 'ThrusterSystem', type: 'subsystem' }],
      claims: [
        {
          entityId: 'thruster-sys',
          attribute: 'pressure_bar',
          value: '150',
          confidence: 0.97,
          source: 'sensor-feed',
          staleness_s: 10,
        },
        {
          entityId: 'thruster-sys',
          attribute: 'temp_c',
          value: '22',
          confidence: 0.97,
          source: 'thermal-sensor',
          staleness_s: 10,
        },
      ],
      constraints: [
        {
          entityId: 'thruster-sys',
          attribute: 'pressure_bar',
          operator: '>=',
          threshold: 100,
          description: 'Minimum ignition pressure',
        },
        {
          entityId: 'thruster-sys',
          attribute: 'temp_c',
          operator: '<=',
          threshold: 80,
          description: 'Maximum operating temperature',
        },
      ],
      actions: [
        {
          id: 'ignite_thrusters',
          name: 'ignite_thrusters',
          impactedEntityNames: ['ThrusterSystem'],
        },
      ],
    },
  },

  {
    id: 'cal-vld-005',
    name: 'Finalize data package with fresh high-confidence schema',
    description:
      'DataPackage claims fresh (60s), confidence 0.98, no constraints violated.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'data', 'finalize'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'data-pkg', name: 'DataPackage', type: 'artifact' }],
      claims: [
        {
          entityId: 'data-pkg',
          attribute: 'schema_version',
          value: '4.0',
          confidence: 0.98,
          source: 'schema-registry',
          staleness_s: 60,
        },
        {
          entityId: 'data-pkg',
          attribute: 'row_count',
          value: '2000000',
          confidence: 0.98,
          source: 'etl-job',
          staleness_s: 60,
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'release_package',
          name: 'release_package',
          impactedEntityNames: ['DataPackage'],
        },
      ],
    },
  },

  {
    id: 'cal-vld-006',
    name: 'Deploy ML model exceeding accuracy target',
    description:
      'MLModel.accuracy = 0.96 well above 0.95 target. Fresh eval pipeline.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'ml', 'deploy'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'ml-model', name: 'MLModel', type: 'artifact' }],
      claims: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          value: '0.96',
          confidence: 0.96,
          source: 'eval-pipeline',
          staleness_s: 300,
        },
        {
          entityId: 'ml-model',
          attribute: 'f1_score',
          value: '0.95',
          confidence: 0.96,
          source: 'eval-pipeline',
          staleness_s: 300,
        },
      ],
      constraints: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          operator: '>=',
          threshold: 0.95,
          description: 'Target accuracy',
        },
      ],
      actions: [
        {
          id: 'deploy_model',
          name: 'deploy_model',
          impactedEntityNames: ['MLModel'],
        },
      ],
    },
  },

  {
    id: 'cal-vld-007',
    name: 'Activate reactor with sufficient coolant flow',
    description:
      'ReactorCoolant.flow_lpm = 75 (>= 50), temp nominal. Safe to activate.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'coolant', 'reactor'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'reactor-coolant', name: 'ReactorCoolant', type: 'component' }],
      claims: [
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          value: '75',
          confidence: 0.98,
          source: 'flow-sensor',
          staleness_s: 5,
        },
        {
          entityId: 'reactor-coolant',
          attribute: 'temp_inlet_c',
          value: '18',
          confidence: 0.98,
          source: 'temp-sensor',
          staleness_s: 5,
        },
      ],
      constraints: [
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          operator: '>=',
          threshold: 50,
          description: 'Minimum coolant flow',
        },
      ],
      actions: [
        {
          id: 'activate_reactor',
          name: 'activate_reactor',
          impactedEntityNames: ['ReactorCoolant'],
        },
      ],
    },
  },

  {
    id: 'cal-vld-008',
    name: 'Release API with no active dependencies broken',
    description:
      'APIModule dependencies all satisfied. High-confidence, fresh version claims.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'api', 'release'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'api-module', name: 'APIModule', type: 'service' },
        { id: 'downstream', name: 'DownstreamService', type: 'service' },
      ],
      claims: [
        {
          entityId: 'api-module',
          attribute: 'version',
          value: '5.0.0',
          confidence: 0.99,
          source: 'registry',
          staleness_s: 45,
        },
        {
          entityId: 'downstream',
          attribute: 'compatibility',
          value: 'v5-ready',
          confidence: 0.95,
          source: 'registry',
          staleness_s: 45,
        },
      ],
      dependencies: [],
      constraints: [],
      actions: [
        {
          id: 'release_api',
          name: 'release_api',
          impactedEntityNames: ['APIModule'],
        },
      ],
    },
  },

  {
    id: 'cal-vld-009',
    name: 'Slew antenna with controller temperature nominal',
    description:
      'AntennaController.temp_c = 42 well below 85 limit. Fresh readings.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'antenna', 'nominal'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'ant-ctrl', name: 'AntennaController', type: 'subsystem' }],
      claims: [
        {
          entityId: 'ant-ctrl',
          attribute: 'temp_c',
          value: '42',
          confidence: 0.97,
          source: 'thermal-monitor',
          staleness_s: 15,
        },
      ],
      constraints: [
        {
          entityId: 'ant-ctrl',
          attribute: 'temp_c',
          operator: '<=',
          threshold: 85,
          description: 'Max controller temperature',
        },
      ],
      actions: [
        {
          id: 'slew_antenna',
          name: 'slew_antenna',
          impactedEntityNames: ['AntennaController'],
        },
      ],
    },
  },

  {
    id: 'cal-vld-010',
    name: 'Open fuel valve with tank pressure nominal',
    description:
      'FuelTank.pressure_psi = 2800 below 3000 max. Safe to open valve.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'fuel', 'valve'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'fuel-tank', name: 'FuelTank', type: 'component' }],
      claims: [
        {
          entityId: 'fuel-tank',
          attribute: 'pressure_psi',
          value: '2800',
          confidence: 0.99,
          source: 'pressure-sensor',
          staleness_s: 8,
        },
      ],
      constraints: [
        {
          entityId: 'fuel-tank',
          attribute: 'pressure_psi',
          operator: '<=',
          threshold: 3000,
          description: 'Maximum safe pressure',
        },
      ],
      actions: [
        {
          id: 'open_release_valve',
          name: 'open_release_valve',
          impactedEntityNames: ['FuelTank'],
        },
      ],
    },
  },
];

// ─── BRANCH_DEPENDENT (10) ────────────────────────────────────────────────────

const branchDependent: ScenarioV2[] = [
  {
    id: 'cal-brd-001',
    name: 'Deploy with conflicting CPU load reports on target server',
    description:
      'ServerNode.cpu_load_pct reported as 35 by monitor-a and 88 by monitor-b. ' +
      'Action deploy_app impacts ServerNode → open branch blocks classification.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'contradiction', 'deploy'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'server-node', name: 'ServerNode', type: 'service' }],
      claims: [
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          value: '35',
          confidence: 0.8,
          source: 'monitor-a',
        },
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          value: '88',
          confidence: 0.8,
          source: 'monitor-b',
        },
      ],
      branches: [
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          isOpen: true,
          candidates: ['35', '88'],
        },
      ],
      constraints: [
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          operator: '<=',
          threshold: 80,
          description: 'CPU cap for deployment',
        },
      ],
      actions: [
        {
          id: 'deploy_app',
          name: 'deploy_app',
          impactedEntityNames: ['ServerNode'],
        },
      ],
    },
  },

  {
    id: 'cal-brd-002',
    name: 'Release build with branched test pass rate',
    description:
      'BuildArtifact.test_pass_rate is 0.97 from ci-a, 0.74 from ci-b. Branch open.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'software', 'release'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'build-artifact', name: 'BuildArtifact', type: 'artifact' }],
      claims: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          value: '0.97',
          confidence: 0.85,
          source: 'ci-a',
        },
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          value: '0.74',
          confidence: 0.85,
          source: 'ci-b',
        },
      ],
      branches: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          isOpen: true,
          candidates: ['0.97', '0.74'],
        },
      ],
      constraints: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          operator: '>=',
          threshold: 0.95,
          description: 'Minimum test pass rate',
        },
      ],
      actions: [
        {
          id: 'release_build',
          name: 'release_build',
          impactedEntityNames: ['BuildArtifact'],
        },
      ],
    },
  },

  {
    id: 'cal-brd-003',
    name: 'Ignite thrusters with branched pressure reading',
    description:
      'ThrusterSystem.pressure_bar: 130 (sensor-a) vs 68 (sensor-b). Branch unresolved.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'thruster', 'safety_critical'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'thruster-sys', name: 'ThrusterSystem', type: 'subsystem' }],
      claims: [
        {
          entityId: 'thruster-sys',
          attribute: 'pressure_bar',
          value: '130',
          confidence: 0.75,
          source: 'sensor-a',
        },
        {
          entityId: 'thruster-sys',
          attribute: 'pressure_bar',
          value: '68',
          confidence: 0.75,
          source: 'sensor-b',
        },
      ],
      branches: [
        {
          entityId: 'thruster-sys',
          attribute: 'pressure_bar',
          isOpen: true,
          candidates: ['130', '68'],
        },
      ],
      constraints: [
        {
          entityId: 'thruster-sys',
          attribute: 'pressure_bar',
          operator: '>=',
          threshold: 100,
          description: 'Minimum ignition pressure',
        },
      ],
      actions: [
        {
          id: 'ignite_thrusters',
          name: 'ignite_thrusters',
          impactedEntityNames: ['ThrusterSystem'],
        },
      ],
    },
  },

  {
    id: 'cal-brd-004',
    name: 'Approve inspection with branched crack index',
    description:
      'StructuralComponent.crack_index: 0.31 (scan-a) vs 0.67 (scan-b). Branch open.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'structural', 'approve'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'struct-comp', name: 'StructuralComponent', type: 'component' }],
      claims: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          value: '0.31',
          confidence: 0.78,
          source: 'scan-a',
        },
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          value: '0.67',
          confidence: 0.78,
          source: 'scan-b',
        },
      ],
      branches: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          isOpen: true,
          candidates: ['0.31', '0.67'],
        },
      ],
      constraints: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          operator: '<=',
          threshold: 0.5,
          description: 'Maximum crack index',
        },
      ],
      actions: [
        {
          id: 'approve_inspection',
          name: 'approve_inspection',
          impactedEntityNames: ['StructuralComponent'],
        },
      ],
    },
  },

  {
    id: 'cal-brd-005',
    name: 'Activate reactor with branched coolant flow',
    description:
      'ReactorCoolant.flow_lpm: 80 (flowmeter-new) vs 22 (flowmeter-old). Unresolved branch.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'coolant', 'reactor'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'reactor-coolant', name: 'ReactorCoolant', type: 'component' }],
      claims: [
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          value: '80',
          confidence: 0.8,
          source: 'flowmeter-new',
        },
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          value: '22',
          confidence: 0.8,
          source: 'flowmeter-old',
        },
      ],
      branches: [
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          isOpen: true,
          candidates: ['80', '22'],
        },
      ],
      constraints: [
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          operator: '>=',
          threshold: 50,
          description: 'Minimum coolant flow',
        },
      ],
      actions: [
        {
          id: 'activate_reactor',
          name: 'activate_reactor',
          impactedEntityNames: ['ReactorCoolant'],
        },
      ],
    },
  },

  {
    id: 'cal-brd-006',
    name: 'Deploy ML model with branched accuracy report',
    description:
      'MLModel.accuracy: 0.97 (eval-a) vs 0.81 (eval-b). Branch open — eval run discrepancy.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'ml', 'deploy'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'ml-model', name: 'MLModel', type: 'artifact' }],
      claims: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          value: '0.97',
          confidence: 0.82,
          source: 'eval-a',
        },
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          value: '0.81',
          confidence: 0.82,
          source: 'eval-b',
        },
      ],
      branches: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          isOpen: true,
          candidates: ['0.97', '0.81'],
        },
      ],
      constraints: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          operator: '>=',
          threshold: 0.95,
          description: 'Target accuracy for deployment',
        },
      ],
      actions: [
        {
          id: 'deploy_model',
          name: 'deploy_model',
          impactedEntityNames: ['MLModel'],
        },
      ],
    },
  },

  {
    id: 'cal-brd-007',
    name: 'Release package with branched schema version',
    description:
      'DataPackage.schema_version: 3.0 (registry-a) vs 4.0 (registry-b). Branch open.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'data', 'release'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'data-pkg', name: 'DataPackage', type: 'artifact' }],
      claims: [
        {
          entityId: 'data-pkg',
          attribute: 'schema_version',
          value: '3.0',
          confidence: 0.77,
          source: 'registry-a',
        },
        {
          entityId: 'data-pkg',
          attribute: 'schema_version',
          value: '4.0',
          confidence: 0.77,
          source: 'registry-b',
        },
      ],
      branches: [
        {
          entityId: 'data-pkg',
          attribute: 'schema_version',
          isOpen: true,
          candidates: ['3.0', '4.0'],
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'release_package',
          name: 'release_package',
          impactedEntityNames: ['DataPackage'],
        },
      ],
    },
  },

  {
    id: 'cal-brd-008',
    name: 'Finalize burn with branched delta-v estimate',
    description:
      'PropulsionModule.dv_remaining_ms: 120 (nav-a) vs 38 (nav-b). Branch open.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'propulsion', 'finalize'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'prop-module', name: 'PropulsionModule', type: 'subsystem' }],
      claims: [
        {
          entityId: 'prop-module',
          attribute: 'dv_remaining_ms',
          value: '120',
          confidence: 0.76,
          source: 'nav-a',
        },
        {
          entityId: 'prop-module',
          attribute: 'dv_remaining_ms',
          value: '38',
          confidence: 0.76,
          source: 'nav-b',
        },
      ],
      branches: [
        {
          entityId: 'prop-module',
          attribute: 'dv_remaining_ms',
          isOpen: true,
          candidates: ['120', '38'],
        },
      ],
      constraints: [
        {
          entityId: 'prop-module',
          attribute: 'dv_remaining_ms',
          operator: '>=',
          threshold: 50,
          description: 'Minimum delta-v reserve',
        },
      ],
      actions: [
        {
          id: 'finalize_burn',
          name: 'finalize_burn',
          impactedEntityNames: ['PropulsionModule'],
        },
      ],
    },
  },

  {
    id: 'cal-brd-009',
    name: 'Open valve with branched tank pressure',
    description:
      'FuelTank.pressure_psi: 2750 (sensor-a) vs 3150 (sensor-b). Branch open.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'fuel', 'valve'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'fuel-tank', name: 'FuelTank', type: 'component' }],
      claims: [
        {
          entityId: 'fuel-tank',
          attribute: 'pressure_psi',
          value: '2750',
          confidence: 0.79,
          source: 'sensor-a',
        },
        {
          entityId: 'fuel-tank',
          attribute: 'pressure_psi',
          value: '3150',
          confidence: 0.79,
          source: 'sensor-b',
        },
      ],
      branches: [
        {
          entityId: 'fuel-tank',
          attribute: 'pressure_psi',
          isOpen: true,
          candidates: ['2750', '3150'],
        },
      ],
      constraints: [
        {
          entityId: 'fuel-tank',
          attribute: 'pressure_psi',
          operator: '<=',
          threshold: 3000,
          description: 'Maximum safe pressure',
        },
      ],
      actions: [
        {
          id: 'open_release_valve',
          name: 'open_release_valve',
          impactedEntityNames: ['FuelTank'],
        },
      ],
    },
  },

  {
    id: 'cal-brd-010',
    name: 'Finalize calibration with branched reference temperature',
    description:
      'CalibrationTarget.reference_temp_c: 20.0 (ref-a) vs 25.8 (ref-b). Branch open.',
    familyId: FAMILY,
    category: 'branch',
    tags: ['branch_dependent', 'calibration', 'sensor'],
    expectedAction: 'BRANCH_DEPENDENT',
    setup: {
      entities: [{ id: 'cal-target', name: 'CalibrationTarget', type: 'component' }],
      claims: [
        {
          entityId: 'cal-target',
          attribute: 'reference_temp_c',
          value: '20.0',
          confidence: 0.8,
          source: 'ref-a',
        },
        {
          entityId: 'cal-target',
          attribute: 'reference_temp_c',
          value: '25.8',
          confidence: 0.8,
          source: 'ref-b',
        },
      ],
      branches: [
        {
          entityId: 'cal-target',
          attribute: 'reference_temp_c',
          isOpen: true,
          candidates: ['20.0', '25.8'],
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'finalize_calibration',
          name: 'finalize_calibration',
          impactedEntityNames: ['CalibrationTarget'],
        },
      ],
    },
  },
];

// ─── Export ───────────────────────────────────────────────────────────────────

export function generateCalibrationScenarios(): ScenarioV2[] {
  return [...blocked, ...risky, ...valid, ...branchDependent];
}
