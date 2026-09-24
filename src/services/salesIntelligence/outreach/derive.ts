import { csiPolicyEvolution, type CsiPolicy } from "../../../validation/v1/salesIntelligence";
import { attentionEvolutionEnabled, type RecordRow, type FollowupRow } from "./types";
import { staffedMinutesAtLeast, staffedMinutesBetween, type Staffing } from "./staffing";

export type RestrictionInput = { channels: string[]; state: string; until?: Date | null };
export type DeriveContext = { now: Date; policy: CsiPolicy; staffing: Staffing; followups: readonly FollowupRow[];
  restrictions: readonly RestrictionInput[]; reviewItems: readonly { _id: unknown; state: string; cause_kind: string }[];
  coverage: { known_through?: string | null; gaps?: unknown[] }; unsuccessfulAttempts?: readonly Date[]; suppressed?: boolean;
  /** Test seam; production reads SALES_INTELLIGENCE_ATTENTION_EVOLUTION. */
  evolution?: boolean };
export const attentionDue = (a: Pick<FollowupRow, "due_at" | "base_attention_due_at" | "snoozed_until">) => a.due_at ? new Date(Math.max(+(a.base_attention_due_at ?? a.due_at), +(a.snoozed_until ?? 0))) : null;

/** Spec §5.1 (F8): the origins a promised callback can have. A retry successor inherits its root's. */
export const PROMISE_ORIGINS = ["rep_promise", "customer_request", "owner"] as const;
export type PromiseOrigin = (typeof PROMISE_ORIGINS)[number];
/** The structural fields the predicate reads, so the follow-up row and its DTO both qualify. */
export type PromiseCandidate = { kind: string; origin: string; missed_episode_key?: string | null;
  promise_chain?: { root_origin: string } | null; date_resolution?: { precision?: string | null } | null };
const promiseOrigin = (a: PromiseCandidate) => (a.origin === "system_default" && a.promise_chain ? a.promise_chain.root_origin : a.origin);
/** Band 1 and addendum E16 "Callbacks kept on time" share this (F8): an exact `call` promised by a rep, the customer or the Owner. */
export function isPromisedCallback(a: PromiseCandidate): boolean {
  return isPromiseOriginCall(a) && a.date_resolution?.precision === "exact";
}
/** The same predicate ignoring precision (spec §6 rule 2: an inbound conversation completes a promise of any precision). */
export function isPromiseOriginCall(a: PromiseCandidate): boolean {
  return a.kind === "call" && !a.missed_episode_key && (PROMISE_ORIGINS as readonly string[]).includes(promiseOrigin(a));
}
/** Who promised: the `promised_by:<who>` secondary reason. */
export const promisedBy = (a: PromiseCandidate) => ({ rep_promise: "rep", customer_request: "customer", owner: "owner" } as const)[promiseOrigin(a) as PromiseOrigin];
/** A promised callback (or a successor) completed without reaching the customer (spec §6 rule 4). */
export const UNREACHED_DISPOSITIONS = ["no_answer", "left_voicemail", "connected_contact_unknown"] as const;
/**
 * V-AC B1 (2026-09-24): the dispositions that are known misses at completion time. `connected_contact_unknown`
 * is not one: capture records every connected call that way until analysis or the Owner classifies it, so it
 * never spawns a retry by itself and never ends a chain in `promise_unreached` (a classified non-conversation
 * gets its retry from the re-projection pass in `ensureInteraction`).
 */
export const KNOWN_MISS_DISPOSITIONS = ["no_answer", "left_voicemail"] as const;
const isUnreached = (disposition: string | null | undefined) => (KNOWN_MISS_DISPOSITIONS as readonly string[]).includes(disposition ?? "");

/**
 * Spec §6 rule 4: the chain whose newest action completed unreached after the last retry, with no
 * newer human conversation and no newer open action. Pure over the rows `derive()` already has.
 */
export function promiseUnreachedSince(record: Pick<RecordRow, "last_meaningful_contact_at">, followups: readonly FollowupRow[], maxRetries: number): Date | null {
  const chains = new Map<string, FollowupRow[]>();
  for (const a of followups) {
    const root = a.promise_chain ? String(a.promise_chain.root_id) : isPromisedCallback(a) ? String(a._id) : null;
    if (root) chains.set(root, [...(chains.get(root) ?? []), a]);
  }
  let since: Date | null = null;
  for (const members of chains.values()) {
    const last = [...members].sort((a, b) => (a.promise_chain?.attempt ?? 0) - (b.promise_chain?.attempt ?? 0)).at(-1)!;
    if ((last.promise_chain?.attempt ?? 0) < maxRetries || last.status !== "completed" || !isUnreached(last.disposition) || !last.completed_at) continue;
    const at = last.completed_at;
    if (record.last_meaningful_contact_at && record.last_meaningful_contact_at > at) continue;
    if (followups.some(a => a.status === "open" && +(a.createdAt ?? a.date_resolution?.anchor ?? 0) > +at)) continue;
    if (!since || at > since) since = at;
  }
  return since;
}

