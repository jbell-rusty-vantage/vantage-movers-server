import type { SalesOutreachPeriodStartKind, SalesOutreachWorkflow } from "../../../config/domain/salesOutreach";
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
  time_basis: "accepted_observation_captured_at" | "entity_change_applied_at" | "activation_boundary";
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
 * - First period: opens at the enrollment boundary (`first_start`): `activation` for a cohort
 *   enrollment (P10a), `intake` for intake admission (P05e). A later first period (a review subject
 *   whose priority was accepted afterwards) starts when that fact took effect, never before the boundary.
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
  first_start: Readonly<{ kind: "intake" | "activation"; boundary: Date; has_prior_periods: boolean }>;
}): PeriodPlan {
  const { active, desired } = input;
  if (!desired) return { action: "none", reason: active ? "retain_last_verified" : "no_policy" };
  if (input.recorded_keys.has(desired.transition_key)) return { action: "none", reason: "transition_already_recorded" };
  if (!active) {
    const atBoundary = !input.first_start.has_prior_periods;
    const startedAt = atBoundary ? input.first_start.boundary : new Date(Math.max(+input.first_start.boundary, +desired.effective_at));
    return {
      action: "open",
      period: {
        ...periodFields(desired),
        start_kind: input.first_start.kind,
        started_at: startedAt,
        time_basis: atBoundary ? "activation_boundary" : desired.time_basis,
      },
    };
  }
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

function periodFields(desired: DesiredPeriod) {
  return {
    transition_key: desired.transition_key,
    workflow: desired.workflow,
    priority: desired.priority,
    priority_source_ref: desired.priority_source_ref,
    priority_source_revision: desired.priority_source_revision,
  };
}
