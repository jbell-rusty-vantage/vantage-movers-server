import { createHash } from "node:crypto";
import type { SalesOutreachWorkflow } from "../../../config/domain/salesOutreach";
import type {
  SalesOutreachContactAssociation,
  SalesOutreachContactOutcome,
  SalesOutreachGoalCredit,
} from "../../../config/domain/salesOutreachContacts";
import type { RepSmsStatus } from "../../../config/domain/ringcentralRepSms";
import { engineSmsStatus } from "../../ringcentral/repSms/mapper";
import { resolveRepIdentityAt, type TemporalRepLink } from "../../salesIntelligence/repIdentity/resolve";
import { classifyCallEvidence, classifySmsEvidence, type AssociationState, type ClassifiedEvidence, type IdentityState } from "../engine/credit";
import type { EngineContactEvent } from "../engine/types";
import { newYorkBusinessDay } from "../reads/businessDay";

/**
 * Contact-event derivation (IMPLEMENTATION-PLAN §4.4, IMPL-06, IMPL-07, P07a–P07g). Pure: the caller
 * loads one source row and its context (rep identity links, the numbers' current Leads, desk subjects
 * with their policy periods, contact restrictions) and gets back the one `sales_outreach_contact_events`
 * row the source should have. No Mongo, no clock: re-deriving the same inputs gives the same row and
 * the same fingerprint, so the consumer and the sweep converge and an identical re-derivation writes
 * nothing.
 *
 * Call rules (one canonical row per call, never per leg or receipt):
 * - merged-away (`merged_into_id`) and purged rows are excluded: the canonical row carries the call;
 * - `Internal` direction and calls to our own extensions/DIDs are internal; withheld, malformed and
 *   service-code endpoints are not external attempts; an `Unknown` direction is excluded;
 * - the outbound initiator (P07b) is the extension of the earliest outbound Call Log leg, ignoring
 *   monitoring/queue/IVR/voicemail legs; a tie between extensions is ambiguous identity. Transfer and
 *   monitoring participants therefore earn nothing, and the call itself still earns its one credit;
 * - IMPL-06: credit only for a terminal call present in the Call Log; webhook-only is
 *   `awaiting_confirmation`, never a miss;
 * - IMPL-07 (All Numbers): the number's current Lead (`contact_numbers.lead`), when it is a desk subject
 *   active at contact time; several Leads across an SMS's numbers are `ambiguous`, none is `none`;
 * - P05f/P10a: a contact before the subject's activation boundary on the same New York date stays `none`
 *   (no workflow, no goal scope, no credit) but carries `subject_id`, so the activation date's partial
 *   quota subtracts it;
 * - P07g: outbound at the verified start (a call crossing midnight belongs to its start date),
 *   answered inbound at the reviewed handler's answer, SMS at the confirmed sent time;
 * - restricted contact (an active restriction on the number covering the channel at contact time)
 *   stays in history with zero goal and cadence credit.
 */

export type DeskLeadKey = `${"FormLead" | "CallLead"}:${string}`;

export type CallPartyFacts = Readonly<{
  role: string;
  direction: string | null;
  extension_id: string | null;
  connected: boolean;
  answered_at: Date | null;
}>;

export type CallLegFacts = Readonly<{
  leg_type: string | null;
  direction: string | null;
  result: string | null;
  start_time: Date | null;
  extension_id: string | null;
}>;

/** The `call_interactions` fields the derivation reads. */
export type CallSourceRow = Readonly<{
  id: string;
  provider_account_id: string;
  direction: "Inbound" | "Outbound" | "Internal" | "Unknown";
  telephony_session_id: string | null;
  contact_number_id: string | null;
  external_endpoint_kind: string | null;
  started_at: Date;
  answered_at: Date | null;
  provider_connected: boolean;
  provider_result: string | null;
  contact_type: string;
  parties: readonly CallPartyFacts[];
  legs: readonly CallLegFacts[];
  call_log_state: "provisional" | "settled" | null;
  terminal: boolean;
  merged_into_id: string | null;
  purged_at: Date | null;
  projection_revision: number;
}>;

