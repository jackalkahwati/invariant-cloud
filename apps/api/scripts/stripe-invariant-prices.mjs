/**
 * Create Invariant Cloud Stripe Products + recurring monthly Prices (Starter $79, Team $199).
 * Idempotent: reuses products that already have metadata invariant_tier=starter|team.
 *
 * Usage (from repo root):
 *   node --env-file=.env apps/api/scripts/stripe-invariant-prices.mjs
 *
 * Requires: STRIPE_SECRET_KEY in environment
 */
import Stripe from 'stripe';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = join(__dirname, '../../..', '.env');
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_')) {
  console.error('Missing STRIPE_SECRET_KEY (set in repo .env or export it).');
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' });

async function findProductByTier(tier) {
  const list = await stripe.products.list({ limit: 100, active: true });
  return list.data.find((p) => p.metadata?.invariant_tier === tier) ?? null;
}

async function findMonthlyPriceForProduct(productId, unitAmount) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
  return prices.data.find(
    (p) =>
      p.recurring?.interval === 'month' &&
      p.unit_amount === unitAmount &&
      p.currency === 'usd',
  );
}

async function ensureTier({ tier, name, description, unitAmount }) {
  let product = await findProductByTier(tier);
  if (!product) {
    product = await stripe.products.create({
      name,
      description,
      metadata: { invariant_tier: tier },
    });
    console.error(`Created product ${product.id} (${tier})`);
  }

  let price = await findMonthlyPriceForProduct(product.id, unitAmount);
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: unitAmount,
      recurring: { interval: 'month' },
      metadata: { invariant_tier: tier },
    });
    console.error(`Created price ${price.id} (${tier} $${unitAmount / 100}/mo)`);
  }

  return price.id;
}

const starter = await ensureTier({
  tier: 'starter',
  name: 'Invariant Cloud, Starter',
  description: 'Managed Invariant Cloud, early access (monthly).',
  unitAmount: 7900,
});

const team = await ensureTier({
  tier: 'team',
  name: 'Invariant Cloud, Team',
  description: 'Managed Invariant Cloud, production team (monthly).',
  unitAmount: 19900,
});

console.log('');
console.log('# Add to .env and Vercel/host env:');
console.log(`STRIPE_STARTER_PRICE_ID=${starter}`);
console.log(`STRIPE_TEAM_PRICE_ID=${team}`);
console.log('');
