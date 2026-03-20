import type { Workspace, WorkspaceTier } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';

/** Aligned with docs/billing-pricing.md (billable units per month). */
export const TIER_MONTHLY_BILLABLE_UNITS: Record<WorkspaceTier, number> = {
  FREE:       100_000,
  STARTER:  1_000_000,
  TEAM:    10_000_000,
  ENTERPRISE: 999_999_999,
};

export function tierMonthlyBillableCap(tier: WorkspaceTier): number {
  return TIER_MONTHLY_BILLABLE_UNITS[tier];
}

/**
 * Billable units for a single request (v0 weights from billing doc).
 * Other write routes are unmetered until counters are wired per-route.
 */
export function billableUnitsForRequest(method: string, path: string): number {
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return 0;
  if (path.startsWith('/auth/') || path.startsWith('/checkout')) return 0;

  if (path === '/actions/validate' || path === '/actions/simulate') return 10;
  if (path === '/claims' || path === '/observations') return 1;
  if (path.includes('/claims/') && path.endsWith('/supersede')) return 1;
  return 0;
}

export async function resetMonthlyClaimsIfNeeded(w: Workspace): Promise<Workspace> {
  const resetAt = new Date(w.claimsResetAt);
  const now = new Date();
  const sameMonth =
    resetAt.getUTCFullYear() === now.getUTCFullYear() && resetAt.getUTCMonth() === now.getUTCMonth();
  if (sameMonth) return w;
  return prisma.workspace.update({
    where: { id: w.id },
    data: { claimsThisMonth: 0, claimsResetAt: now },
  });
}
