/**
 * Auth Audit Extension
 * Provides audit context and integration hooks for auth module
 */

export interface AuditContext {
  userId?: string;
  resource?: string;
  action?: string;
}

export function enrichAuditContext(context: AuditContext, userId?: string): AuditContext {
  return {
    ...context,
    userId: userId || context.userId,
  };
}