/** The `ringcentral_rep_sms_evidence` fields the derivation reads. */
export type SmsSourceRow = Readonly<{
  id: string;
  canonical_logical_id: string;
  direction: "inbound" | "outbound";
  status: RepSmsStatus;
  send_at: Date | null;
  provider_created_at: Date;
  counterpart_numbers: readonly string[];
  is_group: boolean;
  reviewed_agent_id: string | null;
  identity_state: "reviewed" | "pending_identity";
  source_revision: number;
  /** True when another mailbox copy of the same logical message is the canonical one. */
  duplicate_copy: boolean;
}>;

export type SubjectPeriodFacts = Readonly<{ workflow: SalesOutreachWorkflow; started_at: Date; ended_at: Date | null }>;

export type SubjectFacts = Readonly<{
  id: string;
  revision: number;
  activation_at: Date;
  periods: readonly SubjectPeriodFacts[];
  /** Call Lead subjects: the RingCentral telephony session that created the Lead (P07g originating inbound). */
  originating_session_id: string | null;
}>;

export type RestrictionInterval = Readonly<{ channels: readonly ("call" | "text")[]; from: Date; to: Date | null }>;

export type DerivationContext = Readonly<{
  links: readonly TemporalRepLink[];
  /** Contact number id → the number's current Lead (`contact_numbers.lead`; at most one per number). */
  linked_leads: ReadonlyMap<string, readonly DeskLeadKey[]>;
  /** Lead key → its desk subject (absent when the Lead is not enrolled). */
  subjects: ReadonlyMap<DeskLeadKey, SubjectFacts>;
  /** Contact number id → restriction intervals. */
  restrictions: ReadonlyMap<string, readonly RestrictionInterval[]>;
  /** SMS only: counterpart E.164 → contact number id. */
  numbers_by_e164?: ReadonlyMap<string, string>;
}>;

/** The derived row (everything but `_id`, `revision` and timestamps). */
export type ContactEventDraft = {
  source_kind: "call" | "sms";
  source_id: string;
  subject_id: string | null;
  channel: "call" | "sms";
  direction: "inbound" | "outbound";
  event_at: Date;
  business_date: string;
  actor_agent_id: string | null;
  goal_agent_id: string | null;
  kind: ClassifiedEvidence["kind"];
  verification: ClassifiedEvidence["verification"];
  exclusion_reason: string | null;
  restricted_at_contact: boolean;
  association: SalesOutreachContactAssociation;
  subject_workflow: SalesOutreachWorkflow | null;
  outcome: SalesOutreachContactOutcome;
  goal_credit: SalesOutreachGoalCredit;
  goal_scope_eligible: boolean;
  /** P07g: the confirmed reviewed-rep answered inbound that created the uniquely associated Call Lead. */
  originating_inbound: boolean;
  source_revision: number;
  input_fingerprint: string;
};

/** Leg types / party roles that never initiate or handle a customer call. */
const MONITORING_LEG_TYPES = new Set(["Monitoring", "Call Monitoring", "Call Coaching", "Whisper", "Barge In", "Coaching", "Barge"]);
const NON_PERSON_ROLES = new Set(["monitoring", "queue", "ivr", "voicemail", "external"]);
/** Call Log results meaning the platform refused to place the call: no actual attempt (P07a). */
const NO_ATTEMPT_RESULTS = new Set([
  "Internal Error",
  "Restricted",
  "Blocked",
  "International Disabled",
  "International Restriction",
  "Suspended account",
  "Account Suspended",
  "Stopped",
]);
const CONNECTED_RESULTS = new Set(["Accepted", "Completed", "Call connected", "Connected", "Answered"]);
const OUR_SIDE_KINDS = new Set(["extension", "company_did"]);
const NOT_EXTERNAL_KINDS = new Set(["service_code", "withheld", "malformed"]);
const GOAL_WORKFLOWS = new Set<SalesOutreachWorkflow>(["new", "quoted"]);

/** Deterministic event `_id` (24 hex) for one source: one row per source, concurrent writers collide. */
export function contactEventId(sourceKind: "call" | "sms", sourceId: string): string {
  return createHash("sha256").update(`sod-contact-event:${sourceKind}:${sourceId}`).digest("hex").slice(0, 24);
}

