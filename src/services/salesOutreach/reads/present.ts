import type { SalesOutreachCadenceExposure } from "../../../config/domain/salesOutreach";
import type {
  SalesOutreachChannelDto,
  SalesOutreachQueueRowDto,
} from "../../../validation/v1/salesOutreachReads";
import { presentProjectionExposure } from "../evaluation/projection";
import type { ChannelCoverage } from "../evidence/coverage";
import type { DeskReadCoverage } from "./common";
import type { QueueDateKey, QueueMatchable } from "./queueQuery";

/**
 * Read-side presentation of stored projections (CONTRACTS "Common read data"; IMPLEMENTATION-PLAN §4.5).
 *
 * Status is derived at the read's one reference instant (`as_of`) with the channel's cadence coverage
 * (olr A2, SPECIFICATION §10.3): a requirement stored as `due` whose deadline has passed reads `overdue`
 * only when coverage proves the deadline, otherwise `due` + `verification.state = unverified` ("not
 * yet verified"). The move-date review is computed from `as_of`'s New York date — so countdowns never
 * rewrite rows. The result then passes through `presentProjectionExposure`: a `shadow` row shows
 * deadlines and requirements but no overdue label and no verification.
 */

type ChannelStatus = SalesOutreachChannelDto["status"];

export type StoredChannel = Readonly<{
  required: number | null;
  verified_completed: number | null;
  remaining: number | null;
  due_at: Date | null;
  oldest_actionable_due_at: Date | null;
  status: ChannelStatus;
  completion_kind: string | null;
  coverage: unknown;
  blocked_reason: string | null;
}>;

export type StoredStatusFlags = Readonly<{
  needs_contact: boolean;
  overdue: boolean;
  blocked: boolean;
  pending: boolean;
  move_date_passed: boolean;
  move_date_unknown: boolean;
  job_pending: boolean;
  advisory_cooldown: boolean;
}>;

/** One stored `sales_outreach_projections` row as the reads use it (ids as hex strings). */
export type StoredQueueRow = QueueMatchable &
  Readonly<{
    display: Readonly<{
      job_no: string | null;
      normalized_job_no: string | null;
      phone: string | null;
      normalized_phone: string | null;
      name: string | null;
      name_folded: string | null;
      move_date: string | null;
    }>;
    status_flags: StoredStatusFlags;
    call: StoredChannel;
    sms: StoredChannel;
    oldest_actionable_due_at: Date | null;
    next_action_due_at: Date | null;
    last_interaction_at: Date | null;
    received_at: Date | null;
    exposure: SalesOutreachCadenceExposure;
    computed_as_of: Date;
    publication_revision: number;
    policy_fingerprint: string | null;
    /** The evaluator's stored `detail.schedule_day` (New schedule day at `computed_as_of`); null when absent. */
    schedule_day: number | null;
  }>;

/** A stored row plus the bounded detail the outreach view reads. */
export type StoredProjectionDetail = StoredQueueRow &
  Readonly<{
    period_id: string | null;
    configuration_version: string | null;
    detail: Record<string, unknown> | null;
    window_history: unknown[];
    window_history_summary: Record<string, unknown> | null;
  }>;

const idOrNull = (value: unknown) => (value === null || value === undefined ? null : String(value));
const dateOrNull = (value: unknown) => (value instanceof Date ? value : typeof value === "string" ? new Date(value) : null);
const numOrNull = (value: unknown) => (typeof value === "number" ? value : null);
const strOrNull = (value: unknown) => (typeof value === "string" ? value : null);

function storedChannel(raw: unknown): StoredChannel {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    required: numOrNull(c.required),
    verified_completed: numOrNull(c.verified_completed),
    remaining: numOrNull(c.remaining),
    due_at: dateOrNull(c.due_at),
    oldest_actionable_due_at: dateOrNull(c.oldest_actionable_due_at),
    status: (strOrNull(c.status) ?? "pending") as ChannelStatus,
    completion_kind: strOrNull(c.completion_kind),
    coverage: c.coverage ?? null,
    blocked_reason: strOrNull(c.blocked_reason),
  };
}

const FLAG_KEYS = ["needs_contact", "overdue", "blocked", "pending", "move_date_passed", "move_date_unknown", "job_pending", "advisory_cooldown"] as const;

