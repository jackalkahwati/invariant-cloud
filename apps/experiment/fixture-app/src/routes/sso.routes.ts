/**
 * SSO Routes
 * Feature-local SSO route definitions and handlers
 */

import { Router, Request, Response } from 'express';
import { exchangeToken, invalidateSession, getSession } from '../auth/sso-provider';
import type { AuthenticatedRequest } from '../auth/middleware';

const ssoRouter = Router();

/**
 * POST /api/auth/sso/callback
 * Handles SAML/OIDC callback and creates session
 */
ssoRouter.post('/callback', async (req: Request, res: Response) => {
  try {
    const { samlResponse, idToken, code } = req.body;

    if (!samlResponse && !idToken && !code) {
      res.status(400).json({ error: 'Missing token' });
      return;
    }

    // Exchange token for session
    const response = await exchangeToken({
      samlResponse,
      idToken,
      code,
    });

    res.status(200).json({
      session_id: response.sessionId,
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid SSO callback' });
  }
});

/**
 * GET /api/auth/sso/logout
 * Invalidates user session
 */
ssoRouter.get('/logout', (req: Request, res: Response) => {
  try {
    const sessionId = req.query.session_id as string;

    if (sessionId) {
      invalidateSession(sessionId);
    }

    res.status(200).json({ status: 'logged_out' });
  } catch (error) {
    res.status(400).json({ error: 'Logout failed' });
  }
});

/**
 * GET /api/auth/sso/verify
 * Verifies current session (internal use)
 */
ssoRouter.get('/verify', (req: AuthenticatedRequest, res: Response) => {
  const sessionId = (req.headers['x-session-id'] as string) || (req.query.session_id as string);

  if (!sessionId) {
    res.status(401).json({ error: 'No session' });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  res.status(200).json({
    sessionId: session.sessionId,
    userId: session.userId,
    email: session.email,
    provider: session.provider,
    expiresAt: session.expiresAt,
  });
});

export default ssoRouter;
