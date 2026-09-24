import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import type { CsiPolicy } from "../../../validation/v1/salesIntelligence";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { isPromisedCallback, KNOWN_MISS_DISPOSITIONS, PROMISE_ORIGINS, attentionDue } from "../outreach/derive";
import { outcomeReason } from "../outreach/facts";
import { staffedMinutesBetween, type Staffing } from "../outreach/staffing";
import { priorityMongoPredicate } from "../outreach/closedHistory";
import type { OverviewPeriod } from "./periods";
import { emptyBands, type BandCounts } from "./now";

/**
 * S9-READS desk health (addendum §6.2, reconciliation §4.3): speed to lead, callbacks kept on time,
 * missed calls returned and flow in/out, each an indexed read over the period computed at `as_of`.
 * Record-based numbers honour the Priority filter; with a rep scope they count that rep's work.
 */
export type DeskFilters = { priority?: readonly string[] | null; agent_id?: string | null };
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const median = (values: readonly number[]) => percentile(values, 0.5);
/** Nearest-rank on the sorted values (null when empty). */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (p === 0.5 && sorted.length % 2 === 0) return (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}
const round1 = (value: number | null) => (value == null ? null : Math.round(value * 10) / 10);

/** Record filter shared by the record-based desk numbers: Priority (`filter_keys.priority` semantics) and the rep's responsibility. */
function recordFilter(filters: DeskFilters): Record<string, unknown> {
  const priority = priorityMongoPredicate(filters.priority ?? undefined);
  return { purged_at: null, ...(filters.agent_id ? { responsible_agent_id: oid(filters.agent_id) } : {}), ...(priority ? { $and: [priority] } : {}) };
}

// ── Speed to lead ──────────────────────────────────────────────────────────────────────────────
export type SpeedRecord = { trigger_at: Date; first_attributable_outbound_at?: Date | null; state: string };
/**
 * Form Lead records whose `trigger_at` is in the period: staffed minutes from `trigger_at` to the first
 * attributable outbound call. "Still waiting" = no outbound yet and not closed; "missed target" = the
 * first call (or, still waiting, `as_of`) came more than the policy's first-action minutes (30) later.
 */
export function speedToLead(records: readonly SpeedRecord[], asOf: Date, staffing: Staffing, targetMinutes: number) {
  const worked: number[] = [];
  let waiting = 0, missed = 0;
  for (const record of records) {
    const first = record.first_attributable_outbound_at ?? null;
    if (!first && record.state === "closed") continue;
    const minutes = staffedMinutesBetween(record.trigger_at, first ?? asOf, staffing);
    if (first) worked.push(minutes); else waiting++;
    if (minutes > targetMinutes) missed++;
  }
  return { leads: records.length, worked: worked.length, median_staffed_minutes: round1(median(worked)), p90_staffed_minutes: round1(percentile(worked, 0.9)),
    still_waiting: waiting, missed_target: missed, target_staffed_minutes: targetMinutes };
}

// ── Callbacks kept on time ─────────────────────────────────────────────────────────────────────
export type CallbackRow = { _id: unknown; kind: string; origin: string; status: string; due_at?: Date | null; completed_at?: Date | null; completion_basis?: string | null;
  disposition?: string | null; missed_episode_key?: string | null; promise_chain?: { root_id: unknown; root_origin: string } | null;
  date_resolution?: { precision?: string | null } | null; base_attention_due_at?: Date | null; snoozed_until?: Date | null };
/**
 * E16 via `isPromisedCallback` (F8): exact-time `call` follow-ups promised by a rep, the customer or the
 * Owner, due in the period. A retry successor counts as its root (only roots are the cohort; a root is
 * overdue now while it or an open successor is past due). Kept = completed by a call attempt at or before
 * `due_at`. `connected_contact_unknown` is not a known miss (`KNOWN_MISS_DISPOSITIONS`): a kept attempt with
 * it is `kept_contact_unknown`, never `kept_unreached`.
 */
