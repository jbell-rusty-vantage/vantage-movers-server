import { createHash } from "node:crypto";
import type { ClientSession } from "mongoose";
import type { EvaluateSubjectResult, EngineChannelRequirement } from "../engine/types";
import type { ActiveConfiguration } from "../config/load";
import type { DeskRestrictionRow } from "../evaluation/store";
import { recomputePoolDuty } from "./duties";
import { poolNextDateAt } from "./policy";

/** Shared Pool policy replaces routine private cadence; it has no initial response, SMS or debt. */
export async function projectPoolResult(base: EvaluateSubjectResult, configuration: ActiveConfiguration, now: Date,
  restrictions: readonly DeskRestrictionRow[], coverage: Date | null, session: ClientSession, noContact = false, readOnly = false): Promise<EvaluateSubjectResult> {
  if (base.state === "closed") return base;
  const shared = await recomputePoolDuty(base.subject_id, base.business_date, configuration, now, session, readOnly);
  if (!shared?.work.active) return base;
  return poolResultOf(base, shared, configuration, now, restrictions, coverage, noContact);
}

type PoolDuty = NonNullable<Awaited<ReturnType<typeof recomputePoolDuty>>>;

/** The Pool row for an active duty (pure; `projectPoolResult` loads the duty). */
export function poolResultOf(base: EvaluateSubjectResult, shared: Pick<PoolDuty, "window" | "winner" | "pending_evidence">,
  configuration: ActiveConfiguration, now: Date, restrictions: readonly DeskRestrictionRow[], coverage: Date | null, noContact = false): EvaluateSubjectResult {
  const { window, winner } = shared;
  const blocked = noContact || restrictions.some((r) => r.state === "active" && r.channels.includes("call") && (!r.until || +r.until > +now));
  const required = window.required || winner ? 1 : 0;
  const done = winner ? 1 : 0;
  const due = required ? new Date(window.due).toISOString() : null;
  const pending = required > done && (shared.pending_evidence || (+now > window.due && (!coverage || +coverage < window.due)));
  const overdue = required > done && !blocked && !pending && +now > window.due;
  const empty: EngineChannelRequirement = { channel: "sms", required: 0, verified_completed: 0, remaining: 0, due_at: null, oldest_actionable_due_at: null,
    status: "not_required", completion_kind: null, blocked_reason: null, blocked_until: null,
    catch_up: { outstanding: false, missed_count: 0, oldest_missed_due_at: null, state: null } };
  const call: EngineChannelRequirement = { ...empty, channel: "call", required, verified_completed: done, remaining: required - done, due_at: due,
    oldest_actionable_due_at: overdue ? due : null, status: done ? "completed" : blocked ? "blocked" : !required ? "not_required" : +now < window.start ? "scheduled" : "due",
    completion_kind: winner ? "fulfilled_in_window" : null,
    blocked_reason: blocked ? "contact_restriction" : null };
  const result: EvaluateSubjectResult = { ...base, state: "active", workflow: "none", schedule_day: null,
    requirements: { call, sms: empty }, initial_response: null,
    oldest_actionable_due_at: overdue ? due : null,
    next_action_due_at: required > done && !blocked ? due : null,
    next_evaluation_at: new Date(Math.min(+poolNextDateAt(base.business_date), window.due > +now ? window.due + 1 : Infinity)).toISOString(),
    coverage_wait: { call: pending ? due : null, sms: null }, obligations: [],
    flags: { ...base.flags, needs_contact: required > done && !blocked, overdue, blocked, pending,
      inherited_overdue: false, review: false },
  };
  // The stored wake is part of the row: an unchanged result must not leave a passed `next_evaluation_at` behind,
  // because its completed `due:` job fences the sweep and the row would never wake again.
  result.fingerprint = createHash("sha256").update(JSON.stringify({ date: base.business_date, required, done, winner: winner?.id ?? null,
    blocked, pending, overdue, due, next_evaluation_at: result.next_evaluation_at, policy: configuration.value.pool })).digest("hex");
  return result;
}
