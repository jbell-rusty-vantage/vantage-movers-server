import mongoose, { type ClientSession } from "mongoose";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getContactNumberModel } from "../../models/ContactNumber";
import { canonicalJson } from "../durableWork/checksum";
import { callUserParty } from "./callRep";

/**
 * All Numbers call summary (all-numbers CONTRACT §2–§3): `calls`, `last_call`, `last_inbound_at`,
 * `last_outbound_at` and `waiting_since` on a Contact Number.
 *
 * Always recomputed from the number's `call_interactions`, never incrementally, so a late or
 * out-of-order Call Log reconcile, a merge or a re-pointed call lands correctly. Capture calls
 * `recomputeCallSummary` inside every persisted observation's transaction (`persistInteraction.ts`),
 * retention after a purge, and the v2 migration once per number.
 *
 * Counted calls are canonical (`merged_into_id: null`), unpurged, external (`Inbound`/`Outbound`)
 * and settled. Settled means `terminal` and not a provisional Call Log snapshot (CC-04): a call still
 * ringing or a mid-call snapshot is ignored until it ends, so a live call never opens "waiting".
 */
export type CallResult = "answered" | "missed" | "voicemail";

export type SummaryCallRow = {
  _id: unknown;
  direction: string;
  started_at: Date;
  provider_connected?: boolean | null;
  contact_type?: string | null;
  provider_result?: string | null;
  duration_seconds?: number | null;
  parties?: ReadonlyArray<{ role: string; connected?: boolean | null; extension_id?: string | null }> | null;
};

export type CallSummary = {
  calls: { inbound: number; outbound: number; missed: number };
  last_call: null | {
    interaction_id: mongoose.Types.ObjectId;
    at: Date;
    direction: "inbound" | "outbound";
    result: CallResult;
    duration_seconds: number | null;
    rc_extension_id: string | null;
  };
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
  waiting_since: Date | null;
};

/**
 * `answered` when the provider connected the call; `voicemail` when it was declared voicemail or the
 * provider result says so; otherwise `missed`. An outbound call that never connected keeps `missed`
 * as its result but is never counted as missed and never opens "waiting" (§3).
 */
export function callResult(row: Pick<SummaryCallRow, "provider_connected" | "contact_type" | "provider_result">): CallResult {
  if (row.provider_connected) return "answered";
  if (row.contact_type === "voicemail" || /voicemail/i.test(row.provider_result ?? "")) return "voicemail";
  return "missed";
}

/** Pure. Order-independent: the rows are sorted by start time (then id) before the walk. */
export function summarizeCalls(rows: readonly SummaryCallRow[]): CallSummary {
  const calls = [...rows]
    .filter((row) => row.direction === "Inbound" || row.direction === "Outbound")
    .sort((a, b) => +a.started_at - +b.started_at || String(a._id).localeCompare(String(b._id)));
  const summary: CallSummary = {
    calls: { inbound: 0, outbound: 0, missed: 0 },
    last_call: null,
    last_inbound_at: null,
    last_outbound_at: null,
    waiting_since: null,
  };
  let latestHandledAt: Date | null = null;
  const unanswered: Date[] = [];
  for (const row of calls) {
    const inbound = row.direction === "Inbound";
    const result = callResult(row);
    if (inbound) {
      summary.calls.inbound += 1;
      summary.last_inbound_at = row.started_at;
      if (result === "answered") latestHandledAt = row.started_at;
      else {
        summary.calls.missed += 1;
        unanswered.push(row.started_at);
      }
    } else {
      summary.calls.outbound += 1;
      summary.last_outbound_at = row.started_at;
      // Any outbound call, connected or not, counts as handled; an outbound text does not (v1).
      latestHandledAt = row.started_at;
    }
  }
  summary.waiting_since = unanswered.find((at) => !latestHandledAt || +at > +latestHandledAt) ?? null;
  const last = calls.at(-1);
  if (last) {
    summary.last_call = {
      interaction_id: new mongoose.Types.ObjectId(String(last._id)),
      at: last.started_at,
      direction: last.direction === "Inbound" ? "inbound" : "outbound",
      result: callResult(last),
      duration_seconds: typeof last.duration_seconds === "number" ? last.duration_seconds : null,
      rc_extension_id: callUserParty(last)?.extension_id ?? null,
    };
  }
  return summary;
}