export function callbacksKept(roots: readonly CallbackRow[], openSuccessorRoots: ReadonlySet<string>, asOf: Date) {
  let kept = 0, keptUnreached = 0, keptUnknown = 0, overdue = 0, pending = 0, late = 0;
  const misses = new Set<string>(KNOWN_MISS_DISPOSITIONS);
  const cohort = roots.filter(row => !row.promise_chain && isPromisedCallback(row as never));
  for (const row of cohort) {
    const due = row.due_at!;
    if (row.status === "completed" && row.completion_basis === "call_attempt" && row.completed_at && +row.completed_at <= +due) {
      kept++;
      if (misses.has(row.disposition ?? "")) keptUnreached++;
      else if (row.disposition === "connected_contact_unknown") keptUnknown++;
      continue;
    }
    if (row.status === "open") {
      const attention = attentionDue(row as never);
      if (attention && +attention <= +asOf) overdue++; else pending++;
      continue;
    }
    if (openSuccessorRoots.has(String(row._id))) { overdue++; continue; }
    late++;
  }
  const decided = kept + late + overdue;
  return { due: cohort.length, kept, kept_share: decided ? kept / decided : null, kept_unreached: keptUnreached, kept_contact_unknown: keptUnknown,
    not_kept: late, overdue_now: overdue, pending };
}

// ── Missed calls returned ──────────────────────────────────────────────────────────────────────
export type MissedRow = { status: string; first_missed_at?: Date | null; due_at?: Date | null; completed_at?: Date | null };
/** Missed-call episodes first missed in the period: returned on time = `completed_at ≤ due_at` (the policy's 15 staffed minutes). */
export function missedCallsReturned(rows: readonly MissedRow[], staffing: Staffing) {
  let onTime = 0, late = 0, open = 0, closedUnreturned = 0;
  const minutes: number[] = [];
  for (const row of rows) {
    if (row.status === "open") { open++; continue; }
    if (row.status !== "completed" || !row.completed_at) { closedUnreturned++; continue; }
    if (row.due_at && +row.completed_at <= +row.due_at) onTime++; else late++;
    if (row.first_missed_at) minutes.push(staffedMinutesBetween(row.first_missed_at, row.completed_at, staffing));
  }
  const returned = onTime + late;
  return { episodes: rows.length, returned_on_time: onTime, returned_late: late, still_open: open, closed_unreturned: closedUnreturned,
    on_time_share: returned + open + closedUnreturned ? onTime / (returned + open + closedUnreturned) : null, median_staffed_minutes_to_return: round1(median(minutes)) };
}

// ── Flow in / out ─────────────────────────────────────────────────────────────────────────────
export type TransitionRow = { subject_key: string; from_band?: number | null; to_band?: number | null; at: Date; cause?: { kind?: string | null } | null };
/** Reconciliation §4.3: `baseline` and `policy` rows are no movement; `capture_repair` is counted apart and never as rep activity. */
export const NON_FLOW_CAUSES = new Set(["baseline", "policy"]);
export function bandFlow(rows: readonly TransitionRow[], subjects: ReadonlySet<string> | null) {
  const into = emptyBands(), outOf = emptyBands();
  let moves = 0, captureRepair = 0, excluded = 0;
  for (const row of rows) {
    if (subjects && !subjects.has(row.subject_key)) continue;
    const kind = row.cause?.kind ?? "clock";
    if (NON_FLOW_CAUSES.has(kind)) { excluded++; continue; }
    if (kind === "capture_repair") { captureRepair++; continue; }
    moves++;
    if (row.to_band && row.to_band >= 1 && row.to_band <= 7) into[String(row.to_band) as keyof BandCounts]++;
    if (row.from_band && row.from_band >= 1 && row.from_band <= 7) outOf[String(row.from_band) as keyof BandCounts]++;
  }
  return { moves, into_band: into, out_of_band: outOf, capture_repair: captureRepair, excluded_baseline_or_policy: excluded };
}
/**
 * Time in band (addendum §6.3): per band, the median time since the newest transition into the band a
 * record is in now, over transitions of the last 30 days with baseline and policy rows excluded. A record
 * with no such transition is counted `unknown` (never zero).
 */
