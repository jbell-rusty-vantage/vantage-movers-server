import { GranotRunConflict } from "./errors";
import type { GranotAutomationActionReceipt } from '../granotLifecycle/automationApply';

type ReceiptWriter = (filter: Record<string, unknown>, update: Record<string, unknown>) => PromiseLike<{ matchedCount: number }>;

/** Keep the legacy array readable while sending only one action result per write. */
export async function persistActionReceipt(
  write: ReceiptWriter,
  fence: () => Record<string, unknown>,
  receipt: GranotAutomationActionReceipt,
  progress?: Record<string, unknown>,
): Promise<void> {
  const fields = progress ? { checkpoint: progress } : {};
  const replaced = await write(
    { ...fence(), 'receipts.action_id': receipt.action_id },
    { $set: { 'receipts.$': receipt, ...fields } },
  );
  // An identical replay is successful even when Mongo reports zero modifications.
  if (replaced.matchedCount === 1) return;
  const appended = await write(
    { ...fence(), 'receipts.action_id': { $ne: receipt.action_id } },
    { $push: { receipts: receipt }, ...(progress ? { $set: fields } : {}) },
  );
  if (appended.matchedCount !== 1) throw new Error('Granot apply checkpoint lost its fenced lease.');
}

/** Planning progress is advisory; a crash recollects and never resumes from this cursor. */
export function createPlanningCheckpointGate(startedAt: number) {
  let lastCount = 0;
  let lastAt = startedAt;
  return (count: number, now: number): boolean => {
    if (count - lastCount < 25 && now - lastAt < 5_000) return false;
    lastCount = count;
    lastAt = now;
    return true;
  };
}

export type PersistedRunLease = { leased_until?: Date | null } | null;

// Half the unchanged 45-minute TTL leaves 1,350 seconds of headroom, exceeding
// vercel.json api/index.ts maxDuration=800. A non-renewing gate must leave enough
// time for an entire serverless invocation; local actions still need bounded I/O.
export const GRANOT_RUN_LEASE_RENEWAL_HEADROOM_MS = 22.5 * 60_000;

/** Reads must freshly fence owner/epoch (and run status) on the primary. */
export async function renewRunLeaseWhenDue(deps: {
  readAccount: () => Promise<PersistedRunLease>;
  readRun: () => Promise<PersistedRunLease>;
  renew: () => Promise<void>;
  now: () => number;
}): Promise<void> {
  // No local token/cache can stand in for either persisted ownership check.
  const [account, run] = await Promise.all([deps.readAccount(), deps.readRun()]);
  const now = deps.now();
  const accountExpiry = account?.leased_until?.getTime() ?? NaN;
  const runExpiry = run?.leased_until?.getTime() ?? NaN;
  if (!Number.isFinite(accountExpiry) || accountExpiry <= now) throw new GranotRunConflict('LEASE_LOST', 'Granot account lease is missing, changed or expired.');
  if (!Number.isFinite(runExpiry) || runExpiry <= now) throw new GranotRunConflict('RUN_LEASE_LOST', 'Granot run lease is missing, changed or expired.');
  if (Math.min(accountExpiry, runExpiry) - now <= GRANOT_RUN_LEASE_RENEWAL_HEADROOM_MS) await deps.renew();
}
