/**
 * Auth Module — Core authentication utilities
 * Written by integration-wiring task
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Authentication context attached to requests
 */
export interface AuthContext {
  sessionId?: string;
  userId?: string;
  role?: string;
}

/**
 * Extract auth context from request headers
 */
export function extractAuthContext(req: Request): AuthContext {
  const sessionId = (req.headers['x-session-id'] as string) || (req.query.session_id as string);
  const userId = (req.headers['x-user-id'] as string);
  const role = (req.headers['x-user-role'] as string);

  return {
    sessionId,
    userId,
    role,
  };
}

/**
 * Attach auth context to request object
 */
export function withAuthContext(req: Request, _res: Response, next: NextFunction): void {
  const context = extractAuthContext(req);
  (req as any).authContext = context;
  (req as any).sessionId = context.sessionId;
  (req as any).userId = context.userId;
  (req as any).role = context.role;
  next();
}