export const TIME_IN_BAND_WINDOW_MS = 30 * 86_400_000;
export function timeInBand(current: ReadonlyMap<string, number>, newestFirst: readonly TransitionRow[], asOf: Date) {
  const entered = new Map<string, TransitionRow>();
  for (const row of newestFirst) {
    if (NON_FLOW_CAUSES.has(row.cause?.kind ?? "clock") || entered.has(row.subject_key)) continue;
    entered.set(row.subject_key, row);
  }
  const ages = new Map<number, number[]>();
  const unknown = emptyBands();
  for (const [subject, band] of current) {
    const row = entered.get(subject);
    if (!row || row.to_band !== band) { unknown[String(band) as keyof BandCounts]++; continue; }
    const list = ages.get(band) ?? [];
    list.push(+asOf - +row.at);
    ages.set(band, list);
  }
  return Object.fromEntries(([1, 2, 3, 4, 5, 6, 7] as const).map(band => [String(band), { median_ms: median(ages.get(band) ?? []), known: ages.get(band)?.length ?? 0,
    unknown: unknown[String(band) as keyof BandCounts] }])) as Record<keyof BandCounts, { median_ms: number | null; known: number; unknown: number }>;
}
/** Closures in the period by Closed-view outcome (`outcomeReason`); `granot_booked` is S6-P5's Priority-5 closure. */
export function closureFlow(rows: readonly { state: string; closed_reason?: string | null; closure_origin?: string | null }[]) {
  const counts = { booked_in_granot: 0, booked: 0, crm_bad_dead: 0, owner_closed: 0, other: 0, total: rows.length };
  for (const row of rows) {
    if (row.closure_origin === "crm_disposition" && row.closed_reason === "granot_booked") { counts.booked_in_granot++; continue; }
    const reason = outcomeReason(row as never);
    if (reason === "booked") counts.booked++;
    else if (reason === "crm_dead" || reason === "crm_bad_unusable") counts.crm_bad_dead++;
    else if (reason === "owner") counts.owner_closed++;
    else counts.other++;
  }
  return counts;
}

