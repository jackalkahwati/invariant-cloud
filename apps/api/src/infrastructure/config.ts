/**
 * Configuration, loaded from environment variables with defaults.
 */

import type { EngineConfig } from '../domain/entities/types.js';

function getEnvFloat(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback : parsed;
}

function getEnvString(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  const v = val.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function parseCommaSeparatedEnv(key: string): string[] {
  const raw = process.env[key];
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Optional extra browser origins for @fastify/cors (e.g. staging URL). Comma-separated in CORS_EXTRA_ORIGINS. */
export const corsAllowedExtraOrigins = parseCommaSeparatedEnv('CORS_EXTRA_ORIGINS');

export const engineConfig: EngineConfig = {
  coherenceWeights: {
    lambdaC: getEnvFloat('COHERENCE_LAMBDA_C', 1.0),
    lambdaK: getEnvFloat('COHERENCE_LAMBDA_K', 1.5),
    lambdaD: getEnvFloat('COHERENCE_LAMBDA_D', 0.8),
    lambdaU: getEnvFloat('COHERENCE_LAMBDA_U', 0.5),
    lambdaB: getEnvFloat('COHERENCE_LAMBDA_B', 0.7),
    kScale:  getEnvFloat('COHERENCE_K_SCALE', 2.0),
  },
  actionWeights: {
    mu1: 0.20, // constraint violation risk
    mu2: 0.20, // dependency breakage risk
    mu3: 0.15, // contradiction amplification
    mu4: 0.10, // uncertainty exposure
    mu5: 0.15, // provenance fragility
    mu6: 0.20, // propagated risk (Phase 1: graph-traversal transitive risk)
  },
  stalenessLambda: getEnvFloat('STALENESS_LAMBDA', 0.001),
  contradictionThreshold: getEnvFloat('CONTRADICTION_THRESHOLD', 0.5),
  branchThreshold: getEnvFloat('BRANCH_THRESHOLD', 0.7),
  actionBudget: getEnvFloat('ACTION_BUDGET', 5.0),
  actionEpsilon: getEnvFloat('ACTION_EPSILON', 0.6),
  settlingMaxRounds: parseInt(process.env['SETTLING_MAX_ROUNDS'] ?? '50', 10),
  // Phase 1: propagated risk via dependency graph traversal
  propagatedRiskGlobalThreshold: getEnvFloat('PROPAGATED_RISK_GLOBAL_THRESHOLD', 0.70),
  propagationHops: parseInt(process.env['PROPAGATION_HOPS'] ?? '4', 10),
  propagationDecay: getEnvFloat('PROPAGATION_DECAY', 0.7),
};

export const serverConfig = {
  port: parseInt(getEnvString('PORT', '3000'), 10),
  host: getEnvString('HOST', '0.0.0.0'),
  apiKey: getEnvString('API_KEY', 'dev-api-key'),
  logLevel: getEnvString('LOG_LEVEL', 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error',
  /** Per-key (or IP) request cap per time window. Lower in production to limit accident spend, e.g. API_RATE_LIMIT_MAX=120 */
  apiRateLimitMax: getEnvInt('API_RATE_LIMIT_MAX', 1000),
  /**
   * When true, workspace + JWT callers cannot exceed monthly billable units for their tier (master API_KEY bypasses).
   * Defaults on in production; set ENFORCE_USAGE_CAPS=false to keep soft limits during metering tuning.
   */
  enforceUsageCaps: getEnvBool(
    'ENFORCE_USAGE_CAPS',
    process.env['NODE_ENV'] === 'production',
  ),
};

export const stripeConfig = {
  secretKey:           process.env['STRIPE_SECRET_KEY']            ?? '',
  starterPriceId:      process.env['STRIPE_STARTER_PRICE_ID']      ?? '',
  teamPriceId:         process.env['STRIPE_TEAM_PRICE_ID']         ?? process.env['STRIPE_PRICE_ID'] ?? '',
  enterprisePriceId:   process.env['STRIPE_ENTERPRISE_PRICE_ID']   ?? '',
  webhookSecret:       process.env['STRIPE_WEBHOOK_SECRET']        ?? '',
  successUrl:          getEnvString('STRIPE_SUCCESS_URL', 'https://invariant.me/success.html'),
  cancelUrl:           getEnvString('STRIPE_CANCEL_URL', 'https://invariant.me/pricing.html'),
};

export const githubConfig = {
  clientId:     getEnvString('GITHUB_CLIENT_ID', ''),
  clientSecret: getEnvString('GITHUB_CLIENT_SECRET', ''),
  callbackUrl:  getEnvString('GITHUB_CALLBACK_URL', 'http://localhost:3000/auth/github/callback'),
  frontendUrl:  getEnvString('FRONTEND_URL', 'http://localhost:8080'),
};

export const authConfig = {
  jwtSecret:    getEnvString('JWT_SECRET', 'dev-jwt-secret-change-in-prod'),
  jwtExpiresIn: getEnvString('JWT_EXPIRES_IN', '7d'),
};

export const emailConfig = {
  host:     getEnvString('SMTP_HOST', 'smtp.gmail.com'),
  port:     parseInt(getEnvString('SMTP_PORT', '587'), 10),
  user:     getEnvString('SMTP_USER', ''),
  pass:     getEnvString('SMTP_PASS', ''),
  from:     getEnvString('SMTP_FROM', 'Invariant <jack@thestardrive.com>'),
  enabled:  process.env['SMTP_USER'] !== undefined && process.env['SMTP_USER'] !== '',
};
