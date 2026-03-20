# Send-Ready DMs — Invariant Launch

Send these on X after the Show HN gains traction (10+ upvotes). Keep them in separate DMs, not mentions.

---

## Harrison Chase (@hwchase17) — LangChain founder

Hey Harrison — been following LangChain for a while.

Built something I think is relevant for your ecosystem: Invariant — a coherence layer for AI agents. One call before any tool execution; it validates the action against your world state and constraints and blocks it if the risk is too high.

Built it because I kept hitting coherence collapse in long-running agents — the model acting on beliefs that stopped being true steps ago. Not hallucination, just stale state.

It integrates cleanly with LangChain's tool call lifecycle. Free Team access for you if you want to poke at it — no pitch, just feedback from someone who's deep in this.

invariant.me — takes 5 min to wire in.

---

## Jerry Liu (@jerryjliu0) — LlamaIndex founder

Hey Jerry — big fan of LlamaIndex.

Shipped Invariant — a coherence layer that sits before any tool call in an agent loop. It validates the proposed action against a typed world state graph and active constraints, blocks risky actions before execution, logs everything with provenance.

Integrates with LlamaIndex agents via a single pre-execution hook. Free Team access if you want to try it — genuinely just looking for feedback from people building agents in production.

invariant.me

---

## Yohei Nakajima (@yoheinakajima) — BabyAGI

Hey Yohei — your writing on long-horizon agent failures has been really useful.

Coherence collapse is one of the root causes I kept running into — agent acts on beliefs that got contradicted or went stale mid-run. No error thrown, no flag raised. The agent just keeps going based on a world model that's no longer true.

Built Invariant as a structured fix: typed state graph, contradiction detection, action validation before execution. Blocks before damage happens.

Would love your take — you've thought about this more than almost anyone. Free Team access, no ask except honest feedback.

invariant.me

---

## Peter Steinberger (@steipete) — OpenClaw creator

Hey Peter — congrats on OpenClaw, it's genuinely incredible. 100k stars is a real milestone.

Built Invariant — it's a coherence layer that validates OpenClaw actions against world state before they execute. Basically catches the class of bugs where OpenClaw acts on a stale or contradicted belief mid-run. One line before any tool call.

Feels like a natural pairing — OpenClaw handles the execution surface, Invariant handles the state consistency underneath. Would love to show you and give you free access.

invariant.me

---

## Timing notes

- Send AFTER the HN post hits 10+ upvotes
- Do NOT send all at once — space them 30 min apart
- If they reply, reply within the hour
- Harrison and Jerry are the highest leverage — prioritize those two
