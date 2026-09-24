import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { getOutreachRepDayModel } from "../../../models/salesIntelligence/overview";
import { MongoLeaseStore } from "../../durableWork/leases";
import { easternDayKey, easternInstantBounds, previousEasternDayKey } from "../../dailyOperations/dayDocument";
import { easternWallClockToUtc } from "../../../utils/easternTime";
import { resolveRepIdentityAt, type TemporalRepLink } from "../repIdentity/resolve";

/**
 * S9-READS (addendum §6.4, E17; reconciliation §4.4): per-rep ET day documents rebuilt wholesale
 * from `call_interactions`. A call counts when it is external (Inbound/Outbound), canonical
 * (`merged_into_id: null`), not purged, not a monitoring leg and final (`terminal: true`; an
 * in-progress call counts once it settles). The day is the call's real `started_at` in ET, so a
 * call a capture repair added later counts on the day it happened (`recovered_calls` says how many).
 *
 * Rep identity is the reviewed identity of each Vantage extension leg at the call time
 * (`resolveRepIdentityAt`, as `interactionRepIdentity`): a reviewed `sales_rep` link → that Agent;
 * no review, a proposal only, or conflicting links → `unmapped`; a reviewed non-sales role → not a
 * rep, not counted. A leg is the rep's when it connected, or it is the outbound leg of a terminal
 * outbound call (the `callFacts` rule).
 */
export const UNMAPPED_REP = "unmapped";
export type RepDayCall = {
  _id: unknown; provider_account_id: string; started_at: Date; direction: string; contact_type?: string | null; provider_connected?: boolean | null;
  duration_seconds?: number | null; capture_recovery?: { kind?: string } | null;
  parties?: Array<{ role: string; extension_id?: string | null; connected?: boolean | null; direction?: string | null }> | null;
  legs?: Array<{ extension_id?: string | null; duration_seconds?: number | null }> | null;
};
export type RepDayDoc = {
  _id: string; day: string; agent_key: string; agent_id: mongoose.Types.ObjectId | null;
  outbound_attempts: number; outbound_conversations: number; answered_inbound: number; human_conversations: number;
  talk_seconds: number; calls: number; recovered_calls: number; extensions: string[];
};
const CALL_PROJECTION = { _id: 1, provider_account_id: 1, started_at: 1, direction: 1, contact_type: 1, provider_connected: 1, duration_seconds: 1,
  capture_recovery: 1, "parties.role": 1, "parties.extension_id": 1, "parties.connected": 1, "parties.direction": 1, "legs.extension_id": 1, "legs.duration_seconds": 1 } as const;

/** The call filter for one ET day (index `call_interaction_started_window`). */
export function repDayCallFilter(day: string) {
  const { start, end } = easternInstantBounds(day);
  return { started_at: { $gte: start, $lt: end }, terminal: true, merged_into_id: null, purged_at: null, monitoring: { $ne: true }, direction: { $in: ["Inbound", "Outbound"] } };
}

/** Pure: the day's documents from its calls and the rep identity links of their extensions. Sorted by `agent_key`. */
export function buildRepDayDocs(day: string, calls: readonly RepDayCall[], links: readonly TemporalRepLink[]): RepDayDoc[] {
  const docs = new Map<string, RepDayDoc & { seen: Set<string>; exts: Set<string> }>();
  const doc = (key: string) => {
    let row = docs.get(key);
    if (!row) {
      row = { _id: `${day}|${key}`, day, agent_key: key, agent_id: key === UNMAPPED_REP ? null : new mongoose.Types.ObjectId(key),
        outbound_attempts: 0, outbound_conversations: 0, answered_inbound: 0, human_conversations: 0, talk_seconds: 0, calls: 0, recovered_calls: 0, extensions: [],
        seen: new Set(), exts: new Set() };
      docs.set(key, row);
    }
    return row;
  };
  for (const call of calls) {
    if (easternDayKey(call.started_at) !== day) continue;
    const outbound = call.direction === "Outbound", human = call.contact_type === "human_conversation";
    const userLegs = (call.parties ?? []).filter(p => p.role === "user" && p.extension_id && (p.connected || (outbound && p.direction === "Outbound")));
    const extensions = [...new Set(userLegs.map(p => p.extension_id!))].sort();
    for (const extension of extensions) {
      const resolution = resolveRepIdentityAt(links, call.provider_account_id, extension, call.started_at);
      if (resolution.status === "excluded_role") continue;
      const key = resolution.status === "reviewed" && resolution.agent_id ? resolution.agent_id : UNMAPPED_REP;
      const row = doc(key);
      const callId = String(call._id);
      const connected = userLegs.some(p => p.extension_id === extension && p.connected);
      if (key === UNMAPPED_REP) row.exts.add(extension);
      // One call counts once per rep row even when the rep has two legs on it.
      if (row.seen.has(callId)) continue;
      row.seen.add(callId);
      row.calls++;
      if (call.capture_recovery) row.recovered_calls++;
      if (outbound) { row.outbound_attempts++; if (human) row.outbound_conversations++; }
      if (!outbound && connected) row.answered_inbound++;
      if (human && connected) row.human_conversations++;
      if (connected) {
        const legSeconds = (call.legs ?? []).filter(l => l.extension_id === extension && typeof l.duration_seconds === "number").reduce((n, l) => n + Math.max(0, l.duration_seconds!), 0);
        const talk = legSeconds > 0 ? legSeconds : extensions.length === 1 && typeof call.duration_seconds === "number" ? Math.max(0, call.duration_seconds) : 0;
        row.talk_seconds += Math.round(talk);
      }
    }
  }
  return [...docs.values()].sort((a, b) => a.agent_key.localeCompare(b.agent_key))
    .map(({ seen: _seen, exts, ...row }) => ({ ...row, extensions: [...exts].sort() }));
}

