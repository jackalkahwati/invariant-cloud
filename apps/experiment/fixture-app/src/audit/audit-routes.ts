/**
 * Audit Routes Utilities
 * Helper functions and utilities for audit routing
 */

import type { Request, Response, NextFunction } from 'express';
import { addAuditLog } from '../routes/audit.routes';

/**
 * Wrapper to log audit events from route handlers
 */
export function logAuditEvent(req: Request, res: Response, entry: {
  action: string;
  userId?: string;
  resource: string;
  details: Record<string, any>;
}): void {
  addAuditLog({
    action: entry.action,
    userId: entry.userId || (req as any).userId,
    resource: entry.resource,
    details: entry.details,
  });
}

/**
 * Enhance audit context from request
 */
export function getAuditContext(req: Request): {
  userId?: string;
  resource: string;
  action: string;
} {
  return {
    userId: (req as any).userId,
    resource: req.path,
    action: req.method,
  };
}
