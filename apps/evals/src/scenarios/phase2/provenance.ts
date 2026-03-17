/**
 * Phase 2 — Provenance Fragility Scenarios
 *
 * Tests how the engine responds to weak, broken, or unverifiable provenance chains.
 * PF = 1 - mean_confidence_of_provenance_chain
 *
 * A high PF (→ 1.0) occurs when:
 *  - Provenance chain confidence is very low (source unverified, chain broken)
 *  - Multiple hops in derivation chain each reduce confidence
 *  - Claims sourced from deprecated/retired systems
 *
 * 20 scenarios: 7 BLOCKED · 7 RISKY · 6 VALID
 */

import { ScenarioV2, ScenarioFamily } from '../types';

const FAMILY: ScenarioFamily = 'provenance';

// ─── BLOCKED (7) ──────────────────────────────────────────────────────────────

const provenanceBlocked: ScenarioV2[] = [
  {
    id: 'prv-blk-001',
    name: 'Approve with fully unverifiable provenance chain',
    description:
      'MedicalDevice claims sourced from an unknown system (provenanceConfidence=0.05). ' +
      'temp_c = 48 violates <= 42. PF ≈ 0.95 + CVR high → BLOCKED.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['blocked', 'unknown_source', 'safety_critical'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'medical-device', name: 'MedicalDevice', type: 'component' }],
      claims: [
        {
          entityId: 'medical-device',
          attribute: 'temp_c',
          value: '48',
          confidence: 0.5,
          source: 'unknown-iot-gateway',
          provenanceConfidence: 0.05,
        },
      ],
      constraints: [
        {
          entityId: 'medical-device',
          attribute: 'temp_c',
          operator: '<=',
          threshold: 42,
          description: 'Maximum safe operating temperature',
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
    id: 'prv-blk-002',
    name: 'Release build sourced from retired CI system with violation',
    description:
      'BuildArtifact claims from retired-ci (provenanceConfidence=0.08). ' +
      'test_pass_rate = 0.78 violates >= 0.95. ' +
      'PF ≈ 0.92 + CVR high → BLOCKED.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['blocked', 'retired_source', 'constraint_violation'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'build-artifact', name: 'BuildArtifact', type: 'artifact' }],
      claims: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          value: '0.78',
          confidence: 0.4,
          source: 'retired-ci',
          provenanceConfidence: 0.08,
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
    id: 'prv-blk-003',
    name: 'Deploy firmware from unregistered source with version violation',
    description:
      'FirmwareImage from unregistered-vendor (provenanceConfidence=0.1). ' +
      'semver_minor = 0 violates >= 1. PF very high + CVR → BLOCKED.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['blocked', 'unregistered_source', 'firmware'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'firmware-image', name: 'FirmwareImage', type: 'artifact' }],
      claims: [
        {
          entityId: 'firmware-image',
          attribute: 'semver_minor',
          value: '0',
          confidence: 0.3,
          source: 'unregistered-vendor',
          provenanceConfidence: 0.1,
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
    id: 'prv-blk-004',
    name: 'Approve drug batch with 4-hop derivation chain',
    description:
      'DrugBatch purity_pct derived through 4-step chain, each step 0.5 confidence. ' +
      'Effective PF ≈ 0.94. contaminant_ppm = 6 violates <= 5. BLOCKED.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['blocked', 'long_chain', 'safety_critical'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'drug-batch', name: 'DrugBatch', type: 'artifact' }],
      claims: [
        {
          entityId: 'drug-batch',
          attribute: 'contaminant_ppm',
          value: '6',
          confidence: 0.35,
          source: 'derived-4-hop',
          provenanceConfidence: 0.06,
        },
        {
          entityId: 'drug-batch',
          attribute: 'purity_pct',
          value: '97.8',
          confidence: 0.35,
          source: 'derived-4-hop',
          provenanceConfidence: 0.06,
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
    id: 'prv-blk-005',
    name: 'Finalize structural inspection from forged scan report',
    description:
      'StructuralComponent claims from suspected-forged-scan (provenanceConfidence=0.02). ' +
      'crack_index = 0.65 violates <= 0.50. BLOCKED.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['blocked', 'forged_provenance', 'structural'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'struct-comp', name: 'StructuralComponent', type: 'component' }],
      claims: [
        {
          entityId: 'struct-comp',
          attribute: 'crack_index',
          value: '0.65',
          confidence: 0.25,
          source: 'suspected-forged-scan',
          provenanceConfidence: 0.02,
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
    id: 'prv-blk-006',
    name: 'Launch with guidance data from deprecated satellite constellation',
    description:
      'GuidanceSystem accuracy sourced from decommissioned-gps (provenanceConfidence=0.07). ' +
      'accuracy_m = 380 violates <= 100. BLOCKED.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['blocked', 'decommissioned_source', 'launch'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'guidance-sys', name: 'GuidanceSystem', type: 'subsystem' }],
      claims: [
        {
          entityId: 'guidance-sys',
          attribute: 'accuracy_m',
          value: '380',
          confidence: 0.3,
          source: 'decommissioned-gps',
          provenanceConfidence: 0.07,
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
    id: 'prv-blk-007',
    name: 'Deploy ML model from untrusted training pipeline',
    description:
      'MLModel accuracy from untrusted-training-env (provenanceConfidence=0.04). ' +
      'accuracy = 0.82 violates >= 0.95. BLOCKED.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['blocked', 'untrusted_source', 'ml'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'ml-model', name: 'MLModel', type: 'artifact' }],
      claims: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          value: '0.82',
          confidence: 0.2,
          source: 'untrusted-training-env',
          provenanceConfidence: 0.04,
        },
      ],
      constraints: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          operator: '>=',
          threshold: 0.95,
          description: 'Minimum accuracy',
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
];

// ─── RISKY (7) ────────────────────────────────────────────────────────────────

const provenanceRisky: ScenarioV2[] = [
  {
    id: 'prv-rsk-001',
    name: 'Approve with weak but not broken provenance chain',
    description:
      'PipelineStage from intermediary-aggregator (provenanceConfidence=0.55). ' +
      'No constraint violation, but PF = 0.45 → elevated fragility.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['risky', 'weak_provenance', 'approve'],
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
          value: '0.92',
          confidence: 0.65,
          source: 'intermediary-aggregator',
          provenanceConfidence: 0.55,
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
    id: 'prv-rsk-002',
    name: 'Release firmware from 2-hop derivation chain',
    description:
      'FirmwareImage from 2-hop chain (provenanceConfidence=0.45). ' +
      'Version satisfies constraint but PF = 0.55 — moderate fragility.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['risky', 'multi_hop', 'firmware'],
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
          value: '2',
          confidence: 0.7,
          source: 'vendor-proxy',
          provenanceConfidence: 0.45,
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
    id: 'prv-rsk-003',
    name: 'Deploy ML model from partially verified pipeline',
    description:
      'MLModel claims from partially-verified-training (provenanceConfidence=0.5). ' +
      'accuracy = 0.97 satisfies constraint but PF = 0.50.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['risky', 'partial_verification', 'ml'],
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
          value: '0.97',
          confidence: 0.72,
          source: 'partially-verified-training',
          provenanceConfidence: 0.5,
        },
      ],
      constraints: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          operator: '>=',
          threshold: 0.95,
          description: 'Minimum accuracy',
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
    id: 'prv-rsk-004',
    name: 'Release API with re-exported claim (confidence diluted)',
    description:
      'APIModule version claim re-exported through 2 registries (provenanceConfidence=0.52). ' +
      'No constraint violation. PF ≈ 0.48.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['risky', 're_exported', 'release'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'api-module', name: 'APIModule', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'api-module',
          attribute: 'version',
          value: '3.1.0',
          confidence: 0.75,
          source: 'proxy-registry',
          provenanceConfidence: 0.52,
        },
      ],
      constraints: [],
      dependencies: [
        { fromEntityId: 'api-module', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
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
    id: 'prv-rsk-005',
    name: 'Approve batch from single-lab with unconfirmed chain of custody',
    description:
      'DrugBatch from single-lab-uncertified (provenanceConfidence=0.48). ' +
      'purity within spec. PF = 0.52 contributes to Psi.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['risky', 'unconfirmed_custody', 'approve'],
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
          value: '98.8',
          confidence: 0.7,
          source: 'single-lab-uncertified',
          provenanceConfidence: 0.48,
        },
        {
          entityId: 'drug-batch',
          attribute: 'contaminant_ppm',
          value: '2.5',
          confidence: 0.7,
          source: 'single-lab-uncertified',
          provenanceConfidence: 0.48,
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
    id: 'prv-rsk-006',
    name: 'Deploy service with claims from shadow-monitoring agent',
    description:
      'ServiceInstance metrics from non-production monitoring agent (provenanceConfidence=0.45). ' +
      'error_rate satisfies SLO, but provenance fragility is a concern.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['risky', 'shadow_source', 'deploy'],
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
          value: '0.005',
          confidence: 0.68,
          source: 'shadow-monitoring',
          provenanceConfidence: 0.45,
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

  {
    id: 'prv-rsk-007',
    name: 'Activate backup with claims from unaudited sensor',
    description:
      'BackupPower claims from unaudited-sensor (provenanceConfidence=0.5). ' +
      'Voltage satisfies constraint. PF ≈ 0.50.',
    familyId: FAMILY,
    category: 'provenance',
    tags: ['risky', 'unaudited_source', 'power'],
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
          value: '48.0',
          confidence: 0.72,
          source: 'unaudited-sensor',
          provenanceConfidence: 0.5,
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
];

// ─── VALID (6) ────────────────────────────────────────────────────────────────

const provenanceValid: ScenarioV2[] = [
  {
    id: 'prv-vld-001',
    name: 'Approve device with certified and audited source chain',
    description:
      'MedicalDevice claims from certified-lab-v2 (provenanceConfidence=0.97). ' +
      'temp_c = 38 within 42 limit. Low PF, low CVR → VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'certified_source', 'approve'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'medical-device', name: 'MedicalDevice', type: 'component' }],
      claims: [
        {
          entityId: 'medical-device',
          attribute: 'temp_c',
          value: '38',
          confidence: 0.98,
          source: 'certified-lab-v2',
          provenanceConfidence: 0.97,
        },
      ],
      constraints: [
        {
          entityId: 'medical-device',
          attribute: 'temp_c',
          operator: '<=',
          threshold: 42,
          description: 'Max operating temperature',
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
    id: 'prv-vld-002',
    name: 'Release build from fully verified CI pipeline',
    description:
      'BuildArtifact from verified-ci-v3 (provenanceConfidence=0.99). ' +
      'test_pass_rate = 0.98 satisfies constraint. PF ≈ 0.01 → VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'verified_source', 'release'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'build-artifact', name: 'BuildArtifact', type: 'artifact' }],
      claims: [
        {
          entityId: 'build-artifact',
          attribute: 'test_pass_rate',
          value: '0.98',
          confidence: 0.99,
          source: 'verified-ci-v3',
          provenanceConfidence: 0.99,
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
    id: 'prv-vld-003',
    name: 'Deploy ML model from signed, audited training pipeline',
    description:
      'MLModel from signed-training-pipeline (provenanceConfidence=0.95). ' +
      'accuracy = 0.97 satisfies constraint. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'signed_source', 'ml'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'ml-model', name: 'MLModel', type: 'artifact' }],
      claims: [
        {
          entityId: 'ml-model',
          attribute: 'accuracy',
          value: '0.97',
          confidence: 0.96,
          source: 'signed-training-pipeline',
          provenanceConfidence: 0.95,
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
    id: 'prv-vld-004',
    name: 'Approve drug batch with GMP-certified laboratory',
    description:
      'DrugBatch from gmp-certified-lab (provenanceConfidence=0.96). ' +
      'All within spec. PF ≈ 0.04 → VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'certified_source', 'approve'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'drug-batch', name: 'DrugBatch', type: 'artifact' }],
      claims: [
        {
          entityId: 'drug-batch',
          attribute: 'purity_pct',
          value: '99.4',
          confidence: 0.97,
          source: 'gmp-certified-lab',
          provenanceConfidence: 0.96,
        },
        {
          entityId: 'drug-batch',
          attribute: 'contaminant_ppm',
          value: '1.0',
          confidence: 0.97,
          source: 'gmp-certified-lab',
          provenanceConfidence: 0.96,
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
    id: 'prv-vld-005',
    name: 'Deploy service with metrics from trusted observability platform',
    description:
      'ServiceInstance from trusted-observability-v2 (provenanceConfidence=0.94). ' +
      'error_rate = 0.001. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'trusted_source', 'deploy'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'svc-instance', name: 'ServiceInstance', type: 'service' }],
      claims: [
        {
          entityId: 'svc-instance',
          attribute: 'error_rate',
          value: '0.001',
          confidence: 0.98,
          source: 'trusted-observability-v2',
          provenanceConfidence: 0.94,
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
    id: 'prv-vld-006',
    name: 'Activate reactor with claims from certified instrumentation',
    description:
      'ReactorCoolant from iso-certified-instruments (provenanceConfidence=0.98). ' +
      'flow_lpm = 68 satisfies >= 50. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'certified_source', 'reactor'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'reactor-coolant', name: 'ReactorCoolant', type: 'component' }],
      claims: [
        {
          entityId: 'reactor-coolant',
          attribute: 'flow_lpm',
          value: '68',
          confidence: 0.98,
          source: 'iso-certified-instruments',
          provenanceConfidence: 0.98,
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
];

// ─── Export ───────────────────────────────────────────────────────────────────

export function generateProvenanceScenarios(): ScenarioV2[] {
  return [...provenanceBlocked, ...provenanceRisky, ...provenanceValid];
}
