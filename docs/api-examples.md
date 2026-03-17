# Coherence Engine — API Examples

All requests require `X-API-Key: <your-api-key>` header.
Default dev key: `dev-api-key`

Base URL: `http://localhost:3000`
Swagger UI: `http://localhost:3000/docs`

---

## 1. Create an Entity

```bash
curl -X POST http://localhost:3000/entities \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key" \
  -d '{
    "name": "Battery Pack BP-2",
    "type": "COMPONENT",
    "description": "Secondary battery module",
    "metadata": { "system": "power", "capacity_wh": 450 }
  }'
```

---

## 2. Assert a Claim

```bash
curl -X POST http://localhost:3000/claims \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key" \
  -d '{
    "entityId": "<entity-id>",
    "predicate": "mass",
    "value": 18.5,
    "confidence": 0.95,
    "sourceName": "Mass Sensor",
    "sourceType": "SENSOR"
  }'
```

---

## 3. Get Entity Current State

```bash
curl http://localhost:3000/entities/<entity-id>/state \
  -H "X-API-Key: dev-api-key"
```

Response:
```json
{
  "entity": { "id": "...", "name": "Battery Pack BP-1", ... },
  "activeClaims": [...],
  "stateSnapshot": {
    "mass": 21.3,
    "mass_limit": 20.0
  },
  "dependencies": { "from": [...], "to": [...] }
}
```

---

## 4. Ingest an Observation with Claims

```bash
curl -X POST http://localhost:3000/observations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key" \
  -d '{
    "sourceName": "Telemetry System",
    "sourceType": "SYSTEM",
    "type": "telemetry_reading",
    "content": { "timestamp": "2025-01-01T10:00:00Z", "sensor": "mass" },
    "entityIds": ["<bp1-entity-id>"],
    "claims": [
      {
        "entityId": "<bp1-entity-id>",
        "predicate": "mass",
        "value": 21.3,
        "confidence": 0.98
      }
    ]
  }'
```

---

## 5. Get Coherence Score

```bash
curl http://localhost:3000/world/coherence \
  -H "X-API-Key: dev-api-key"
```

Response:
```json
{
  "coherenceScore": 34.2,
  "phi": 5.34,
  "breakdown": {
    "Vc": 1.8,
    "Vk": 1.2,
    "Vd": 0.8,
    "Vu": 0.12,
    "Vb": 0.7
  },
  "formula": "Phi(G) = lambdaC*Vc + lambdaK*Vk + lambdaD*Vd + lambdaU*Vu + lambdaB*Vb",
  "timestamp": "2025-01-01T10:00:00.000Z"
}
```

---

## 6. Validate an Action

```bash
curl -X POST http://localhost:3000/actions/validate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key" \
  -d '{
    "operation": "proceed_to_launch",
    "description": "Transition to launch phase",
    "parameters": { "targetDate": "2025-06-01" },
    "impactedEntityIds": ["<launch-readiness-id>", "<requirement-r42-id>"]
  }'
```

Response:
```json
{
  "proposal": { "id": "...", "operation": "proceed_to_launch", "status": "BLOCKED" },
  "validation": {
    "admissibility": "BLOCKED",
    "deltaPhi": 7.2,
    "psiScore": 0.82,
    "constraintViolationRisk": 0.9,
    "dependencyBreakageRisk": 0.7,
    "contradictionAmplification": 0.6,
    "uncertaintyExposure": 0.3,
    "provenanceFragility": 0.4,
    "impactedEntityIds": ["..."],
    "reasons": [
      "Constraint violation risk: R-42: status=complete requires verificationStatus=complete but not satisfied",
      "Operation 'proceed_to_launch' targets entities with 2 active constraint violations",
      "2 existing contradictions involve impacted entities (avg score: 0.73)"
    ]
  }
}
```

---

## 7. Get Contradictions

```bash
curl "http://localhost:3000/contradictions?status=OPEN" \
  -H "X-API-Key: dev-api-key"
```

---

## 8. Get Branches

```bash
curl "http://localhost:3000/branches?status=OPEN" \
  -H "X-API-Key: dev-api-key"
```

---

## 9. Create a Dependency

```bash
curl -X POST http://localhost:3000/dependencies \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key" \
  -d '{
    "fromEntityId": "<requirement-id>",
    "toEntityId": "<test-id>",
    "type": "REQUIRES",
    "weight": 1.0,
    "description": "Requirement completion requires test to pass"
  }'
```

---

## 10. Trigger Manual Settling

```bash
curl -X POST http://localhost:3000/world/settle \
  -H "X-API-Key: dev-api-key"
```

Response:
```json
{
  "rounds": 3,
  "converged": true,
  "phiBefore": 5.34,
  "phiAfter": 4.12,
  "coherenceScoreBefore": 34.2,
  "coherenceScoreAfter": 44.1,
  "monotonicityMaintained": true,
  "summary": [
    { "round": 0, "contradictionsDetected": 2, "branchesCreated": 1, "phiChange": -0.8 },
    { "round": 1, "constraintViolationsFound": 1, "phiChange": -0.2 },
    { "round": 2, "converged": true, "phiChange": 0 }
  ]
}
```

---

## SDK Usage (TypeScript)

```typescript
import { createCoherenceClient } from '@coherence-engine/sdk';

const client = createCoherenceClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'dev-api-key',
  agentName: 'My Planning Agent',
});

// Check coherence before acting
const score = await client.getCoherenceScore();
if (score.coherenceScore < 50) {
  console.log('World state is incoherent, investigate before acting');
}

// Validate an action first
const result = await client.validateAction({
  operation: 'deploy_configuration',
  impactedEntityIds: ['entity-123'],
  parameters: { version: '2.1.0' },
});

if (result.validation.admissibility === 'VALID') {
  console.log('Action is safe to execute');
} else {
  console.log('Action blocked:', result.validation.reasons);
}

// Publish an observation
await client.publishObservation({
  type: 'sensor_reading',
  content: { sensor: 'temperature', value: 42.1 },
  entityIds: ['battery-entity-id'],
  claims: [{
    entityId: 'battery-entity-id',
    predicate: 'temperature',
    value: 42.1,
    confidence: 0.99,
  }],
});
```