/** Normalizes a stored projection document (Mongo lean doc or the memory store's write) for the reads. */
export function toStoredProjection(subjectId: string, doc: Readonly<Record<string, unknown>>): StoredProjectionDetail {
  const display = (doc.display ?? {}) as Record<string, unknown>;
  const flags = (doc.status_flags ?? {}) as Record<string, unknown>;
  const keys = (doc.queue_keys ?? {}) as Record<string, unknown>;
  const key = (name: QueueDateKey) => dateOrNull(keys[name]) ?? new Date(0);
  return {
    subject_id: subjectId,
    assigned_agent_id: idOrNull(doc.assigned_agent_id),
    subject_status: (strOrNull(doc.subject_status) ?? "active") as StoredQueueRow["subject_status"],
    priority_raw: strOrNull(doc.priority_raw),
    workflow: strOrNull(doc.workflow),
    display: {
      job_no: strOrNull(display.job_no),
      normalized_job_no: strOrNull(display.normalized_job_no),
      phone: strOrNull(display.phone),
      normalized_phone: strOrNull(display.normalized_phone),
      name: strOrNull(display.name),
      name_folded: strOrNull(display.name_folded),
      move_date: strOrNull(display.move_date),
    },
    status_flags: Object.fromEntries(FLAG_KEYS.map((k) => [k, flags[k] === true])) as unknown as StoredStatusFlags,
    queue_keys: {
      urgency_due: key("urgency_due"),
      urgency_next: key("urgency_next"),
      call_due: key("call_due"),
      received_asc: key("received_asc"),
      received_desc: key("received_desc"),
      last_interaction: key("last_interaction"),
      // Absent on a row written before olr A2 (engine v1): the overdue counts' transitional branch reads it.
      sms_due: dateOrNull(keys.sms_due),
    },
    call: storedChannel(doc.call),
    sms: storedChannel(doc.sms),
    oldest_actionable_due_at: dateOrNull(doc.oldest_actionable_due_at),
    next_action_due_at: dateOrNull(doc.next_action_due_at),
    last_interaction_at: dateOrNull(doc.last_interaction_at),
    received_at: dateOrNull(doc.received_at),
    exposure: (strOrNull(doc.exposure) ?? "shadow") as SalesOutreachCadenceExposure,
    computed_as_of: dateOrNull(doc.computed_as_of) ?? new Date(0),
    publication_revision: numOrNull(doc.publication_revision) ?? 0,
    policy_fingerprint: strOrNull(doc.policy_fingerprint),
    schedule_day: numOrNull((doc.detail as Record<string, unknown> | null | undefined)?.schedule_day),
    period_id: idOrNull(doc.period_id),
    configuration_version: strOrNull(doc.configuration_version),
    detail: (doc.detail as Record<string, unknown> | null | undefined) ?? null,
    window_history: Array.isArray(doc.window_history) ? doc.window_history : [],
    window_history_summary: (doc.window_history_summary as Record<string, unknown> | null | undefined) ?? null,
  };
}

/** Read-time verification of a passed deadline (olr A2); null when none has passed (or in shadow). */
export type ChannelVerification = Readonly<{
  state: "verified" | "unverified";
  /** The channel's cadence coverage at the read (null = no capture coverage). */
  verified_through: Date | null;
  /** The earliest passed deadline coverage cannot prove yet; null when verified. */
  unverified_since: Date | null;
}>;

export type PresentedChannel = StoredChannel & Readonly<{ verification: ChannelVerification | null }>;

/**
 * The one read-time rule (olr A2), used by every read, with `coverage` = the channel's cadence coverage
 * (the value the engine judges deadlines against):
 * - stored `overdue` → overdue, verified (the engine only stores it once coverage proved the deadline);
 * - stored `due` whose deadline passed by `asOf` → `overdue` when `coverage >= due_at` (verified),
 *   else `due` with `verification.unverified` since `due_at` (no guessed failure, still actionable);
 * - anything else is unchanged with no verification.
 * Countdowns never rewrite rows. The Mongo overdue counts (`deskStore.ts` `overdueCutoffs`) apply the
 * same rule to the stored `queue_keys`, so a row's label and the counts agree.
 */
