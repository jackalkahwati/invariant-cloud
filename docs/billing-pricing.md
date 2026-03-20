# Billing & pricing (pre-launch policy)

Internal reference aligned with the public pricing page and checkout. Update this when meters or enforcement change.

**Stripe products & env vars:** see [`docs/stripe-setup.md`](./stripe-setup.md) (dashboard or Stripe MCP).

## Tiers

| Tier | Stripe | Workspace `tier` | Intent |
|------|--------|------------------|--------|
| Self-host | - | `FREE` | OSS, unlimited locally |
| Starter | `STRIPE_STARTER_PRICE_ID` | `STARTER` | Managed cloud, low entry |
| Team | `STRIPE_TEAM_PRICE_ID` | `TEAM` | Production teams |
| Enterprise | Contract (optional `STRIPE_ENTERPRISE_PRICE_ID`) | `ENTERPRISE` | VPC, compliance, SSO |

## Billable units (v0)

Until automated metering ships, **document** usage as follows:

| Event | Units |
|-------|------:|
| New claim (`POST /claims` or claim created from `POST /observations`) | 1 |
| `POST /actions/validate` or `POST /actions/simulate` | 10 |
| Read-only `GET` requests | 0 |

**Included bundles (marketing targets):**

- **Starter:** ~1M units / month  
- **Team:** ~10M units / month  

**Pre-launch:** limits are **soft**. Do not hard-block customers until counters are accurate in production and communicated.

## Why subscription + included usage (not pure per-call)

- Covers fixed cost (managed Postgres, API uptime).  
- Avoids Stripe’s fixed fee eating micro-charges.  
- Overage and weight tuning come **after** real traffic data.

## Database

`WorkspaceTier` includes `STARTER`. Apply with:

```bash
npx prisma migrate deploy
```

If you previously used `prisma db push` without migrations, run the SQL in `prisma/migrations/20260319180000_add_workspace_tier_starter/migration.sql` once against your database, then align migration history with `prisma migrate resolve`.

## Next implementation steps

1. Increment `Workspace.claimsThisMonth` (or rename column to `billableUnitsThisMonth`) from route handlers using the table above.  
2. Nightly or rolling reset aligned to `claimsResetAt`.  
3. Dashboard: show units vs tier limit.  
4. Email alert at 80% / 100% of included bundle.  
5. Stripe **metered** price or invoice line for overage (post-launch).
