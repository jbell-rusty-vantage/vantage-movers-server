import { createHash } from "node:crypto";
import type { SalesOutreachCadenceExposure } from "../../../config/domain/salesOutreach";
import { stableStringify, type EngineChannelRequirement, type EvaluateSubjectResult } from "../engine";
import type { DeskTiming } from "../config/timing";
import type { DeskSubjectRow } from "../subjects/store";
import type { CoverageFacts, ProjectionWrite } from "./store";

/**
 * Pure mapping of one engine result to the stored `sales_outreach_projections` row
 * (IMPLEMENTATION-PLAN §4.5), plus the read-side exposure rule for shadow rows.
 */

export type ProjectionContext = Readonly<{
  exposure: SalesOutreachCadenceExposure;
  configuration_version: string;
  policy_fingerprint: string;
  coverage: CoverageFacts;
  /** `deskTimingOf` of the active configuration (today's coverage tolerance). */
  timing: DeskTiming;
}>;

/**
 * The coverage block stored with a channel at `computed_as_of` (reads decorate live freshness on top):
 * the raw capture watermark, `complete` while it trails `as_of` by at most the today tolerance.
 */
function coverageBlock(knownCompleteThrough: Date | null, asOf: Date, timing: DeskTiming) {
  if (!knownCompleteThrough) return { state: "unknown", known_complete_through: null, gaps: [] };
  const state = +asOf - +knownCompleteThrough <= timing.today_coverage_tolerance_ms ? "complete" : "partial";
  return { state, known_complete_through: knownCompleteThrough.toISOString(), gaps: [] };
}

function channel(requirement: EngineChannelRequirement, coverage: ReturnType<typeof coverageBlock>) {
  return {
    required: requirement.required,
    verified_completed: requirement.verified_completed,
    remaining: requirement.remaining,
    due_at: requirement.due_at ? new Date(requirement.due_at) : null,
    oldest_actionable_due_at: requirement.oldest_actionable_due_at ? new Date(requirement.oldest_actionable_due_at) : null,
    status: requirement.status,
    completion_kind: requirement.completion_kind,
    coverage,
    blocked_reason: requirement.blocked_reason,
  };
}

const sha256 = (value: unknown) => createHash("sha256").update(stableStringify(value)).digest("hex");
const toDate = (value: string | null) => (value ? new Date(value) : null);

/** Queue sort sentinels: unknown instants never reach the database's own null ordering. */
export const QUEUE_KEY_FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");
export const QUEUE_KEY_EPOCH = new Date(0);

/** Case-insensitive literal name key (NFKC, lower case, trimmed). */
export const foldName = (name: string | null) => (name ? name.normalize("NFKC").trim().toLowerCase() || null : null);

/** The subject facts a projection row copies for queue filtering and search (IMPLEMENTATION-PLAN §4.5). */
export function projectionDisplayOf(subject: DeskSubjectRow) {
  const display = subject.display;
  return {
    job_no: display.job_no,
    normalized_job_no: display.normalized_job_no,
    phone: display.phone,
    normalized_phone: display.normalized_phone,
    name: display.name,
    name_folded: foldName(display.name),
    move_date: display.move_date,
  };
}

/** A channel's earliest unsatisfied actionable deadline: overdue, or due and unmet; never a blocked channel's. */
function channelUrgency(requirement: EngineChannelRequirement): string | null {
  if (requirement.status === "blocked") return null;
  const dues = [requirement.oldest_actionable_due_at, requirement.status === "due" || requirement.status === "overdue" ? requirement.due_at : null];
  return dues.filter((v): v is string => v !== null).sort()[0] ?? null;
}

/**
 * Never-null queue sort keys (CONTRACTS "Queue sort enums"). Urgency = the earliest unsatisfied actionable
 * deadline (overdue deadlines are always earlier than due-today ones, so the order stays right as time
 * passes without a rewrite), then the next future action, then received time (unknown last).
 */
export function queueKeysOf(result: EvaluateSubjectResult, receivedAt: Date | null) {
  const call = channelUrgency(result.requirements.call);
  const sms = channelUrgency(result.requirements.sms);
  const urgency = [call, sms].filter((v): v is string => v !== null).sort()[0] ?? null;
  return {
    urgency_due: toDate(urgency) ?? QUEUE_KEY_FAR_FUTURE,
    urgency_next: toDate(result.next_action_due_at) ?? QUEUE_KEY_FAR_FUTURE,
    call_due: toDate(call) ?? QUEUE_KEY_FAR_FUTURE,
    received_asc: receivedAt ?? QUEUE_KEY_FAR_FUTURE,
    received_desc: receivedAt ?? QUEUE_KEY_EPOCH,
    last_interaction: toDate(result.last_interaction_at) ?? QUEUE_KEY_EPOCH,
  };
}