/** The desk-health reads for one period (all batched; the count is constant in the data size). */
export async function readDeskHealth(period: OverviewPeriod, asOf: Date, policy: CsiPolicy, filters: DeskFilters,
  context: { flowSubjects: ReadonlySet<string> | null; currentBands: ReadonlyMap<string, number> }) {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const range = { $gte: period.start, $lt: period.end };
  const records = recordFilter(filters);
  const agentFollowups = filters.agent_id ? { $or: [{ responsible_agent_id: oid(filters.agent_id) }, { promised_by_agent_id: oid(filters.agent_id) }] } : {};
  const [speedRows, newCount, closures, roots, missed, quoted, transitions, recent] = await Promise.all([
    getOutreachRecordModel().find({ ...records, trigger_at: range, trigger_kind: "lead_arrival", "subject.kind": "lead", "subject.model": "FormLead" })
      .select({ trigger_at: 1, first_attributable_outbound_at: 1, state: 1 }).lean(),
    getOutreachRecordModel().countDocuments({ ...records, trigger_at: range }),
    getOutreachRecordModel().find({ ...records, state: "closed", closed_at: range }).select({ state: 1, closed_reason: 1, closure_origin: 1 }).lean(),
    getOutreachFollowupModel().find({ kind: "call", due_at: range, origin: { $in: [...PROMISE_ORIGINS] }, "date_resolution.precision": "exact", missed_episode_key: null, ...agentFollowups })
      .select({ kind: 1, origin: 1, status: 1, due_at: 1, completed_at: 1, completion_basis: 1, disposition: 1, missed_episode_key: 1, promise_chain: 1, date_resolution: 1,
        base_attention_due_at: 1, snoozed_until: 1, outreach_record_id: 1 }).lean(),
    getOutreachFollowupModel().find({ first_missed_at: range, missed_episode_key: { $type: "string" }, ...agentFollowups })
      .select({ status: 1, first_missed_at: 1, due_at: 1, completed_at: 1, outreach_record_id: 1 }).lean(),
    getSalesIntelligenceAuditEventModel().find({ event_kind: "lead_progress_updated", happened_at: range, "current.lead_progress.disposition": "quoted",
      "prior.lead_progress.disposition": { $ne: "quoted" } }).select({ subject_key: 1, "current.lead_progress.granot_priority": 1, "current.responsible_agent_id": 1 }).lean(),
    db.collection("outreach_band_transitions").find({ at: range }, { projection: { _id: 0, subject_key: 1, from_band: 1, to_band: 1, at: 1, "cause.kind": 1 } }).toArray(),
    db.collection("outreach_band_transitions").find({ at: { $gte: new Date(+asOf - TIME_IN_BAND_WINDOW_MS), $lte: asOf } },
      { projection: { _id: 0, subject_key: 1, to_band: 1, at: 1, "cause.kind": 1 } }).sort({ at: -1 }).toArray(),
  ]);
  // Follow-ups carry no Priority: a Priority filter keeps those whose record matches it (one batched read).
  let callbackRows = roots as unknown as (CallbackRow & { outreach_record_id: unknown })[];
  let missedRows = missed as unknown as (MissedRow & { outreach_record_id: unknown })[];
  if (filters.priority?.length) {
    const ids = [...new Set([...callbackRows, ...missedRows].map(row => String(row.outreach_record_id)))];
    const allowed = ids.length ? new Set((await getOutreachRecordModel().find({ _id: { $in: ids.map(oid) }, ...recordFilter({ priority: filters.priority }) }).select({ _id: 1 }).lean())
      .map(row => String(row._id))) : new Set<string>();
    callbackRows = callbackRows.filter(row => allowed.has(String(row.outreach_record_id)));
    missedRows = missedRows.filter(row => allowed.has(String(row.outreach_record_id)));
  }
  const rootIds = callbackRows.filter(row => !row.promise_chain).map(row => row._id as mongoose.Types.ObjectId);
  const successors = rootIds.length ? await getOutreachFollowupModel().find({ status: "open", due_at: { $lte: asOf }, "promise_chain.root_id": { $in: rootIds } })
    .select({ "promise_chain.root_id": 1, due_at: 1, base_attention_due_at: 1, snoozed_until: 1 }).lean() : [];
  const overdueRoots = new Set(successors.filter(row => { const at = attentionDue(row as never); return at && +at <= +asOf; }).map(row => String(row.promise_chain!.root_id)));
  const staffing: Staffing = { timezone: policy.timezone, staffed_hours: policy.staffed_hours };
  const quotedRows = (quoted as unknown as { subject_key: string; current?: { lead_progress?: { granot_priority?: string | null } | null; responsible_agent_id?: unknown } }[])
    .filter(row => !filters.agent_id || String(row.current?.responsible_agent_id ?? "") === filters.agent_id)
    .filter(row => !filters.priority?.length || filters.priority.includes(row.subject_key.startsWith("lead:") ? row.current?.lead_progress?.granot_priority ?? "not_set" : "no_lead"));
  const closureCounts = closureFlow(closures);
  return {
    speed_to_lead: speedToLead(speedRows as SpeedRecord[], asOf, staffing, policy.first_action_due_staffed_minutes),
    callbacks_kept: callbacksKept(callbackRows, overdueRoots, asOf),
    missed_calls_returned: missedCallsReturned(missedRows, staffing),
    flow: {
      new_outreach: newCount,
      moved_to_quoted: new Set(quotedRows.map(row => row.subject_key)).size,
      booked_in_granot: closureCounts.booked_in_granot,
      booked: closureCounts.booked,
      crm_bad_dead: closureCounts.crm_bad_dead,
      owner_closed: closureCounts.owner_closed,
      closed_total: closureCounts.total,
      net_active_change: newCount - closureCounts.total,
      bands: bandFlow(transitions as unknown as TransitionRow[], context.flowSubjects),
      time_in_band: timeInBand(context.currentBands, recent as unknown as TransitionRow[], asOf),
    },
  };
}
