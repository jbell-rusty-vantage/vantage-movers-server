import mongoose from "mongoose";
import { csiFlag, type CSI_FLAGS } from "../../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getOutreachBandTransitionModel, OUTREACH_BAND_TRANSITION_CAUSES } from "../../../models/salesIntelligence/outreach";
import { csiPolicyEvolution, type CsiPolicy } from "../../../validation/v1/salesIntelligence";
import type { AttentionPublishMeta, BandSinceDto } from "../dto";
import { attentionDue, isPromisedCallback, promiseUnreachedSince } from "./derive";
import { addStaffedMinutes } from "./staffing";
import type { FollowupRow, RecordRow } from "./types";

/**
 * S9-PUBLISH (assignment addendum §6.3, reconciliation §4.3 / G8, T3-S9-INTERFACE §2–§7): band history.
 *
 * Everything here is behind `SALES_INTELLIGENCE_OVERVIEW`. The Attention publish compares each active row's
 * band and primary reason with the previous snapshot's index entry (read once per publish, through the
 * parsed-snapshot cache when warm), resolves the causes of the changed rows with one batched audit `$in`
 * (plus, only when a call caused a change, one batched `call_interactions` `$in` for `capture_recovery`),
 * and writes the rows with one `insertMany` inside the publish transaction. No write touches
 * `outreach_records` (RD9). The pure parts (primary reason, baseline estimate, cause mapping, the per-row
 * plan) are exported for the fixed-clock unit tests.
 */
export type BandTransitionCause = (typeof OUTREACH_BAND_TRANSITION_CAUSES)[number];
export type BandSince = BandSinceDto;

export function overviewEnabled(): boolean {
  return csiFlag("OVERVIEW");
}

/** The flags whose flip can move a band without any record change (T3-S9-INTERFACE §2). */
export const PUBLISH_META_FLAGS = ["ATTENTION_V2", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "PRIORITY5_CLOSURE", "RECEIVER_ASSIGNMENT",
  "RECEIVER_LATEST_WINS", "OVERVIEW"] as const satisfies readonly (typeof CSI_FLAGS)[number][];

export function publishMeta(policyVersion: string, flag: (name: (typeof PUBLISH_META_FLAGS)[number]) => boolean = csiFlag): AttentionPublishMeta {
  return { policy_version: policyVersion, flags: Object.fromEntries(PUBLISH_META_FLAGS.map(name => [name, flag(name)])) };
}
/** Same policy version and the same value for every flag either side names. */
export function samePublishMeta(a: AttentionPublishMeta | null | undefined, b: AttentionPublishMeta | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.policy_version !== b.policy_version) return false;
  const names = new Set([...Object.keys(a.flags), ...Object.keys(b.flags)]);
  return [...names].every(name => Boolean(a.flags[name]) === Boolean(b.flags[name]));
}

/** `derive()`'s band-carrying reasons (the secondary reasons such as `promised_by:*` or `unreached` carry no band). */
export const REASON_BAND: Readonly<Record<string, number>> = {
  promised_callback_overdue: 1,
  no_call_yet: 2, new_not_yet_due: 2,
  missed_call_no_callback: 3,
  followups_due: 4, promise_unreached: 4, no_callback_after_inbound: 4,
  no_next_step: 5,
  missing_responsibility: 6,
  going_cold: 7,
};
/** The first reason that belongs to the row's band, in `derive()` order; null without a band. */
export function primaryReason(band: number | null | undefined, reasons: readonly string[] | null | undefined): string | null {
  if (band == null) return null;
  return (reasons ?? []).find(reason => REASON_BAND[reason] === band) ?? null;
}

type EstimateRecord = Pick<RecordRow, "trigger_at"> & Partial<Pick<RecordRow, "first_action_due_at" | "last_meaningful_contact_at" | "first_attributable_outbound_at"
  | "first_human_conversation_at" | "last_activity_at" | "last_inbound_human_at">> & { lead_progress?: { first_work_observed_at?: Date | null } | null };
