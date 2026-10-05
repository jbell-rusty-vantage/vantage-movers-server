import { createHash } from "node:crypto";
import { logger } from "../../../logger";
import { repSmsSyncScope } from "../../../config/domain/ringcentralRepSms";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { inRepSmsPollWindow, repSmsCaptureEnabled } from "./gate";
import { listReviewedRepMailboxes, type RepMailbox } from "./mailboxes";
import { runRepSmsMailboxSync, type MailboxSyncSummary } from "./mailboxSync";

/**
 * 5-minute safety poll per mailbox during staffed hours (RINGCENTRAL-CAPTURE §5/§7), because
 * message-store update events carry no ids and dropped deliveries are not replayed.
 *
 * The cron fires every minute; each mailbox owns one stable minute slot of five (a hash of its
 * extension id), so ~10 mailboxes spread over the five minutes instead of bursting. A mailbox whose
 * last good sync is younger than 4 minutes (a webhook-driven sync just ran) is not polled again. The
 * poll uses the low Light lane (10/min) and never waits for a slot. The first run of a mailbox is its
 * 7-day FSync (FAST-TRACK SMS history).
 */
export const REP_SMS_POLL_SLOTS = 5;
export const REP_SMS_POLL_FRESH_MS = 4 * 60_000;

export function repSmsPollSlot(extensionId: string): number {
  return createHash("sha256").update(extensionId).digest().readUInt32BE(0) % REP_SMS_POLL_SLOTS;
}

/** Pure: which mailboxes this minute polls. */
export function mailboxesDueForPoll(
  mailboxes: readonly RepMailbox[],
  lastSuccess: ReadonlyMap<string, Date | null>,
  now: Date,
): RepMailbox[] {
  const slot = now.getUTCMinutes() % REP_SMS_POLL_SLOTS;
  return mailboxes.filter((m) => {
    if (repSmsPollSlot(m.extension_id) !== slot) return false;
    const last = lastSuccess.get(m.extension_id) ?? null;
    return !last || now.getTime() - last.getTime() >= REP_SMS_POLL_FRESH_MS;
  });
}

export type RepSmsPollSummary = {
  skipped: boolean;
  skip_reason: "capture_disabled" | "outside_staffed_hours" | null;
  mailboxes: number;
  polled: number;
  results: Array<Pick<MailboxSyncSummary, "extension_id" | "skipped" | "sync_type" | "records" | "inserted" | "updated" | "error_code">>;
  deadline_reached: boolean;
};

export type RepSmsPollDeps = {
  now: () => Date;
  enabled: () => Promise<boolean>;
  mailboxes: (at: Date) => Promise<RepMailbox[]>;
  lastSuccess: (extensionIds: string[]) => Promise<Map<string, Date | null>>;
  sync: (mailbox: RepMailbox) => Promise<MailboxSyncSummary>;
  deadlineMs: number;
  clock: () => number;
};

async function lastSuccessByMailbox(extensionIds: string[]): Promise<Map<string, Date | null>> {
  const rows = await getSalesIntelligenceSyncStateModel()
    .find({ scope: { $in: extensionIds.map(repSmsSyncScope) } }, { scope: 1, message_sync: 1 })
    .lean();
  const out = new Map<string, Date | null>();
  for (const row of rows) {
    const extension = String(row.scope).slice("rep_sms:".length);
    out.set(extension, (row.message_sync as { last_success_at?: Date | null } | undefined)?.last_success_at ?? null);
  }
  return out;
}

export async function runRepSmsSafetyPoll(overrides: Partial<RepSmsPollDeps> = {}): Promise<RepSmsPollSummary> {
  const deps: RepSmsPollDeps = {
    now: () => new Date(),
    enabled: repSmsCaptureEnabled,
    mailboxes: (at) => listReviewedRepMailboxes(at),
    lastSuccess: lastSuccessByMailbox,
    sync: (mailbox) => runRepSmsMailboxSync(mailbox, { priority: "low" }),
    deadlineMs: 40_000,
    clock: () => Date.now(),
    ...overrides,
  };
  const summary: RepSmsPollSummary = { skipped: false, skip_reason: null, mailboxes: 0, polled: 0, results: [], deadline_reached: false };
  const now = deps.now();
  if (!(await deps.enabled())) return { ...summary, skipped: true, skip_reason: "capture_disabled" };
  if (!inRepSmsPollWindow(now)) return { ...summary, skipped: true, skip_reason: "outside_staffed_hours" };
  const mailboxes = await deps.mailboxes(now);
  summary.mailboxes = mailboxes.length;
  const due = mailboxesDueForPoll(mailboxes, await deps.lastSuccess(mailboxes.map((m) => m.extension_id)), now);
  const deadline = deps.clock() + deps.deadlineMs;
  for (const mailbox of due) {
    if (deps.clock() >= deadline) {
      summary.deadline_reached = true;
      break;
    }
    try {
      const result = await deps.sync(mailbox);
      summary.polled += 1;
      summary.results.push({
        extension_id: result.extension_id,
        skipped: result.skipped,
        sync_type: result.sync_type,
        records: result.records,
        inserted: result.inserted,
        updated: result.updated,
        error_code: result.error_code,
      });
      // The low lane never waits: a throttle means the rest of this minute would be refused too.
      if (result.error_code === "provider_throttled") break;
    } catch (error) {
      logger.warn({ msg: "sales_outreach.rep_sms_poll.mailbox_failed", extensionId: mailbox.extension_id, errorName: error instanceof Error ? error.name : "Error" });
    }
  }
  return summary;
}