async function loadLinks(calls: readonly RepDayCall[], session?: mongoose.ClientSession): Promise<TemporalRepLink[]> {
  const accounts = [...new Set(calls.map(c => c.provider_account_id))];
  const extensions = [...new Set(calls.flatMap(c => (c.parties ?? []).flatMap(p => (p.role === "user" && p.extension_id ? [p.extension_id] : []))))];
  if (!accounts.length || !extensions.length) return [];
  return await getRepIdentityLinkModel().find({ rc_account_id: { $in: accounts }, rc_extension_id: { $in: extensions } })
    .select({ _id: 1, revision: 1, agent_id: 1, rc_account_id: 1, rc_extension_id: 1, role_kind: 1, status: 1, effective_from: 1, effective_to: 1, reviewed_at: 1, reviewed_by: 1 })
    .session(session ?? null).lean() as unknown as TemporalRepLink[];
}

/**
 * Recompute one ET day: two reads (the day's calls, their links), then one transaction that replaces
 * the day's documents. Idempotent; a second run on unchanged calls writes identical documents.
 */
export async function rebuildRepDay(day: string, options: { session?: mongoose.ClientSession } = {}) {
  easternInstantBounds(day);
  const read = async (session?: mongoose.ClientSession) => {
    const calls = await getCallInteractionModel().find(repDayCallFilter(day) as never).select(CALL_PROJECTION).sort({ started_at: 1, _id: 1 }).session(session ?? null).lean() as unknown as RepDayCall[];
    return { calls, docs: buildRepDayDocs(day, calls, await loadLinks(calls, session)) };
  };
  const write = async (session: mongoose.ClientSession) => {
    const { calls, docs } = await read(session);
    const collection = getOutreachRepDayModel().collection;
    await collection.deleteMany({ day }, { session });
    if (docs.length) await collection.insertMany(docs as never[], { session });
    return { day, documents: docs.length, calls: calls.length, unmapped_calls: docs.find(d => d.agent_key === UNMAPPED_REP)?.calls ?? 0 };
  };
  return options.session ? write(options.session) : withTransaction(write);
}

/**
 * Addendum §6.4: which days a refresh at `now` recomputes. Today always; yesterday until 06:00 ET
 * the next morning, for late captures. Older days are closed (only `rebuild_overview_day` touches them).
 */
export function overviewRefreshDays(now: Date): string[] {
  const today = easternDayKey(now);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const sixAm = easternWallClockToUtc(y, m, d, 6, 0, 0)!;
  return +now < +sixAm ? [previousEasternDayKey(today), today] : [today];
}

export const OVERVIEW_REFRESH_SCOPE = "overview_refresh";
/** The cron `sales-intelligence-overview-refresh` (every 5 min) on its own lease. A no-op with `SALES_INTELLIGENCE_OVERVIEW` off. */
export async function runOverviewRefreshOnce(options: { now?: Date } = {}) {
  if (!csiFlag("OVERVIEW")) return { skipped: true as const, reason: "disabled" as const };
  const now = options.now ?? new Date();
  const store = new MongoLeaseStore(getSalesIntelligenceSyncStateModel());
  const token = await store.acquire({ scope: OVERVIEW_REFRESH_SCOPE, owner: randomUUID(), now: new Date(), ttl_ms: 240_000 });
  if (!token) return { skipped: true as const, reason: "lease_held" as const };
  try {
    const days = [];
    for (const day of overviewRefreshDays(now)) days.push(await rebuildRepDay(day));
    return { skipped: false as const, days };
  } finally { await store.release({ token, now: new Date() }); }
}