function fingerprintOf(draft: Omit<ContactEventDraft, "input_fingerprint">): string {
  const canonical = { ...draft, event_at: draft.event_at.toISOString() };
  return createHash("sha256").update(JSON.stringify(canonical, Object.keys(canonical).sort())).digest("hex");
}

const time = (value: Date | null | undefined) => (value ? value.getTime() : Number.POSITIVE_INFINITY);

/** The single person-extension that `pick` selects by earliest time, or ambiguity/none. */
function earliestExtension(candidates: ReadonlyArray<{ extension_id: string; at: number }>): { extension_id: string | null; ambiguous: boolean } {
  if (!candidates.length) return { extension_id: null, ambiguous: false };
  const min = Math.min(...candidates.map((c) => c.at));
  const first = new Set(candidates.filter((c) => c.at === min).map((c) => c.extension_id));
  if (first.size > 1) return { extension_id: null, ambiguous: true };
  return { extension_id: [...first][0]!, ambiguous: false };
}

function roleOf(row: CallSourceRow, extensionId: string): string | null {
  return row.parties.find((p) => p.extension_id === extensionId)?.role ?? null;
}

function personLeg(row: CallSourceRow, leg: CallLegFacts): leg is CallLegFacts & { extension_id: string } {
  if (!leg.extension_id || MONITORING_LEG_TYPES.has(leg.leg_type ?? "")) return false;
  const role = roleOf(row, leg.extension_id);
  return role === null || !NON_PERSON_ROLES.has(role);
}

/** P07b: the initiating extension of an outbound call (earliest outbound Call Log leg, else the outbound user party). */
export function outboundInitiator(row: CallSourceRow): { extension_id: string | null; ambiguous: boolean } {
  const legs = row.legs
    .filter((leg) => personLeg(row, leg) && (leg.direction === null || leg.direction === "Outbound"))
    .map((leg) => ({ extension_id: leg.extension_id!, at: time(leg.start_time) }));
  if (legs.length) return earliestExtension(legs);
  const parties = [...new Set(row.parties.filter((p) => p.role === "user" && p.extension_id && p.direction === "Outbound").map((p) => p.extension_id!))];
  if (parties.length > 1) return { extension_id: null, ambiguous: true };
  return { extension_id: parties[0] ?? null, ambiguous: false };
}

/** P07c/P07g: the extension that actually answered an inbound call first, and when. */
export function inboundHandler(row: CallSourceRow): { extension_id: string | null; ambiguous: boolean; answered_at: Date | null } {
  const parties = row.parties
    .filter((p) => p.connected && p.extension_id && (p.role === "user" || p.role === "unknown"))
    .map((p) => ({ extension_id: p.extension_id!, at: time(p.answered_at) }));
  const legs = row.legs
    .filter((leg) => personLeg(row, leg) && leg.result !== null && CONNECTED_RESULTS.has(leg.result))
    .map((leg) => ({ extension_id: leg.extension_id!, at: time(leg.start_time) }));
  const byExtension = new Map<string, number>();
  for (const candidate of [...parties, ...legs]) byExtension.set(candidate.extension_id, Math.min(byExtension.get(candidate.extension_id) ?? Infinity, candidate.at));
  const picked = earliestExtension([...byExtension].map(([extension_id, at]) => ({ extension_id, at })));
  const at = picked.extension_id ? byExtension.get(picked.extension_id)! : Infinity;
  return { ...picked, answered_at: Number.isFinite(at) ? new Date(at) : row.answered_at };
}

function identityAt(links: readonly TemporalRepLink[], account: string, pick: { extension_id: string | null; ambiguous: boolean }, at: Date): { agent_id: string | null; identity: IdentityState } {
  if (pick.ambiguous) return { agent_id: null, identity: "ambiguous" };
  if (!pick.extension_id) return { agent_id: null, identity: "none" };
  const resolution = resolveRepIdentityAt(links, account, pick.extension_id, at);
  if (resolution.status === "reviewed") return { agent_id: resolution.agent_id, identity: "reviewed" };
  return { agent_id: null, identity: resolution.status === "conflicting" ? "ambiguous" : "unreviewed" };
}

