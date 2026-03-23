/**
 * Fixture App — Main Entrypoint
 *
 * A compact, realistic web app that serves as the benchmark target.
 * The benchmark scenario adds:
 *   1. Enterprise SSO (SAML/OIDC)
 *   2. Audit Logging
 *   3. Admin Role Management
 *
 * This file intentionally represents the "before" state — minimal auth,
 * no SSO, no audit, basic roles only.
 */

export interface AppConfig {
  port: number;
  host: string;
  jwt_secret: string;
  database_url: string;
}

export interface AppContext {
  config: AppConfig;
  started_at: Date;
  version: string;
}

export function createApp(config: AppConfig): AppContext {
  return {
    config,
    started_at: new Date(),
    version: "1.0.0",
  };
}

// Routes registered (will be extended by benchmark tasks)
export const registeredRoutes: string[] = [
  "GET /health",
  "POST /auth/login",
  "POST /auth/register",
  "GET /users",
  "GET /users/:id",
  "PUT /users/:id",
  "DELETE /users/:id",
];
