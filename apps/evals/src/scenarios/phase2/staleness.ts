/**
 * Phase 2 — Staleness Benchmark Scenarios
 *
 * Tests how the engine responds to claims of varying age.
 * Staleness formula: 1 - exp(-0.001 * deltaSeconds)
 *   - 60s  → ~0.06  (fresh)
 *   - 600s → ~0.45  (moderate)
 *   - 2000s → ~0.86  (stale)
 *   - 5000s → ~0.99  (very stale)
 *
 * UE = meanStaleness × (1 - meanConfidence)
 *
 * 25 scenarios split: 8 BLOCKED · 9 RISKY · 8 VALID
 */

import { ScenarioV2, ScenarioFamily } from '../types';

const FAMILY: ScenarioFamily = 'staleness';

// ─── BLOCKED / high staleness + constraint violation ─────────────────────────

const staleBlocked: ScenarioV2[] = [
  {
    id: 'stl-blk-001',
    name: 'Approve medical device with very stale safety readings',
    description:
      'MedicalDevice.temp_c claims are 4500s old (staleness ≈ 0.989), confidence 0.5. ' +
      'temp_c = 48 exceeds max 42. UE very high. Action approve_device impacts MedicalDevice.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['blocked', 'very_stale', 'safety_critical'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'medical-device', name: 'MedicalDevice', type: 'component' }],
      claims: [
        {
          entityId: 'medical-device',
          attribute: 'temp_c',
          value: '48',
          confidence: 0.5,
          source: 'legacy-monitor',
          staleness_s: 4500,
        },
        {
          entityId: 'medical-device',
          attribute: 'status',
          value: 'unknown',
          confidence: 0.45,
          source: 'legacy-monitor',
          staleness_s: 4500,
        },
      ],
      constraints: [
        {
          entityId: 'medical-device',
          attribute: 'temp_c',
          operator: '<=',
          threshold: 42,
          description: 'Maximum operating temperature',
        },
      ],
      actions: [
        {
          id: 'approve_device',
          name: 'approve_device',
          impactedEntityNames: ['MedicalDevice'],
        },
      ],
    },
  },

  {
    id: 'stl-blk-002',
    name: 'Release pipeline stage with stale + violated constraint',
    description:
      'PipelineStage claims 3600s old (staleness ≈ 0.973). test_pass_rate = 0.80 < 0.95. ' +
      'Action release_stage directly impacts PipelineStage.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['blocked', 'stale', 'constraint_violation'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'pipeline-stage', name: 'PipelineStage', type: 'artifact' }],
      claims: [
        {
          entityId: 'pipeline-stage',
          attribute: 'test_pass_rate',
          value: '0.80',
          confidence: 0.65,
          source: 'old-ci',
          staleness_s: 3600,
        },
      ],
      constraints: [
        {
          entityId: 'pipeline-stage',
          attribute: 'test_pass_rate',
          operator: '>=',
          threshold: 0.95,
          description: 'Minimum test pass rate',
        },
      ],
      actions: [
        {
          id: 'release_stage',
          name: 'release_stage',
          impactedEntityNames: ['PipelineStage'],
        },
      ],
    },
  },

  {
    id: 'stl-blk-003',
    name: 'Finalize mission with all claims exceeding TTL',
    description:
      'MissionSystem claims 5000s old (staleness ≈ 0.993), confidence 0.4. ' +
      'cpu_load_pct = 95 violates <= 90. Action finalize_mission impacts MissionSystem.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['blocked', 'expired_ttl', 'finalize'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'mission-sys', name: 'MissionSystem', type: 'system' }],
      claims: [
        {
          entityId: 'mission-sys',
          attribute: 'cpu_load_pct',
          value: '95',
          confidence: 0.4,
          source: 'outdated-telemetry',
          staleness_s: 5000,
        },
        {
          entityId: 'mission-sys',
          attribute: 'memory_free_mb',
          value: '30',
          confidence: 0.4,
          source: 'outdated-telemetry',
          staleness_s: 5000,
        },
      ],
      constraints: [
        {
          entityId: 'mission-sys',
          attribute: 'cpu_load_pct',
          operator: '<=',
          threshold: 90,
          description: 'Max CPU during finalization',
        },
      ],
      actions: [
        {
          id: 'finalize_mission',
          name: 'finalize_mission',
          impactedEntityNames: ['MissionSystem'],
        },
      ],
    },
  },

  {
    id: 'stl-blk-004',
    name: 'Deploy firmware with 2-hour-old version claims',
    description:
      'FirmwareImage claims 7200s old (staleness ≈ 0.999), confidence 0.35. ' +
      'version = 1.0.2 violates >= 1.1.0. Action deploy_firmware impacts FirmwareImage.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['blocked', 'very_stale', 'firmware'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'firmware-image', name: 'FirmwareImage', type: 'artifact' }],
      claims: [
        {
          entityId: 'firmware-image',
          attribute: 'semver_minor',
          value: '0',
          confidence: 0.35,
          source: 'old-registry',
          staleness_s: 7200,
        },
      ],
      constraints: [
        {
          entityId: 'firmware-image',
          attribute: 'semver_minor',
          operator: '>=',
          threshold: 1,
          description: 'Minimum minor version requirement',
        },
      ],
      actions: [
        {
          id: 'deploy_firmware',
          name: 'deploy_firmware',
          impactedEntityNames: ['FirmwareImage'],
        },
      ],
    },
  },

  {
    id: 'stl-blk-005',
    name: 'Approve drug batch with stale purity readings and violation',
    description:
      'DrugBatch.contaminant_ppm claims 2500s old. Violation: contaminant_ppm = 8 > 5. ' +
      'Action approve_batch impacts DrugBatch.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['blocked', 'stale', 'safety_critical'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'drug-batch', name: 'DrugBatch', type: 'artifact' }],
      claims: [
        {
          entityId: 'drug-batch',
          attribute: 'contaminant_ppm',
          value: '8',
          confidence: 0.6,
          source: 'lab-old',
          staleness_s: 2500,
        },
        {
          entityId: 'drug-batch',
          attribute: 'purity_pct',
          value: '97.1',
          confidence: 0.58,
          source: 'lab-old',
          staleness_s: 2500,
        },
      ],
      constraints: [
        {
          entityId: 'drug-batch',
          attribute: 'contaminant_ppm',
          operator: '<=',
          threshold: 5,
          description: 'Maximum contamination level',
        },
      ],
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
    id: 'stl-blk-006',
    name: 'Proceed to launch with stale guidance lock and violation',
    description:
      'GuidanceSystem claims 4000s old. accuracy_m = 350 > 100. ' +
      'Very high UE and CVR together. Action proceed_to_launch impacts GuidanceSystem.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['blocked', 'stale_and_violation', 'launch'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'guidance-sys', name: 'GuidanceSystem', type: 'subsystem' }],
      claims: [
        {
          entityId: 'guidance-sys',
          attribute: 'accuracy_m',
          value: '350',
          confidence: 0.5,
          source: 'backup-gps',
          staleness_s: 4000,
        },
      ],
      constraints: [
        {
          entityId: 'guidance-sys',
          attribute: 'accuracy_m',
          operator: '<=',
          threshold: 100,
          description: 'Maximum guidance error at launch',
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

  {
    id: 'stl-blk-007',
    name: 'Release API with stale error-rate claim above SLO',
    description:
      'ServiceInstance claims 3200s old. error_rate = 0.04 > 0.01 SLO. ' +
      'Action deploy_service impacts ServiceInstance.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['blocked', 'stale', 'slo_breach'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'svc-instance', name: 'ServiceInstance', type: 'service' }],
      claims: [
        {
          entityId: 'svc-instance',
          attribute: 'error_rate',
          value: '0.04',
          confidence: 0.55,
          source: 'old-metrics',
          staleness_s: 3200,
        },
      ],
      constraints: [
        {
          entityId: 'svc-instance',
          attribute: 'error_rate',
          operator: '<=',
          threshold: 0.01,
          description: 'SLO error rate cap',
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
    id: 'stl-blk-008',
    name: 'Activate backup power with stale voltage below threshold',
    description:
      'BackupPower claims 6000s old. voltage_v = 36 < 42 minimum. ' +
      'Action activate_backup impacts BackupPower.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['blocked', 'very_stale', 'power'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'backup-power', name: 'BackupPower', type: 'component' }],
      claims: [
        {
          entityId: 'backup-power',
          attribute: 'voltage_v',
          value: '36',
          confidence: 0.45,
          source: 'dormant-sensor',
          staleness_s: 6000,
        },
      ],
      constraints: [
        {
          entityId: 'backup-power',
          attribute: 'voltage_v',
          operator: '>=',
          threshold: 42,
          description: 'Minimum operating voltage',
        },
      ],
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

// ─── RISKY / moderate staleness ───────────────────────────────────────────────

const staleRisky: ScenarioV2[] = [
  {
    id: 'stl-rsk-001',
    name: 'Deploy with moderately stale CPU claims (10 min old)',
    description:
      'ServerNode.cpu_load_pct claims 600s old (staleness ≈ 0.451), confidence 0.75. ' +
      'No constraint violation. Action deploy_app impacts ServerNode → UE elevated.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'moderate_stale', 'deploy'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'server-node', name: 'ServerNode', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          value: '62',
          confidence: 0.75,
          source: 'monitoring',
          staleness_s: 600,
        },
      ],
      constraints: [
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          operator: '<=',
          threshold: 80,
          description: 'CPU cap',
        },
      ],
      dependencies: [
        { fromEntityId: 'server-node', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
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
    id: 'stl-rsk-002',
    name: 'Approve with 15-minute-old claim and low confidence',
    description:
      'PipelineStage claims 900s old, confidence 0.55. No violation. ' +
      'UE = staleness(900) × (1-0.55) ≈ 0.585 × 0.45 ≈ 0.26. RISKY range.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'moderate_stale', 'low_confidence'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'pipeline-stage', name: 'PipelineStage', type: 'artifact' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'pipeline-stage',
          attribute: 'test_pass_rate',
          value: '0.91',
          confidence: 0.55,
          source: 'ci-pipeline',
          staleness_s: 900,
        },
      ],
      constraints: [],
      dependencies: [
        { fromEntityId: 'pipeline-stage', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
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
    id: 'stl-rsk-003',
    name: 'Release firmware with 20-minute-old version claim',
    description:
      'FirmwareImage claims 1200s old, confidence 0.7. No violation. Moderate staleness signal.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'moderate_stale', 'firmware'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'firmware-image', name: 'FirmwareImage', type: 'artifact' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'firmware-image',
          attribute: 'semver_minor',
          value: '3',
          confidence: 0.7,
          source: 'registry',
          staleness_s: 1200,
        },
      ],
      constraints: [
        {
          entityId: 'firmware-image',
          attribute: 'semver_minor',
          operator: '>=',
          threshold: 1,
          description: 'Minimum minor version',
        },
      ],
      dependencies: [
        { fromEntityId: 'firmware-image', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      actions: [
        {
          id: 'deploy_firmware',
          name: 'deploy_firmware',
          impactedEntityNames: ['FirmwareImage'],
        },
      ],
    },
  },

  {
    id: 'stl-rsk-004',
    name: 'Finalize calibration with 8-minute-old reference readings',
    description:
      'CalibrationTarget claims 480s old, confidence 0.65. ' +
      'Staleness contributes to UE without violating a hard constraint.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'moderate_stale', 'calibration'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'cal-target', name: 'CalibrationTarget', type: 'component' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'cal-target',
          attribute: 'reference_temp_c',
          value: '20.1',
          confidence: 0.65,
          source: 'reference-sensor',
          staleness_s: 480,
        },
      ],
      constraints: [],
      dependencies: [
        { fromEntityId: 'cal-target', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
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
    id: 'stl-rsk-005',
    name: 'Mixed staleness: one fresh, one stale claim on impacted entity',
    description:
      'StorageArray: capacity_tb fresh (30s), iops stale (1000s). ' +
      'Mean staleness elevated enough to push into RISKY territory.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'mixed_staleness', 'storage'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'storage-arr', name: 'StorageArray', type: 'component' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'storage-arr',
          attribute: 'capacity_tb',
          value: '120',
          confidence: 0.9,
          source: 'provisioner',
          staleness_s: 30,
        },
        {
          entityId: 'storage-arr',
          attribute: 'iops',
          value: '40000',
          confidence: 0.68,
          source: 'old-benchmark',
          staleness_s: 1000,
        },
      ],
      constraints: [],
      dependencies: [
        { fromEntityId: 'storage-arr', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
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
    id: 'stl-rsk-006',
    name: 'Approve batch with moderate staleness and slightly low confidence',
    description:
      'DrugBatch claims 750s old, confidence 0.68. purity_pct = 98.9, no violation. ' +
      'UE = staleness(750)*(1-0.68) ≈ 0.527*0.32 ≈ 0.17 — moderate UE.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'moderate_stale', 'approve'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'drug-batch', name: 'DrugBatch', type: 'artifact' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'drug-batch',
          attribute: 'purity_pct',
          value: '98.9',
          confidence: 0.68,
          source: 'lab-system',
          staleness_s: 750,
        },
        {
          entityId: 'drug-batch',
          attribute: 'contaminant_ppm',
          value: '1.8',
          confidence: 0.68,
          source: 'lab-system',
          staleness_s: 750,
        },
      ],
      constraints: [],
      dependencies: [
        { fromEntityId: 'drug-batch', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
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
    id: 'stl-rsk-007',
    name: 'Activate backup power with 12-minute-old voltage',
    description:
      'BackupPower claims 720s old, confidence 0.72. No violation.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'moderate_stale', 'power'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'backup-power', name: 'BackupPower', type: 'component' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'backup-power',
          attribute: 'voltage_v',
          value: '48.5',
          confidence: 0.72,
          source: 'power-monitor',
          staleness_s: 720,
        },
      ],
      constraints: [],
      dependencies: [
        { fromEntityId: 'backup-power', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      actions: [
        {
          id: 'activate_backup',
          name: 'activate_backup',
          impactedEntityNames: ['BackupPower'],
        },
      ],
    },
  },

  {
    id: 'stl-rsk-008',
    name: 'Deploy model with 18-minute-old eval metrics',
    description:
      'MLModel claims 1080s old, confidence 0.7. accuracy = 0.96 satisfies constraint. ' +
      'Moderate staleness → RISKY not BLOCKED.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'moderate_stale', 'ml'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'ml-model', name: 'MLModel', type: 'artifact' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          value: '0.96',
          confidence: 0.7,
          source: 'eval-pipeline',
          staleness_s: 1080,
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
      dependencies: [
        { fromEntityId: 'ml-model', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
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
    id: 'stl-rsk-009',
    name: 'Release service with 25-minute-old SLO metrics',
    description:
      'ServiceInstance claims 1500s old, confidence 0.65. error_rate = 0.004 satisfies SLO. ' +
      'Staleness alone pushes into RISKY band.',
    familyId: FAMILY,
    category: 'staleness',
    tags: ['risky', 'moderate_stale', 'slo'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'svc-instance', name: 'ServiceInstance', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'svc-instance',
          attribute: 'error_rate',
          value: '0.004',
          confidence: 0.65,
          source: 'metrics-collector',
          staleness_s: 1500,
        },
      ],
      constraints: [
        {
          entityId: 'svc-instance',
          attribute: 'error_rate',
          operator: '<=',
          threshold: 0.01,
          description: 'SLO error cap',
        },
      ],
      dependencies: [
        { fromEntityId: 'svc-instance', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
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
];

// ─── VALID / fresh claims ─────────────────────────────────────────────────────

const staleValid: ScenarioV2[] = [
  {
    id: 'stl-vld-001',
    name: 'Deploy app with 30-second-old CPU reading',
    description:
      'ServerNode claims 30s old, confidence 0.95. cpu_load_pct = 40 within limits.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'fresh', 'deploy'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'server-node', name: 'ServerNode', type: 'service' }],
      claims: [
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          value: '40',
          confidence: 0.95,
          source: 'monitoring',
          staleness_s: 30,
        },
      ],
      constraints: [
        {
          entityId: 'server-node',
          attribute: 'cpu_load_pct',
          operator: '<=',
          threshold: 80,
          description: 'CPU cap',
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
    id: 'stl-vld-002',
    name: 'Release build with just-completed CI run',
    description:
      'BuildArtifact claims 45s old, confidence 0.99. test_pass_rate = 0.98.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'fresh', 'release'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'build-artifact', name: 'BuildArtifact', type: 'artifact' }],
      claims: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          value: '0.98',
          confidence: 0.99,
          source: 'ci-pipeline',
          staleness_s: 45,
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
    id: 'stl-vld-003',
    name: 'Approve drug batch with freshly completed lab analysis',
    description:
      'DrugBatch claims 120s old, confidence 0.97. purity and contaminant within spec.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'fresh', 'approve'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'drug-batch', name: 'DrugBatch', type: 'artifact' }],
      claims: [
        {
          entityId: 'drug-batch',
          attribute: 'purity_pct',
          value: '99.2',
          confidence: 0.97,
          source: 'lab-fresh',
          staleness_s: 120,
        },
        {
          entityId: 'drug-batch',
          attribute: 'contaminant_ppm',
          value: '1.2',
          confidence: 0.97,
          source: 'lab-fresh',
          staleness_s: 120,
        },
      ],
      constraints: [
        {
          entityId: 'drug-batch',
          attribute: 'contaminant_ppm',
          operator: '<=',
          threshold: 5,
          description: 'Max contamination',
        },
      ],
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
    id: 'stl-vld-004',
    name: 'Activate reactor with real-time coolant readings',
    description:
      'ReactorCoolant claims 5s old, confidence 0.99. flow_lpm = 72 above 50 minimum.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'real_time', 'reactor'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'reactor-coolant', name: 'ReactorCoolant', type: 'component' }],
      claims: [
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          value: '72',
          confidence: 0.99,
          source: 'flow-sensor',
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
    id: 'stl-vld-005',
    name: 'Deploy firmware with freshly validated image',
    description:
      'FirmwareImage claims 90s old, confidence 0.98. semver_minor = 4 satisfies >= 1.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'fresh', 'firmware'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'firmware-image', name: 'FirmwareImage', type: 'artifact' }],
      claims: [
        {
          entityId: 'firmware-image',
          attribute: 'semver_minor',
          value: '4',
          confidence: 0.98,
          source: 'registry',
          staleness_s: 90,
        },
      ],
      constraints: [
        {
          entityId: 'firmware-image',
          attribute: 'semver_minor',
          operator: '>=',
          threshold: 1,
          description: 'Minimum minor version',
        },
      ],
      actions: [
        {
          id: 'deploy_firmware',
          name: 'deploy_firmware',
          impactedEntityNames: ['FirmwareImage'],
        },
      ],
    },
  },

  {
    id: 'stl-vld-006',
    name: 'Proceed to launch with just-acquired GPS lock',
    description:
      'GuidanceSystem claims 20s old, confidence 0.96. accuracy_m = 12 well within 100m limit.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'real_time', 'launch'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'guidance-sys', name: 'GuidanceSystem', type: 'subsystem' }],
      claims: [
        {
          entityId: 'guidance-sys',
          attribute: 'accuracy_m',
          value: '12',
          confidence: 0.96,
          source: 'gps-primary',
          staleness_s: 20,
        },
      ],
      constraints: [
        {
          entityId: 'guidance-sys',
          attribute: 'accuracy_m',
          operator: '<=',
          threshold: 100,
          description: 'Max guidance error',
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

  {
    id: 'stl-vld-007',
    name: 'Release API with real-time error rate metrics',
    description:
      'ServiceInstance claims 15s old, confidence 0.98. error_rate = 0.001 well within SLO.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'real_time', 'slo'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'svc-instance', name: 'ServiceInstance', type: 'service' }],
      claims: [
        {
          entityId: 'svc-instance',
          attribute: 'error_rate',
          value: '0.001',
          confidence: 0.98,
          source: 'metrics-collector',
          staleness_s: 15,
        },
      ],
      constraints: [
        {
          entityId: 'svc-instance',
          attribute: 'error_rate',
          operator: '<=',
          threshold: 0.01,
          description: 'SLO error cap',
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
    id: 'stl-vld-008',
    name: 'Approve inspection with 2-minute-old scan results',
    description:
      'StructuralComponent claims 120s old, confidence 0.97. crack_index = 0.15 well within 0.50.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'fresh', 'structural'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'struct-comp', name: 'StructuralComponent', type: 'component' }],
      claims: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          value: '0.15',
          confidence: 0.97,
          source: 'ndt-scan',
          staleness_s: 120,
        },
      ],
      constraints: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          operator: '<=',
          threshold: 0.5,
          description: 'Max crack index',
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
];

// ─── Export ───────────────────────────────────────────────────────────────────

export function generateStalenessScenarios(): ScenarioV2[] {
  return [...staleBlocked, ...staleRisky, ...staleValid];
}