type EstimateAction = Pick<FollowupRow, "status" | "due_at" | "base_attention_due_at" | "snoozed_until"> & Partial<Pick<FollowupRow, "kind" | "origin" | "promise_chain"
  | "completed_at" | "first_missed_at" | "missed_episode_key" | "completion_basis" | "disposition" | "date_resolution">> & { _id?: unknown };

const earliest = (dates: readonly (Date | null | undefined)[]) => dates.filter((d): d is Date => d instanceof Date && Number.isFinite(+d)).sort((a, b) => +a - +b)[0] ?? null;
const newest = (dates: readonly (Date | null | undefined)[]) => dates.filter((d): d is Date => d instanceof Date && Number.isFinite(+d)).sort((a, b) => +b - +a)[0] ?? null;
function staffedAfter(from: Date, minutes: number, policy: Pick<CsiPolicy, "timezone" | "staffed_hours">): Date {
  try { return addStaffedMinutes(from, minutes, policy); } catch { return from; }
}

/**
 * Reconciliation §4.3: the one-time estimate of when the record entered `band`, in staffed time where a
 * threshold applies. Never after `asOf`. A row without a band (active, not in Attention) uses its last activity.
 *
 * | 1, 4 | the earliest due action's `attention_due_at` (band 1: the promised callbacks; band 4 `no_callback_after_inbound`: the inbound + its staffed window; `promise_unreached`: since the promise went unreached) |
 * | 2 | `trigger_at`; `first_action_due_at` for `no_call_yet` |
 * | 3 | the open missed-call episode's `first_missed_at` |
 * | 5 | the newest action completion, else `lead_progress.first_work_observed_at`, else the first attempt or conversation |
 * | 6 | `trigger_at` |
 * | 7 | `last_activity_at ?? last_meaningful_contact_at ?? trigger_at` plus `going_cold_staffed_minutes` |
 */
export function estimateBandEntry(input: { record: EstimateRecord; actions: readonly EstimateAction[]; band: number | null; reason: string | null;
  policy: CsiPolicy; asOf: Date }): Date {
  const { record, actions, band, reason, policy, asOf } = input;
  const open = actions.filter(a => a.status === "open");
  const due = open.filter(a => { const at = attentionDue(a); return Boolean(at && at <= asOf); });
  const trigger = record.trigger_at;
  const lastActivity = record.last_activity_at ?? record.last_meaningful_contact_at ?? trigger;
  let at: Date | null;
  switch (band) {
    case 1: {
      // Flag off, band 1 is a rep-promised call; on, any promised callback (F8).
      const promised = due.filter(a => a.kind === "call" && (a.origin === "rep_promise" || isPromisedCallback(a as Parameters<typeof isPromisedCallback>[0])));
      at = earliest((promised.length ? promised : due).map(a => attentionDue(a)));
      break;
    }
    case 4:
      if (reason === "no_callback_after_inbound" && record.last_inbound_human_at) {
        at = staffedAfter(record.last_inbound_human_at, csiPolicyEvolution(policy).inbound_followup_staffed_minutes, policy);
      } else if (reason === "promise_unreached") {
        at = promiseUnreachedSince(record as Pick<RecordRow, "last_meaningful_contact_at">, actions as FollowupRow[], csiPolicyEvolution(policy).callback_max_retries);
      } else at = earliest(due.map(a => attentionDue(a)));
      break;
    case 2:
      at = reason === "no_call_yet" ? record.first_action_due_at ?? trigger : trigger;
      break;
    case 3:
      at = earliest(open.filter(a => a.missed_episode_key).map(a => a.first_missed_at ?? null)) ?? earliest(due.map(a => attentionDue(a)));
      break;
    case 5:
      at = newest(actions.filter(a => a.status === "completed").map(a => a.completed_at ?? null)) ?? record.lead_progress?.first_work_observed_at
        ?? earliest([record.first_attributable_outbound_at, record.first_human_conversation_at]);
      break;
    case 6:
      at = trigger;
      break;
    case 7:
      at = staffedAfter(lastActivity, policy.going_cold_staffed_minutes, policy);
      break;
    default:
      at = lastActivity;
  }
  const value = at ?? trigger ?? asOf;
  return +value > +asOf ? new Date(+asOf) : new Date(+value);
}