type Association = {
  state: SalesOutreachContactAssociation;
  subject: SubjectFacts | null;
  workflow: SalesOutreachWorkflow | null;
  /**
   * P05f/P10a (olr C4): the Lead's subject when the contact precedes its activation boundary on the same
   * New York business date. The row stays `none` (no workflow, no goal scope: nothing is owed or credited
   * before the boundary) but carries the subject id and its real kind/verification, so the evaluator's
   * partial-start quota subtracts the earlier same-date contact (`engine/reentry.ts` priorSameDateCredit).
   */
  same_date_prior: SubjectFacts | null;
};

const NO_ASSOCIATION: Association = { state: "none", subject: null, workflow: null, same_date_prior: null };
const AMBIGUOUS: Association = { state: "ambiguous", subject: null, workflow: null, same_date_prior: null };

function periodAt(subject: SubjectFacts, at: Date): SubjectPeriodFacts | null {
  const ms = at.getTime();
  return subject.periods.find((p) => p.started_at.getTime() <= ms && (p.ended_at === null || p.ended_at.getTime() > ms)) ?? null;
}

/** IMPL-07 over the source's contact numbers. */
export function associate(numberIds: readonly string[], at: Date, context: DerivationContext): Association {
  const leads = new Set<DeskLeadKey>();
  for (const id of numberIds) for (const lead of context.linked_leads.get(id) ?? []) leads.add(lead);
  if (leads.size === 0) return NO_ASSOCIATION;
  if (leads.size > 1) return AMBIGUOUS;
  const subject = context.subjects.get([...leads][0]!) ?? null;
  if (!subject) return NO_ASSOCIATION;
  if (subject.activation_at.getTime() > at.getTime()) {
    const sameDate = newYorkBusinessDay(subject.activation_at) === newYorkBusinessDay(at);
    return sameDate ? { ...NO_ASSOCIATION, same_date_prior: subject } : NO_ASSOCIATION;
  }
  const period = periodAt(subject, at);
  // A subject whose closed period had started is no longer an active desk subject at contact time.
  if (period?.workflow === "closed") return NO_ASSOCIATION;
  return { state: "unique", subject, workflow: period?.workflow ?? null, same_date_prior: null };
}

/** The association the evidence classifier sees: a same-date prior contact keeps its real kind and verification. */
function evidenceAssociation(association: Association): AssociationState {
  return (association.same_date_prior ? "unique" : association.state) as AssociationState;
}

/** The row's `subject_id`: the associated subject, else the same-date prior subject (evaluator input only). */
function subjectIdOf(association: Association): string | null {
  return association.subject?.id ?? association.same_date_prior?.id ?? null;
}

export function restrictedAt(numberIds: readonly string[], channel: "call" | "text", at: Date, context: DerivationContext): boolean {
  const ms = at.getTime();
  return numberIds.some((id) =>
    (context.restrictions.get(id) ?? []).some((r) => r.channels.includes(channel) && r.from.getTime() <= ms && (r.to === null || r.to.getTime() > ms)),
  );
}

function callOutcome(row: CallSourceRow, confirmed: boolean): SalesOutreachContactOutcome {
  if (!confirmed) return "unknown";
  if (row.contact_type === "voicemail" || row.provider_result === "Voicemail") return "unanswered";
  return row.provider_connected ? "answered" : "unanswered";
}

function finish(draft: Omit<ContactEventDraft, "input_fingerprint">): ContactEventDraft {
  return { ...draft, input_fingerprint: fingerprintOf(draft) };
}

