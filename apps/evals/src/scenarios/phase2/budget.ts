/**
 * Phase 2 — Coherence Budget Scenarios
 *
 * Tests the actionBudget (DeltaPhi threshold) dimension independently of Psi.
 * DeltaPhi = violationLoad * 1.5 + phiFraction * 2.0
 *
 * Budget thresholds:
 *  - VALID:   deltaPhi <= 5.0  (actionBudget = 5.0)
 *  - RISKY:   deltaPhi <= 7.5  (actionBudget * 1.5)
 *  - BLOCKED: deltaPhi >  7.5
 *
 * These scenarios keep Psi low (no stale claims, high confidence, clear provenance)
 * but vary how much the action would increase global incoherence energy.
 *
 * 20 scenarios: 7 BLOCKED · 7 RISKY · 6 VALID
 */

import { ScenarioV2, ScenarioFamily } from '../types';

const FAMILY: ScenarioFamily = 'budget';

// ─── BLOCKED (7) — DeltaPhi > 7.5 ────────────────────────────────────────────

const budgetBlocked: ScenarioV2[] = [
  {
    id: 'bgt-blk-001',
    name: 'High violation load: 3 active constraint violations',
    description:
      'SystemNode has 3 simultaneous constraint violations. ' +
      'violationLoad = 3 → deltaPhi ≈ 3*1.5 = 4.5 minimum. ' +
      'With phiFraction contribution, total deltaPhi > 7.5. BLOCKED.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['blocked', 'high_violation_load', 'deltaphi'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'system-node', name: 'SystemNode', type: 'system' }],
      claims: [
        { entityId: 'system-node', attribute: 'cpu_load_pct', value: '98', confidence: 0.97, source: 'monitor' },
        { entityId: 'system-node', attribute: 'memory_used_gb', value: '62', confidence: 0.97, source: 'monitor' },
        { entityId: 'system-node', attribute: 'disk_io_mbs', value: '980', confidence: 0.96, source: 'monitor' },
        { entityId: 'system-node', attribute: 'network_errors', value: '450', confidence: 0.96, source: 'monitor' },
      ],
      constraints: [
        { entityId: 'system-node', attribute: 'cpu_load_pct', operator: '<=', threshold: 90, description: 'CPU cap' },
        { entityId: 'system-node', attribute: 'memory_used_gb', operator: '<=', threshold: 60, description: 'Memory cap' },
        { entityId: 'system-node', attribute: 'disk_io_mbs', operator: '<=', threshold: 500, description: 'Disk IO cap' },
      ],
      actions: [
        { id: 'deploy_workload', name: 'deploy_workload', impactedEntityNames: ['SystemNode'] },
      ],
    },
  },

  {
    id: 'bgt-blk-002',
    name: 'Action on highly constrained graph with many violations',
    description:
      'ClusterNode has 4 violations including network error count. ' +
      'DeltaPhi contribution from all violations exceeds budget.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['blocked', 'cluster_overload', 'deltaphi'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'cluster-node', name: 'ClusterNode', type: 'system' }],
      claims: [
        { entityId: 'cluster-node', attribute: 'cpu_load_pct', value: '96', confidence: 0.97, source: 'metrics' },
        { entityId: 'cluster-node', attribute: 'memory_used_pct', value: '95', confidence: 0.97, source: 'metrics' },
        { entityId: 'cluster-node', attribute: 'active_connections', value: '12000', confidence: 0.96, source: 'metrics' },
        { entityId: 'cluster-node', attribute: 'error_count', value: '850', confidence: 0.96, source: 'metrics' },
      ],
      constraints: [
        { entityId: 'cluster-node', attribute: 'cpu_load_pct', operator: '<=', threshold: 85, description: 'CPU safety limit' },
        { entityId: 'cluster-node', attribute: 'memory_used_pct', operator: '<=', threshold: 85, description: 'Memory limit' },
        { entityId: 'cluster-node', attribute: 'active_connections', operator: '<=', threshold: 10000, description: 'Max connections' },
        { entityId: 'cluster-node', attribute: 'error_count', operator: '<=', threshold: 100, description: 'Max errors' },
      ],
      actions: [
        { id: 'scale_up', name: 'scale_up', impactedEntityNames: ['ClusterNode'] },
      ],
    },
  },

  {
    id: 'bgt-blk-003',
    name: 'Action dramatically increases phi fraction of global graph',
    description:
      'Proposed action creates 5 new dependency links to already-violated entities. ' +
      'phiFraction contribution alone would exceed budget.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['blocked', 'phi_fraction', 'high_connectivity'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [
        { id: 'hub-node', name: 'HubNode', type: 'system' },
        { id: 'spoke-a', name: 'SpokeA', type: 'component' },
        { id: 'spoke-b', name: 'SpokeB', type: 'component' },
        { id: 'spoke-c', name: 'SpokeC', type: 'component' },
      ],
      claims: [
        { entityId: 'hub-node', attribute: 'latency_ms', value: '2500', confidence: 0.96, source: 'monitor' },
        { entityId: 'spoke-a', attribute: 'error_rate', value: '0.15', confidence: 0.95, source: 'metrics' },
        { entityId: 'spoke-b', attribute: 'error_rate', value: '0.12', confidence: 0.95, source: 'metrics' },
        { entityId: 'spoke-c', attribute: 'error_rate', value: '0.18', confidence: 0.95, source: 'metrics' },
      ],
      constraints: [
        { entityId: 'hub-node', attribute: 'latency_ms', operator: '<=', threshold: 1000, description: 'Max latency' },
        { entityId: 'spoke-a', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
        { entityId: 'spoke-b', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
        { entityId: 'spoke-c', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
      ],
      actions: [
        { id: 'deploy_hub', name: 'deploy_hub', impactedEntityNames: ['HubNode'] },
      ],
    },
  },

  {
    id: 'bgt-blk-004',
    name: 'Release when graph incoherence energy is already near maximum',
    description:
      'GlobalSystem has 5 constraint violations. Even a small additional action ' +
      'would push deltaPhi far above budget.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['blocked', 'near_maximum_phi', 'overloaded_graph'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'global-sys', name: 'GlobalSystem', type: 'system' }],
      claims: [
        { entityId: 'global-sys', attribute: 'coherence_score', value: '0.1', confidence: 0.95, source: 'engine' },
        { entityId: 'global-sys', attribute: 'violation_count', value: '8', confidence: 0.95, source: 'engine' },
        { entityId: 'global-sys', attribute: 'contradiction_count', value: '5', confidence: 0.95, source: 'engine' },
        { entityId: 'global-sys', attribute: 'dependency_breaks', value: '3', confidence: 0.95, source: 'engine' },
      ],
      constraints: [
        { entityId: 'global-sys', attribute: 'coherence_score', operator: '>=', threshold: 0.7, description: 'Minimum coherence' },
        { entityId: 'global-sys', attribute: 'violation_count', operator: '<=', threshold: 2, description: 'Max violations' },
        { entityId: 'global-sys', attribute: 'contradiction_count', operator: '<=', threshold: 1, description: 'Max contradictions' },
      ],
      actions: [
        { id: 'finalize_system', name: 'finalize_system', impactedEntityNames: ['GlobalSystem'] },
      ],
    },
  },

  {
    id: 'bgt-blk-005',
    name: 'Deploy when impacted entity is central hub with many violations',
    description:
      'NetworkHub has 3 severe violations. It connects to 12 downstream nodes. ' +
      'phiFraction contribution from touching this hub is enormous.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['blocked', 'central_hub', 'high_fan_out'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'network-hub', name: 'NetworkHub', type: 'system' }],
      claims: [
        { entityId: 'network-hub', attribute: 'packet_loss_pct', value: '18', confidence: 0.97, source: 'nmon' },
        { entityId: 'network-hub', attribute: 'throughput_gbps', value: '0.8', confidence: 0.97, source: 'nmon' },
        { entityId: 'network-hub', attribute: 'jitter_ms', value: '45', confidence: 0.96, source: 'nmon' },
      ],
      constraints: [
        { entityId: 'network-hub', attribute: 'packet_loss_pct', operator: '<=', threshold: 2, description: 'Max packet loss' },
        { entityId: 'network-hub', attribute: 'throughput_gbps', operator: '>=', threshold: 10, description: 'Min throughput' },
        { entityId: 'network-hub', attribute: 'jitter_ms', operator: '<=', threshold: 5, description: 'Max jitter' },
      ],
      actions: [
        { id: 'reconfigure_hub', name: 'reconfigure_hub', impactedEntityNames: ['NetworkHub'] },
      ],
    },
  },

  {
    id: 'bgt-blk-006',
    name: 'Action with high violation load AND high phi fraction: dual budget breach',
    description:
      'DatabaseCluster: 2 violations (violationLoad=2) + high existing incoherence (phiFraction=0.6). ' +
      'deltaPhi = 2*1.5 + 0.6*2.0 = 3.0 + 1.2 = 4.2 (borderline). ' +
      'With severity multipliers: effectively exceeds 7.5.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['blocked', 'dual_budget_breach', 'db_cluster'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'db-cluster', name: 'DatabaseCluster', type: 'system' }],
      claims: [
        { entityId: 'db-cluster', attribute: 'replication_lag_ms', value: '8500', confidence: 0.97, source: 'db-monitor' },
        { entityId: 'db-cluster', attribute: 'query_timeout_rate', value: '0.25', confidence: 0.97, source: 'db-monitor' },
        { entityId: 'db-cluster', attribute: 'disk_used_pct', value: '94', confidence: 0.96, source: 'db-monitor' },
        { entityId: 'db-cluster', attribute: 'active_locks', value: '2400', confidence: 0.95, source: 'db-monitor' },
      ],
      constraints: [
        { entityId: 'db-cluster', attribute: 'replication_lag_ms', operator: '<=', threshold: 1000, description: 'Max replication lag' },
        { entityId: 'db-cluster', attribute: 'query_timeout_rate', operator: '<=', threshold: 0.01, description: 'Max timeout rate' },
        { entityId: 'db-cluster', attribute: 'disk_used_pct', operator: '<=', threshold: 85, description: 'Max disk usage' },
      ],
      actions: [
        { id: 'run_migration', name: 'run_migration', impactedEntityNames: ['DatabaseCluster'] },
      ],
    },
  },

  {
    id: 'bgt-blk-007',
    name: 'Finalize with action that impacts entity with severity 1.0 violations',
    description:
      'SafetySystem has critical-severity violations (severity=1.0). ' +
      'Severity multiplier pushes deltaPhi well above budget.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['blocked', 'critical_severity', 'safety'],
    expectedAction: 'BLOCKED',
    setup: {
      entities: [{ id: 'safety-sys', name: 'SafetySystem', type: 'system' }],
      claims: [
        { entityId: 'safety-sys', attribute: 'redundancy_level', value: '0', confidence: 0.99, source: 'safety-monitor' },
        { entityId: 'safety-sys', attribute: 'heartbeat_ms', value: '5000', confidence: 0.99, source: 'safety-monitor' },
      ],
      constraints: [
        { entityId: 'safety-sys', attribute: 'redundancy_level', operator: '>=', threshold: 2, description: 'Min redundancy', severity: 1.0 },
        { entityId: 'safety-sys', attribute: 'heartbeat_ms', operator: '<=', threshold: 500, description: 'Max heartbeat interval', severity: 1.0 },
      ],
      actions: [
        { id: 'approve_safety_check', name: 'approve_safety_check', impactedEntityNames: ['SafetySystem'] },
      ],
    },
  },
];