export function deriveChannelAt(channel: StoredChannel, asOf: Date, coverage: Date | null): PresentedChannel {
  if (channel.status === "overdue") return { ...channel, verification: { state: "verified", verified_through: coverage, unverified_since: null } };
  if (channel.status !== "due" || !channel.due_at || +channel.due_at > +asOf) return { ...channel, verification: null };
  const deadline = channel.due_at;
  if (coverage && +coverage >= +deadline) {
    const oldest = channel.oldest_actionable_due_at && +channel.oldest_actionable_due_at < +deadline ? channel.oldest_actionable_due_at : deadline;
    return { ...channel, status: "overdue", oldest_actionable_due_at: oldest, verification: { state: "verified", verified_through: coverage, unverified_since: null } };
  }
  return { ...channel, verification: { state: "unverified", verified_through: coverage, unverified_since: deadline } };
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

function coverageDto(raw: unknown): SalesOutreachChannelDto["coverage"] {
  const c = raw as { state?: unknown; known_complete_through?: unknown; gaps?: unknown } | null;
  const state = c?.state === "complete" || c?.state === "partial" ? c.state : "unknown";
  const through = dateOrNull(c?.known_complete_through);
  return { state, known_complete_through: iso(through), gaps: Array.isArray(c?.gaps) ? c.gaps.slice(0, 50) : [] };
}

/** The live capture coverage of one channel at a read (olr A2): the block is no longer frozen at `computed_as_of`. */
export type LiveChannelCoverage = Readonly<{ through: Date | null; as_of: Date; today_tolerance_ms: number }>;

/** `complete` while the raw capture watermark trails `as_of` by at most the today tolerance; `unknown` without one. */
export function liveCoverageDto(live: LiveChannelCoverage): SalesOutreachChannelDto["coverage"] {
  if (!live.through) return { state: "unknown", known_complete_through: null, gaps: [] };
  const state = +live.as_of - +live.through <= live.today_tolerance_ms ? "complete" : "partial";
  return { state, known_complete_through: live.through.toISOString(), gaps: [] };
}

/** The channel DTO; `live` replaces the stored coverage block with the read's own (every desk read passes it). */
export function channelDto(channel: StoredChannel | PresentedChannel, live?: LiveChannelCoverage): SalesOutreachChannelDto {
  const verification = "verification" in channel ? channel.verification : null;
  return {
    required: channel.required,
    verified_completed: channel.verified_completed,
    remaining: channel.remaining,
    due_at: iso(channel.due_at),
    oldest_actionable_due_at: iso(channel.oldest_actionable_due_at),
    status: channel.status,
    completion_kind: channel.completion_kind,
    coverage: live ? liveCoverageDto(live) : coverageDto(channel.coverage),
    blocked_reason: channel.blocked_reason,
    verification: verification
      ? { state: verification.state, verified_through: iso(verification.verified_through), unverified_since: iso(verification.unverified_since) }
      : null,
  };
}

/** The two channels' live coverage blocks of a read at `asOf`. */
export function liveCoverageOf(coverage: DeskReadCoverage, asOf: Date): Readonly<{ call: LiveChannelCoverage; sms: LiveChannelCoverage }> {
  const at = (through: Date | null) => ({ through, as_of: asOf, today_tolerance_ms: coverage.today_tolerance_ms });
  return { call: at(coverage.capture.call), sms: at(coverage.capture.sms) };
}

/** The pending channel shown when no current projection exists: counts null, coverage unknown. */
export const PENDING_CHANNEL: StoredChannel = {
  required: null,
  verified_completed: null,
  remaining: null,
  due_at: null,
  oldest_actionable_due_at: null,
  status: "pending",
  completion_kind: "evidence_pending",
  coverage: null,
  blocked_reason: null,
};

/** P05g label at `today` (the read's New York date). */
export function moveDateReviewOf(moveDate: string | null, today: string): "passed" | "unknown" | null {
  if (moveDate === null) return "unknown";
  return moveDate < today ? "passed" : null;
}

export type PresentedRequirements = Readonly<{
  call: PresentedChannel;
  sms: PresentedChannel;
  status_flags: StoredStatusFlags;
  oldest_actionable_due_at: Date | null;
  enforcement_labels: boolean;
  /** The labels before the shadow mask (the Owner's reconciliation view). */
  unmasked: Readonly<{ call_status: ChannelStatus; sms_status: ChannelStatus; overdue: boolean }>;
}>;

/**
 * Derives time status at `asOf` with the channels' cadence `coverage` (`deriveChannelAt`), the move-date
 * flags at `today`, then applies the exposure mask. A row shows enforcement labels only when it was
 * computed under enforcement AND the current controls still enforce (`currentExposure`): switching back
 * to shadow hides overdue labels before the policy reconcile rewrites the rows. A shadow row carries no
 * verification (no performance label in shadow).
 */
export function presentRequirements(
  row: StoredQueueRow,
  asOf: Date,
  today: string,
  currentExposure: SalesOutreachCadenceExposure,
  coverage: ChannelCoverage,
): PresentedRequirements {
  const call = deriveChannelAt(row.call, asOf, coverage.call);
  const sms = deriveChannelAt(row.sms, asOf, coverage.sms);
  const oldest = [call.oldest_actionable_due_at, sms.oldest_actionable_due_at]
    .filter((d): d is Date => d !== null)
    .sort((a, b) => +a - +b)[0] ?? null;
  const review = moveDateReviewOf(row.display.move_date, today);
  const flags: StoredStatusFlags = {
    ...row.status_flags,
    overdue: call.status === "overdue" || sms.status === "overdue",
    move_date_passed: review === "passed",
    move_date_unknown: review === "unknown",
    job_pending: !row.display.job_no,
  };
  const exposure = row.exposure === "enforcement" && currentExposure === "enforcement" ? "enforcement" : "shadow";
  const masked = presentProjectionExposure({ exposure, call, sms, status_flags: flags });
  const shown = (channel: unknown): PresentedChannel => {
    const c = channel as PresentedChannel;
    return masked.enforcement_labels ? c : { ...c, verification: null };
  };
  return {
    call: shown(masked.call),
    sms: shown(masked.sms),
    status_flags: masked.status_flags as unknown as StoredStatusFlags,
    oldest_actionable_due_at: oldest,
    enforcement_labels: masked.enforcement_labels,
    unmasked: { call_status: call.status, sms_status: sms.status, overdue: flags.overdue },
  };
}

export function presentQueueRow(
  row: StoredQueueRow,
  context: Readonly<{
    as_of: Date;
    today: string;
    names: ReadonlyMap<string, string>;
    exposure: SalesOutreachCadenceExposure;
    /** The read's coverage (`readFreshness`): cadence coverage for the rule, capture for the live blocks. */
    coverage: DeskReadCoverage;
  }>,
): SalesOutreachQueueRowDto {
  const presented = presentRequirements(row, context.as_of, context.today, context.exposure, context.coverage.cadence);
  const live = liveCoverageOf(context.coverage, context.as_of);
  return {
    subject_id: row.subject_id,
    job_no: row.display.job_no,
    job_pending: !row.display.job_no,
    phone: row.display.phone,
    name: row.display.name,
    move_date: row.display.move_date,
    move_date_review: moveDateReviewOf(row.display.move_date, context.today),
    priority_raw: row.priority_raw,
    workflow: row.workflow as SalesOutreachQueueRowDto["workflow"],
    subject_status: row.subject_status === "review" ? "review" : "active",
    assigned_agent_id: row.assigned_agent_id,
    assigned_agent_name: row.assigned_agent_id ? (context.names.get(row.assigned_agent_id) ?? null) : null,
    received_at: iso(row.received_at),
    last_interaction_at: iso(row.last_interaction_at),
    oldest_actionable_due_at: iso(presented.oldest_actionable_due_at),
    next_action_due_at: iso(row.next_action_due_at),
    call: channelDto(presented.call, live.call),
    sms: channelDto(presented.sms, live.sms),
    status_flags: presented.status_flags,
    exposure: row.exposure,
    computed_as_of: row.computed_as_of.toISOString(),
    publication_revision: row.publication_revision,
    // The New cadence's day; other workflows have no schedule day to show.
    schedule_day: row.workflow === "new" ? row.schedule_day : null,
  };
}
