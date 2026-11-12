import { connectMongo } from "../../db";
import { SheetSyncLease } from "../../models/SheetSyncLease";

export const LEAD_TAB_MIGRATION_FENCE_SCOPE = "lead-reporting:tab-migration";
export type LeadTabWriterFence = { lease_owner?: string | null; leased_until: Date };
type FenceLookup = (scope: string, now: Date) => Promise<LeadTabWriterFence | null>;
export type WriterFenceCheckOptions = { now?: Date; lookup?: FenceLookup };

async function lookupFence(scope: string, now: Date): Promise<LeadTabWriterFence | null> {
  await connectMongo();
  const lease = await SheetSyncLease.findOne({ scope, leased_until: { $gt: now } }).select({ lease_owner: 1, leased_until: 1 }).lean();
  return lease?.leased_until ? { lease_owner: lease.lease_owner, leased_until: lease.leased_until } : null;
}

/** Read through to the durable lease on every write boundary. No env flag or
 * isolate cache can turn the fence off before its owner releases/expires it. */
export async function readLeadTabWriterFence(options: WriterFenceCheckOptions = {}): Promise<LeadTabWriterFence | null> {
  const now = options.now ?? new Date();
  const fence = await (options.lookup ?? lookupFence)(LEAD_TAB_MIGRATION_FENCE_SCOPE, now);
  return fence && fence.leased_until > now ? fence : null;
}

export class LeadTabWritesFencedError extends Error {
  readonly code = "lead_sheet_tab_migration_in_progress";
  readonly retryable = true;
  constructor(readonly retry_after: Date) {
    super("Lead reporting sheet writes are temporarily fenced for tab migration; retry after the migration lease is released.");
    this.name = "LeadTabWritesFencedError";
  }
}

export async function assertLeadTabWritesAllowed(options: WriterFenceCheckOptions = {}): Promise<void> {
  const fence = await readLeadTabWriterFence(options);
  if (fence) throw new LeadTabWritesFencedError(fence.leased_until);
}

export async function assertLeadTargetWritesAllowed(targets: readonly { target: string }[], options: WriterFenceCheckOptions = {}): Promise<void> {
  if (targets.some(({ target }) => /^(?:master|source)_(?:forms|calls|duplicates|duplicate_calls|bad_leads|bad_calls)$/.test(target))) {
    await assertLeadTabWritesAllowed(options);
  }
}
