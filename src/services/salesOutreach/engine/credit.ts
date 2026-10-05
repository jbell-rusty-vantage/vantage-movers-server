/**
 * P07a–P07g evidence credit rules, P02e spacing and the goal arithmetic (P08a / SPECIFICATION §13.4).
 * Pure functions shared by the engine (cadence) and S3 (contact-event derivation, rep-day projection).
 *
 * - `classifyCallEvidence` / `classifySmsEvidence`: normalized provider facts → contact-event kind,
 *   verification, actor and goal agent (one canonical event per call / logical message).
 * - `isCadenceQualifying` / `goalCreditAgent`: what one event can earn. Goal credit is never spacing- or
 *   window-dependent; cadence credit is decided by the evaluator against open requirements.
 * - `selectSpacedStarts`: the stand-alone P02e spacing rule (anchor moves only on a credited start).
 */
import { businessDateOf, parseInstant } from "./calendar";
import type { BusinessDate, Channel, ContactEventKind, ContactVerification, EngineContactEvent } from "./types";

export type IdentityState = "reviewed" | "ambiguous" | "unreviewed" | "none";
export type AssociationState = "unique" | "ambiguous" | "none";

export interface ClassifiedEvidence {
  kind: ContactEventKind;
  verification: ContactVerification;
  exclusion_reason: string | null;
  actor_agent_id: string | null;
  goal_agent_id: string | null;
}

/** Normalized facts about one canonical Call Interaction (not one leg / receipt). */
export interface CallEvidenceFacts {
  direction: "outbound" | "inbound";
  /** Duplicate receipt, merged alias or purged interaction (another canonical row carries the call). */
  duplicate: boolean;
  /** Internal (extension-to-extension) or monitoring/whisper call. */
  internal: boolean;
  /** Provider shows an actual dial attempt (false for an API error or a button press alone). */
  actual_attempt: boolean;
  /** Provider marks the call terminal (not in progress). */
  terminal: boolean;
  /** IMPL-06: the call is present in the Call Log (`call_log_state` non-null). */
  in_call_log: boolean;
  /** Outbound: the initiating extension's reviewed identity at contact time. */
  initiator: { agent_id: string | null; identity: IdentityState };
  /** Inbound: the reviewed rep that actually answered/handled the call, if any. */
  handler: { agent_id: string | null; identity: IdentityState } | null;
  /** IMPL-07: the number's current Lead is an eligible subject at contact time. */
  association: AssociationState;
}

/** P07a/P07b/P07c + IMPL-06/07 classification of one canonical call. */
export function classifyCallEvidence(facts: CallEvidenceFacts): ClassifiedEvidence {
  const excluded = (reason: string, kind: ContactEventKind = "other"): ClassifiedEvidence => ({
    kind,
    verification: "excluded",
    exclusion_reason: reason,
    actor_agent_id: null,
    goal_agent_id: null,
  });
  if (facts.duplicate) return excluded("duplicate_receipt");
  if (facts.internal) return excluded("internal_call");
  if (facts.association === "none") return excluded("no_associated_subject");

  if (facts.direction === "outbound") {
    if (!facts.actual_attempt) return excluded("no_actual_attempt");
    const base = { kind: "outbound_attempt" as const, exclusion_reason: null };
    const reviewed = facts.initiator.identity === "reviewed" && facts.initiator.agent_id !== null;
    if (!facts.terminal || !facts.in_call_log) {
      return { ...base, verification: "awaiting_confirmation", actor_agent_id: reviewed ? facts.initiator.agent_id : null, goal_agent_id: null };
    }
    if (facts.association === "ambiguous") return { ...base, verification: "pending_association", actor_agent_id: reviewed ? facts.initiator.agent_id : null, goal_agent_id: null };
    if (!reviewed) return { ...base, verification: "pending_identity", actor_agent_id: null, goal_agent_id: null };
    return { ...base, verification: "confirmed", actor_agent_id: facts.initiator.agent_id, goal_agent_id: facts.initiator.agent_id };
  }

  if (!facts.terminal || !facts.in_call_log) {
    return { kind: facts.handler ? "inbound_answered" : "inbound_missed", verification: "awaiting_confirmation", exclusion_reason: null, actor_agent_id: null, goal_agent_id: null };
  }
  if (facts.handler === null || facts.handler.identity === "none") {
    // Missed inbound: history only, no credit, no automatic callback obligation (P06f).
    return { kind: "inbound_missed", verification: "confirmed", exclusion_reason: null, actor_agent_id: null, goal_agent_id: null };
  }
  if (facts.association === "ambiguous") return { kind: "inbound_answered", verification: "pending_association", exclusion_reason: null, actor_agent_id: null, goal_agent_id: null };
  if (facts.handler.identity !== "reviewed" || facts.handler.agent_id === null) {
    return { kind: "inbound_answered", verification: "pending_identity", exclusion_reason: null, actor_agent_id: null, goal_agent_id: null };
  }
  // Answered inbound: cadence/catch-up credit for any reviewed handler, zero outbound-goal credit (P07c).
  return { kind: "inbound_answered", verification: "confirmed", exclusion_reason: null, actor_agent_id: facts.handler.agent_id, goal_agent_id: null };
}

export type SmsProviderStatus = "queued" | "pending" | "api_accepted" | "sent" | "delivered" | "send_failed" | "delivery_failed";
export type SmsOrigin = "rep_deliberate" | "automation" | "automatic_confirmation" | "unknown";