/** One canonical `call_interactions` row → its contact-event row. */
export function deriveCallContactEvent(row: CallSourceRow, context: DerivationContext): ContactEventDraft {
  const numbers = row.contact_number_id ? [row.contact_number_id] : [];
  const confirmed = row.terminal && row.call_log_state !== null;
  const base = {
    source_kind: "call" as const,
    source_id: row.id,
    channel: "call" as const,
    source_revision: row.projection_revision,
  };
  const excluded = (reason: string, direction: "inbound" | "outbound", eventAt: Date) =>
    finish({
      ...base,
      subject_id: null,
      direction,
      event_at: eventAt,
      business_date: newYorkBusinessDay(eventAt),
      actor_agent_id: null,
      goal_agent_id: null,
      kind: "other",
      verification: "excluded",
      exclusion_reason: reason,
      restricted_at_contact: false,
      association: "none",
      subject_workflow: null,
      outcome: "unknown",
      goal_credit: "none",
      goal_scope_eligible: false,
      originating_inbound: false,
    });
  const fallbackDirection = row.direction === "Inbound" ? "inbound" : "outbound";
  if (row.merged_into_id) return excluded("merged_duplicate", fallbackDirection, row.started_at);
  if (row.purged_at) return excluded("purged", fallbackDirection, row.started_at);
  if (row.direction === "Internal" || OUR_SIDE_KINDS.has(row.external_endpoint_kind ?? "")) return excluded("internal_call", fallbackDirection, row.started_at);
  if (row.direction === "Unknown") return excluded("direction_unknown", "outbound", row.started_at);
  if (NOT_EXTERNAL_KINDS.has(row.external_endpoint_kind ?? "") || !row.contact_number_id) return excluded("not_external", fallbackDirection, row.started_at);

  if (row.direction === "Outbound") {
    const eventAt = row.started_at;
    const initiator = identityAt(context.links, row.provider_account_id, outboundInitiator(row), eventAt);
    const association = associate(numbers, eventAt, context);
    const restricted = restrictedAt(numbers, "call", eventAt, context);
    const actualAttempt = !NO_ATTEMPT_RESULTS.has(row.provider_result ?? "");
    const classified = classifyCallEvidence({
      direction: "outbound",
      duplicate: false,
      internal: false,
      actual_attempt: actualAttempt,
      terminal: row.terminal,
      in_call_log: row.call_log_state !== null,
      initiator,
      handler: null,
      association: evidenceAssociation(association),
    });
    const reviewed = initiator.identity === "reviewed" && initiator.agent_id !== null;
    const goalCredit: SalesOutreachGoalCredit = !actualAttempt || !reviewed || restricted ? "none" : confirmed ? "confirmed" : "awaiting_confirmation";
    return finish({
      ...base,
      subject_id: subjectIdOf(association),
      direction: "outbound",
      event_at: eventAt,
      business_date: newYorkBusinessDay(eventAt),
      actor_agent_id: reviewed ? initiator.agent_id : classified.actor_agent_id,
      goal_agent_id: goalCredit === "none" ? null : initiator.agent_id,
      kind: classified.kind,
      verification: classified.verification,
      exclusion_reason: classified.exclusion_reason,
      restricted_at_contact: restricted,
      association: association.state,
      subject_workflow: association.workflow,
      outcome: callOutcome(row, confirmed),
      goal_credit: goalCredit,
      goal_scope_eligible: association.state === "unique" && association.workflow !== null && GOAL_WORKFLOWS.has(association.workflow),
      originating_inbound: false,
    });
  }

  // Inbound: P07c cadence credit for the reviewed handler, zero outbound-goal credit.
  const handlerPick = inboundHandler(row);
  const answered = handlerPick.extension_id !== null || handlerPick.ambiguous;
  const eventAt = answered ? (handlerPick.answered_at ?? row.started_at) : row.started_at;
  const handler = answered ? identityAt(context.links, row.provider_account_id, handlerPick, eventAt) : null;
  const association = associate(numbers, eventAt, context);
  const classified = classifyCallEvidence({
    direction: "inbound",
    duplicate: false,
    internal: false,
    actual_attempt: true,
    terminal: row.terminal,
    in_call_log: row.call_log_state !== null,
    initiator: { agent_id: null, identity: "none" },
    handler,
    association: evidenceAssociation(association),
  });
  return finish({
    ...base,
    subject_id: subjectIdOf(association),
    direction: "inbound",
    event_at: eventAt,
    business_date: newYorkBusinessDay(eventAt),
    actor_agent_id: classified.actor_agent_id,
    goal_agent_id: null,
    kind: classified.kind,
    verification: classified.verification,
    exclusion_reason: classified.exclusion_reason,
    restricted_at_contact: restrictedAt(numbers, "call", eventAt, context),
    association: association.state,
    subject_workflow: association.workflow,
    outcome: !confirmed ? "unknown" : answered ? "answered" : "unanswered",
    goal_credit: "none",
    goal_scope_eligible: false,
    originating_inbound:
      classified.kind === "inbound_answered" &&
      classified.verification === "confirmed" &&
      association.subject !== null &&
      association.subject.originating_session_id !== null &&
      row.telephony_session_id === association.subject.originating_session_id,
  });
}

