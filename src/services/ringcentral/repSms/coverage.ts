import { repSmsSyncScope } from "../../../config/domain/ringcentralRepSms";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";

/**
 * SMS capture coverage per reviewed mailbox (RINGCENTRAL-CAPTURE §8), for the desk's SMS freshness
 * chip and for `EngineCoverage.sms.complete_through` (SRV-6 / S1 reads).
 *
 * - `never_synced`: no successful mailbox sync yet (SMS shows "pending — not connected");
 * - `delayed`: the last good sync is older than 10 minutes (SMS deadlines read `pending`, never missed);
 * - `current`: otherwise.
 * `known_complete_through` is the provider `syncTime` of the last complete sync and only ever comes
 * from a sync that stored every record. `coverage_from` is where the stored history starts.
 */
export const REP_SMS_DELAYED_AFTER_MS = 10 * 60_000;

export type RepSmsMailboxCoverage = {
  extension_id: string;
  state: "current" | "delayed" | "never_synced";
  known_complete_through: string | null;
  last_success_at: string | null;
  coverage_from: string | null;
};

export function mailboxCoverage(
  extensionId: string,
  row: { known_complete_through?: Date | null; message_sync?: { last_success_at?: Date | null; coverage_from?: Date | null } | null } | null,
  now: Date,
): RepSmsMailboxCoverage {
  const lastSuccess = row?.message_sync?.last_success_at ?? null;
  const state = !lastSuccess ? "never_synced" : now.getTime() - lastSuccess.getTime() > REP_SMS_DELAYED_AFTER_MS ? "delayed" : "current";
  return {
    extension_id: extensionId,
    state,
    known_complete_through: lastSuccess ? row?.known_complete_through?.toISOString() ?? null : null,
    last_success_at: lastSuccess?.toISOString() ?? null,
    coverage_from: row?.message_sync?.coverage_from?.toISOString() ?? null,
  };
}

/** Worst mailbox first: the header shows "SMS delayed" when any reviewed mailbox is not current. */
export function worstMailboxCoverage(items: readonly RepSmsMailboxCoverage[]): RepSmsMailboxCoverage | null {
  const rank = { never_synced: 0, delayed: 1, current: 2 } as const;
  return [...items].sort((a, b) => rank[a.state] - rank[b.state] || (a.known_complete_through ?? "").localeCompare(b.known_complete_through ?? ""))[0] ?? null;
}

export async function readRepSmsCoverage(extensionIds: readonly string[], now: Date): Promise<RepSmsMailboxCoverage[]> {
  if (!extensionIds.length) return [];
  const rows = await getSalesIntelligenceSyncStateModel()
    .find({ scope: { $in: extensionIds.map(repSmsSyncScope) } }, { scope: 1, known_complete_through: 1, message_sync: 1 })
    .lean();
  const byExtension = new Map(rows.map((row) => [String(row.scope).slice("rep_sms:".length), row]));
  return extensionIds.map((id) => mailboxCoverage(id, (byExtension.get(id) as never) ?? null, now));
}
