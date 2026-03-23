/**
 * Role Enforcement Guard
 * Provides middleware and utilities for role-based access control
 */

import { Request, Response, NextFunction } from 'express';
import { isAdmin, hasPermission } from './permissions';
import type { Role } from './types';

export interface GuardedRequest extends Request {
  userId?: string;
  sessionId?: string;
  userRole?: string;
}

/**
 * Guard factory: requires admin role
 * Returns Express middleware that enforces admin access
 */
export function requireRole(requiredRole: string) {
  return (req: GuardedRequest, res: Response, next: NextFunction): void => {
    const userRole = req.headers['x-user-role'] as string;

    if (!userRole) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (userRole === requiredRole || isAdmin(userRole)) {
      req.userRole = userRole;
      next();
    } else {
      res.status(403).json({ error: 'Forbidden' });
    }
  };
}

/**
 * Guard: requires permission
 * Returns Express middleware that enforces permission-based access
 */
export function requirePermission(permission: string) {
  return (req: GuardedRequest, res: Response, next: NextFunction): void => {
    const userRole = req.headers['x-user-role'] as string;

    if (!userRole) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (hasPermission(userRole, permission)) {
      req.userRole = userRole;
      next();
    } else {
      res.status(403).json({ error: 'Forbidden' });
    }
  };
}

/**
 * Guard: requires admin role specifically
 * Returns Express middleware that enforces admin access
 */
export function requireAdmin(req: GuardedRequest, res: Response, next: NextFunction): void {
  const userRole = req.headers['x-user-role'] as string;

  if (!userRole) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (isAdmin(userRole)) {
    req.userRole = userRole;
    next();
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
}

/**
 * Check if user has admin access
 */
export function checkAdminAccess(userRole?: string): boolean {
  if (!userRole) return false;
  return isAdmin(userRole);
}

/**
 * Check if user has required permission
 */
export function checkPermission(userRole: string, permission: string): boolean {
  return hasPermission(userRole, permission);
}
