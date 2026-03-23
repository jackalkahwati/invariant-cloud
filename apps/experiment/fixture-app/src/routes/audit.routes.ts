/**
 * Audit Routes
 * Provides endpoints for audit log retrieval and management
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

const auditRouter = Router();

// In-memory audit log storage for this implementation
const auditLogs: Array<{
  id: string;
  action: string;
  userId?: string;
  resource: string;
  details: Record<string, any>;
  timestamp: number;
}> = [];

// Export function to add logs (used by middleware and other modules)
export function addAuditLog(entry: {
  action: string;
  userId?: string;
  resource: string;
  details: Record<string, any>;
}): void {
  auditLogs.push({
    id: `log-${Date.now()}-${Math.random()}`,
    ...entry,
    timestamp: Date.now(),
  });
}

/**
 * GET /api/audit/logs
 * Retrieve audit logs with optional limit parameter
 */
auditRouter.get('/logs', (req: Request, res: Response): void => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  
  let logs = [...auditLogs];
  
  if (limit && limit > 0) {
    logs = logs.slice(-limit);
  }
  
  res.json(logs);
});

export default auditRouter;
