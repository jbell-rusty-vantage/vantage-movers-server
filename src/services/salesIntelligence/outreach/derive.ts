import type { CsiPolicy } from "../../../validation/v1/salesIntelligence";
import type { RecordRow, FollowupRow } from "./types";
import { staffedMinutesBetween, type Staffing } from "./staffing";

export type RestrictionInput = { channels: string[]; state: string; until?: Date | null };
export type DeriveContext = { now: Date; policy: CsiPolicy; staffing: Staffing; followups: readonly FollowupRow[];
  restrictions: readonly RestrictionInput[]; reviewItems: readonly { _id: unknown; state: string; cause_kind: string }[];
  coverage: { known_through?: string | null; gaps?: unknown[] }; unsuccessfulAttempts?: readonly Date[]; suppressed?: boolean };
export const attentionDue = (a: Pick<FollowupRow, "due_at" | "base_attention_due_at" | "snoozed_until">) => a.due_at ? new Date(Math.max(+(a.base_attention_due_at ?? a.due_at), +(a.snoozed_until ?? 0))) : null;
/** All active actions participate. Contractual overdue survives snooze in detail. */
export function derive(record: RecordRow, context: DeriveContext) {
  const { now, policy, staffing } = context;
  const actions = context.followups.filter(a => a.status === "open");
  const due = actions.filter(a => { const at = attentionDue(a); return at && at <= now; });
  const actionable = !["closed", "identity_review"].includes(record.state);
  const ageFrom = record.last_meaningful_contact_at ?? record.trigger_at;
  const age = staffedMinutesBetween(ageFrom, now, staffing);
  const missing = actions.filter(a => !a.responsible_agent_id).map(a => String(a._id));
  const reasons: string[] = [];
  const bands: number[] = [];
  const add = (band: number, reason: string, match: boolean) => { if (actionable && match) { bands.push(band); reasons.push(reason); } };
  add(1, "promised_callback_overdue", due.some(a => a.kind === "call" && a.origin === "rep_promise"));
  add(2, "no_call_yet", record.state === "unworked" && record.subject.model === "FormLead");
  add(3, "missed_call_no_callback", actions.some(a => Boolean(a.missed_episode_key) && !(a.snoozed_until && a.snoozed_until > now)));
  add(4, "followups_due", due.length > 0);
  add(5, "no_next_step", record.state === "open" && actions.length === 0);
  add(6, "missing_responsibility", !record.responsible_agent_id || missing.length > 0);
  // Snoozing an overdue task postpones its reminder, not the customer's agreement
  // or the last human contact. Day-only waits still honor their next-opening boundary.
  const futurePlan = actions.some(a => a.due_at && (a.base_attention_due_at ?? a.due_at) > now);
  add(7, "going_cold", !futurePlan && age >= policy.going_cold_staffed_minutes);
  const review = context.reviewItems.filter(r => r.state === "open");
  const badges = new Set(review.map(r => r.cause_kind));
  if (actions.some(a => !a.due_at)) badges.add("missing_date");
  if (missing.length) badges.add("missing_responsibility");
  const blockers: string[] = [];
  if (record.state === "closed") blockers.push("closed");
  if (record.state === "identity_review") { blockers.push("identity"); badges.add("identity"); }
  if (context.suppressed) blockers.push("suppressed");
  if (context.restrictions.some(r => r.state === "active" && r.channels.includes("call") && (!r.until || r.until > now))) { blockers.push("restriction"); badges.add("restriction"); }
  return { overdue: actionable && (due.length > 0 || (record.state === "unworked" && Boolean(record.first_action_due_at && record.first_action_due_at <= now))),
    no_owner: !record.responsible_agent_id || missing.length > 0, missing_record_responsibility: !record.responsible_agent_id,
    missing_action_responsibility: missing, no_next_action: record.state === "open" && actions.length === 0,
    cooldown: (context.unsuccessfulAttempts ?? []).filter(at => +at > +now - 86_400_000 && at <= now).length >= policy.cooldown_attempts_24h,
    attention_band: bands.length ? Math.min(...bands) : null, reasons, review_badges: [...badges], review_item_ids: review.map(r => String(r._id)),
    call_blockers: blockers, age_wall_ms: Math.max(0, +now - +ageFrom), age_staffed_ms: age * 60_000, policy_version: policy.version,
    absence_qualified: !context.coverage.known_through || Boolean(context.coverage.gaps?.length),
    actions: actions.map(a => ({ id: String(a._id), contractual_overdue: Boolean(a.due_at && a.due_at < now), overdue: due.includes(a), attention_due_at: attentionDue(a)?.toISOString() ?? null,
      call_allowed: a.kind === "call" && blockers.length === 0 && !(a.snoozed_until && a.snoozed_until > now) })) };
}
