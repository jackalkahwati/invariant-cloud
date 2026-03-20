# Show HN: Invariant — coherence layer for AI agents (validate actions before they execute)

**Title:**
Show HN: Invariant – coherence layer for AI agents (validates actions before execution, works with OpenClaw/LangChain/AutoGen)

**URL:** https://invariant.me

---

**Body (paste in the text field on HN):**

OpenClaw just hit 100k stars. Millions of people are running autonomous agents that can send emails, manage files, and call APIs on their behalf. That's great — but there's a failure mode nobody is talking about.

I've been building agents for a while and kept running into the same class of bug: the agent's internal world model drifts from reality mid-run, and it starts making decisions based on stale or contradicted beliefs. Not hallucination — coherence collapse.

An OpenClaw agent that deletes the wrong file because it was acting on a stale belief isn't hallucinating. Every individual fact it held was true at some point. The problem is it had no mechanism to know which beliefs were still valid.

The fix isn't prompt engineering. It's a structured state layer that sits between the agent and its tools.

Invariant is that layer. It does three things:

1. **Tracks world state as a typed graph** — every fact the agent holds is a claim with a source, timestamp, and decay rate. Contradictions are detected automatically.

2. **Validates actions before execution** — you call `actions.propose()` before any tool call. It scores the action against active constraints and current state. If the risk exceeds your threshold, it's blocked before the damage happens.

3. **Full audit trail** — every claim, constraint check, and validation logged with provenance. Useful for debugging and compliance.

The API is simple:

```typescript
const result = await client.actions.propose({
  operation: 'delete_record',
  parameters: { id: 'user-123' },
});
if (result.status === 'blocked') return; // don't execute
```

It works with any agent framework — LangChain, LlamaIndex, AutoGen, or custom. Self-host with Docker or use the managed cloud.

Free tier available. SDK on npm (`npm install invariant-sdk`).

Happy to answer questions about the coherence model or the math behind the risk scoring (it's based on a weighted graph traversal over the world state).

---

**Tips for posting:**
- Post between 9-11am ET on a weekday (Tuesday or Wednesday is best)
- Do NOT share the link publicly until it's been up for 30 min — let organic votes build first
- Reply to every comment within the first 2 hours
- If asked technical questions about the Phi formula or scoring, go deep — HN rewards that
