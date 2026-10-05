/**
 * Sales Outreach Desk contact-event vocabularies (S3, SRV-6). Value sets only; nothing here
 * activates behaviour. See IMPLEMENTATION-PLAN §4.4 / §4.6, IMPL-06 / IMPL-07 and P07a–P07g.
 */

/** IMPL-07 association of one call/SMS at contact time. */
export const SALES_OUTREACH_CONTACT_ASSOCIATIONS = ["unique", "ambiguous", "none"] as const;
export type SalesOutreachContactAssociation = (typeof SALES_OUTREACH_CONTACT_ASSOCIATIONS)[number];

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
