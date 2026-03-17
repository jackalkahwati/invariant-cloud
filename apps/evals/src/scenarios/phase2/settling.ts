/**
 * Phase 2 — Fixed-Point Settling vs Single-Pass Propagation Scenarios
 *
 * Tests whether the engine reaches a stable fixed-point after multi-hop
 * dependency updates, vs stopping after a single pass.
 *
 * Key scenario patterns:
 *  - A → B → C chain: invalidating A should propagate uncertainty through B to C
 *  - A → B, A → C, B → C: diamond dependency; C receives two invalidation paths
 *  - Cycles: A ↔ B: should detect cycle and not loop forever
 *  - Long chains (5+ hops): single-pass misses downstream effects
 *
 * 25 scenarios: 8 BLOCKED · 9 RISKY · 8 VALID
 */

import { ScenarioV2, ScenarioFamily } from '../types';

const FAMILY: ScenarioFamily = 'settling';

// ─── BLOCKED (8) — multi-hop invalidation reaches critical violation ──────────

const settlingBlocked: ScenarioV2[] = [
  {
    id: 'set-blk-001',
    name: 'A→B→C chain: upstream invalidation cascades to constrained leaf',
    description:
      'SensorA claims are invalid. SensorB depends on SensorA. ' +
      'ActuatorC depends on SensorB and has a constraint. ' +
      'Action activate_actuator impacts ActuatorC. ' +
      'After full settling, ActuatorC has no valid upstream → DBR high → BLOCKED.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'chain', '3hop'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'sensor-a', name: 'SensorA', type: 'component' },
        { id: 'sensor-b', name: 'SensorB', type: 'component' },
        { id: 'actuator-c', name: 'ActuatorC', type: 'component' },
      ],
      claims: [
        {
          entityId: 'actuator-c',
          attribute: 'pressure_bar',
          value: '45',
          confidence: 0.5,
          source: 'derived-chain',
        },
      ],
      dependencies: [
        {
          fromEntityId: 'sensor-b',
          toEntityId: 'sensor-a',
          type: 'REQUIRES',
          attribute: 'calibration_value',
        },
        {
          fromEntityId: 'actuator-c',
          toEntityId: 'sensor-b',
          type: 'REQUIRES',
          attribute: 'reading',
        },
      ],
      constraints: [
        {
          entityId: 'actuator-c',
          attribute: 'pressure_bar',
          operator: '>=',
          threshold: 100,
          description: 'Minimum actuator pressure',
        },
      ],
      invalidations: [
        { entityId: 'sensor-a', attribute: 'calibration_value', reason: 'hardware_failure' },
      ],
      actions: [
        {
          id: 'activate_actuator',
          name: 'activate_actuator',
          impactedEntityNames: ['ActuatorC'],
        },
      ],
    },
  },

  {
    id: 'set-blk-002',
    name: 'Diamond dependency: two invalidation paths converge on critical node',
    description:
      'Root invalidated. Left and Right both REQUIRE Root. ' +
      'OutputNode REQUIRES Left and Right. Action approve_output impacts OutputNode. ' +
      'Both paths carry violation → DBR very high.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'diamond', 'dual_path'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'root', name: 'Root', type: 'component' },
        { id: 'left', name: 'Left', type: 'component' },
        { id: 'right', name: 'Right', type: 'component' },
        { id: 'output-node', name: 'OutputNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'output-node',
          attribute: 'integrity_score',
          value: '0.3',
          confidence: 0.4,
          source: 'derived',
        },
      ],
      dependencies: [
        { fromEntityId: 'left', toEntityId: 'root', type: 'REQUIRES', attribute: 'value' },
        { fromEntityId: 'right', toEntityId: 'root', type: 'REQUIRES', attribute: 'value' },
        { fromEntityId: 'output-node', toEntityId: 'left', type: 'REQUIRES', attribute: 'computed' },
        { fromEntityId: 'output-node', toEntityId: 'right', type: 'REQUIRES', attribute: 'computed' },
      ],
      constraints: [
        {
          entityId: 'output-node',
          attribute: 'integrity_score',
          operator: '>=',
          threshold: 0.8,
          description: 'Minimum output integrity',
        },
      ],
      invalidations: [
        { entityId: 'root', attribute: 'value', reason: 'source_corrupted' },
      ],
      actions: [
        {
          id: 'approve_output',
          name: 'approve_output',
          impactedEntityNames: ['OutputNode'],
        },
      ],
    },
  },

  {
    id: 'set-blk-003',
    name: '5-hop chain: single-pass would miss leaf violation',
    description:
      'N1→N2→N3→N4→N5 chain. N1 invalidated. N5 has constraint violation. ' +
      'After settling, N5 has no valid upstream claims → DBR propagated fully.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', '5hop', 'long_chain'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'n1', name: 'N1', type: 'component' },
        { id: 'n2', name: 'N2', type: 'component' },
        { id: 'n3', name: 'N3', type: 'component' },
        { id: 'n4', name: 'N4', type: 'component' },
        { id: 'n5', name: 'N5', type: 'component' },
      ],
      claims: [
        {
          entityId: 'n5',
          attribute: 'output_voltage',
          value: '3.1',
          confidence: 0.45,
          source: 'derived-5hop',
        },
      ],
      dependencies: [
        { fromEntityId: 'n2', toEntityId: 'n1', type: 'REQUIRES', attribute: 'signal' },
        { fromEntityId: 'n3', toEntityId: 'n2', type: 'REQUIRES', attribute: 'signal' },
        { fromEntityId: 'n4', toEntityId: 'n3', type: 'REQUIRES', attribute: 'signal' },
        { fromEntityId: 'n5', toEntityId: 'n4', type: 'REQUIRES', attribute: 'signal' },
      ],
      constraints: [
        {
          entityId: 'n5',
          attribute: 'output_voltage',
          operator: '>=',
          threshold: 5.0,
          description: 'Minimum output voltage',
        },
      ],
      invalidations: [
        { entityId: 'n1', attribute: 'signal', reason: 'source_offline' },
      ],
      actions: [
        {
          id: 'activate_output',
          name: 'activate_output',
          impactedEntityNames: ['N5'],
        },
      ],
    },
  },

  {
    id: 'set-blk-004',
    name: 'Multi-update propagation: sequential updates destabilize downstream',
    description:
      'Config entity updated twice (A→B→C, then A updated again). ' +
      'Each update shifts C further from constraint. Fixed-point reveals cumulative effect.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'multi_update', 'cumulative'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'config-src', name: 'ConfigSource', type: 'system' },
        { id: 'config-derived', name: 'ConfigDerived', type: 'system' },
        { id: 'service-target', name: 'ServiceTarget', type: 'service' },
      ],
      claims: [
        {
          entityId: 'service-target',
          attribute: 'max_connections',
          value: '5',
          confidence: 0.5,
          source: 'config-pipeline',
        },
      ],
      dependencies: [
        {
          fromEntityId: 'config-derived',
          toEntityId: 'config-src',
          type: 'REQUIRES',
          attribute: 'base_config',
        },
        {
          fromEntityId: 'service-target',
          toEntityId: 'config-derived',
          type: 'REQUIRES',
          attribute: 'derived_config',
        },
      ],
      constraints: [
        {
          entityId: 'service-target',
          attribute: 'max_connections',
          operator: '>=',
          threshold: 100,
          description: 'Minimum connection pool size',
        },
      ],
      invalidations: [
        { entityId: 'config-src', attribute: 'base_config', reason: 'config_reset' },
      ],
      actions: [
        {
          id: 'deploy_service',
          name: 'deploy_service',
          impactedEntityNames: ['ServiceTarget'],
        },
      ],
    },
  },

  {
    id: 'set-blk-005',
    name: 'Shared dependency invalidation: two downstream consumers affected',
    description:
      'SharedLib invalidated. ServiceA and ServiceB both REQUIRE SharedLib. ' +
      'Action deploy impacts ServiceA directly. DBR elevated.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'shared_dependency', 'dual_consumer'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'shared-lib', name: 'SharedLib', type: 'component' },
        { id: 'service-a', name: 'ServiceA', type: 'service' },
        { id: 'service-b', name: 'ServiceB', type: 'service' },
      ],
      claims: [
        {
          entityId: 'service-a',
          attribute: 'startup_time_ms',
          value: '8000',
          confidence: 0.5,
          source: 'deployment-test',
        },
      ],
      dependencies: [
        {
          fromEntityId: 'service-a',
          toEntityId: 'shared-lib',
          type: 'REQUIRES',
          attribute: 'version',
        },
        {
          fromEntityId: 'service-b',
          toEntityId: 'shared-lib',
          type: 'REQUIRES',
          attribute: 'version',
        },
      ],
      constraints: [
        {
          entityId: 'service-a',
          attribute: 'startup_time_ms',
          operator: '<=',
          threshold: 3000,
          description: 'Maximum startup time',
        },
      ],
      invalidations: [
        { entityId: 'shared-lib', attribute: 'version', reason: 'breaking_change' },
      ],
      actions: [
        {
          id: 'deploy_service',
          name: 'deploy_service',
          impactedEntityNames: ['ServiceA'],
        },
      ],
    },
  },

  {
    id: 'set-blk-006',
    name: 'Cascading claim retraction: 4-hop chain with retracted anchor',
    description:
      'DataSource.schema retracted. Transformer, Aggregator, Report all depend on it. ' +
      'Action release_report impacts Report. After settling, Report has no valid claims.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'claim_retraction', '4hop'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'data-source', name: 'DataSource', type: 'system' },
        { id: 'transformer', name: 'Transformer', type: 'system' },
        { id: 'aggregator', name: 'Aggregator', type: 'system' },
        { id: 'report', name: 'Report', type: 'artifact' },
      ],
      claims: [
        {
          entityId: 'report',
          attribute: 'accuracy_score',
          value: '0.5',
          confidence: 0.35,
          source: 'retracted-pipeline',
        },
      ],
      dependencies: [
        { fromEntityId: 'transformer', toEntityId: 'data-source', type: 'REQUIRES', attribute: 'schema' },
        { fromEntityId: 'aggregator', toEntityId: 'transformer', type: 'REQUIRES', attribute: 'output' },
        { fromEntityId: 'report', toEntityId: 'aggregator', type: 'REQUIRES', attribute: 'summary' },
      ],
      constraints: [
        {
          entityId: 'report',
          attribute: 'accuracy_score',
          operator: '>=',
          threshold: 0.9,
          description: 'Report accuracy requirement',
        },
      ],
      invalidations: [
        { entityId: 'data-source', attribute: 'schema', reason: 'schema_retracted' },
      ],
      actions: [
        {
          id: 'release_report',
          name: 'release_report',
          impactedEntityNames: ['Report'],
        },
      ],
    },
  },

  {
    id: 'set-blk-007',
    name: 'Fixed-point settling reveals hidden violation not seen single-pass',
    description:
      'InferenceEngine.output_score depends on ModelWeights and FeatureStore. ' +
      'ModelWeights REQUIRES DataPipeline. DataPipeline has a constraint violation. ' +
      'Single-pass: DataPipeline violation not propagated. Fixed-point: BLOCKED.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'fixed_point', 'hidden_violation'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'data-pipeline', name: 'DataPipeline', type: 'system' },
        { id: 'model-weights', name: 'ModelWeights', type: 'artifact' },
        { id: 'feature-store', name: 'FeatureStore', type: 'system' },
        { id: 'inference-engine', name: 'InferenceEngine', type: 'service' },
      ],
      claims: [
        {
          entityId: 'data-pipeline',
          attribute: 'error_rate',
          value: '0.15',
          confidence: 0.95,
          source: 'pipeline-monitor',
        },
        {
          entityId: 'inference-engine',
          attribute: 'output_score',
          value: '0.6',
          confidence: 0.5,
          source: 'derived',
        },
      ],
      dependencies: [
        { fromEntityId: 'model-weights', toEntityId: 'data-pipeline', type: 'REQUIRES', attribute: 'training_data' },
        { fromEntityId: 'inference-engine', toEntityId: 'model-weights', type: 'REQUIRES', attribute: 'weights' },
        { fromEntityId: 'inference-engine', toEntityId: 'feature-store', type: 'REQUIRES', attribute: 'features' },
      ],
      constraints: [
        {
          entityId: 'data-pipeline',
          attribute: 'error_rate',
          operator: '<=',
          threshold: 0.05,
          description: 'Pipeline error rate limit',
        },
      ],
      actions: [
        {
          id: 'deploy_model',
          name: 'deploy_model',
          impactedEntityNames: ['InferenceEngine'],
        },
      ],
    },
  },

  {
    id: 'set-blk-008',
    name: 'Re-entrant invalidation: update to shared config propagates to 3 services',
    description:
      'DatabaseConfig updated with wrong connection pool size. ' +
      'ServiceX, ServiceY, ServiceZ all depend on DatabaseConfig. ' +
      'ServiceX action triggers evaluation. Fixed-point: all three services affected.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['blocked', 'shared_config', 'multi_consumer'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'db-config', name: 'DatabaseConfig', type: 'system' },
        { id: 'service-x', name: 'ServiceX', type: 'service' },
        { id: 'service-y', name: 'ServiceY', type: 'service' },
        { id: 'service-z', name: 'ServiceZ', type: 'service' },
      ],
      claims: [
        {
          entityId: 'db-config',
          attribute: 'pool_size',
          value: '2',
          confidence: 0.95,
          source: 'config-mgr',
        },
        {
          entityId: 'service-x',
          attribute: 'ready_state',
          value: 'degraded',
          confidence: 0.8,
          source: 'health-check',
        },
      ],
      dependencies: [
        { fromEntityId: 'service-x', toEntityId: 'db-config', type: 'REQUIRES', attribute: 'pool_size' },
        { fromEntityId: 'service-y', toEntityId: 'db-config', type: 'REQUIRES', attribute: 'pool_size' },
        { fromEntityId: 'service-z', toEntityId: 'db-config', type: 'REQUIRES', attribute: 'pool_size' },
      ],
      constraints: [
        {
          entityId: 'db-config',
          attribute: 'pool_size',
          operator: '>=',
          threshold: 10,
          description: 'Minimum DB pool size',
        },
      ],
      actions: [
        {
          id: 'deploy_service',
          name: 'deploy_service',
          impactedEntityNames: ['ServiceX'],
        },
      ],
    },
  },
];