/** One rep-mailbox SMS evidence row → its contact-event row (P07d/P07e/P07g; never goal credit). */
export function deriveSmsContactEvent(row: SmsSourceRow, context: DerivationContext): ContactEventDraft {
  const eventAt = row.direction === "outbound" ? (row.send_at ?? row.provider_created_at) : row.provider_created_at;
  const numbers = [...new Set(row.counterpart_numbers.map((n) => context.numbers_by_e164?.get(n)).filter((id): id is string => Boolean(id)))];
  const association: Association = row.is_group
    ? AMBIGUOUS
    : numbers.length === 0
      ? NO_ASSOCIATION
      : associate(numbers, eventAt, context);
  const restricted = restrictedAt(numbers, "text", eventAt, context);
  const base = {
    source_kind: "sms" as const,
    source_id: row.id,
    channel: "sms" as const,
    direction: row.direction,
    event_at: eventAt,
    business_date: newYorkBusinessDay(eventAt),
    goal_agent_id: null,
    restricted_at_contact: restricted,
    association: association.state,
    subject_workflow: association.workflow,
    outcome: "unknown" as const,
    goal_credit: "none" as const,
    goal_scope_eligible: false,
    originating_inbound: false,
    source_revision: row.source_revision,
  };
  if (row.duplicate_copy) {
    return finish({ ...base, subject_id: null, actor_agent_id: null, kind: "other", verification: "excluded", exclusion_reason: "duplicate_copy" });
  }
  const status = engineSmsStatus(row.status);
  const reviewed = row.identity_state === "reviewed" && row.reviewed_agent_id !== null;
  const classified = classifySmsEvidence({
    direction: row.direction,
    status: status ?? "pending",
    // Rep-mailbox evidence is the rep's own message (automation and confirmations are `lead_messages`);
    // an unproven sender keeps the origin unknown (P07e pending identity).
    origin: reviewed ? "rep_deliberate" : "unknown",
    sender: { agent_id: reviewed ? row.reviewed_agent_id : null, identity: reviewed ? "reviewed" : "unreviewed" },
    association: evidenceAssociation(association),
  });
  return finish({
    ...base,
    subject_id: subjectIdOf(association),
    actor_agent_id: classified.actor_agent_id,
    kind: classified.kind,
    verification: classified.verification,
    exclusion_reason: classified.exclusion_reason,
  });
}

/** A stored/derived contact event as the S2 engine reads it (`outreach_evaluate` input). */
export function toEngineContactEvent(
  event: Pick<
    ContactEventDraft,
    "source_kind" | "source_id" | "channel" | "direction" | "event_at" | "kind" | "verification" | "exclusion_reason" | "actor_agent_id" | "goal_agent_id" | "outcome" | "restricted_at_contact"
  >,
): EngineContactEvent {
  return {
    event_id: `${event.source_kind}:${event.source_id}`,
    source_kind: event.source_kind,
    source_id: event.source_id,
    channel: event.channel,
    direction: event.direction,
    event_at: event.event_at.toISOString(),
    kind: event.kind,
    verification: event.verification,
    exclusion_reason: event.exclusion_reason,
    actor_agent_id: event.actor_agent_id,
    goal_agent_id: event.goal_agent_id,
    outcome: event.outcome,
    restricted_at_contact: event.restricted_at_contact,
  };
}
