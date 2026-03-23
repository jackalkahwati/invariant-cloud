/**
 * Audit Logger with Sink Abstraction
 * Provides structured logging with pluggable sink implementations
 */

import { Router } from 'express';
import type { AuditLogEntry, AuditSink } from './types';
import { InMemoryAuditSink } from './sinks';

let defaultSink: AuditSink = new InMemoryAuditSink();

export function setAuditSink(sink: AuditSink): void {
  defaultSink = sink;
}

export async function logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
  const auditEntry: AuditLogEntry = {
    id: Math.random().toString(36).substr(2, 9),
    timestamp: Date.now(),
    ...entry,
  };
  await defaultSink.write(auditEntry);
}

export function createAuditRouter(): Router {
  const router = Router();

  router.get('/logs', async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const logs = await defaultSink.read(limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: 'Failed to read audit logs' });
    }
  });

  return router;
}