// ─── RISKY (9) — partial settling with moderate propagation ──────────────────

const settlingRisky: ScenarioV2[] = [
  {
    id: 'set-rsk-001',
    name: '2-hop chain: upstream degraded but not invalid',
    description:
      'SensorA has low confidence (0.6). SensorB derives from SensorA. ' +
      'ActuatorC depends on SensorB. No constraint violation but uncertainty propagates.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', '2hop', 'degraded_source'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'sensor-a', name: 'SensorA', type: 'component' },
        { id: 'sensor-b', name: 'SensorB', type: 'component' },
        { id: 'actuator-c', name: 'ActuatorC', type: 'component' },
      ],
      claims: [
        {
          entityId: 'sensor-a',
          attribute: 'calibration_value',
          value: '1.02',
          confidence: 0.6,
          source: 'factory-cal',
        },
        {
          entityId: 'actuator-c',
          attribute: 'pressure_bar',
          value: '115',
          confidence: 0.65,
          source: 'derived-chain',
        },
      ],
      dependencies: [
        { fromEntityId: 'sensor-b', toEntityId: 'sensor-a', type: 'REQUIRES', attribute: 'calibration_value' },
        { fromEntityId: 'actuator-c', toEntityId: 'sensor-b', type: 'REQUIRES', attribute: 'reading' },
      ],
      constraints: [
        {
          entityId: 'actuator-c',
          attribute: 'pressure_bar',
          operator: '>=',
          threshold: 100,
          description: 'Minimum actuator pressure',
        },
      ],
      actions: [
        {
          id: 'activate_actuator',
          name: 'activate_actuator',
          impactedEntityNames: ['ActuatorC'],
        },
      ],
    },
  },

  {
    id: 'set-rsk-002',
    name: 'INVALIDATES dependency with claims on downstream entity',
    description:
      'UpstreamService INVALIDATES DownstreamCache which has claims on ResponseTime. ' +
      'UpstreamService changed. Action deploy_cache impacts DownstreamCache → DBR 0.6.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'invalidates_dep', 'cache'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'upstream-svc', name: 'UpstreamService', type: 'service' },
        { id: 'downstream-cache', name: 'DownstreamCache', type: 'service' },
      ],
      claims: [
        {
          entityId: 'upstream-svc',
          attribute: 'api_version',
          value: '3.0',
          confidence: 0.95,
          source: 'registry',
        },
        {
          entityId: 'downstream-cache',
          attribute: 'response_time_ms',
          value: '45',
          confidence: 0.85,
          source: 'benchmark',
        },
      ],
      dependencies: [
        {
          fromEntityId: 'upstream-svc',
          toEntityId: 'downstream-cache',
          type: 'INVALIDATES',
          attribute: 'response_time_ms',
        },
      ],
      constraints: [],
      actions: [
        {
          id: 'deploy_cache',
          name: 'deploy_cache',
          impactedEntityNames: ['DownstreamCache'],
        },
      ],
    },
  },

  {
    id: 'set-rsk-003',
    name: 'Partial invalidation: one branch of diamond dependency healthy',
    description:
      'Root still healthy. Left REQUIRES Root (ok). Right has no claims. ' +
      'OutputNode REQUIRES Left and Right. Partial DBR from Right.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'partial_diamond', 'missing_entity'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'root', name: 'Root', type: 'component' },
        { id: 'left', name: 'Left', type: 'component' },
        { id: 'right-empty', name: 'RightEmpty', type: 'component' },
        { id: 'output-node', name: 'OutputNode', type: 'component' },
      ],
      claims: [
        {
          entityId: 'root',
          attribute: 'value',
          value: '42',
          confidence: 0.95,
          source: 'primary',
        },
        {
          entityId: 'left',
          attribute: 'computed',
          value: '21',
          confidence: 0.88,
          source: 'derived',
        },
        {
          entityId: 'output-node',
          attribute: 'integrity_score',
          value: '0.72',
          confidence: 0.7,
          source: 'aggregated',
        },
      ],
      dependencies: [
        { fromEntityId: 'left', toEntityId: 'root', type: 'REQUIRES', attribute: 'value' },
        { fromEntityId: 'output-node', toEntityId: 'left', type: 'REQUIRES', attribute: 'computed' },
        { fromEntityId: 'output-node', toEntityId: 'right-empty', type: 'REQUIRES', attribute: 'computed' },
      ],
      constraints: [],
      actions: [
        {
          id: 'approve_output',
          name: 'approve_output',
          impactedEntityNames: ['OutputNode'],
        },
      ],
    },
  },

  {
    id: 'set-rsk-004',
    name: '3-hop chain: middle node has low confidence claims',
    description:
      'N1 healthy. N2 derived from N1 with confidence 0.6. N3 derived from N2. ' +
      'Action approve_n3 impacts N3 → propagated uncertainty.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', '3hop', 'confidence_decay'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'n1', name: 'N1', type: 'component' },
        { id: 'n2', name: 'N2', type: 'component' },
        { id: 'n3', name: 'N3', type: 'component' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'n1', attribute: 'value', value: '100', confidence: 0.95, source: 'primary' },
        { entityId: 'n2', attribute: 'derived', value: '50', confidence: 0.6, source: 'step1' },
        { entityId: 'n3', attribute: 'output', value: '25', confidence: 0.55, source: 'step2' },
      ],
      dependencies: [
        { fromEntityId: 'n2', toEntityId: 'n1', type: 'REQUIRES', attribute: 'value' },
        { fromEntityId: 'n3', toEntityId: 'n2', type: 'REQUIRES', attribute: 'derived' },
        { fromEntityId: 'n3', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      constraints: [],
      actions: [
        {
          id: 'approve_n3',
          name: 'approve_n3',
          impactedEntityNames: ['N3'],
        },
      ],
    },
  },

  {
    id: 'set-rsk-005',
    name: 'Dependency cycle detected: A→B→A',
    description:
      'ServiceA and ServiceB have circular REQUIRES dependency. ' +
      'Action deploy_service_a → engine should detect cycle and flag as RISKY ' +
      '(indeterminate settling).',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'cycle', 'circular_dependency'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'service-a', name: 'ServiceA', type: 'service' },
        { id: 'service-b', name: 'ServiceB', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'service-a', attribute: 'status', value: 'running', confidence: 0.8, source: 'health-check' },
        { entityId: 'service-b', attribute: 'status', value: 'running', confidence: 0.8, source: 'health-check' },
      ],
      dependencies: [
        { fromEntityId: 'service-a', toEntityId: 'service-b', type: 'REQUIRES', attribute: 'status' },
        { fromEntityId: 'service-b', toEntityId: 'service-a', type: 'REQUIRES', attribute: 'status' },
        { fromEntityId: 'service-a', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      constraints: [],
      actions: [
        {
          id: 'deploy_service',
          name: 'deploy_service',
          impactedEntityNames: ['ServiceA'],
        },
      ],
    },
  },

  {
    id: 'set-rsk-006',
    name: 'Multi-update: second update reverses first, net effect uncertain',
    description:
      'ConfigRoot updated twice. First update increases pool_size, second resets it. ' +
      'Net state uncertain. ServiceTarget action → RISKY.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'oscillating_update', 'multi_update'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'config-root', name: 'ConfigRoot', type: 'system' },
        { id: 'service-target', name: 'ServiceTarget', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'config-root', attribute: 'pool_size', value: '10', confidence: 0.7, source: 'update-1' },
        { entityId: 'config-root', attribute: 'pool_size', value: '2', confidence: 0.7, source: 'update-2' },
        { entityId: 'service-target', attribute: 'ready_state', value: 'pending', confidence: 0.6, source: 'derived' },
      ],
      dependencies: [
        { fromEntityId: 'service-target', toEntityId: 'config-root', type: 'REQUIRES', attribute: 'pool_size' },
        { fromEntityId: 'service-target', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      constraints: [],
      actions: [
        {
          id: 'deploy_service',
          name: 'deploy_service',
          impactedEntityNames: ['ServiceTarget'],
        },
      ],
    },
  },

  {
    id: 'set-rsk-007',
    name: 'Long chain with one stale middle node',
    description:
      'N1→N2(stale)→N3→N4. N2 claims are 900s old. ' +
      'Action on N4 propagates staleness uncertainty through chain.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'stale_middle_node', '4hop'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'n1', name: 'N1', type: 'component' },
        { id: 'n2', name: 'N2', type: 'component' },
        { id: 'n3', name: 'N3', type: 'component' },
        { id: 'n4', name: 'N4', type: 'component' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'n1', attribute: 'signal', value: '1.0', confidence: 0.95, source: 'primary', staleness_s: 30 },
        { entityId: 'n2', attribute: 'signal', value: '0.98', confidence: 0.72, source: 'derived', staleness_s: 900 },
        { entityId: 'n3', attribute: 'signal', value: '0.97', confidence: 0.68, source: 'derived', staleness_s: 100 },
        { entityId: 'n4', attribute: 'output', value: '0.95', confidence: 0.65, source: 'derived', staleness_s: 100 },
      ],
      dependencies: [
        { fromEntityId: 'n2', toEntityId: 'n1', type: 'REQUIRES', attribute: 'signal' },
        { fromEntityId: 'n3', toEntityId: 'n2', type: 'REQUIRES', attribute: 'signal' },
        { fromEntityId: 'n4', toEntityId: 'n3', type: 'REQUIRES', attribute: 'signal' },
        { fromEntityId: 'n4', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      constraints: [],
      actions: [
        {
          id: 'activate_output',
          name: 'activate_output',
          impactedEntityNames: ['N4'],
        },
      ],
    },
  },

  {
    id: 'set-rsk-008',
    name: 'Settling detects contradiction introduced mid-chain',
    description:
      'N1→N2. N2 has contradictory claims from two derivation sources. ' +
      'N3 depends on N2. Action on N3 → CA elevated from chain contradiction.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'contradiction_mid_chain', '3hop'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'n1', name: 'N1', type: 'component' },
        { id: 'n2', name: 'N2', type: 'component' },
        { id: 'n3', name: 'N3', type: 'component' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'n1', attribute: 'value', value: '100', confidence: 0.9, source: 'sensor' },
        { entityId: 'n2', attribute: 'derived', value: '50', confidence: 0.75, source: 'path-a' },
        { entityId: 'n2', attribute: 'derived', value: '80', confidence: 0.75, source: 'path-b' },
        { entityId: 'n3', attribute: 'output', value: '65', confidence: 0.65, source: 'aggregated' },
      ],
      contradictions: [
        {
          entityId: 'n2',
          attribute: 'derived',
          valueA: '50',
          valueB: '80',
          sourceA: 'path-a',
          sourceB: 'path-b',
        },
      ],
      dependencies: [
        { fromEntityId: 'n2', toEntityId: 'n1', type: 'REQUIRES', attribute: 'value' },
        { fromEntityId: 'n3', toEntityId: 'n2', type: 'REQUIRES', attribute: 'derived' },
        { fromEntityId: 'n3', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      constraints: [],
      actions: [
        {
          id: 'approve_n3',
          name: 'approve_n3',
          impactedEntityNames: ['N3'],
        },
      ],
    },
  },

  {
    id: 'set-rsk-009',
    name: 'Fan-out invalidation: one source feeds three moderately risky consumers',
    description:
      'SharedSensor degraded (confidence 0.65). Reads feeds into three separate systems. ' +
      'Action on PrimarySystem. Moderate DBR from degraded shared source.',
    familyId: FAMILY,
    category: 'multi_hop',
    tags: ['risky', 'fan_out', 'degraded_source'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'shared-sensor', name: 'SharedSensor', type: 'component' },
        { id: 'primary-sys', name: 'PrimarySystem', type: 'service' },
        { id: 'secondary-sys', name: 'SecondarySystem', type: 'service' },
        { id: 'monitor-sys', name: 'MonitorSystem', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'shared-sensor', attribute: 'reading', value: '42.5', confidence: 0.65, source: 'degraded-sensor' },
        { entityId: 'primary-sys', attribute: 'status', value: 'running', confidence: 0.7, source: 'derived' },
      ],
      dependencies: [
        { fromEntityId: 'primary-sys', toEntityId: 'shared-sensor', type: 'REQUIRES', attribute: 'reading' },
        { fromEntityId: 'secondary-sys', toEntityId: 'shared-sensor', type: 'REQUIRES', attribute: 'reading' },
        { fromEntityId: 'monitor-sys', toEntityId: 'shared-sensor', type: 'REQUIRES', attribute: 'reading' },
        { fromEntityId: 'primary-sys', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      constraints: [],
      actions: [
        {
          id: 'deploy_service',
          name: 'deploy_service',
          impactedEntityNames: ['PrimarySystem'],
        },
      ],
    },
  },
];