/** All active actions participate. Contractual overdue survives snooze in detail. */
export function derive(record: RecordRow, context: DeriveContext) {
  const { now, policy, staffing } = context;
  const evolution = context.evolution ?? attentionEvolutionEnabled();
  const actions = context.followups.filter(a => a.status === "open");
  const due = actions.filter(a => { const at = attentionDue(a); return at && at <= now; });
  const actionable = !["closed", "identity_review"].includes(record.state);
  const ageFrom = record.last_meaningful_contact_at ?? record.trigger_at;
  const age = staffedMinutesBetween(ageFrom, now, staffing);
  const missing = actions.filter(a => !a.responsible_agent_id).map(a => String(a._id));
  const reasons: string[] = [];
  const bands: number[] = [];
  const add = (band: number, reason: string, match: boolean) => { if (actionable && match) { bands.push(band); reasons.push(reason); } };
  const tuning = evolution ? csiPolicyEvolution(policy) : null;
  if (!evolution) add(1, "promised_callback_overdue", due.some(a => a.kind === "call" && a.origin === "rep_promise"));
  else {
    // F8: exact callbacks promised by a rep, the customer or the Owner, and their retry successors.
    const promised = due.filter(isPromisedCallback).sort((a, b) => +attentionDue(a)! - +attentionDue(b)! || String(a._id).localeCompare(String(b._id)));
    add(1, "promised_callback_overdue", promised.length > 0);
    if (actionable && promised.length) reasons.push(`promised_by:${promisedBy(promised[0]!)}`);
  }
  const unworkedForm = record.state === "unworked" && record.subject.model === "FormLead";
  // F10: a new Form Lead is on the desk at once; before its first-call deadline it says so and sorts below overdue ones.
  add(2, evolution && record.first_action_due_at && record.first_action_due_at > now ? "new_not_yet_due" : "no_call_yet", unworkedForm);
  add(3, "missed_call_no_callback", actions.some(a => Boolean(a.missed_episode_key) && !(a.snoozed_until && a.snoozed_until > now)));
  add(4, "followups_due", due.length > 0);
  if (tuning) {
    add(4, "promise_unreached", promiseUnreachedSince(record, context.followups, tuning.callback_max_retries) !== null);
    // F10: the customer's last conversation was inbound and nobody called back or planned anything.
    const inbound = record.last_inbound_human_at;
    add(4, "no_callback_after_inbound", record.state === "open" && actions.length === 0 && Boolean(inbound) &&
      +inbound! >= +(record.last_meaningful_contact_at ?? 0) && !(record.last_attributable_outbound_at && record.last_attributable_outbound_at > inbound!) &&
      staffedMinutesAtLeast(inbound!, now, tuning.inbound_followup_staffed_minutes, staffing));
  }
  add(5, "no_next_step", record.state === "open" && actions.length === 0);
  add(6, "missing_responsibility", !record.responsible_agent_id || missing.length > 0);
  // LP-01: work established by accepted Lead progress with no attributable call in available history.
  // A secondary explanation, never a band of its own (§4).
  if (actionable && record.state !== "unworked" && record.lead_progress?.work_observed && !record.first_attributable_outbound_at && !record.first_human_conversation_at) reasons.push("no_call_observed");
  // Snoozing an overdue task postpones its reminder, not the customer's agreement
  // or the last human contact. Day-only waits still honor their next-opening boundary.
  const futurePlan = actions.some(a => a.due_at && (a.base_attention_due_at ?? a.due_at) > now);
  // P8: with the flag, going cold measures from the last activity (attempt, conversation, accepted progress, Owner command).
  // (A capped walk from the activity time, so the flag adds no full-age calendar walk per row.)
  const cold = evolution && record.last_activity_at ? staffedMinutesAtLeast(record.last_activity_at, now, policy.going_cold_staffed_minutes, staffing) : age >= policy.going_cold_staffed_minutes;
  add(7, "going_cold", !futurePlan && cold);
  if (tuning && actionable) {
    // Secondary reasons (never a band of their own).
    if (record.subject.model === "FormLead" && record.prior_contact_at) reasons.push("called_before_form");
    if (record.last_attributable_outbound_at && record.last_attributable_outbound_at > ageFrom && age >= tuning.unreached_multiplier * policy.going_cold_staffed_minutes) reasons.push("unreached");
    if (bands.length && Math.min(...bands) === 5 && record.lead_progress?.disposition === "rep_discretion") reasons.push("rep_discretion");
  }
  const review = context.reviewItems.filter(r => r.state === "open");
  const badges = new Set(review.map(r => r.cause_kind));
  if (actions.some(a => !a.due_at)) badges.add("missing_date");
  if (missing.length) badges.add("missing_responsibility");
  const blockers: string[] = [];
  if (record.state === "closed") blockers.push("closed");
  if (record.state === "identity_review") { blockers.push("identity"); badges.add("identity"); }
  if (context.suppressed) blockers.push("suppressed");
  if (context.restrictions.some(r => r.state === "active" && r.channels.includes("call") && (!r.until || r.until > now))) { blockers.push("restriction"); badges.add("restriction"); }
  // A terminal CRM disposition of uncertain provenance blocks new sales execution until reviewed (§6).
  if (review.some(r => r.cause_kind === "disposition_review")) blockers.push("disposition_review");
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
