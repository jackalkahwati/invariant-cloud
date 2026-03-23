/**
 * Audit Sinks
 * In-memory implementation for testing
 */

import type { AuditLogEntry, AuditSink } from './types';

export class InMemoryAuditSink implements AuditSink {
  private logs: AuditLogEntry[] = [];

  async write(entry: AuditLogEntry): Promise<void> {
    this.logs.push(entry);
  }

  async read(limit?: number): Promise<AuditLogEntry[]> {
    if (limit === undefined) {
      return [...this.logs];
    }
    return this.logs.slice(0, limit);
  }
}
