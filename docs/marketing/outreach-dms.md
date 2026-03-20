# Direct Outreach — 10 Target Builders

Send these as DMs on X or LinkedIn. Keep it short, specific, and non-pitchy.
Offer free Team tier. Ask for feedback, not a sale.

---

## Template (customize per person)

Subject/opening: Reference something specific they've built or written.

---

**Message:**

Hey [name] — been following your work on [specific project/post].

I've been building Invariant — it's a coherence layer for AI agents. Before any tool call, you run the action through it; it validates against your world state and constraints and blocks anything risky before it executes.

Built it because I kept hitting coherence collapse in long-running agents — the model acting on beliefs that stopped being true 5 steps ago.

Would love to give you free Team access and hear what you think. No pitch, just feedback from someone who's actually building agents in production.

invariant.me — takes 5 min to integrate.

---

## Target List

### 1. Harrison Chase — LangChain founder
@hwchase17 on X
Why: Millions of LangChain users need this. If he integrates or mentions it, that's a distribution unlock.
Customize: "I built a coherence layer that integrates cleanly with LangChain's tool call lifecycle..."

### 2. Jerry Liu — LlamaIndex founder
@jerryjliu0 on X
Why: Same as above for LlamaIndex ecosystem.
Customize: "...integrates with LlamaIndex agents via a single pre-execution hook..."

### 3. Yohei Nakajima — BabyAGI / agent researcher
@yoheinakajima on X
Why: Deep in autonomous agent research, large following of agent builders.
Customize: "You've written a lot about long-horizon agent failures — coherence collapse is one of the root causes..."

### 4. Simon Willison — datasette / LLM tools
@simonw on X
Why: Extremely influential in the dev tools / AI tools community, writes deeply technical posts.
Customize: "Given your work on LLM observability, I think you'd find the audit trail piece interesting..."

### 5. swyx — AI engineer community
@swyx on X
Why: Runs the AI Engineer community, direct line to thousands of practitioners.
Customize: "I'd love to get Invariant in front of the AI Eng community — would you be open to a quick look?"

### 6. Lilian Weng — OpenAI safety / agent research
@lilianweng on X
Why: Her posts on agent architectures are widely read; a mention would be massive credibility.
Customize: "Your post on LLM-powered agents inspired a lot of the architecture — I built the coherence layer you described as missing..."

### 7. Greg Kamradt — LLM practitioner / educator
@GregKamradt on X
Why: Practical AI builders follow him; he demos tools to large audiences.
Customize: "Built something I think would make a good demo — a coherence layer that actually blocks bad agent actions..."

### 8. Shawn Wang (swyx) — Smol AI / AI news
Already listed above — ping separately for newsletter inclusion.

### 9. CEO/CTO of an agent-heavy startup (Adept, Fixie, Dust, etc.)
Find via LinkedIn — search "Head of AI" or "AI Engineer" at companies building B2B agents.
Customize: "We're in early access — looking for 5 teams building production agents to give free Team tier in exchange for feedback..."

### 10. A YC founder building agents
Check the current YC batch at ycombinator.com/companies — filter by AI/agents.
Message via LinkedIn or Founder intro request.
Customize: "Fellow founder — building the coherence layer for AI agents. Would love 15 min and free access in exchange for honest feedback."

---

## Discord / Slack communities to post in

### LangChain Discord (#show-and-tell or #tools)
"Hey all — built a coherence layer for agent state management. Validates actions against world state before execution, blocks risky ones, full audit trail. Works as a drop-in before any tool call. Free tier at invariant.me — would love feedback from people building real agents."

### LlamaIndex Discord (#showcase)
Same message, swap LlamaIndex context.

### AutoGen Discord / GitHub Discussions
"Built Invariant — a pre-execution validation layer for AutoGen agents. One call before any tool use; it scores action risk against your world state and constraints. Catches coherence failures before they happen. invariant.me"

### Latent Space Discord (swyx's community)
"Shipping Invariant — coherence layer for AI agents. The problem: agents act on stale/contradicted beliefs mid-run. The fix: typed world state graph + action validation before execution. Show HN today: [link]"

### AI Engineer Slack (if you have access)
Same as Latent Space message.

---

## Reddit Posts

### r/MachineLearning
**Title:** "Coherence collapse in long-running AI agents — a structural fix"
Post the blog post content (trimmed to ~500 words), link to full post and GitHub.
Do NOT make it a product pitch — frame it as a technical post with Invariant as a footnote.

### r/LocalLLaMA
**Title:** "Built a coherence layer for local agents — validates actions before execution"
More direct, mention self-hosting via Docker, free tier.

### r/LangChain
**Title:** "Pre-execution action validation for LangChain agents"
Show the code snippet. Keep it technical and short.
