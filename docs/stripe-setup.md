# Stripe setup (dashboard or MCP)

Invariant Checkout expects **recurring monthly Price IDs** in environment variables. You can create them in the [Stripe Dashboard](https://dashboard.stripe.com) or with a **Stripe MCP** in Cursor if you have one connected.

## Required env vars

| Variable | Used for |
|----------|----------|
| `STRIPE_SECRET_KEY` | API + Checkout |
| `STRIPE_STARTER_PRICE_ID` | Starter plan (~$79/mo) |
| `STRIPE_TEAM_PRICE_ID` | Team plan (~$199/mo) |
| `STRIPE_WEBHOOK_SECRET` | `POST /checkout/webhook` |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | Redirects after Checkout |

`STRIPE_ENTERPRISE_PRICE_ID` is optional (Enterprise is primarily **Contact sales**).

## Objects to create (Products + Prices)

1. **Product**, e.g. `Invariant Cloud: Starter`  
   - **Price**: recurring, **monthly**, **USD 7900** ($79.00)  
   - Copy **`price_...`** → `STRIPE_STARTER_PRICE_ID`

2. **Product**, e.g. `Invariant Cloud: Team`  
   - **Price**: recurring, **monthly**, **USD 19900** ($199.00)  
   - Copy **`price_...`** → `STRIPE_TEAM_PRICE_ID`

Checkout sessions use **14-day trial** (`trial_period_days: 14`) in code, no separate trial price needed.

## Using a Stripe MCP in Cursor

The **proposalforge-stripe** MCP (`stripe_test_connection`, `stripe_list_prices`, `stripe_setup_prices`) reads **`STRIPE_SECRET_KEY` from the environment**.

Cursor launches it via **`scripts/stripe-mcp-launcher.sh`**, which loads, in order:

1. **`Coherence-engine-/.env`** (Invariant, primary)
2. **`ProposalForge/.env`** (optional; later file wins on duplicate keys)

After changing `~/.cursor/mcp.json` or this script, **restart Cursor** (or restart the MCP server in the MCP panel) so a new process picks up the config.

Ensure **`STRIPE_SECRET_KEY`** is set in **`Coherence-engine-/.env`** (same key the API uses). After changing MCP config, **reload the MCP server** (Cursor: MCP panel → restart) or restart Cursor.

Then you can:

1. Run **`stripe_test_connection`** to verify the key.
2. Use **`stripe_list_prices`** to copy `price_...` IDs into `.env`.
3. For local webhooks: `stripe listen --forward-to localhost:3000/checkout/webhook` and set `STRIPE_WEBHOOK_SECRET` from the CLI output.

**Note:** `stripe_setup_prices` is still ProposalForge-oriented (one-time + Pro monthly). For Invariant Starter/Team, create prices in the Dashboard or extend the MCP, see `docs/billing-pricing.md`.

## Verify

```bash
curl -s -X POST http://localhost:3000/checkout/session \
  -H "Content-Type: application/json" \
  -d '{"tier":"starter"}' | jq .
```

You should get `{ "url": "https://checkout.stripe.com/..." }` when keys and price IDs are valid.

---

## Production (`invariant.me` + Vercel)

The static site and API are combined on one host: `fetch('/checkout/session')` from **pricing.html** hits the same origin; `vercel.json` rewrites `/checkout/*` to the serverless API.

### 1. Create prices (once)

From repo root (uses `.env`):

```bash
npm run stripe:invariant-prices
```

Copy `STRIPE_STARTER_PRICE_ID` and `STRIPE_TEAM_PRICE_ID` into **Vercel → Project → Settings → Environment Variables** (Production).

### 2. Required Vercel env vars

| Variable | Example |
|----------|---------|
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_STARTER_PRICE_ID` | `price_...` |
| `STRIPE_TEAM_PRICE_ID` | `price_...` |
| `STRIPE_SUCCESS_URL` | `https://invariant.me/success.html` |
| `STRIPE_CANCEL_URL` | `https://invariant.me/pricing.html` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from Stripe Dashboard webhook) |
| `DATABASE_URL` | Postgres for Prisma |

### 3. Stripe webhook (Dashboard)

Add endpoint:

`https://invariant.me/checkout/webhook`

Events at minimum: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

Paste the signing secret into `STRIPE_WEBHOOK_SECRET` on Vercel.

### 4. Redeploy

Trigger a redeploy after setting env vars so Checkout and webhooks work.
