# Coherence Engine — Roadmap

## v1 (Current MVP)

- [x] Discrete fixed-point reconciliation settling loop
- [x] Typed claim graph with full provenance
- [x] Branch-aware contradiction handling
- [x] Signed dependency types (SUPPORTS, REQUIRES, IMPLIES, INVALIDATES, EXCLUDES, MUTEX, IMPLIES_NOT)
- [x] Modular contradiction detectors (numeric, status, temporal, range/threshold)
- [x] Phi incoherence energy computation
- [x] CoherenceScore exposed in API
- [x] Action validation with DeltaPhi and Psi
- [x] Provenance-aware action validation
- [x] Staleness decay model
- [x] Coherence budget enforcement
- [x] Lyapunov monotonicity as a testable invariant
- [x] PostgreSQL persistence via Prisma
- [x] REST API with OpenAPI docs
- [x] Agent SDK
- [x] Engineering scenario seed

## v2 — Planned Extensions

### Semantic Contradiction Detection
- Embed claim values into vector space (sentence-transformers or via LLM)
- Detect semantic contradictions beyond exact string/numeric conflicts
- Stub: `SemanticConflictDetector` (implements interface, returns null in v1)

### Learned Confidence Calibration
- Train a model to predict actual claim correctness from features
- Replace sigmoid heuristic with calibrated probabilistic model

### Streaming Subscriptions
- WebSocket / SSE endpoints for real-time world state changes
- Agent subscription hooks: `onContradictionDetected`, `onBranchCreated`, `onCoherenceChange`

### Branch Merge Assistant
- LLM-assisted resolution suggestions for open contradictions
- Conflict resolution scoring: which branch is more consistent with the global state?

### Scenario Simulation Mode
- "What if" mode: simulate proposed observations without persisting
- Returns: predicted Phi change, contradiction risk, dependency cascade

### Continuous Latent State / BPR-Native Reconciler (v3)
- Implement the full continuous BPR formulation as a learned reconciler
- Entity states as latent vectors; contradictions as phase misalignments
- Gradient descent settling: `dG/dt = -grad_G Phi(G)`
- Requires: differentiable constraints, learned embeddings, convergence monitoring

### Vector Memory Support
- Integration with vector databases (pgvector, Pinecone, Qdrant)
- Semantic search over claim history
- Similarity-based claim retrieval for provenance chains

### Multimodal Observations
- Image, audio, sensor stream observation types
- Structured extraction pipeline: raw input → claims

### Frontend Dashboard
- World overview with live coherence score
- Entity detail view with claim timeline
- Contradiction console with branch explorer
- Action validation panel
- Interactive dependency graph (D3.js or React Flow)
