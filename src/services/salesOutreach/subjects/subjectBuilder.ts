import type { SalesOutreachWorkflow } from "../../../config/domain/salesOutreach";
import type { SalesOutreachNoContactNumberRule } from "../../../validation/v1/salesOutreach";
import { newYorkBusinessDay } from "../reads/businessDay";
import type { DeskEligibility } from "./eligibility";
import type { DeskLeadFacts } from "./leadFacts";
import { leadInstant, leadTimestampConvention } from "./leadInstant";
import type { DeskPolicyDecision } from "./policyMapping";

/** Version of the received-time adapter recorded on every subject and period (restored `leadInstant`). */
export const LEAD_INSTANT_ADAPTER_VERSION = "lead-instant-v1" as const;
/** Arrivals before this are not credible Lead times for the desk (`received_quality: unreliable`). */
const EARLIEST_CREDIBLE_ARRIVAL = Date.parse("2010-01-01T00:00:00.000Z");

export type ReceivedQuality = "instant" | "wall_clock" | "missing" | "unreliable";

export type DeskReceivedFacts = Readonly<{
  received_at: Date | null;
  received_date: string | null;
  received_quality: ReceivedQuality;
  adapter_version: typeof LEAD_INSTANT_ADAPTER_VERSION;
}>;

/**
 * The subject's received time through the restored adapter (P02a Day 1, P10a original age).
 * Missing or not credible (after the reference instant, or implausibly old) is never guessed: the
 * subject goes to review and the engine computes no age (P10a "missing/unreliable age goes to review").
 */
export function receivedFactsOf(facts: Pick<DeskLeadFacts, "timestamp" | "created_at" | "ingestion_origin">, asOf: Date): DeskReceivedFacts {
  const source = { timestamp: facts.timestamp, createdAt: facts.created_at, ingestion_origin: facts.ingestion_origin };
  const received = leadInstant(source);
  if (!received) return { received_at: null, received_date: null, received_quality: "missing", adapter_version: LEAD_INSTANT_ADAPTER_VERSION };
  if (+received > +asOf || +received < EARLIEST_CREDIBLE_ARRIVAL)
    return { received_at: received, received_date: null, received_quality: "unreliable", adapter_version: LEAD_INSTANT_ADAPTER_VERSION };
  return {
    received_at: received,
    received_date: newYorkBusinessDay(received),
    received_quality: leadTimestampConvention(source),
    adapter_version: LEAD_INSTANT_ADAPTER_VERSION,
  };
}

export const isReliableReceived = (received: DeskReceivedFacts) =>
  received.received_quality === "instant" || received.received_quality === "wall_clock";

export type DeskSubjectDisplay = Readonly<{
  job_no: string | null;
  normalized_job_no: string | null;
  phone: string | null;
  normalized_phone: string | null;
  name: string | null;
  move_date: string | null;
}>;

export type DeskSubjectPriority = Readonly<{
  raw: string | null;
  accepted_at: Date | null;
  observation_id: string | null;
  basis: "accepted_observation" | "intake_default" | "none";
  uncertain: boolean;
}>;

/** The subject fields derived from current Lead facts (IMPLEMENTATION-PLAN §4.1). */
export type DeskSubjectFacts = DeskReceivedFacts &
  Readonly<{
    display: DeskSubjectDisplay;
    priority: DeskSubjectPriority;
    /** IMPL-01: `receiver_agent` only when that Agent has a reviewed `sales_rep` link now; else Unassigned. */
    assigned_agent_id: string | null;
    /** IMPL-07 inputs: Contact Numbers whose `lead` or `other_leads` hold this Lead (All Numbers). */
    contact_number_ids: string[];
    lead_revision_seen: number;
    /**
     * olr B2: `deskDecisionFingerprint` of the configuration this subject was last decided under (priority
     * map + intake defaults). Null on subjects written before B2 (treated as "same", never as a change).
     */
    decision_fingerprint: string | null;
  }>;