/**
 * The fields that decide whether a row is rewritten: the engine result (which already excludes
 * `computed_as_of`), the resolved policy + exposure and the subject facts the row carries but the
 * engine does not read (assignee, status, display/search copy). Capture coverage advancing alone
 * never rewrites a row.
 */
export function resultFingerprint(result: EvaluateSubjectResult, subject: DeskSubjectRow, policyFingerprint: string): string {
  return sha256({
    result: result.fingerprint,
    policy: policyFingerprint,
    assigned_agent_id: subject.assigned_agent_id,
    received_at: subject.received_at?.toISOString() ?? null,
    job_pending: !subject.display.job_no,
    subject_status: subject.status,
    display: projectionDisplayOf(subject),
  });
}

export function toProjectionWrite(subject: DeskSubjectRow, result: EvaluateSubjectResult, context: ProjectionContext): ProjectionWrite {
  const asOf = new Date(result.computed_as_of);
  return {
    period_id: result.period_id,
    call: channel(result.requirements.call, coverageBlock(context.coverage.calls.capture_known, asOf, context.timing)),
    sms: channel(result.requirements.sms, coverageBlock(context.coverage.sms_known_complete_through, asOf, context.timing)),
    oldest_actionable_due_at: toDate(result.oldest_actionable_due_at),
    next_action_due_at: toDate(result.next_action_due_at),
    next_evaluation_at: toDate(result.next_evaluation_at),
    // olr A1: the evaluate sweep re-nominates the row once channel coverage reaches these instants.
    coverage_wait: { call: toDate(result.coverage_wait.call), sms: toDate(result.coverage_wait.sms) },
    last_interaction_at: toDate(result.last_interaction_at),
    received_at: subject.received_at,
    assigned_agent_id: subject.assigned_agent_id,
    subject_status: subject.status,
    display: projectionDisplayOf(subject),
    queue_keys: queueKeysOf(result, subject.received_at),
    workflow: result.workflow,
    priority_raw: result.priority_raw,
    status_flags: {
      needs_contact: result.flags.needs_contact,
      overdue: result.flags.overdue,
      blocked: result.flags.blocked,
      pending: result.flags.pending,
      move_date_passed: result.flags.move_date_passed,
      move_date_unknown: result.flags.move_date_unknown,
      job_pending: !subject.display.job_no,
      advisory_cooldown: result.flags.advisory_cooldown,
    },
    window_history: result.window_history,
    window_history_summary: result.history_summary,
    detail: {
      business_date: result.business_date,
      state: result.state,
      schedule_day: result.schedule_day,
      policy_version: result.policy_version,
      initial_response: result.initial_response,
      callback: result.callback,
      quoted: result.quoted,
      cooldown: result.cooldown,
      flags: result.flags,
      catch_up: { call: result.requirements.call.catch_up, sms: result.requirements.sms.catch_up },
      blocked_until: { call: result.requirements.call.blocked_until, sms: result.requirements.sms.blocked_until },
      current_assignee_agent_id: result.current_assignee_agent_id,
    },
    exposure: context.exposure,
    engine_version: result.engine_version,
    input_fingerprint: result.input_fingerprint,
    result_fingerprint: resultFingerprint(result, subject, context.policy_fingerprint),
    policy_fingerprint: context.policy_fingerprint,
    configuration_version: context.configuration_version,
    computed_as_of: asOf,
  };
}

/** Enforcement labels a `shadow` projection must not show (CONTRACTS / IMPLEMENTATION-PLAN §6.2). */
export type ExposedChannel = { status: string; [key: string]: unknown };
export type ExposedProjection = {
  exposure: SalesOutreachCadenceExposure;
  call: ExposedChannel;
  sms: ExposedChannel;
  status_flags: Record<string, boolean>;
  window_history?: unknown[];
  [key: string]: unknown;
};

/**
 * Read-side exposure rule (phase 4b reads use it): an `enforcement` row is shown as computed; a
 * `shadow` row keeps its deadlines, requirements and history for Owner reconciliation but presents no
 * overdue state — `overdue` channel statuses read as `due` and the `overdue`/inherited-overdue flags
 * are false. The stored row is never altered.
 */
export function presentProjectionExposure<T extends ExposedProjection>(row: T): T & { enforcement_labels: boolean } {
  if (row.exposure === "enforcement") return { ...row, enforcement_labels: true };
  const unlabel = (c: ExposedChannel) => ({ ...c, status: c.status === "overdue" ? "due" : c.status });
  return {
    ...row,
    call: unlabel(row.call),
    sms: unlabel(row.sms),
    status_flags: { ...row.status_flags, overdue: false },
    enforcement_labels: false,
  };
}
