/**
 * Base auth module — written by integration-wiring task
 * Provides authentication context and utilities
 */

export interface AuthContext {
  sessionId?: string;
  userId?: string;
  role?: string;
}

export const createAuthContext = (sessionId?: string): AuthContext => {
  return { sessionId };
};