export type DeskSubjectContext = Readonly<{
  as_of: Date;
  /** olr B2: the active configuration's decision fingerprint, stamped on the subject. */
  decision_fingerprint: string;
  /** Agents with a reviewed `sales_rep` identity link effective at `as_of`. */
  reviewed_rep_ids: ReadonlySet<string>;
  contact_number_ids: readonly string[];
  /** P05e: a newer blank/malformed/unverified priority update exists after the last accepted one. */
  priority_uncertain: boolean;
}>;

export function buildSubjectFacts(facts: DeskLeadFacts, decision: DeskPolicyDecision, context: DeskSubjectContext): DeskSubjectFacts {
  const accepted = decision.kind === "accepted";
  return {
    ...receivedFactsOf(facts, context.as_of),
    display: {
      job_no: facts.job_no,
      normalized_job_no: facts.normalized_job_no,
      phone: facts.phone,
      normalized_phone: facts.normalized_phone,
      name: facts.name,
      move_date: facts.move_date,
    },
    priority: {
      raw: accepted ? decision.priority_raw : facts.granot_priority,
      accepted_at: accepted ? decision.accepted_at : null,
      observation_id: accepted ? decision.observation_id : null,
      basis: accepted ? "accepted_observation" : decision.kind === "intake_default" ? "intake_default" : "none",
      uncertain: context.priority_uncertain || (decision.kind === "review" && decision.reason === "malformed_priority"),
    },
    assigned_agent_id: facts.receiver_agent_id && context.reviewed_rep_ids.has(facts.receiver_agent_id) ? facts.receiver_agent_id : null,
    contact_number_ids: [...new Set(context.contact_number_ids)].sort(),
    lead_revision_seen: facts.domain_revision,
    decision_fingerprint: context.decision_fingerprint,
  };
}

/**
 * The period the Lead's current facts call for, or null to retain the last verified one (P05e).
 * `transition_key` is the semantic identity of the transition: one row per accepted observation and
 * workflow (or closure fact), so a replay or a repeated accepted priority cannot open a second period.
 */
export type DesiredPeriod = Readonly<{
  workflow: SalesOutreachWorkflow;
  priority: string | null;
  transition_key: string;
  priority_source_ref: string | null;
  priority_source_revision: number | null;
  /**
   * When the fact took effect (accepted observation `captured_at`, or the Lead change time), or — for a
   * re-decision caused by a configuration change — when that configuration became active (olr B2).
   */
  effective_at: Date;
  time_basis: "accepted_observation_captured_at" | "entity_change_applied_at" | "configuration_activated_at";
  end_reason_for_previous: "priority_change" | "closure";
}>;

export function desiredPeriodOf(facts: DeskLeadFacts, eligibility: DeskEligibility, decision: DeskPolicyDecision, asOf: Date): DesiredPeriod | null {
  const changedAt = facts.last_changed_at ?? asOf;
  if (eligibility.outcome === "closed") {
    const ref = eligibility.reason === "official_booking" ? facts.booked_id : eligibility.reason === "official_cancellation" ? facts.cancelled_id : facts.bad_lead;
    return {
      workflow: "closed",
      priority: facts.granot_priority,
      transition_key: `closure:${eligibility.reason}:${ref ?? "-"}`,
      priority_source_ref: null,
      priority_source_revision: facts.domain_revision,
      effective_at: changedAt,
      time_basis: "entity_change_applied_at",
      end_reason_for_previous: "closure",
    };
  }
  if (decision.kind === "accepted") {
    const source = decision.observation_id ? `observation:${decision.observation_id}` : `lead_revision:${facts.domain_revision}`;
    return {
      workflow: decision.workflow,
      priority: decision.priority_raw,
      transition_key: `priority:${source}:${decision.workflow}:${decision.priority_raw}`,
      priority_source_ref: decision.observation_id,
      priority_source_revision: facts.domain_revision,
      effective_at: decision.accepted_at ?? changedAt,
      time_basis: decision.accepted_at ? "accepted_observation_captured_at" : "entity_change_applied_at",
      end_reason_for_previous: decision.workflow === "closed" ? "closure" : "priority_change",
    };
  }
  if (decision.kind === "intake_default") {
    return {
      workflow: "new",
      priority: null,
      transition_key: `intake_default:${decision.source}`,
      priority_source_ref: null,
      priority_source_revision: facts.domain_revision,
      effective_at: changedAt,
      time_basis: "entity_change_applied_at",
      end_reason_for_previous: "priority_change",
    };
  }
  return null;
}

