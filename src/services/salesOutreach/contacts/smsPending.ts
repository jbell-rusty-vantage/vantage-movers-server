import mongoose from "mongoose";
import { logger } from "../../../logger";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { getSalesOutreachContactEventModel } from "../../../models/salesOutreach";
import { getRingCentralRepSmsEvidenceModel } from "../../../models/salesOutreach/repSmsEvidence";
import { repSmsCaptureEnabled } from "../../ringcentral/repSms/gate";
import { listReviewedRepMailboxes, type RepMailbox } from "../../ringcentral/repSms/mailboxes";

/**
 * Outreach lifecycle repair C7: SMS evidence that is still `pending_identity` / `pending_association` is
 * made visible instead of silent.
 *
 * `refreshSmsPendingCounts` counts the SMS contact events of the last 7 days (`event_at`) per owning
 * mailbox and verification (index `sod_contact_kind_verification_event`, then a `$lookup` of the
 * evidence row's `owning_extension_id`; the pending set is tiny) and writes the counts onto each
 * `rep_sms:<extension>` sync-state row as `rep_sms_pending {identity, association, since, agent_id,
 * computed_at}`. A mailbox with nothing pending is written zeros. Only existing mailbox rows are written:
 * a row is created by the mailbox's first sync, and a row without coverage would make SMS freshness
 * `unknown`. The contact-events cron calls it after the SMS sweep; it skips while every mailbox row was
 * computed less than 5 minutes ago, and while rep SMS capture is off. Reads sum the rows into
 * `freshness.sms.pending` (`reads/freshness.ts`).
 */
export const SMS_PENDING_WINDOW_DAYS = 7 as const;
export const SMS_PENDING_WINDOW_MS = SMS_PENDING_WINDOW_DAYS * 24 * 60 * 60_000;
/** Engineering bound: the counters are recomputed at most every 5 minutes. */
export const SMS_PENDING_REFRESH_MS = 5 * 60_000;
const MAX_MAILBOX_ROWS = 500;
const SCOPE_PREFIX = "rep_sms:";

export const SMS_PENDING_VERIFICATIONS = ["pending_identity", "pending_association"] as const;
export type SmsPendingVerification = (typeof SMS_PENDING_VERIFICATIONS)[number];

/** One aggregation group: pending events of one mailbox (null when the evidence row is gone) and verification. */
export type SmsPendingGroup = { extension_id: string | null; verification: SmsPendingVerification; count: number; oldest: Date | null };

export type MailboxPending = { identity: number; association: number; since: Date | null; agent_id: string | null; computed_at: Date };

/**
 * Pure: the counters of every mailbox row. A mailbox without groups gets zeros; a group whose mailbox
 * has no sync-state row (or whose evidence row is gone) is not written anywhere.
 */
export function pendingByMailbox(
  groups: readonly SmsPendingGroup[],
  mailboxExtensions: readonly string[],
  reviewedAgents: ReadonlyMap<string, string>,
  now: Date,
): Map<string, MailboxPending> {
  const out = new Map<string, MailboxPending>();
  for (const extension of mailboxExtensions)
    out.set(extension, { identity: 0, association: 0, since: null, agent_id: reviewedAgents.get(extension) ?? null, computed_at: now });
  for (const group of groups) {
    const row = group.extension_id === null ? undefined : out.get(group.extension_id);
    if (!row || group.count <= 0) continue;
    if (group.verification === "pending_identity") row.identity += group.count;
    else row.association += group.count;
    if (group.oldest && (!row.since || group.oldest < row.since)) row.since = group.oldest;
  }
  return out;
}

export type SmsPendingMailboxRow = { extension_id: string; computed_at: Date | null };

export type SmsPendingStore = {
  /** The `rep_sms:<extension>` sync-state rows with their last counters' instant. */
  listMailboxRows(): Promise<SmsPendingMailboxRow[]>;
  /** Pending SMS contact events with `event_at >= since`, grouped by owning mailbox and verification. */
  aggregatePending(since: Date): Promise<SmsPendingGroup[]>;
  write(counters: ReadonlyMap<string, MailboxPending>): Promise<number>;
};

