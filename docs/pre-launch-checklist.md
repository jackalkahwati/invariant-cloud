# Invariant Pre-Launch Checklist

**For:** OpenClaw QA team
**Product:** [invariant.me](https://invariant.me)
**Purpose:** Verify that a stranger can arrive, trust the product, and get to first value — without help.

Mark each item `[ ]` → `[x]` as you verify it. Log failures in the **Issues** column with a short description and severity (P0 = blocks launch, P1 = fix before launch, P2 = fix after).

---

## Bucket 1 — Core Product Promise

> This is the one that matters most. If the demo flow is broken, nothing else does.

The full flow to verify:

1. Agent proposes an action
2. Invariant checks shared state
3. A contradiction or missing fact is detected
4. The action is VALID / RISKY / BLOCKED
5. The reason trace is visible

### 1A — Happy path (action gets validated and passes)

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 1 | `POST /claims` — create an entity and assert a claim about it | 201, claim stored | |
| 2 | `POST /actions/validate` — action consistent with that claim | `admissibility: VALID`, score returned | |
| 3 | Reason trace in response | `reasons` array present, not empty | |
| 4 | `GET /world/coherence` | coherence score returned, Φ > 0 | |

### 1B — Contradiction detected (action gets blocked)

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 5 | Assert two contradictory claims about the same entity | Both accepted, contradiction created | |
| 6 | `GET /contradictions` | Contradiction visible with both claim IDs | |
| 7 | `POST /actions/validate` with operation that depends on the conflicted entity | `admissibility: BLOCKED` or `RISKY` | |
| 8 | Reason trace references the contradiction | `type: CONTRADICTION` or `STALE_STATE` in reasons | |

### 1C — Stale state detected

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 9 | Create a claim with a timestamp far in the past (or advance time via staleness config) | Claim created, staleness > 0 | |
| 10 | Validate action against the stale entity | Staleness surfaced in reasons | |

### 1D — Constraint violation detected

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 11 | Create a constraint via `POST /constraints` | 201 | |
| 12 | Validate action that violates the constraint | `admissibility: BLOCKED`, constraint cited in reasons | |

---

## Bucket 2 — New User Onboarding

> Pretend you are a stranger. Can you get to first value without anyone helping you?

### 2A — Site visit

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 13 | Open invariant.me in a fresh browser (no cache, logged out) | Page loads < 3s | |
| 14 | Read the hero headline | Clear in 5 seconds what Invariant does and who it is for | |
| 15 | Read the concrete scenario card below the fold | The CRM example makes sense without context | |
| 16 | Scroll to "How it works in 10 seconds" | 5-step flow readable and correct | |
| 17 | Click "Read the docs" | Docs page loads, quickstart visible | |
| 18 | Click "Start validating free" | Sign-up page loads | |

### 2B — Sign up

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 19 | Register with email + password | Account created, no error | |
| 20 | Register with GitHub OAuth | Redirects to GitHub, returns to dashboard | |
| 21 | Duplicate email registration | Clear error message, not a 500 | |
| 22 | Weak/missing password | Validation error shown before submit | |
| 23 | Email verification (if enabled) | Verification email arrives within 2 min | |

### 2C — First workspace and API key

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 24 | Workspace created automatically or shown on first login | Workspace visible in dashboard | |
| 25 | Generate a workspace API key | Key shown once, prefixed `inv_` | |
| 26 | Copy key and use it in a `curl` request | `X-API-Key: inv_...` authenticated successfully | |

### 2D — First successful validation (docs quickstart)

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 27 | Follow the docs quickstart, step by step, using only what is on the page | Completes without needing external context | |
| 28 | First `POST /claims` from the quickstart | 201 | |
| 29 | First `POST /actions/validate` from the quickstart | Returns admissibility + reasons | |
| 30 | Time from landing on docs to first successful validation | Target: < 10 minutes | |

---

## Bucket 3 — Broken and Adversarial Cases

> Your product is about preventing bad actions. The failure cases matter almost more than the success cases.

### 3A — Bad inputs

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 31 | `POST /claims` with missing required fields | 400 with descriptive error, not 500 | |
| 32 | `POST /actions/validate` with unknown entityId | Clear error or BLOCKED with explanation | |
| 33 | Malformed JSON body | 400, not 500 | |
| 34 | Extra unknown fields in payload | Ignored or 400 — not a crash | |
| 35 | Very long string values (>10k chars) | Handled gracefully | |
| 36 | Null / undefined values for required fields | 400 with field-level message | |

### 3B — Conflicting and duplicate state

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 37 | Submit the exact same claim twice | Idempotent or a clear duplicate signal | |
| 38 | Submit two claims that directly contradict each other | Contradiction created, neither silently dropped | |
| 39 | Submit claims from two "agents" simultaneously (parallel requests) | Both accepted, contradiction surfaced if appropriate | |
| 40 | Submit 50 claims for the same entity in rapid succession | No 500s, coherence score updates | |

### 3C — Auth and permission edge cases

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 41 | No API key on a protected endpoint | 401 | |
| 42 | Invalid API key | 401 | |
| 43 | Expired JWT | 401 | |
| 44 | Valid key for workspace A used to access workspace B data | 403 or 404 — not the other workspace's data | |
| 45 | Revoked API key still in use | 401 | |

### 3D — Rate limiting

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 46 | Exceed the per-minute rate limit | 429 with `retryAfter` field | |
| 47 | Hit auth endpoints repeatedly (brute-force sim) | 429 after 20 req/min | |

### 3E — Retry and network behavior

| # | Step | Expected | Issues |
|---|------|----------|--------|
| 48 | Send a request with `Idempotency-Key` header, then resend the same key | Second response identical to first, no double-write | |
| 49 | Interrupt a request mid-flight and retry | No corrupt state | |

---

## Bucket 4 — Website and Conversion Path

> Click every link from desktop, mobile, and logged-out mode.

### 4A — Nav and footer links (logged out)

| # | Page / Link | Expected | Issues |
|---|-------------|----------|--------|
| 50 | invariant.me → loads | 200, hero visible | |
| 51 | Nav: Docs | docs.html loads | |
| 52 | Nav: Blog | blog.html loads, posts visible | |
| 53 | Nav: Pricing | pricing.html loads, tier cards visible | |
| 54 | Nav: GitHub | github.com/jackalkahwati/invariant-cloud opens in new tab | |
| 55 | Nav: Sign in | login.html loads | |
| 56 | Nav: Sign up | register.html loads | |
| 57 | Footer: Privacy | privacy.html loads | |
| 58 | Footer: Terms | terms.html loads | |
| 59 | Footer: Enterprise | mailto:jack@thestardrive.com triggers email | |
| 60 | Footer: Blog | blog.html loads | |

### 4B — Docs page

| # | Check | Expected | Issues |
|---|-------|----------|--------|
| 61 | docs.html loads | No sidebar from old app, TOC visible | |
| 62 | All anchor links in TOC | Jump to correct section | |
| 63 | Code blocks | Readable, copy-pasteable | |
| 64 | API endpoint references match actual API behavior | No dead endpoints, no wrong field names | |

### 4C — Blog

| # | Check | Expected | Issues |
|---|-------|----------|--------|
| 65 | blog.html loads with two post cards | Both posts visible | |
| 66 | "Why AI Agents Lie to Themselves" post | Opens, readable, no broken images | |
| 67 | "The Coherence Score (Φ)" post | Opens, MathJax renders | |

### 4D — Pricing

| # | Check | Expected | Issues |
|---|-------|----------|--------|
| 68 | Tier cards visible (Free, Starter, Team, Enterprise) | Correct limits displayed | |
| 69 | "Get started" CTA on free tier | Goes to register.html | |
| 70 | Paid tier checkout flow | Stripe checkout opens, test card works | |

### 4E — Mobile (375px viewport)

| # | Check | Expected | Issues |
|---|-------|----------|--------|
| 71 | Homepage hero | Readable, not overflowing | |
| 72 | Nav | Hamburger or collapsed nav works | |
| 73 | Docs | Readable, no horizontal scroll | |
| 74 | Pricing cards | Stack vertically, all text visible | |

### 4F — Logged-in state

| # | Check | Expected | Issues |
|---|-------|----------|--------|
| 75 | Sign in → nav updates | "Sign in" and "Sign up" hidden, account visible | |
| 76 | account.html | Shows workspace, API keys, usage | |
| 77 | Sign out | Clears session, redirects to homepage | |
| 78 | Revisit protected page after sign out | Redirected to login | |

---

## Bucket 5 — Traffic and Reliability

> You do not need massive scale, but you need to know a launch spike does not break the first experience.

### 5A — Concurrent load

| # | Test | Expected | Issues |
|---|------|----------|--------|
| 79 | 20 simultaneous signups | All succeed, no 500s, no duplicate accounts | |
| 80 | 50 concurrent `POST /actions/validate` calls | All return within 2s, no 503s | |
| 81 | Burst to homepage (ab or curl loop, 100 req) | Page serves consistently | |
| 82 | Burst to `/health` endpoint | Always 200 | |

### 5B — Monitoring and observability

| # | Check | Expected | Issues |
|---|-------|----------|--------|
| 83 | Vercel function logs accessible | Logs visible in Vercel dashboard | |
| 84 | A 500 error produces a log entry | Visible in logs within 30s | |
| 85 | `/health` endpoint returns `{"status":"ok"}` | 200 | |
| 86 | Uptime check configured (UptimeRobot, BetterUptime, or similar) | Alert fires if site goes down | |

---

## Bucket 6 — Launch-Day Operations

> Can you actually support people once they arrive?

### 6A — Support readiness

| # | Item | Status | Notes |
|---|------|--------|-------|
| 87 | One-paragraph product explanation written and ready | | |
| 88 | One-paragraph "how this is different from X" answer ready | | |
| 89 | Docs quickstart verified to work end-to-end | | |
| 90 | Contact email (jack@thestardrive.com) monitored | | |
| 91 | GitHub Issues open and watched | | |

### 6B — Rollback plan

| # | Item | Status | Notes |
|---|------|--------|-------|
| 92 | Previous working Vercel deployment identified | | `vercel rollback` ready if needed |
| 93 | Known-good commit SHA noted | | |
| 94 | If signup breaks: fallback contact method for interested users | | e.g. "email us" CTA |
| 95 | If Stripe breaks: can remove pricing page and route to contact | | |

### 6C — Analytics

| # | Item | Status | Notes |
|---|------|--------|-------|
| 96 | Can see where users are dropping off on homepage | | |
| 97 | Can see how many signups per day | | |
| 98 | Can see which docs pages are most visited | | |

---

## The Single Most Important Test

**Do this before anything else.**

> Ask one technical person who knows nothing about Invariant to open invariant.me, sign up, and use it without your help. Watch where they get confused. Time how long it takes to get to a successful `BLOCKED` response.

If they cannot do it in 15 minutes unassisted, there is a gap in the onboarding that must be fixed before launch.

---

## Priority Summary

| Priority | Must pass before launch |
|----------|------------------------|
| **P0** | Signup works (email + GitHub OAuth) |
| **P0** | First-value flow works (claim → validate → reason trace) |
| **P0** | VALID / RISKY / BLOCKED behavior correct |
| **P0** | Docs quickstart works end-to-end |
| **P0** | No 500s on any public page or core API path |
| **P1** | Mobile homepage readable |
| **P1** | All nav and footer links work |
| **P1** | Rate limiting returns 429 not 500 |
| **P1** | Auth edge cases return 401/403, not 500 |
| **P1** | Uptime monitor configured |
| **P2** | Analytics and attribution |
| **P2** | Email notification flows |
| **P2** | Edge case UX polish |

---

*Generated for Invariant v1.1.0 pre-launch · invariant.me*
