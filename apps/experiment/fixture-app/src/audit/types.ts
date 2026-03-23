/**
 * Audit Logger Types
 */

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  action: string;
  userId?: string;
  resource?: string;
  details?: Record<string, unknown>;
}

export interface AuditSink {
  write(entry: AuditLogEntry): Promise<void>;
  read(limit?: number): Promise<AuditLogEntry[]>;
}