export const mongoSmsPendingStore: SmsPendingStore = {
  async listMailboxRows() {
    const rows = (await getSalesIntelligenceSyncStateModel()
      .find({ scope: { $regex: `^${SCOPE_PREFIX}` } }, { scope: 1, "rep_sms_pending.computed_at": 1 })
      .limit(MAX_MAILBOX_ROWS)
      .lean()) as unknown as Array<{ scope: string; rep_sms_pending?: { computed_at?: Date | null } | null }>;
    return rows.map((row) => ({ extension_id: row.scope.slice(SCOPE_PREFIX.length), computed_at: row.rep_sms_pending?.computed_at ?? null }));
  },
  async aggregatePending(since) {
    const rows = await getSalesOutreachContactEventModel().aggregate<{
      _id: { extension_id: string | null; verification: SmsPendingVerification };
      count: number;
      oldest: Date | null;
    }>([
      { $match: { source_kind: "sms", verification: { $in: [...SMS_PENDING_VERIFICATIONS] }, event_at: { $gte: since } } },
      {
        $lookup: {
          from: getRingCentralRepSmsEvidenceModel().collection.collectionName,
          localField: "source_id",
          foreignField: "_id",
          as: "evidence",
          pipeline: [{ $project: { _id: 0, owning_extension_id: 1 } }],
        },
      },
      {
        $group: {
          _id: { extension_id: { $ifNull: [{ $first: "$evidence.owning_extension_id" }, null] }, verification: "$verification" },
          count: { $sum: 1 },
          oldest: { $min: "$event_at" },
        },
      },
    ]);
    return rows.map((row) => ({ extension_id: row._id.extension_id, verification: row._id.verification, count: row.count, oldest: row.oldest ?? null }));
  },
  async write(counters) {
    if (!counters.size) return 0;
    const result = await getSalesIntelligenceSyncStateModel().bulkWrite(
      [...counters].map(([extension, pending]) => ({
        updateOne: {
          filter: { scope: `${SCOPE_PREFIX}${extension}` },
          update: {
            $set: {
              rep_sms_pending: {
                identity: pending.identity,
                association: pending.association,
                since: pending.since,
                agent_id: pending.agent_id && mongoose.isValidObjectId(pending.agent_id) ? new mongoose.Types.ObjectId(pending.agent_id) : null,
                computed_at: pending.computed_at,
              },
            },
          },
        },
      })),
      { ordered: false },
    );
    return result.matchedCount;
  },
};

export type SmsPendingRefreshSummary =
  | { skipped: true; reason: "capture_disabled" | "no_mailbox" | "fresh" }
  | { skipped: false; mailboxes: number; written: number; identity: number; association: number; unattributed: number };

export type SmsPendingDeps = {
  enabled: () => Promise<boolean>;
  store: SmsPendingStore;
  mailboxes: (at: Date) => Promise<RepMailbox[]>;
};

export async function refreshSmsPendingCounts(now: Date, overrides: Partial<SmsPendingDeps> = {}): Promise<SmsPendingRefreshSummary> {
  const deps: SmsPendingDeps = {
    enabled: repSmsCaptureEnabled,
    store: mongoSmsPendingStore,
    mailboxes: (at) => listReviewedRepMailboxes(at),
    ...overrides,
  };
  if (!(await deps.enabled())) return { skipped: true, reason: "capture_disabled" };
  const rows = await deps.store.listMailboxRows();
  if (!rows.length) return { skipped: true, reason: "no_mailbox" };
  if (rows.every((row) => row.computed_at && now.getTime() - row.computed_at.getTime() < SMS_PENDING_REFRESH_MS))
    return { skipped: true, reason: "fresh" };
  const groups = await deps.store.aggregatePending(new Date(now.getTime() - SMS_PENDING_WINDOW_MS));
  const reviewed = new Map((await deps.mailboxes(now)).map((m) => [m.extension_id, m.agent_id]));
  const counters = pendingByMailbox(groups, rows.map((row) => row.extension_id), reviewed, now);
  const written = await deps.store.write(counters);
  const sum = (key: "identity" | "association") => [...counters.values()].reduce((total, row) => total + row[key], 0);
  const attributed = sum("identity") + sum("association");
  const total = groups.reduce((n, group) => n + group.count, 0);
  const summary = { skipped: false as const, mailboxes: counters.size, written, identity: sum("identity"), association: sum("association"), unattributed: total - attributed };
  if (summary.unattributed) logger.warn({ msg: "sales_outreach.sms_pending.unattributed", unattributed: summary.unattributed });
  return summary;
}
