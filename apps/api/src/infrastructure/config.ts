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
    mu1: 0.25,  // constraint violation risk
    mu2: 0.25,  // dependency breakage risk
    mu3: 0.20,  // contradiction amplification
    mu4: 0.15,  // uncertainty exposure
    mu5: 0.15,  // provenance fragility
  },
  stalenessLambda: getEnvFloat('STALENESS_LAMBDA', 0.001),
  contradictionThreshold: getEnvFloat('CONTRADICTION_THRESHOLD', 0.5),
  branchThreshold: getEnvFloat('BRANCH_THRESHOLD', 0.7),
  actionBudget: getEnvFloat('ACTION_BUDGET', 5.0),
  actionEpsilon: getEnvFloat('ACTION_EPSILON', 0.6),
  settlingMaxRounds: parseInt(process.env['SETTLING_MAX_ROUNDS'] ?? '50', 10),
};

export const serverConfig = {
  port: parseInt(getEnvString('PORT', '3000'), 10),
  host: getEnvString('HOST', '0.0.0.0'),
  apiKey: getEnvString('API_KEY', 'dev-api-key'),
  logLevel: getEnvString('LOG_LEVEL', 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error',
};