/**
 * Review reasons that hold a subject's admission (identity or received time not trustworthy). A first
 * period opened after such a hold clears starts at the decision instant (`desk_decision_at`, olr B1),
 * because no fact time exists for the hold clearing. The hold itself is olr B8 (`sync.ts` `admissionHoldOf`).
 */
export const ADMISSION_HOLD_REASONS: ReadonlySet<string> = new Set(["ambiguous_identity", "received_time_unreliable", "received_time_missing"]);

/**
 * olr C2c inputs: the subject's linked Contact Numbers, the E.164 its Lead's number is minted from
 * (`leadPhoneE164`, the mint's phone rule: the live phone, a Call Lead's original caller, then the intake and
 * Granot snapshots; null when none forms an E.164) and the Owner's `cadence.no_contact_number_rule`.
 */
export type DeskSubjectContactFacts = Readonly<{
  number_ids: readonly string[];
  phone_e164: string | null;
  rule: SalesOutreachNoContactNumberRule | undefined;
}>;

/** olr C2c review reason: nothing can be called or texted (rule on, no linked number, no usable phone). */
export const NO_CONTACT_NUMBER_REASON = "no_contact_number";

/**
 * True when the subject has no callable number and none can exist yet (D-C2c). A phone without a number
 * yet is a linking delay (the Lead's `lead_link` job mints and links it within about a minute, olr C2b),
 * never a review: review drops every routine obligation (`engine/evaluate.ts`). Pure.
 */
export function lacksContactNumber(contact: DeskSubjectContactFacts | undefined): boolean {
  return contact?.rule === "review_no_cadence" && contact.number_ids.length === 0 && contact.phone_e164 === null;
}

/** Subject status and the current review reasons (recomputed from facts, never accumulated). */
export function subjectStatusOf(input: {
  eligibility: DeskEligibility;
  decision: DeskPolicyDecision;
  received: DeskReceivedFacts;
  /** Workflow of the period that will be active after this refresh, or null when there is none. */
  active_workflow: SalesOutreachWorkflow | null;
  /** Statuses never move out of `closed` (no implicit reopening, P05h/P06f). */
  current_status: "active" | "closed" | "review" | null;
  /** olr C2c: absent (or the rule absent) = no `no_contact_number` reason, as before C2c. */
  contact?: DeskSubjectContactFacts;
  /** olr B8: the admission hold's own reasons (`ambiguous_identity`), from `admissionHoldOf`. */
  hold_reasons?: readonly string[];
}): { status: "active" | "closed" | "review"; review_reasons: string[] } {
  if (input.current_status === "closed" || input.active_workflow === "closed") return { status: "closed", review_reasons: [] };
  const reasons: string[] = [];
  if (input.eligibility.outcome === "excluded") reasons.push(input.eligibility.reason);
  if (input.eligibility.outcome === "review") reasons.push(input.eligibility.reason);
  if (input.received.received_quality === "missing") reasons.push("received_time_missing");
  if (input.received.received_quality === "unreliable") reasons.push("received_time_unreliable");
  reasons.push(...(input.hold_reasons ?? []));
  if (input.active_workflow === null) {
    if (input.decision.kind === "review") reasons.push(input.decision.reason);
    if (input.decision.kind === "unavailable") reasons.push("policy_unavailable");
  }
  if (lacksContactNumber(input.contact)) reasons.push(NO_CONTACT_NUMBER_REASON);
  return { status: reasons.length ? "review" : "active", review_reasons: reasons };
}
