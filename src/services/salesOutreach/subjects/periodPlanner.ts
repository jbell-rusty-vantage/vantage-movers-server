import type { SalesOutreachPeriodStartKind, SalesOutreachTimeBasis, SalesOutreachWorkflow } from "../../../config/domain/salesOutreach";
import type { DesiredPeriod } from "./subjectBuilder";

/** The active period of a subject as the planner needs it. */
export type ActivePeriodView = Readonly<{
  id: string;
  workflow: SalesOutreachWorkflow;
  priority: string | null;
  started_at: Date;
}>;

/** A period row to insert (`sales_outreach_policy_periods`, IMPLEMENTATION-PLAN §4.2). */
export type NewPeriod = Readonly<{
  transition_key: string;
  workflow: SalesOutreachWorkflow;
  start_kind: SalesOutreachPeriodStartKind;
  priority: string | null;
  priority_source_ref: string | null;
  priority_source_revision: number | null;
  started_at: Date;
  time_basis: SalesOutreachTimeBasis;
}>;

/** How the subject's first period may start (`syncSubject` passes it on every sync). */
export type FirstPeriodStart = Readonly<{
  /** How the subject was enrolled: `intake` (P05e) or a cohort `activation` (P10a). */
  kind: "intake" | "activation";
  /** `enrollment.activation_at`: nothing is due before it. */
  boundary: Date;
  /** True only on the sync that creates the subject (enrollment apply, intake, expansion admission). */
  at_enrollment: boolean;
  /** Reference instant of this sync. */
  as_of: Date;
  /** The subject was held for an admission reason (`ADMISSION_HOLD_REASONS`) before this sync. */
  held_before: boolean;
}>;

export type PeriodPlan =
  | Readonly<{ action: "none"; reason: PeriodNoopReason }>
  | Readonly<{ action: "open"; period: NewPeriod }>
  | Readonly<{
      action: "close_and_open";
      close: Readonly<{ id: string; ended_at: Date; end_reason: "priority_change" | "closure" }>;
      period: NewPeriod;
    }>;

export type PeriodNoopReason =
  | "no_policy"
  | "closed_no_reopen"
  | "retain_last_verified"
  | "repeated_priority"
  | "transition_already_recorded";

/**
 * Plans the policy-period change for one subject (P05b–P05f, P06f, CONTRACTS "Models, indexes and
 * atomicity"). Pure; the caller closes and opens in one transaction.
 *
 * - First period on the creating sync (`at_enrollment`): opens at the enrollment boundary
 *   (`first_start.boundary`) — `activation` for a cohort enrollment (P10a), `intake` for intake
 *   admission (P05e, the initial-response clock from received).
 * - Late first period (olr B1: a review subject whose priority was accepted afterwards, or whose
 *   admission hold cleared): `start_kind: activation`, a P05f-style partial start that keeps the
 *   original received-date age but owes nothing before it. It starts when the fact took effect
 *   (`desired.effective_at`), or at the sync instant after an admission hold (`desk_decision_at`, no
 *   fact time exists), never before the boundary. No retroactive day, no initial response.
 * - An active `closed` period is final: nothing reopens it (P05b/P05c `closed_to_*`, P05h).
 * - No desired period (missing, malformed or unverified priority) retains the last verified period
 *   and its timeline (P05e).
 * - The same workflow as the active period is a no-op (repeated accepted priority).
 * - A transition key already recorded is a no-op (replay).
 * - Otherwise the active period ends and the new one starts (`transition`) at the fact's effective
 *   time, never before the active period started.
 */
export function planPeriodTransition(input: {
  active: ActivePeriodView | null;
  desired: DesiredPeriod | null;
  recorded_keys: ReadonlySet<string>;
  first_start: FirstPeriodStart;
}): PeriodPlan {
  const { active, desired } = input;
  if (!desired) return { action: "none", reason: active ? "retain_last_verified" : "no_policy" };
  if (input.recorded_keys.has(desired.transition_key)) return { action: "none", reason: "transition_already_recorded" };
  if (!active) return { action: "open", period: { ...periodFields(desired), ...firstPeriodStart(input.first_start, desired) } };
  if (active.workflow === "closed") return { action: "none", reason: "closed_no_reopen" };
  // Same workflow = same routine policy: a repeated accepted code, or an accepted code confirming the
  // intake default (0 after an intake-default New), changes no requirement and restarts nothing. The
  // subject's `priority` still shows the current accepted code.
  if (active.workflow === desired.workflow) return { action: "none", reason: "repeated_priority" };
  const startedAt = new Date(Math.max(+active.started_at, +desired.effective_at));
  return {
    action: "close_and_open",
    close: { id: active.id, ended_at: startedAt, end_reason: desired.end_reason_for_previous },
    period: { ...periodFields(desired), start_kind: "transition", started_at: startedAt, time_basis: desired.time_basis },
  };
}

/**
 * Start of a first period. A late first period starts at `max(boundary, fact time)`; when the
 * boundary wins (a fact time before enrollment) the boundary is the recorded basis.
 */
function firstPeriodStart(
  first: FirstPeriodStart,
  desired: DesiredPeriod,
): Pick<NewPeriod, "start_kind" | "started_at" | "time_basis"> {
  if (first.at_enrollment) return { start_kind: first.kind, started_at: first.boundary, time_basis: "activation_boundary" };
  const fact = first.held_before ? first.as_of : desired.effective_at;
  if (+fact <= +first.boundary) return { start_kind: "activation", started_at: first.boundary, time_basis: "activation_boundary" };
  return { start_kind: "activation", started_at: fact, time_basis: first.held_before ? "desk_decision_at" : desired.time_basis };
}

function periodFields(desired: DesiredPeriod) {
  return {
    transition_key: desired.transition_key,
    workflow: desired.workflow,
    priority: desired.priority,
    priority_source_ref: desired.priority_source_ref,
    priority_source_revision: desired.priority_source_revision,
  };
}
