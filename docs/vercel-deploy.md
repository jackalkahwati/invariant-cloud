# Deploy Invariant to Vercel

The repo is configured as a **hybrid** project:

- **Static site** from `apps/web/` (HTML, pricing, dashboards).
- **Single Node serverless function** at `api/index.ts` that runs the Fastify app (`apps/api/dist/*`).
- **Rewrites** in `vercel.json` route API paths to `/api/index`.

## One-time setup

1. Install CLI: `npm i -g vercel`
2. From the repo root:
   ```bash
   vercel login
   vercel link
   ```
3. In the [Vercel dashboard](https://vercel.com) → your project → **Settings → Environment Variables**, add **Production** (and Preview if you want):

| Name | Notes |
|------|--------|
| `DATABASE_URL` | PostgreSQL (e.g. Neon, Supabase, RDS) |
| `JWT_SECRET` | Long random string |
| `STRIPE_SECRET_KEY` | `sk_live_…` or `sk_test_…` |
| `STRIPE_STARTER_PRICE_ID` | From `npm run stripe:invariant-prices` |
| `STRIPE_TEAM_PRICE_ID` | Same |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_SUCCESS_URL` | `https://invariant.me/success.html` |
| `STRIPE_CANCEL_URL` | `https://invariant.me/pricing.html` |
| `API_KEY` | Shared secret for `X-API-Key` on agent routes (or rotate per workspace in DB) |
| `CORS_EXTRA_ORIGINS` | Optional comma-separated browser origins (e.g. `https://staging.example.com`) |

Optional: `NODE_ENV=production`, `LOG_LEVEL=info`, SMTP vars for emails.

4. **Database:** run migrations against production Postgres:
   ```bash
   DATABASE_URL="postgresql://..." npx prisma migrate deploy --schema=prisma/schema.prisma
   ```

5. **Stripe webhook:** endpoint `https://invariant.me/checkout/webhook` (or your domain), events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

6. Deploy:
   ```bash
   vercel --prod
   ```
   Or connect the GitHub repo and use automatic deployments.

## Build pipeline

`vercel.json` runs:

```bash
npm install
npm run vercel-build   # prisma generate + tsc for apps/api
```

`api/index.ts` imports `../apps/api/dist/app.js`, **do not** point it at `src/`; Vercel needs the compiled output.

## Domains

Point **invariant.me** (and `www` if used) to the Vercel project. `apps/api/src/app.ts` CORS already allows `https://invariant.me` and `https://www.invariant.me`.

## Limits

- **Long-lived SSE** (`GET /world/stream`) may hit serverless timeouts; menu bar / polling is safer in production unless you move streaming to a long-running host.
- Function **maxDuration** is set to 60s in `vercel.json` for heavy requests / webhooks.

## Troubleshooting

- **`invariant.me` pricing still shows $0 / $200 / $800 (or other stale copy):** Your **custom domain is not serving the same deployment** as the project you deploy from this repo. Check with:
  ```bash
  curl -sSIL -o /dev/null -w '%{size_download}\n' https://invariant.me/pricing.html
  curl -sSIL -o /dev/null -w '%{size_download}\n' https://YOUR_PROJECT.vercel.app/pricing.html
  ```
  The current `apps/web/pricing.html` is about **30.5 KB** (Starter **$79**, Team **$199**, Enterprise **Custom**). If `invariant.me` is ~**25 KB**, it is an **older build** or a **different Vercel project**. In [Vercel → Domains](https://vercel.com/dashboard), attach `invariant.me` (and `www`) to the **same** project you run `vercel --prod` on for this repo, remove the domain from any legacy project, then **Redeploy** production. The CLI may report “no access” for `vercel alias` / `domains` if the domain lives under another team or account, fix in the dashboard for the account that owns the domain.
- **Site on Vercel looks older than localhost:** Vercel ships whatever is in the **deployed commit**. Local edits under `apps/web/` are not live until you **commit, push** (if using Git integration), and redeploy, or run `vercel --prod` from a tree that includes those files. Run `git status` and confirm Preview/Production in the dashboard matches the commit you expect.
- **502 / function crash:** Check Vercel → Deployment → Functions logs; often missing `DATABASE_URL` or Prisma migrate not applied.
- **Prisma errors on Linux:** `schema.prisma` includes `binaryTargets = ["native", "rhel-openssl-3.0.x"]` for Vercel’s runtime.