/** The previous snapshot's view of one active row (its index entry). `revision`/`band_since` exist only on OVERVIEW publishes. */
export type PreviousBandEntry = { band: number | null; reason: string | null; band_since?: BandSince | null; revision?: number };
export type BandChange = {
  record_id: string; subject_key: string; from_band: number | null; to_band: number | null; from_reason: string | null; to_reason: string | null;
  at: Date; estimated: boolean; band_since: BandSince | null;
  /** Baseline rows carry their cause already; changed rows are resolved after the walk. */
  cause: { kind: "baseline" } | null;
  /** The record revision did not move since the previous snapshot row (null: the previous row did not record it). */
  same_revision: boolean | null;
};
export type BandMode = "baseline" | "compare" | "estimate_only";

/**
 * One active row. `baseline`: the first OVERVIEW publish (no transition row exists yet): one estimated row per
 * active row. `compare`: against the previous snapshot entry; a missing entry is a row that joined the active
 * set (from `null`). `estimate_only`: transitions exist but there is no previous snapshot to compare with, so
 * nothing is written and `band_since` is estimated.
 */
export function planBandRow(input: { mode: BandMode; previous: PreviousBandEntry | undefined; record_id: string; subject_key: string; band: number | null;
  reason: string | null; revision: number; asOf: Date; estimate: () => Date }): { band_since: BandSince | null; change: BandChange | null } {
  const { mode, previous, band, reason, asOf } = input;
  const base = { record_id: input.record_id, subject_key: input.subject_key };
  if (mode === "baseline") {
    const at = input.estimate();
    const band_since = band == null ? null : { at: at.toISOString(), estimated: true };
    return { band_since, change: { ...base, from_band: null, to_band: band, from_reason: null, to_reason: reason, at, estimated: true, band_since, cause: { kind: "baseline" }, same_revision: null } };
  }
  const estimated = (): BandSince | null => (band == null ? null : { at: input.estimate().toISOString(), estimated: true });
  if (mode === "estimate_only") return { band_since: estimated(), change: null };
  const fromBand = previous?.band ?? null, fromReason = previous?.reason ?? null;
  const bandChanged = fromBand !== band, reasonChanged = fromReason !== reason;
  const band_since = band == null ? null : !bandChanged ? previous?.band_since ?? estimated() : { at: asOf.toISOString(), estimated: false };
  if (!bandChanged && !reasonChanged) return { band_since, change: null };
  return { band_since, change: { ...base, from_band: fromBand, to_band: band, from_reason: fromReason, to_reason: reason, at: new Date(+asOf), estimated: false, band_since,
    cause: null, same_revision: previous?.revision == null ? null : previous.revision === input.revision } };
}

/** The audit projection the cause mapping reads. */
export type CauseAudit = {
  _id: unknown; subject_key: string; event_kind: string; recorded_at: Date; actor?: { kind?: string | null } | null;
  invalidation?: { kind?: string | null; target_id?: string | null } | null;
  current?: { interaction_id?: unknown; evidence_interaction_id?: unknown; closure_origin?: unknown } | null;
};
const CALL_EVENTS = new Set(["outreach_call_applied", "outreach_interaction", "call_fulfilled_action", "missed_call_episode", "historical_missed_fulfilled",
  "promise_retry_created", "promise_retry_reopened", "promise_reached_on_classification", "promise_unreached_on_classification", "identity_resolved",
  "identity_blocked", "number_review_opened"]);
const LEAD_PROGRESS_EVENTS = new Set(["lead_progress_updated", "progress_default_created", "followup_superseded_by_plan"]);
const FOLLOWUP_EVENTS = new Set(["intelligence_followup_created", "assessment_followup_created", "intelligence_commitment_evidence", "intelligence_effect",
  "wait_expired", "owner_followup_created"]);
/** Bookkeeping that never moves a band (story `EXCLUDED_AUDIT_EVENT_KINDS` plus projections of other subjects). */
const IGNORED_EVENTS = new Set(["clock_boundary", "outreach_number_linked", "outreach_lead_attachment_mirrored", "attachment_refreshed", "projection_refreshed",
  "media_played", "intelligence.submitted", "move_assessment_published", "outreach_contact_facts"]);