/** Normalized facts about one logical message (provider account + mailbox + message id). */
export interface SmsEvidenceFacts {
  direction: "outbound" | "inbound";
  /** Latest provider status of the logical message (status history is kept by S3). */
  status: SmsProviderStatus;
  origin: SmsOrigin;
  sender: { agent_id: string | null; identity: IdentityState };
  association: AssociationState;
}

/** P07d/P07e classification of one logical SMS. */
export function classifySmsEvidence(facts: SmsEvidenceFacts): ClassifiedEvidence {
  const result = (kind: ContactEventKind, verification: ContactVerification, exclusion_reason: string | null = null, actor: string | null = null): ClassifiedEvidence => ({
    kind,
    verification,
    exclusion_reason,
    actor_agent_id: actor,
    goal_agent_id: null, // No message of any type earns outbound-call goal credit (P07e).
  });
  if (facts.association === "none") return result("other", "excluded", "no_associated_subject");
  if (facts.direction === "inbound") return result("sms_inbound", "confirmed");
  if (facts.origin === "automation") return result("other", "excluded", "unattended_automation");
  if (facts.origin === "automatic_confirmation") return result("other", "excluded", "automatic_confirmation");
  if (facts.status === "send_failed" || facts.status === "delivery_failed") return result("sms_failed", "excluded", facts.status);
  if (facts.status === "queued" || facts.status === "pending" || facts.status === "api_accepted") return result("sms_sent", "awaiting_confirmation");
  if (facts.association === "ambiguous") return result("sms_sent", "pending_association");
  if (facts.origin !== "rep_deliberate" || facts.sender.identity !== "reviewed" || facts.sender.agent_id === null) {
    return result("sms_sent", "pending_identity");
  }
  return result("sms_sent", "confirmed", null, facts.sender.agent_id);
}

/**
 * Whether an event can earn cadence credit on its channel at all (before window/spacing checks):
 * confirmed, the right kind, and not contrary to an active contact restriction (P07g).
 */
export function isCadenceQualifying(event: EngineContactEvent, channel: Channel = event.channel): boolean {
  if (event.channel !== channel || event.verification !== "confirmed" || event.restricted_at_contact) return false;
  return channel === "call" ? event.kind === "outbound_attempt" || event.kind === "inbound_answered" : event.kind === "sms_sent";
}

/**
 * P07a/P07b/P07g outbound-goal credit: one credit to the reviewed initiator of a confirmed outbound
 * attempt, on the New York date of its start, regardless of answer, window or spacing. Restricted
 * contact and every other kind earn zero. Subject eligibility at contact time is the caller's check.
 */
export function goalCreditAgent(event: EngineContactEvent): string | null {
  if (event.channel !== "call" || event.kind !== "outbound_attempt" || event.verification !== "confirmed") return null;
  if (event.restricted_at_contact) return null;
  return event.goal_agent_id;
}

/** Goal credits per agent for one business date (one credit per canonical event, never per leg). */
export function goalCreditsByAgent(events: readonly EngineContactEvent[], date: BusinessDate, timeZone: string): Map<string, number> {
  const seen = new Set<string>();
  const out = new Map<string, number>();
  for (const event of events) {
    if (seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    const agent = goalCreditAgent(event);
    if (!agent || businessDateOf(parseInstant(event.event_at), timeZone) !== date) continue;
    out.set(agent, (out.get(agent) ?? 0) + 1);
  }
  return out;
}

/**
 * P02e spacing on its own: indices of starts that earn cadence credit when every start would otherwise
 * qualify. A start too close to the last *credited* start earns none and does not move the anchor.
 */
export function selectSpacedStarts(startsMs: readonly number[], spacingMinutes: number): number[] {
  const credited: number[] = [];
  let anchor: number | null = null;
  startsMs
    .map((ms, index) => ({ ms, index }))
    .sort((a, b) => a.ms - b.ms || a.index - b.index)
    .forEach(({ ms, index }) => {
      if (anchor === null || ms - anchor >= spacingMinutes * 60_000) {
        credited.push(index);
        anchor = ms;
      }
    });
  return credited.sort((a, b) => a - b);
}

/* -------------------------------------------------------------------------------------------------
 * Goal arithmetic (SPECIFICATION §13.4, P08a)
 * -----------------------------------------------------------------------------------------------*/

export interface RepDayGoal {
  goal: number;
  actual: number;
  remaining: number;
  /** Capped at 1. */
  progress: number;
  goal_state: "goal" | "no_goal_today";
  goal_reached: boolean;
}

export function repDayGoal(actual: number, goal: number): RepDayGoal {
  if (goal <= 0) return { goal: 0, actual, remaining: 0, progress: 0, goal_state: "no_goal_today", goal_reached: false };
  return {
    goal,
    actual,
    remaining: Math.max(0, goal - actual),
    progress: Math.min(1, actual / goal),
    goal_state: "goal",
    goal_reached: actual >= goal,
  };
}

export interface TeamGoalSummary {
  team_goal: number;
  actual: number;
  goal_enabled_reps: number;
  reps_at_goal: number;
}

/** Team goal = sum of applicable individual goals; zero-goal rows keep actuals but leave the denominator. */
export function summarizeTeamGoals(rows: ReadonlyArray<{ goal: number; actual: number }>): TeamGoalSummary {
  let team_goal = 0;
  let actual = 0;
  let goal_enabled_reps = 0;
  let reps_at_goal = 0;
  for (const row of rows) {
    const day = repDayGoal(row.actual, row.goal);
    actual += row.actual;
    if (day.goal_state === "goal") {
      team_goal += day.goal;
      goal_enabled_reps += 1;
      if (day.goal_reached) reps_at_goal += 1;
    }
  }
  return { team_goal, actual, goal_enabled_reps, reps_at_goal };
}
