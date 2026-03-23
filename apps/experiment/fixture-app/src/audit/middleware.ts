/**
 * Audit Middleware
 * Intercepts requests and logs audit events
 */

import type { Request, Response, NextFunction } from 'express';
import { logAudit } from './logger';
import type { AuditContext } from './extensions/audit';

declare global {
  namespace Express {
    interface Request {
      auditContext?: AuditContext;
    }
  }
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Attach audit context to request
  const context: AuditContext = {
    userId: (req as any).userId,
    resource: req.path,
    action: req.method,
  };
  (req as any).auditContext = context;

  // Hook into response finish to log after response
  res.on('finish', async () => {
    try {
      await logAudit({
        action: `${req.method} ${req.path}`,
        userId: context.userId,
        resource: context.resource,
        details: {
          statusCode: res.statusCode,
          method: req.method,
          path: req.path,
        },
      });
    } catch (error) {
      console.error('Failed to log audit entry:', error);
    }
  });

  next();
}