/**
 * `event_kind` (and the actor) → `cause.kind`; null for an event that cannot move a band, so the next older one is used.
 * Any Owner-actor event is `owner`. `interaction_id` names the call when the event carries one (for `capture_repair`).
 */
export function auditCause(event: CauseAudit): { kind: BandTransitionCause; interaction_id: string | null } | null {
  const kind = event.event_kind;
  if (IGNORED_EVENTS.has(kind)) return null;
  const interaction = (value: unknown) => (value != null && mongoose.isValidObjectId(String(value)) ? String(value) : null);
  if (event.actor?.kind === "owner") return { kind: "owner", interaction_id: null };
  if (CALL_EVENTS.has(kind)) {
    const id = kind === "outreach_call_applied" ? interaction(event.current?.interaction_id) ?? interaction(event.invalidation?.target_id)
      : interaction(event.current?.evidence_interaction_id);
    return { kind: "call", interaction_id: id };
  }
  if (LEAD_PROGRESS_EVENTS.has(kind)) return { kind: "lead_progress", interaction_id: null };
  if (FOLLOWUP_EVENTS.has(kind)) return { kind: "followup", interaction_id: null };
  if (kind === "outreach_closed") {
    const origin = event.current?.closure_origin;
    return { kind: origin === "official" ? "booking" : origin === "crm_disposition" ? "lead_progress" : "owner", interaction_id: null };
  }
  // A new record: a Lead arrival is Lead progress; a Number review opens from an unanswered call.
  if (kind === "outreach_created") return { kind: event.subject_key.startsWith("lead:") ? "lead_progress" : "call", interaction_id: null };
  if (event.invalidation?.kind === "followup") return { kind: "followup", interaction_id: null };
  if (event.invalidation?.kind === "interaction") return { kind: "call", interaction_id: interaction(event.invalidation.target_id) };
  return null;
}

export type ResolvedCause = { kind: BandTransitionCause; event_kind: string | null; target_id: string | null; audit_id: string | null };

/**
 * The cause of one changed row (reconciliation §4.3). In order:
 * 1. `policy`: `publish_meta` changed and the record revision did not move since the previous snapshot row;
 * 2. the newest mappable audit event of the subject recorded between the two `as_of` values; a `call` whose newest
 *    call event names a recovered call (`capture_recovery` set) is `capture_repair`;
 * 3. `policy` when `publish_meta` changed and the previous row did not record the revision (an OVERVIEW-off snapshot);
 * 4. `clock`.
 */
export function resolveBandCause(change: Pick<BandChange, "same_revision">, events: readonly CauseAudit[], metaChanged: boolean,
  recovered: ReadonlySet<string>): ResolvedCause {
  if (metaChanged && change.same_revision === true) return { kind: "policy", event_kind: null, target_id: null, audit_id: null };
  const ordered = [...events].sort((a, b) => +b.recorded_at - +a.recorded_at || String(b._id).localeCompare(String(a._id)));
  for (const event of ordered) {
    const cause = auditCause(event);
    if (!cause) continue;
    if (cause.kind === "call") {
      const call = cause.interaction_id ?? ordered.map(auditCause).find(c => c?.kind === "call" && c.interaction_id)?.interaction_id ?? null;
      return { kind: call && recovered.has(call) ? "capture_repair" : "call", event_kind: event.event_kind, target_id: call ?? event.invalidation?.target_id ?? null, audit_id: String(event._id) };
    }
    return { kind: cause.kind, event_kind: event.event_kind, target_id: event.invalidation?.target_id ?? null, audit_id: String(event._id) };
  }
  if (metaChanged) return { kind: "policy", event_kind: null, target_id: null, audit_id: null };
  return { kind: "clock", event_kind: null, target_id: null, audit_id: null };
}

const AUDIT_PROJECTION = { subject_key: 1, event_kind: 1, recorded_at: 1, "actor.kind": 1, invalidation: 1, "current.interaction_id": 1,
  "current.evidence_interaction_id": 1, "current.closure_origin": 1 } as const;

/**
 * Resolves every pending change's cause with one audit `$in` (and one `call_interactions` `$in` only when a call
 * caused a change), then returns the documents for the one `insertMany`. `since` is the previous snapshot's `as_of`.
 */