/** The `call_interactions` predicate of a counted call on one number (index `call_interaction_number_started_id`). */
export function summaryCallFilter(numberId: mongoose.Types.ObjectId) {
  return {
    contact_number_id: numberId,
    merged_into_id: null,
    purged_at: null,
    direction: { $in: ["Inbound", "Outbound"] as Array<"Inbound" | "Outbound"> },
    terminal: true,
    call_log_state: { $ne: "provisional" as const },
  };
}

const SUMMARY_PROJECTION = {
  direction: 1,
  started_at: 1,
  provider_connected: 1,
  contact_type: 1,
  provider_result: 1,
  duration_seconds: 1,
  "parties.role": 1,
  "parties.connected": 1,
  "parties.extension_id": 1,
} as const;

/** Reads the number's counted calls (in the caller's transaction when given). */
export async function loadSummaryCalls(numberId: mongoose.Types.ObjectId, session?: ClientSession | null): Promise<SummaryCallRow[]> {
  return (await getCallInteractionModel()
    .find(summaryCallFilter(numberId), SUMMARY_PROJECTION)
    .session(session ?? null)
    .lean()) as unknown as SummaryCallRow[];
}

/** The stored fields a summary writes, so a recompute that changes nothing writes nothing. */
export function callSummaryFields(summary: CallSummary) {
  return {
    calls: summary.calls,
    last_call: summary.last_call,
    last_inbound_at: summary.last_inbound_at,
    last_outbound_at: summary.last_outbound_at,
    waiting_since: summary.waiting_since,
  };
}

/** Key-order-independent JSON (Dates as ISO strings, ObjectIds as hex), for "did anything change". */
export function stableJson(value: unknown): string {
  return canonicalJson(JSON.parse(JSON.stringify(value ?? null)));
}

function sameSummary(stored: Record<string, unknown>, next: ReturnType<typeof callSummaryFields>): boolean {
  const calls = (stored.calls ?? {}) as Partial<CallSummary["calls"]>;
  return stableJson({
    calls: { inbound: calls.inbound ?? 0, outbound: calls.outbound ?? 0, missed: calls.missed ?? 0 },
    last_call: stored.last_call ?? null,
    last_inbound_at: stored.last_inbound_at ?? null,
    last_outbound_at: stored.last_outbound_at ?? null,
    waiting_since: stored.waiting_since ?? null,
  }) === stableJson(next);
}

/**
 * Recomputes and stores one number's call summary. Writes the summary paths only, without a
 * `revision` bump: the summary is derived state, and the revision fences the Owner's lead-link
 * commands and capture's rollup CAS. Returns whether anything was written.
 */
export async function recomputeCallSummary(numberId: mongoose.Types.ObjectId | string, session?: ClientSession | null, options: { dry_run?: boolean } = {}): Promise<boolean> {
  const id = new mongoose.Types.ObjectId(String(numberId));
  const ContactNumber = getContactNumberModel();
  const stored = (await ContactNumber.findById(id, { calls: 1, last_call: 1, last_inbound_at: 1, last_outbound_at: 1, waiting_since: 1, purged_at: 1 })
    .session(session ?? null)
    .lean()) as unknown as (Record<string, unknown> & { purged_at?: Date | null }) | null;
  if (!stored || stored.purged_at) return false;
  const next = callSummaryFields(summarizeCalls(await loadSummaryCalls(id, session)));
  if (sameSummary(stored, next)) return false;
  if (options.dry_run) return true;
  await ContactNumber.updateOne({ _id: id }, { $set: next }, { session: session ?? undefined, timestamps: false });
  return true;
}
