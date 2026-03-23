/**
 * Recovery Policy
 *
 * Defines how a worker responds to a BLOCKED validation result.
 * V2 adds automatic recovery so blocked actions do not silently
 * degrade test pass rate.
 *
 * Recovery strategies:
 *   NONE         — original V1 behaviour: log and skip (degraded quality)
 *   BACKOFF_RETRY — wait exponentially, retry up to N times (file lock races)
 *   RESCHEDULE   — move action to end of queue, let other tasks progress first
 *   ESCALATE     — immediately generate a repair sub-task and halt this action
 */

export type RecoveryStrategy = "NONE" | "BACKOFF_RETRY" | "RESCHEDULE" | "ESCALATE";

export interface RecoveryPolicy {
  strategy: RecoveryStrategy;
  /** Max retry attempts (BACKOFF_RETRY) */
  max_attempts: number;
  /** Base backoff in ms; actual = base * attempt (linear backoff) */
  backoff_base_ms: number;
  /** Which block reasons are eligible for this recovery (substring match) */
  recoverable_reasons: string[];
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  strategy: "NONE",
  max_attempts: 0,
  backoff_base_ms: 0,
  recoverable_reasons: [],
};

export const BACKOFF_RETRY_POLICY: RecoveryPolicy = {
  strategy: "BACKOFF_RETRY",
  max_attempts: 3,
  backoff_base_ms: 10,
  recoverable_reasons: [
    "exclusively owned",  // File lock held by another task — may be released soon
    "Stale contract",     // Contract version lag — other task may have updated by now
  ],
};

export const RESCHEDULE_POLICY: RecoveryPolicy = {
  strategy: "RESCHEDULE",
  max_attempts: 2,
  backoff_base_ms: 5,
  recoverable_reasons: [
    "exclusively owned",
    "Active claims on",
  ],
};

/** Check whether a blocked result is recoverable under the given policy */
export function isRecoverable(reasons: string[], policy: RecoveryPolicy): boolean {
  if (policy.strategy === "NONE") return false;
  if (policy.recoverable_reasons.length === 0) return true; // All blocks recoverable
  return reasons.some((r) =>
    policy.recoverable_reasons.some((pat) => r.includes(pat))
  );
}

/** Tracking for a single action's recovery attempts */
export interface RecoveryState {
  action_id: string;
  attempts: number;
  recovered: boolean;
  recovery_reason: string;
}