export async function bandTransitionDocs(changes: readonly BandChange[], context: { since: Date | null; asOf: Date; metaChanged: boolean; snapshotId: string }) {
  const pending = changes.filter(change => !change.cause && !(context.metaChanged && change.same_revision === true));
  const bySubject = new Map<string, CauseAudit[]>();
  if (pending.length) {
    const keys = [...new Set(pending.map(change => change.subject_key))];
    const window = context.since ? { $gt: context.since, $lte: context.asOf } : { $lte: context.asOf };
    const rows = await getSalesIntelligenceAuditEventModel().find({ subject_key: { $in: keys }, recorded_at: window }).select(AUDIT_PROJECTION).lean() as unknown as CauseAudit[];
    for (const row of rows) { const list = bySubject.get(row.subject_key); if (list) list.push(row); else bySubject.set(row.subject_key, [row]); }
  }
  const calls = new Set<string>();
  for (const change of pending) for (const event of bySubject.get(change.subject_key) ?? []) {
    const cause = auditCause(event);
    if (cause?.kind === "call" && cause.interaction_id) calls.add(cause.interaction_id);
  }
  const recovered = new Set<string>();
  if (calls.size) {
    const rows = await getCallInteractionModel().find({ _id: { $in: [...calls].map(id => new mongoose.Types.ObjectId(id)) }, capture_recovery: { $ne: null } }).select({ _id: 1 }).lean();
    for (const row of rows) recovered.add(String(row._id));
  }
  return changes.map(change => {
    const cause = change.cause ? { kind: change.cause.kind, event_kind: null, target_id: null, audit_id: null }
      : resolveBandCause(change, bySubject.get(change.subject_key) ?? [], context.metaChanged, recovered);
    return { record_id: new mongoose.Types.ObjectId(change.record_id), subject_key: change.subject_key, from_band: change.from_band, to_band: change.to_band,
      from_reason: change.from_reason, to_reason: change.to_reason, at: change.at, estimated: change.estimated,
      cause: { kind: cause.kind, event_kind: cause.event_kind, target_id: cause.target_id, audit_id: cause.audit_id ? new mongoose.Types.ObjectId(cause.audit_id) : null },
      snapshot_id: context.snapshotId, band_since: change.band_since ? { at: new Date(change.band_since.at), estimated: change.band_since.estimated } : null };
  });
}

/** Whether any transition row exists (the baseline runs once: only when none does). */
export async function bandTransitionsExist(): Promise<boolean> {
  return Boolean(await getOutreachBandTransitionModel().exists({}));
}

export type BandTransitionRow = {
  _id: mongoose.Types.ObjectId; record_id: mongoose.Types.ObjectId; subject_key: string; from_band: number | null; to_band: number | null;
  from_reason: string | null; to_reason: string | null; at: Date; estimated: boolean; snapshot_id: string; createdAt: Date;
  cause: { kind: BandTransitionCause; event_kind: string | null; target_id: string | null; audit_id: mongoose.Types.ObjectId | null };
  band_since: { at: Date; estimated: boolean } | null;
};

/**
 * Detail `band_since` (T3-S9-INTERFACE §6): from the record's newest transition row (one read on
 * `band_transition_record_at`), when that row's band is the band the detail derives now; null otherwise
 * (no band, or the band moved after the last publish and has no row yet).
 */
export async function readDetailBandSince(recordId: string, band: number | null): Promise<BandSince | null> {
  if (band == null) return null;
  const row = await getOutreachBandTransitionModel().findOne({ record_id: new mongoose.Types.ObjectId(recordId) }).sort({ at: -1, _id: -1 }).lean() as BandTransitionRow | null;
  return bandSinceFromRow(row, band);
}
export function bandSinceFromRow(row: Pick<BandTransitionRow, "to_band" | "at" | "estimated" | "band_since"> | null, band: number | null): BandSince | null {
  if (!row || band == null || row.to_band !== band) return null;
  const since = row.band_since ?? { at: row.at, estimated: row.estimated };
  return { at: new Date(since.at).toISOString(), estimated: since.estimated };
}
