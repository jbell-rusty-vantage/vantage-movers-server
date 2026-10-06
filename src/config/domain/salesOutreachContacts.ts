/**
 * Sales Outreach Desk contact-event vocabularies (S3, SRV-6). Value sets only; nothing here
 * activates behaviour. See IMPLEMENTATION-PLAN §4.4 / §4.6, IMPL-06 / IMPL-07 and P07a–P07g.
 */

/** IMPL-07 association of one call/SMS at contact time. */
export const SALES_OUTREACH_CONTACT_ASSOCIATIONS = ["unique", "ambiguous", "none"] as const;
export type SalesOutreachContactAssociation = (typeof SALES_OUTREACH_CONTACT_ASSOCIATIONS)[number];

/**
 * olr C8: why one call/SMS is (or is not) associated with an eligible New/Quoted subject at contact
 * time, stored on every contact event that reaches association (null for merged, purged, internal,
 * unknown-direction, not-external rows and duplicate SMS copies):
 * - `eligible` — unique subject whose period at contact time is New or Quoted (the M2 goal scope);
 * - `not_new_quoted` — unique subject, but its period is another workflow or none;
 * - `ambiguous` — the numbers lead to several Leads, or a group SMS;
 * - `no_lead` — no number Lead (no contact number Lead link, or an SMS with no known counterpart number);
 * - `lead_not_enrolled` — the number's Lead has no desk subject;
 * - `before_activation` — the contact precedes the subject's activation boundary;
 * - `lead_closed` — the subject's closed period had started.
 * Rep-day "Other outbound" is broken down by it (`other_outbound` on the rep-day row).
 */
export const SALES_OUTREACH_ASSOCIATION_REASONS = [
  "eligible",
  "not_new_quoted",
  "ambiguous",
  "no_lead",
  "lead_not_enrolled",
  "before_activation",
  "lead_closed",
] as const;
export type SalesOutreachAssociationReason = (typeof SALES_OUTREACH_ASSOCIATION_REASONS)[number];

/**
 * olr C8: the buckets of a rep-day's "Other outbound" breakdown — every association reason except
 * `eligible`, plus `unknown` for events derived before `association_reason` was stored.
 */
export const SALES_OUTREACH_OTHER_OUTBOUND_BUCKETS = [
  "no_lead",
  "lead_not_enrolled",
  "lead_closed",
  "before_activation",
  "ambiguous",
  "not_new_quoted",
  "unknown",
] as const;
export type SalesOutreachOtherOutboundBucket = (typeof SALES_OUTREACH_OTHER_OUTBOUND_BUCKETS)[number];
export type SalesOutreachOtherOutboundBreakdown = Record<SalesOutreachOtherOutboundBucket, number>;

/** P06b: whether the customer was reached. Only `unanswered` counts toward the advisory warning. */
export const SALES_OUTREACH_CONTACT_OUTCOMES = ["answered", "unanswered", "unknown"] as const;
export type SalesOutreachContactOutcome = (typeof SALES_OUTREACH_CONTACT_OUTCOMES)[number];

/**
 * The outbound-goal credit one source earns for `goal_agent_id` (P07a/P07b/P07g, IMPL-06), before
 * the day's count scope is applied: `confirmed` = a terminal attempt present in the Call Log by a
 * reviewed initiator; `awaiting_confirmation` = the same attempt seen only by webhook so far (never
 * credit, never a miss); `none` = everything else (inbound, SMS, restricted, internal, duplicate…).
 */
export const SALES_OUTREACH_GOAL_CREDITS = ["none", "awaiting_confirmation", "confirmed"] as const;
export type SalesOutreachGoalCredit = (typeof SALES_OUTREACH_GOAL_CREDITS)[number];

/** Sync-state scopes of the contact-event sweeps (cursor + derived-evidence watermark). */
export const OUTREACH_CONTACT_CALLS_SCOPE = "outreach_contact_calls" as const;
export const OUTREACH_CONTACT_SMS_SCOPE = "outreach_contact_sms" as const;