// ─── RISKY (7) — DeltaPhi between 5.0 and 7.5 ────────────────────────────────

const budgetRisky: ScenarioV2[] = [
  {
    id: 'bgt-rsk-001',
    name: 'Moderate violation load: 2 violations with deltaPhi in risky band',
    description:
      'AppServer has 2 active constraint violations. ' +
      'violationLoad = 2 → deltaPhi ≈ 2*1.5 = 3.0 base. ' +
      'With phiFraction: total 5.0 < deltaPhi <= 7.5. RISKY.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['risky', 'moderate_violation_load', 'deltaphi'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'app-server', name: 'AppServer', type: 'service' }],
      claims: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', value: '88', confidence: 0.95, source: 'monitor' },
        { entityId: 'app-server', attribute: 'request_queue_depth', value: '1200', confidence: 0.95, source: 'monitor' },
        { entityId: 'app-server', attribute: 'memory_free_mb', value: '200', confidence: 0.95, source: 'monitor' },
      ],
      constraints: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', operator: '<=', threshold: 85, description: 'CPU cap' },
        { entityId: 'app-server', attribute: 'request_queue_depth', operator: '<=', threshold: 1000, description: 'Max queue depth' },
      ],
      actions: [
        { id: 'deploy_app', name: 'deploy_app', impactedEntityNames: ['AppServer'] },
      ],
    },
  },

  {
    id: 'bgt-rsk-002',
    name: 'Deploy to cache server with minor cpu violation',
    description:
      'CacheServer.cpu_temp_c = 86 barely exceeds max 85. Small excess → small severity → deltaPhi in risky band. ' +
      'deploy op + violation → CVR=0.9.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['risky', 'small_excess_violation', 'cache'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'cache-server', name: 'CacheServer', type: 'service' }],
      claims: [
        { entityId: 'cache-server', attribute: 'cpu_temp_c', value: '86', confidence: 0.96, source: 'cache-monitor' },
        { entityId: 'cache-server', attribute: 'hit_rate', value: '0.78', confidence: 0.96, source: 'cache-monitor' },
      ],
      constraints: [
        { entityId: 'cache-server', attribute: 'cpu_temp_c', operator: '<=', threshold: 85, description: 'Max CPU temperature' },
      ],
      actions: [
        { id: 'deploy_cache_update', name: 'deploy_cache_update', impactedEntityNames: ['CacheServer'] },
      ],
    },
  },

  {
    id: 'bgt-rsk-003',
    name: 'Restart broker with missing upstream prereq data',
    description:
      'MessageBroker connects to consumers. MessageBroker REQUIRES PrereqNode (no claims) → DBR fires → RISKY.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['risky', 'dependency_break', 'broker'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'msg-broker', name: 'MessageBroker', type: 'service' },
        { id: 'consumer-1', name: 'Consumer1', type: 'service' },
        { id: 'consumer-2', name: 'Consumer2', type: 'service' },
        { id: 'consumer-3', name: 'Consumer3', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'msg-broker', attribute: 'queue_depth', value: '8500', confidence: 0.95, source: 'broker-monitor' },
        { entityId: 'msg-broker', attribute: 'lag_ms', value: '420', confidence: 0.95, source: 'broker-monitor' },
        { entityId: 'consumer-1', attribute: 'processing_rate', value: '850', confidence: 0.9, source: 'monitor' },
        { entityId: 'consumer-2', attribute: 'processing_rate', value: '820', confidence: 0.9, source: 'monitor' },
        { entityId: 'consumer-3', attribute: 'processing_rate', value: '780', confidence: 0.9, source: 'monitor' },
      ],
      constraints: [
        { entityId: 'msg-broker', attribute: 'queue_depth', operator: '<=', threshold: 10000, description: 'Max queue depth' },
      ],
      dependencies: [
        { fromEntityId: 'consumer-1', toEntityId: 'msg-broker', type: 'REQUIRES', attribute: 'queue_depth' },
        { fromEntityId: 'consumer-2', toEntityId: 'msg-broker', type: 'REQUIRES', attribute: 'queue_depth' },
        { fromEntityId: 'consumer-3', toEntityId: 'msg-broker', type: 'REQUIRES', attribute: 'queue_depth' },
        { fromEntityId: 'msg-broker', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      actions: [
        { id: 'restart_broker', name: 'restart_broker', impactedEntityNames: ['MessageBroker'] },
      ],
    },
  },

  {
    id: 'bgt-rsk-004',
    name: 'Deploy to storage cluster with minor iops excess',
    description:
      'StorageCluster.iops = 42000 barely exceeds max 40000. Small excess → small severity → deltaPhi in risky band. ' +
      'deploy op + violation → CVR=0.9.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['risky', 'small_excess_violation', 'storage'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'storage-cluster', name: 'StorageCluster', type: 'system' },
        { id: 'app-a', name: 'AppA', type: 'service' },
        { id: 'app-b', name: 'AppB', type: 'service' },
      ],
      claims: [
        { entityId: 'storage-cluster', attribute: 'available_tb', value: '8.5', confidence: 0.97, source: 'storage-monitor' },
        { entityId: 'storage-cluster', attribute: 'iops', value: '42000', confidence: 0.96, source: 'storage-monitor' },
        { entityId: 'app-a', attribute: 'data_written_gb', value: '150', confidence: 0.9, source: 'app-monitor' },
        { entityId: 'app-b', attribute: 'data_written_gb', value: '120', confidence: 0.9, source: 'app-monitor' },
      ],
      constraints: [
        { entityId: 'storage-cluster', attribute: 'iops', operator: '<=', threshold: 40000, description: 'Max IOPS limit' },
      ],
      dependencies: [
        { fromEntityId: 'app-a', toEntityId: 'storage-cluster', type: 'REQUIRES', attribute: 'available_tb' },
        { fromEntityId: 'app-b', toEntityId: 'storage-cluster', type: 'REQUIRES', attribute: 'available_tb' },
      ],
      actions: [
        { id: 'deploy_storage_update', name: 'deploy_storage_update', impactedEntityNames: ['StorageCluster'] },
      ],
    },
  },

  {
    id: 'bgt-rsk-005',
    name: 'Deploy pipeline with borderline violations: small excess, risky band',
    description:
      'PipelineOrchestrator.job_failure_rate = 0.052 (just over 0.05) and scheduler_lag_s = 11 (just over 10). ' +
      'Small excess → small combined violationLoad → deltaPhi in (2, 3]. deploy op → CVR=0.9.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['risky', 'small_excess', 'cumulative'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'pipeline-orch', name: 'PipelineOrchestrator', type: 'system' }],
      claims: [
        { entityId: 'pipeline-orch', attribute: 'job_failure_rate', value: '0.052', confidence: 0.96, source: 'orch-monitor' },
        { entityId: 'pipeline-orch', attribute: 'scheduler_lag_s', value: '11', confidence: 0.95, source: 'orch-monitor' },
        { entityId: 'pipeline-orch', attribute: 'active_workers', value: '28', confidence: 0.95, source: 'orch-monitor' },
      ],
      constraints: [
        { entityId: 'pipeline-orch', attribute: 'job_failure_rate', operator: '<=', threshold: 0.05, description: 'Max failure rate' },
        { entityId: 'pipeline-orch', attribute: 'scheduler_lag_s', operator: '<=', threshold: 10, description: 'Max lag' },
      ],
      actions: [
        { id: 'deploy_pipeline', name: 'deploy_pipeline', impactedEntityNames: ['PipelineOrchestrator'] },
      ],
    },
  },

  {
    id: 'bgt-rsk-006',
    name: 'Reconfigure router with missing upstream prereq data',
    description:
      'RouterNode connects to downstream endpoints. RouterNode REQUIRES PrereqNode (no claims) → DBR fires → RISKY.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['risky', 'dependency_break', 'connectivity'],
    expectedAction: 'RISKY',
    setup: {
      entities: [
        { id: 'router-node', name: 'RouterNode', type: 'system' },
        { id: 'endpoint-a', name: 'EndpointA', type: 'service' },
        { id: 'endpoint-b', name: 'EndpointB', type: 'service' },
        { id: 'endpoint-c', name: 'EndpointC', type: 'service' },
        { id: 'prereq-node', name: 'PrereqNode', type: 'component' },
      ],
      claims: [
        { entityId: 'router-node', attribute: 'routing_latency_ms', value: '180', confidence: 0.96, source: 'router-monitor' },
        { entityId: 'endpoint-a', attribute: 'error_rate', value: '0.08', confidence: 0.93, source: 'ep-monitor' },
        { entityId: 'endpoint-b', attribute: 'error_rate', value: '0.06', confidence: 0.93, source: 'ep-monitor' },
        { entityId: 'endpoint-c', attribute: 'error_rate', value: '0.003', confidence: 0.95, source: 'ep-monitor' },
      ],
      constraints: [
        { entityId: 'endpoint-a', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
        { entityId: 'endpoint-b', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
      ],
      dependencies: [
        { fromEntityId: 'endpoint-a', toEntityId: 'router-node', type: 'REQUIRES', attribute: 'routing_latency_ms' },
        { fromEntityId: 'endpoint-b', toEntityId: 'router-node', type: 'REQUIRES', attribute: 'routing_latency_ms' },
        { fromEntityId: 'endpoint-c', toEntityId: 'router-node', type: 'REQUIRES', attribute: 'routing_latency_ms' },
        { fromEntityId: 'router-node', toEntityId: 'prereq-node', type: 'REQUIRES', attribute: 'data' },
      ],
      actions: [
        { id: 'reconfigure_router', name: 'reconfigure_router', impactedEntityNames: ['RouterNode'] },
      ],
    },
  },

  {
    id: 'bgt-rsk-007',
    name: 'Deploy batch job with two small violations: deltaPhi in risky band',
    description:
      'ComputeNode.cpu_load_pct=87 (cap 85, excess=2, severity≈0.047) and swap_used_gb=4.2 (cap 4, excess=0.2, severity=0.1). ' +
      'violationLoad≈0.147 → deltaPhi≈2.22, inside (2.0, 3.0]. deploy op + violations → CVR=0.9 → RISKY.',
    familyId: FAMILY,
    category: 'budget',
    tags: ['risky', 'small_excess', 'borderline'],
    expectedAction: 'RISKY',
    setup: {
      entities: [{ id: 'compute-node', name: 'ComputeNode', type: 'system' }],
      claims: [
        { entityId: 'compute-node', attribute: 'cpu_load_pct', value: '87', confidence: 0.96, source: 'monitor' },
        { entityId: 'compute-node', attribute: 'swap_used_gb', value: '4.2', confidence: 0.96, source: 'monitor' },
      ],
      constraints: [
        { entityId: 'compute-node', attribute: 'cpu_load_pct', operator: '<=', threshold: 85, description: 'CPU soft cap' },
        { entityId: 'compute-node', attribute: 'swap_used_gb', operator: '<=', threshold: 4, description: 'Swap soft cap' },
      ],
      actions: [
        { id: 'deploy_batch_job', name: 'deploy_batch_job', impactedEntityNames: ['ComputeNode'] },
      ],
    },
  },
];

// ─── VALID (6) — DeltaPhi <= 5.0 ─────────────────────────────────────────────

const budgetValid: ScenarioV2[] = [
  {
    id: 'bgt-vld-001',
    name: 'Action on clean entity in small graph: deltaPhi well within budget',
    description:
      'AppServer: no violations, fresh claims, small dependency graph. ' +
      'deltaPhi ≈ 0 → VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'clean_graph', 'small_graph'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'app-server', name: 'AppServer', type: 'service' }],
      claims: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', value: '42', confidence: 0.97, source: 'monitor', staleness_s: 30 },
        { entityId: 'app-server', attribute: 'memory_free_mb', value: '8000', confidence: 0.97, source: 'monitor', staleness_s: 30 },
      ],
      constraints: [
        { entityId: 'app-server', attribute: 'cpu_load_pct', operator: '<=', threshold: 85, description: 'CPU cap' },
      ],
      actions: [
        { id: 'deploy_app', name: 'deploy_app', impactedEntityNames: ['AppServer'] },
      ],
    },
  },

  {
    id: 'bgt-vld-002',
    name: 'Deploy to isolated entity: no graph connectivity for phi contribution',
    description:
      'StandaloneService: no dependencies, no violations. deltaPhi = 0. VALID.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'isolated_entity', 'zero_deltaphi'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'standalone-svc', name: 'StandaloneService', type: 'service' }],
      claims: [
        { entityId: 'standalone-svc', attribute: 'version', value: '1.0', confidence: 0.99, source: 'registry', staleness_s: 60 },
        { entityId: 'standalone-svc', attribute: 'health', value: 'ok', confidence: 0.99, source: 'health-check', staleness_s: 10 },
      ],
      constraints: [],
      dependencies: [],
      actions: [
        { id: 'deploy_service', name: 'deploy_service', impactedEntityNames: ['StandaloneService'] },
      ],
    },
  },

  {
    id: 'bgt-vld-003',
    name: 'Large graph but all constraints satisfied: phi fraction near zero',
    description:
      'LargeSystem connects to 20 entities but none have violations. ' +
      'phiFraction = 0 → deltaPhi well within budget.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'large_clean_graph', 'zero_violations'],
    expectedAction: 'VALID',
    setup: {
      entities: [{ id: 'large-sys', name: 'LargeSystem', type: 'system' }],
      claims: [
        { entityId: 'large-sys', attribute: 'coherence_score', value: '0.95', confidence: 0.97, source: 'engine', staleness_s: 60 },
        { entityId: 'large-sys', attribute: 'violation_count', value: '0', confidence: 0.99, source: 'engine', staleness_s: 60 },
      ],
      constraints: [
        { entityId: 'large-sys', attribute: 'coherence_score', operator: '>=', threshold: 0.7, description: 'Min coherence' },
      ],
      actions: [
        { id: 'finalize_system', name: 'finalize_system', impactedEntityNames: ['LargeSystem'] },
      ],
    },
  },

  {
    id: 'bgt-vld-004',
    name: 'Single constraint violation on unrelated entity: deltaPhi = 0 for action',
    description:
      'There is a violation on UnrelatedNode but the action targets CleanService. ' +
      'impactedEntityNames=[CleanService] → violationLoad from CleanService = 0.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'unrelated_violation', 'scoped_impact'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'unrelated-node', name: 'UnrelatedNode', type: 'component' },
        { id: 'clean-svc', name: 'CleanService', type: 'service' },
      ],
      claims: [
        { entityId: 'unrelated-node', attribute: 'error_rate', value: '0.5', confidence: 0.95, source: 'monitor' },
        { entityId: 'clean-svc', attribute: 'cpu_load_pct', value: '30', confidence: 0.97, source: 'monitor', staleness_s: 30 },
      ],
      constraints: [
        { entityId: 'unrelated-node', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
        { entityId: 'clean-svc', attribute: 'cpu_load_pct', operator: '<=', threshold: 80, description: 'CPU cap' },
      ],
      actions: [
        { id: 'deploy_app', name: 'deploy_app', impactedEntityNames: ['CleanService'] },
      ],
    },
  },

  {
    id: 'bgt-vld-005',
    name: 'Release with violations existing but all pre-existing and stable',
    description:
      'ProductionSystem has pre-existing violations in acknowledged subsystems. ' +
      'The action targets an unaffected ReleaseArtifact with no constraint issues.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'scoped_impact', 'pre_existing_violations'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'prod-sys', name: 'ProductionSystem', type: 'system' },
        { id: 'release-artifact', name: 'ReleaseArtifact', type: 'artifact' },
      ],
      claims: [
        { entityId: 'prod-sys', attribute: 'error_rate', value: '0.08', confidence: 0.95, source: 'monitor' },
        { entityId: 'release-artifact', attribute: 'test_pass_rate', value: '0.98', confidence: 0.99, source: 'ci', staleness_s: 60 },
      ],
      constraints: [
        { entityId: 'prod-sys', attribute: 'error_rate', operator: '<=', threshold: 0.05, description: 'SLO' },
        { entityId: 'release-artifact', attribute: 'test_pass_rate', operator: '>=', threshold: 0.95, description: 'Min test pass rate' },
      ],
      actions: [
        { id: 'release_build', name: 'release_build', impactedEntityNames: ['ReleaseArtifact'] },
      ],
    },
  },

  {
    id: 'bgt-vld-006',
    name: 'Network is clean: deltaPhi from well-behaved hub is negligible',
    description:
      'NetworkHub has healthy metrics. 6 downstream services. ' +
      'No violations, phiFraction = 0. Action reconfigure_hub → deltaPhi ≈ 0.',
    familyId: FAMILY,
    category: 'nominal',
    tags: ['valid', 'healthy_hub', 'zero_deltaphi'],
    expectedAction: 'VALID',
    setup: {
      entities: [
        { id: 'network-hub', name: 'NetworkHub', type: 'system' },
        { id: 'service-1', name: 'Service1', type: 'service' },
        { id: 'service-2', name: 'Service2', type: 'service' },
      ],
      claims: [
        { entityId: 'network-hub', attribute: 'packet_loss_pct', value: '0.001', confidence: 0.99, source: 'nmon', staleness_s: 10 },
        { entityId: 'network-hub', attribute: 'throughput_gbps', value: '9.8', confidence: 0.98, source: 'nmon', staleness_s: 10 },
        { entityId: 'service-1', attribute: 'latency_ms', value: '12', confidence: 0.97, source: 'monitor', staleness_s: 30 },
        { entityId: 'service-2', attribute: 'latency_ms', value: '14', confidence: 0.97, source: 'monitor', staleness_s: 30 },
      ],
      constraints: [
        { entityId: 'network-hub', attribute: 'packet_loss_pct', operator: '<=', threshold: 2, description: 'Max packet loss' },
        { entityId: 'network-hub', attribute: 'throughput_gbps', operator: '>=', threshold: 8, description: 'Min throughput' },
      ],
      dependencies: [
        { fromEntityId: 'service-1', toEntityId: 'network-hub', type: 'REQUIRES', attribute: 'throughput_gbps' },
        { fromEntityId: 'service-2', toEntityId: 'network-hub', type: 'REQUIRES', attribute: 'throughput_gbps' },
      ],
      actions: [
        { id: 'reconfigure_hub', name: 'reconfigure_hub', impactedEntityNames: ['NetworkHub'] },
      ],
    },
  },
];

// ─── Export ───────────────────────────────────────────────────────────────────

export function generateBudgetScenarios(): ScenarioV2[] {
  return [...budgetBlocked, ...budgetRisky, ...budgetValid];
}
