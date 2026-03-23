/**
 * Authentication Middleware
 * Handles session validation and user context injection
 */

import { Request, Response, NextFunction, Router } from 'express';
import { getSession, invalidateSession } from './sso-provider';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  sessionId?: string;
  userRole?: string;
}

/**
 * SSO Session Verification Middleware
 * Validates sessionId from header or query and attaches user context
 */
export function ssoSessionMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Extract session ID from header or query
  const sessionId =
    (req.headers['x-session-id'] as string) ||
    (req.query.session_id as string);

  if (sessionId) {
    // Validate session
    const session = getSession(sessionId);
    if (session) {
      req.userId = session.userId;
      req.sessionId = sessionId;
    }
  }

  next();
}

/**
 * Admin Role Check Middleware
 * Requires x-user-role header with 'admin' value
 */
export function adminRoleMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const userRole = req.headers['x-user-role'] as string;

  if (userRole === 'admin') {
    req.userRole = userRole;
    next();
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
}

/**
 * Create auth middleware router
 * Exports middleware for integration-wiring to mount
 */
export const authMiddlewareRouter = Router();

// This router can be extended with additional middleware routes if needed
export default authMiddlewareRouter;