// ─── VALID (8) — clean dependency graphs, full settling completes safely ──────

const settlingValid: ScenarioV2[] = [
  {
    id: 'set-vld-001',
    name: 'A→B→C chain: all nodes healthy, constraint satisfied',
    description:
      'SensorA healthy, SensorB derives normally, ActuatorC has fresh valid claims. ' +
      'pressure_bar = 130 >= 100. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', '3hop', 'clean_chain'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'sensor-a', name: 'SensorA', type: 'component' },
        { id: 'sensor-b', name: 'SensorB', type: 'component' },
        { id: 'actuator-c', name: 'ActuatorC', type: 'component' },
      ],
      claims: [
        { entityId: 'sensor-a', attribute: 'calibration_value', value: '1.0', confidence: 0.97, source: 'factory-cal', staleness_s: 60 },
        { entityId: 'sensor-b', attribute: 'reading', value: '130', confidence: 0.95, source: 'derived', staleness_s: 60 },
        { entityId: 'actuator-c', attribute: 'pressure_bar', value: '130', confidence: 0.93, source: 'derived', staleness_s: 60 },
      ],
      dependencies: [
        { fromEntityId: 'sensor-b', toEntityId: 'sensor-a', type: 'REQUIRES', attribute: 'calibration_value' },
        { fromEntityId: 'actuator-c', toEntityId: 'sensor-b', type: 'REQUIRES', attribute: 'reading' },
      ],
      constraints: [
        { entityId: 'actuator-c', attribute: 'pressure_bar', operator: '>=', threshold: 100, description: 'Min pressure' },
      ],
      actions: [
        { id: 'activate_actuator', name: 'activate_actuator', impactedEntityNames: ['ActuatorC'] },
      ],
    },
  },

  {
    id: 'set-vld-002',
    name: 'Diamond dependency: all branches healthy',
    description:
      'Root, Left, Right all healthy. OutputNode integrity_score = 0.95. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'diamond', 'clean_graph'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'root', name: 'Root', type: 'component' },
        { id: 'left', name: 'Left', type: 'component' },
        { id: 'right', name: 'Right', type: 'component' },
        { id: 'output-node', name: 'OutputNode', type: 'component' },
      ],
      claims: [
        { entityId: 'root', attribute: 'value', value: '100', confidence: 0.97, source: 'primary', staleness_s: 30 },
        { entityId: 'left', attribute: 'computed', value: '50', confidence: 0.95, source: 'derived', staleness_s: 30 },
        { entityId: 'right', attribute: 'computed', value: '50', confidence: 0.95, source: 'derived', staleness_s: 30 },
        { entityId: 'output-node', attribute: 'integrity_score', value: '0.95', confidence: 0.93, source: 'aggregated', staleness_s: 30 },
      ],
      dependencies: [
        { fromEntityId: 'left', toEntityId: 'root', type: 'REQUIRES', attribute: 'value' },
        { fromEntityId: 'right', toEntityId: 'root', type: 'REQUIRES', attribute: 'value' },
        { fromEntityId: 'output-node', toEntityId: 'left', type: 'REQUIRES', attribute: 'computed' },
        { fromEntityId: 'output-node', toEntityId: 'right', type: 'REQUIRES', attribute: 'computed' },
      ],
      constraints: [
        { entityId: 'output-node', attribute: 'integrity_score', operator: '>=', threshold: 0.8, description: 'Min integrity' },
      ],
      actions: [
        { id: 'approve_output', name: 'approve_output', impactedEntityNames: ['OutputNode'] },
      ],
    },
  },

  {
    id: 'set-vld-003',
    name: 'Independent impacted entity: upstream issues dont affect action target',
    description:
      'UpstreamSystem has issues. TargetService is independent (no dep on upstream). ' +
      'Action deploy_target impacts TargetService only. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'independent_entity', 'no_dep'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'upstream-sys', name: 'UpstreamSystem', type: 'system' },
        { id: 'target-svc', name: 'TargetService', type: 'service' },
      ],
      claims: [
        { entityId: 'upstream-sys', attribute: 'status', value: 'degraded', confidence: 0.8, source: 'monitor' },
        { entityId: 'target-svc', attribute: 'cpu_load_pct', value: '35', confidence: 0.96, source: 'monitoring', staleness_s: 30 },
      ],
      constraints: [
        { entityId: 'target-svc', attribute: 'cpu_load_pct', operator: '<=', threshold: 80, description: 'CPU cap' },
      ],
      actions: [
        { id: 'deploy_target', name: 'deploy_target', impactedEntityNames: ['TargetService'] },
      ],
    },
  },

  {
    id: 'set-vld-004',
    name: 'Fan-out from healthy source: all downstream consumers valid',
    description:
      'SharedSensor healthy (confidence 0.97). Three systems depend on it. ' +
      'Action on PrimarySystem. Full settling confirms all deps satisfied.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'fan_out', 'healthy_source'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'shared-sensor', name: 'SharedSensor', type: 'component' },
        { id: 'primary-sys', name: 'PrimarySystem', type: 'service' },
      ],
      claims: [
        { entityId: 'shared-sensor', attribute: 'reading', value: '22.5', confidence: 0.97, source: 'calibrated-sensor', staleness_s: 15 },
        { entityId: 'primary-sys', attribute: 'status', value: 'running', confidence: 0.95, source: 'derived', staleness_s: 15 },
      ],
      dependencies: [
        { fromEntityId: 'primary-sys', toEntityId: 'shared-sensor', type: 'REQUIRES', attribute: 'reading' },
      ],
      constraints: [],
      actions: [
        { id: 'deploy_service', name: 'deploy_service', impactedEntityNames: ['PrimarySystem'] },
      ],
    },
  },

  {
    id: 'set-vld-005',
    name: 'Long 5-hop chain: settling confirms no violations propagated',
    description:
      'N1→N2→N3→N4→N5. All healthy, fresh, high confidence. ' +
      'N5 output_voltage = 12.0 satisfies >= 5.0. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', '5hop', 'clean_long_chain'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'n1', name: 'N1', type: 'component' },
        { id: 'n2', name: 'N2', type: 'component' },
        { id: 'n3', name: 'N3', type: 'component' },
        { id: 'n4', name: 'N4', type: 'component' },
        { id: 'n5', name: 'N5', type: 'component' },
      ],
      claims: [
        { entityId: 'n1', attribute: 'signal', value: '12.0', confidence: 0.98, source: 'primary', staleness_s: 10 },
        { entityId: 'n2', attribute: 'signal', value: '12.0', confidence: 0.97, source: 'step1', staleness_s: 10 },
        { entityId: 'n3', attribute: 'signal', value: '12.0', confidence: 0.97, source: 'step2', staleness_s: 10 },
        { entityId: 'n4', attribute: 'signal', value: '12.0', confidence: 0.96, source: 'step3', staleness_s: 10 },
        { entityId: 'n5', attribute: 'output_voltage', value: '12.0', confidence: 0.96, source: 'step4', staleness_s: 10 },
      ],
      dependencies: [
        { fromEntityId: 'n2', toEntityId: 'n1', type: 'REQUIRES', attribute: 'signal' },
        { fromEntityId: 'n3', toEntityId: 'n2', type: 'REQUIRES', attribute: 'signal' },
        { fromEntityId: 'n4', toEntityId: 'n3', type: 'REQUIRES', attribute: 'signal' },
        { fromEntityId: 'n5', toEntityId: 'n4', type: 'REQUIRES', attribute: 'signal' },
      ],
      constraints: [
        { entityId: 'n5', attribute: 'output_voltage', operator: '>=', threshold: 5.0, description: 'Min voltage' },
      ],
      actions: [
        { id: 'activate_output', name: 'activate_output', impactedEntityNames: ['N5'] },
      ],
    },
  },

  {
    id: 'set-vld-006',
    name: 'Config dependency satisfied: service pool size correct',
    description:
      'DatabaseConfig.pool_size = 50 satisfies >= 10. ServiceTarget inherits ok.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'config_dependency', 'clean'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'db-config', name: 'DatabaseConfig', type: 'system' },
        { id: 'service-target', name: 'ServiceTarget', type: 'service' },
      ],
      claims: [
        { entityId: 'db-config', attribute: 'pool_size', value: '50', confidence: 0.98, source: 'config-mgr', staleness_s: 60 },
        { entityId: 'service-target', attribute: 'ready_state', value: 'ready', confidence: 0.95, source: 'health-check', staleness_s: 30 },
      ],
      dependencies: [
        { fromEntityId: 'service-target', toEntityId: 'db-config', type: 'REQUIRES', attribute: 'pool_size' },
      ],
      constraints: [
        { entityId: 'db-config', attribute: 'pool_size', operator: '>=', threshold: 10, description: 'Min pool size' },
      ],
      actions: [
        { id: 'deploy_service', name: 'deploy_service', impactedEntityNames: ['ServiceTarget'] },
      ],
    },
  },

  {
    id: 'set-vld-007',
    name: 'Shared library dependency satisfied: both consumers healthy',
    description:
      'SharedLib healthy. ServiceA and ServiceB both consuming it fine. ' +
      'Action on ServiceA. All settled, VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'shared_dependency', 'healthy'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'shared-lib', name: 'SharedLib', type: 'component' },
        { id: 'service-a', name: 'ServiceA', type: 'service' },
      ],
      claims: [
        { entityId: 'shared-lib', attribute: 'version', value: '2.1.0', confidence: 0.99, source: 'registry', staleness_s: 120 },
        { entityId: 'service-a', attribute: 'startup_time_ms', value: '800', confidence: 0.95, source: 'deployment-test', staleness_s: 60 },
      ],
      dependencies: [
        { fromEntityId: 'service-a', toEntityId: 'shared-lib', type: 'REQUIRES', attribute: 'version' },
      ],
      constraints: [
        { entityId: 'service-a', attribute: 'startup_time_ms', operator: '<=', threshold: 3000, description: 'Max startup time' },
      ],
      actions: [
        { id: 'deploy_service', name: 'deploy_service', impactedEntityNames: ['ServiceA'] },
      ],
    },
  },

  {
    id: 'set-vld-008',
    name: 'ML inference pipeline: clean dependency graph, no violations',
    description:
      'DataPipeline error_rate = 0.001 satisfies constraint. ModelWeights and FeatureStore healthy. ' +
      'InferenceEngine output_score = 0.95. Full settling confirms VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'ml_pipeline', 'clean_graph'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'data-pipeline', name: 'DataPipeline', type: 'system' },
        { id: 'model-weights', name: 'ModelWeights', type: 'artifact' },
        { id: 'feature-store', name: 'FeatureStore', type: 'system' },
        { id: 'inference-engine', name: 'InferenceEngine', type: 'service' },
      ],
      claims: [
        { entityId: 'data-pipeline', attribute: 'error_rate', value: '0.001', confidence: 0.97, source: 'pipeline-monitor', staleness_s: 30 },
        { entityId: 'model-weights', attribute: 'version', value: '3.0', confidence: 0.98, source: 'model-registry', staleness_s: 120 },
        { entityId: 'feature-store', attribute: 'freshness_score', value: '0.98', confidence: 0.95, source: 'feature-monitor', staleness_s: 30 },
        { entityId: 'inference-engine', attribute: 'output_score', value: '0.95', confidence: 0.93, source: 'eval', staleness_s: 60 },
      ],
      dependencies: [
        { fromEntityId: 'model-weights', toEntityId: 'data-pipeline', type: 'REQUIRES', attribute: 'training_data' },
        { fromEntityId: 'inference-engine', toEntityId: 'model-weights', type: 'REQUIRES', attribute: 'weights' },
        { fromEntityId: 'inference-engine', toEntityId: 'feature-store', type: 'REQUIRES', attribute: 'features' },
      ],
      constraints: [
        { entityId: 'data-pipeline', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'Pipeline error cap' },
      ],
      actions: [
        { id: 'deploy_model', name: 'deploy_model', impactedEntityNames: ['InferenceEngine'] },
      ],
    },
  },
];

// ─── Export ───────────────────────────────────────────────────────────────────

export function generateSettlingScenarios(): ScenarioV2[] {
  return [...settlingBlocked, ...settlingRisky, ...settlingValid];
}
