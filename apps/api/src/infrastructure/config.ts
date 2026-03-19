/**
 * Configuration — loaded from environment variables with defaults.
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

export const engineConfig: EngineConfig = {
  coherenceWeights: {
    lambdaC: getEnvFloat('COHERENCE_LAMBDA_C', 1.0),
    lambdaK: getEnvFloat('COHERENCE_LAMBDA_K', 1.5),
    lambdaD: getEnvFloat('COHERENCE_LAMBDA_D', 0.8),
    lambdaU: getEnvFloat('COHERENCE_LAMBDA_U', 0.5),
    lambdaB: getEnvFloat('COHERENCE_LAMBDA_B', 0.7),
    kScale:  getEnvFloat('COHERENCE_K_SCALE',  2.0),
  },
  actionWeights: {
    mu1: 0.20,  // constraint violation risk
    mu2: 0.20,  // dependency breakage risk
    mu3: 0.15,  // contradiction amplification
    mu4: 0.10,  // uncertainty exposure
    mu5: 0.15,  // provenance fragility
    mu6: 0.20,  // propagated risk (Phase 1: graph-traversal transitive risk)
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
};

export const stripeConfig = {
  secretKey:           process.env['STRIPE_SECRET_KEY']            ?? '',
  teamPriceId:         process.env['STRIPE_TEAM_PRICE_ID']         ?? process.env['STRIPE_PRICE_ID'] ?? '',
  enterprisePriceId:   process.env['STRIPE_ENTERPRISE_PRICE_ID']   ?? '',
  webhookSecret:       process.env['STRIPE_WEBHOOK_SECRET']        ?? '',
  successUrl:          getEnvString('STRIPE_SUCCESS_URL', 'http://localhost:8080/success.html'),
  cancelUrl:           getEnvString('STRIPE_CANCEL_URL',  'http://localhost:8080/pricing.html'),
};

export const authConfig = {
  jwtSecret:    getEnvString('JWT_SECRET', 'dev-jwt-secret-change-in-prod'),
  jwtExpiresIn: getEnvString('JWT_EXPIRES_IN', '7d'),
};

export const emailConfig = {
  host:     getEnvString('SMTP_HOST',     'smtp.gmail.com'),
  port:     parseInt(getEnvString('SMTP_PORT', '587'), 10),
  user:     getEnvString('SMTP_USER',     ''),
  pass:     getEnvString('SMTP_PASS',     ''),
  from:     getEnvString('SMTP_FROM',     'Invariant <hello@invariant.dev>'),
  enabled:  process.env['SMTP_USER'] !== undefined && process.env['SMTP_USER'] !== '',
};
