import { createHash } from "node:crypto";
import type { ClientSession } from "mongoose";
import { leadPhoneE164 } from "../../numberActivity/leadContactNumber";
import { CsiError } from "../../salesIntelligence/auth";
import type { ActiveConfiguration } from "../config/load";
import { newYorkBusinessDay, newYorkDayBounds } from "../reads/businessDay";
import { evaluateDeskEligibility, type DeskEligibility } from "./eligibility";
import { deskLeadKey, type DeskLeadFacts } from "./leadFacts";
import { planPeriodTransition, type PeriodPlan } from "./periodPlanner";
import { deskDecisionFingerprint, resolveDeskPolicy, type DeskPolicyDecision } from "./policyMapping";
import type { ContactWakeRequest, DeskEnrollment, DeskSubjectRow, DeskSubjectStore, ReadSession, SubjectUpdate } from "./store";
import {
  ADMISSION_HOLD_REASONS,
  buildSubjectFacts,
  desiredPeriodOf,
  isReliableReceived,
  receivedFactsOf,
  subjectStatusOf,
  type DesiredPeriod,
  type DeskSubjectFacts,
} from "./subjectBuilder";

/** Per-page context the subject builder needs, loaded once for up to 100 Leads. */
export type DeskSubjectPageContext = Readonly<{
  as_of: Date;
  reviewed_rep_ids: ReadonlySet<string>;
  numbers_by_lead: ReadonlyMap<string, readonly string[]>;
  uncertain_leads: ReadonlySet<string>;
  job_number_counts: ReadonlyMap<string, number>;
}>;

export async function loadSubjectPageContext(
  store: DeskSubjectStore,
  facts: readonly DeskLeadFacts[],
  asOf: Date,
  session: ReadSession,
): Promise<DeskSubjectPageContext> {
  const refs = facts.map((f) => f.ref);
  // Sequential: the session may be inside a transaction, and a session runs one operation at a time.
  const reviewed = await store.reviewedRepIds(facts.flatMap((f) => (f.receiver_agent_id ? [f.receiver_agent_id] : [])), asOf, session);
  const numbers = await store.linkedNumberIds(refs, session);
  const uncertain = await store.priorityUncertainLeads(facts, session);
  const jobCounts = await store.jobNumberLeadCounts(facts.flatMap((f) => (f.normalized_job_no && !f.duplicate ? [f.normalized_job_no] : [])), session);
  return { as_of: asOf, reviewed_rep_ids: reviewed, numbers_by_lead: numbers, uncertain_leads: uncertain, job_number_counts: jobCounts };
}

/** Another non-duplicate Lead carries the same Job Number: the opportunity's identity is ambiguous. */
export const hasAmbiguousIdentity = (facts: DeskLeadFacts, context: Pick<DeskSubjectPageContext, "job_number_counts">) =>
  Boolean(facts.normalized_job_no && !facts.duplicate && (context.job_number_counts.get(facts.normalized_job_no) ?? 0) > 1);

export type SubjectSyncOutcome = Readonly<{
  outcome: "created" | "updated" | "unchanged";
  subject_id: string;
  subject_revision: number;
  status: DeskSubjectRow["status"];
  period: PeriodPlan["action"];
  period_reason: string | null;
  /** `outreach_contact_change` jobs this sync nominated (olr C4 re-derive wake; 0 when none). */
  contact_wakes: number;
}>;

/** olr C4 engineering bounds: how far back one subject change re-derives. */
export const SUBJECT_WAKE_LOOKBACK_MS = 14 * 24 * 60 * 60_000;
/** Newest calls, and separately newest SMS, one subject change nominates (intake, period change). */
export const SUBJECT_WAKE_SOURCES_PER_KIND = 50;
/** A cohort enrollment's window is the batch duration, so it nominates fewer (LANE-C §C4 risks). */
export const ENROLLMENT_WAKE_SOURCES_PER_KIND = 10;

export type ContactWake = Omit<ContactWakeRequest, "lead" | "now">;

/**
 * olr C4: the re-derive wake a subject change needs (LANE-C §C4). Derivation reads the subject, its
 * activation boundary and its periods when a source is derived, so a call derived before the change
 * keeps the old context until something re-derives it:
 * - (i) a subject created after its first calls (intake admits about a minute after the Lead arrives;
 *   an enrollment activates at the apply moment): its numbers' calls and SMS since the start of the
 *   activation boundary's New York date. Those at or after the boundary now associate and credit; the
 *   earlier same-date ones carry the subject id so the activation date's partial quota subtracts them
 *   (P05f/P10a, `contacts/derive.ts` `same_date_prior`). Earlier dates derive nothing for the subject,
 *   so an older Lead's history is not woken.
 * - (iv) a period opened, or a transition/closure, whose effective instant is in the past: the calls and
 *   SMS since that instant take the new workflow (`subject_workflow`, `goal_scope_eligible`, closure).
 * Never earlier than `SUBJECT_WAKE_LOOKBACK_MS` before now. Identity-link and restriction changes take
 * effect at `now` (prospective), so they need no wake. Pure; null = nothing to re-derive.
 */
export function contactWakeOf(
  input: Readonly<{
    outcome: SubjectSyncOutcome["outcome"];
    subject_id: string;
    enrollment: DeskEnrollment;
    plan: PeriodPlan;
    as_of: Date;
  }>,
): ContactWake | null {
  const floor = +input.as_of - SUBJECT_WAKE_LOOKBACK_MS;
  let wake: ContactWake | null = null;
  if (input.outcome === "created") {
    const activationDate = newYorkDayBounds(newYorkBusinessDay(input.enrollment.activation_at)).start;
    wake = {
      since: new Date(Math.max(+activationDate, floor)),
      source_revision: `admit:${input.subject_id}`,
      limit_per_kind: input.enrollment.kind === "intake" ? SUBJECT_WAKE_SOURCES_PER_KIND : ENROLLMENT_WAKE_SOURCES_PER_KIND,
    };
  } else if (input.plan.action !== "none") {
    // Transition keys repeat across subjects (`intake_default:website_form`): the subject scopes them.
    const key = createHash("sha256").update(input.plan.period.transition_key).digest("hex").slice(0, 16);
    wake = {
      since: new Date(Math.max(+input.plan.period.started_at, floor)),
      source_revision: `period:${input.subject_id}:${key}`,
      limit_per_kind: SUBJECT_WAKE_SOURCES_PER_KIND,
    };
  }
  // A boundary at or after now has no derived source behind it.
  return wake && +wake.since < +input.as_of ? wake : null;
}

/** The desk wants contact evidence (the capture wake's and the S3 job admission's rule). */
const wantsContactEvidence = (configuration: ActiveConfiguration) =>
  configuration.value.controls.desk_enabled || configuration.value.controls.goal_metrics_enabled;

/**
 * Brings one desk subject in line with its Lead's current facts, in the caller's transaction
 * (IMPLEMENTATION-PLAN §6.2 `outreach_lead_change`, enrollment apply, intake):
 * - subject facts from the Lead (received time via `leadInstant`, display, priority, IMPL-01
 *   assignment, IMPL-07 linked numbers);
 * - P05h eligibility and the P05d/P05e policy decision, from the persisted configuration only;
 * - the policy-period plan: close + open in this same session (one transaction), a repeated accepted
 *   priority or a replayed transition is a no-op, a closure is final; a first period opened on a later
 *   sync (a review subject decided afterwards) is a late `activation` start (olr B1);
 * - olr B2: the decision fingerprint (priority map + intake defaults) is stamped on the subject; a
 *   re-decision caused by a configuration change starts at the configuration time, never earlier
 *   (`configurationDrivenDesired`); a stamp-only change is bookkeeping;
 * - CAS on the subject revision, and an `outreach_evaluate` nomination for every new revision;
 * - olr C4: a created subject, or a past-effective period change, nominates `outreach_contact_change`
 *   for the calls and SMS it re-contextualizes (`contactWakeOf`), in this same transaction;
 * - olr C2c: with `cadence.no_contact_number_rule: review_no_cadence`, a subject with no linked number
 *   whose Lead's live phone forms no E.164 is `review` (`no_contact_number`); a link arriving later
 *   (`capture/leadLinkWake.ts` nominates this sync) or a phone edit clears it.
 * - olr B8: a subject with no period yet whose identity is ambiguous or whose received time is missing
 *   or unreliable is held (`admissionHoldOf`): `review`, no period planned; the sync that finds the hold
 *   cleared opens a late first period at its own instant (`desk_decision_at`, olr B1).
 * Identical inputs write nothing (no revision bump solely to touch the row).
 */
export async function syncSubject(
  input: Readonly<{
    facts: DeskLeadFacts;
    subject: DeskSubjectRow | null;
    /** Required when `subject` is null: how the new subject enters the desk. */
    enrollment?: DeskEnrollment;
    configuration: ActiveConfiguration;
    context: DeskSubjectPageContext;
  }>,
  store: DeskSubjectStore,
  session: ClientSession,
): Promise<SubjectSyncOutcome> {
  const { facts, subject, configuration, context } = input;
  const enrollment = subject?.enrollment ?? input.enrollment;
  if (!enrollment) throw new CsiError("INVALID_INPUT", [{ path: "enrollment", code: "required_for_new_subject" }]);
  const eligibility = evaluateDeskEligibility({ kind: "lead", facts });
  const decision = resolveDeskPolicy(facts, configuration.value.cadence);
  const fingerprint = deskDecisionFingerprint(configuration.value.cadence);
  const built = buildSubjectFacts(facts, decision, {
    as_of: context.as_of,
    decision_fingerprint: fingerprint,
    reviewed_rep_ids: context.reviewed_rep_ids,
    contact_number_ids: context.numbers_by_lead.get(deskLeadKey(facts.ref)) ?? [],
    priority_uncertain: context.uncertain_leads.has(deskLeadKey(facts.ref)),
  });
  const periods = subject ? await store.findPeriods(subject.id, session) : [];
  const active = periods.find((p) => p.ended_at === null) ?? null;
  const hold = admissionHoldOf({ facts, context, eligibility, received: built, has_periods: periods.length > 0 });
  const plan = planPeriodTransition({
    active,
    desired: hold.held ? null : configurationDrivenDesired(desiredPeriodOf(facts, eligibility, decision, context.as_of), {
      stored_fingerprint: subject?.decision_fingerprint ?? null,
      fingerprint,
      eligibility,
      configuration,
      as_of: context.as_of,
    }),
    recorded_keys: new Set(periods.map((p) => p.transition_key)),
    first_start: {
      kind: enrollment.kind === "intake" ? "intake" : "activation",
      boundary: enrollment.activation_at,
      at_enrollment: subject === null,
      as_of: context.as_of,
      held_before: (subject?.review_reasons ?? []).some((reason) => ADMISSION_HOLD_REASONS.has(reason)),
    },
  });
  const activeWorkflowAfter = plan.action === "none" ? (active?.workflow ?? null) : plan.period.workflow;
  const { status, review_reasons } = subjectStatusOf({
    eligibility,
    decision,
    received: built,
    active_workflow: activeWorkflowAfter,
    current_status: subject?.status ?? null,
    hold_reasons: hold.reasons,
    contact: {
      number_ids: built.contact_number_ids,
      // The mint's own phone rule (olr C2c review fix, CW1): live, a Call Lead's original caller, then the intake and Granot snapshots.
      phone_e164: leadPhoneE164(facts.ref.model, { normalized_phone_number: facts.normalized_phone, original_caller_phone: facts.original_caller_phone,
        ingested_phone: facts.ingested_phone, granot_phone: facts.granot_phone }),
      rule: configuration.value.cadence.no_contact_number_rule,
    },
  });

  let subjectId: string;
  let revision: number;
  let outcome: SubjectSyncOutcome["outcome"];
  /** Only the seen Lead revision moved: record it (reconcile bookkeeping) without waking the evaluator. */
  let bookkeepingOnly = false;
  if (!subject) {
    subjectId = await store.insertSubject(
      { ...built, lead: facts.ref, enrollment, status, review_reasons, assignment_revision: built.assigned_agent_id ? 1 : 0 },
      session,
    );
    revision = 1;
    outcome = "created";
  } else {
    const update = changedFields(subject, built, status, review_reasons);
    if (!Object.keys(update).length && plan.action === "none")
      return { outcome: "unchanged", subject_id: subject.id, subject_revision: subject.revision, status, period: "none", period_reason: plan.reason, contact_wakes: 0 };
    if (!(await store.updateSubject(subject.id, subject.revision, update, session))) throw new CsiError("REVISION_CONFLICT");
    subjectId = subject.id;
    revision = subject.revision + 1;
    outcome = "updated";
    bookkeepingOnly = plan.action === "none" && Object.keys(update).every((key) => BOOKKEEPING_FIELDS.has(key));
  }
  if (plan.action === "close_and_open" && !(await store.closePeriod(plan.close.id, plan.close.ended_at, plan.close.end_reason, session)))
    throw new CsiError("REVISION_CONFLICT");
  if (plan.action !== "none")
    await store.insertPeriod(
      subjectId,
      plan.period,
      { policy_version: configuration.version, activation_boundary: enrollment.activation_at, received: receivedFactsOf(facts, context.as_of) },
      session,
    );
  if (!bookkeepingOnly) await store.requestEvaluation(subjectId, revision, session);
  // `insertPeriod` already ran in this session, so the re-derive reads the new period.
  const wake = contactWakeOf({ outcome, subject_id: subjectId, enrollment, plan, as_of: context.as_of });
  const contactWakes = wake && wantsContactEvidence(configuration)
    ? await store.nominateContactSources({ ...wake, lead: facts.ref, now: context.as_of }, session)
    : 0;
  return {
    outcome,
    subject_id: subjectId,
    subject_revision: revision,
    status,
    period: plan.action,
    period_reason: plan.action === "none" ? plan.reason : null,
    contact_wakes: contactWakes,
  };
}

/** olr B8 hold reason for an ambiguous Job Number (another non-duplicate Lead carries it, P05h). */
export const AMBIGUOUS_IDENTITY_REASON = "ambiguous_identity";

export type AdmissionHold = Readonly<{ held: boolean; reasons: string[] }>;

/**
 * olr B8 admission hold (LANE-B §B8). A subject that has no period yet is held — `review`, no period
 * planned, so nothing is owed — while its identity is ambiguous (`hasAmbiguousIdentity`) or its
 * received time is missing or unreliable (P05h/MANUAL-START "ambiguous identity → review", P10a
 * "missing/unreliable age goes to review"). Intake admits such a fresh Lead as a visible held subject
 * instead of refusing it silently. The hold clears on the sync that finds both facts sound: the Lead's
 * own change (timestamp fixed), or, for ambiguity that another Lead's change clears (its `duplicate`
 * flag), the reconcile's 15-minute hold re-check (`subjects/feed.ts` `holdJobInput`). That sync opens a
 * late first period at its instant (`desk_decision_at`, olr B1: no retroactive day, no initial response).
 *
 * Not held: a subject with any period (an active subject whose Job Number becomes shared later is
 * untouched), and a closure (official booking/cancellation, Bad Lead), which owes nothing and is final.
 * `reasons` lists only `ambiguous_identity`; the received reasons are already the subject's review
 * reasons (`subjectStatusOf`). Pure.
 */
export function admissionHoldOf(
  input: Readonly<{
    facts: DeskLeadFacts;
    context: Pick<DeskSubjectPageContext, "job_number_counts">;
    eligibility: DeskEligibility;
    received: Parameters<typeof isReliableReceived>[0];
    has_periods: boolean;
  }>,
): AdmissionHold {
  if (input.has_periods || input.eligibility.outcome === "closed") return { held: false, reasons: [] };
  const ambiguous = hasAmbiguousIdentity(input.facts, input.context);
  const held = ambiguous || !isReliableReceived(input.received);
  return { held, reasons: held && ambiguous ? [AMBIGUOUS_IDENTITY_REASON] : [] };
}

/**
 * Subject fields whose change alone is bookkeeping (no requirement can move): the seen Lead revision
 * (reconcile) and the decision fingerprint stamp (olr B2 re-decision that changed nothing).
 */
const BOOKKEEPING_FIELDS: ReadonlySet<string> = new Set(["lead_revision_seen", "decision_fingerprint"]);

/**
 * olr B2 prospective effect (SPECIFICATION §12 "Policy version activated | Apply prospectively … never
 * silently reprice historical requirements"). When the subject was last decided under another
 * decision fingerprint (priority map / intake defaults), the configuration change is what re-decides
 * it, so a period it opens never starts before the configuration became active (`updated_at` of the
 * active pointer, at most the sync instant): `effective_at = max(fact time, configuration time)` with
 * `time_basis: configuration_activated_at`. The transition key then carries the configuration revision
 * (`…:c<revision>`), so a later flip back (A→B→A, e.g. a rollback PATCH) is a new transition rather
 * than a replay of the first period's key.
 * - A null stored fingerprint (written before B2) is "same": no adjustment; the sync stamps it.
 * - A closure fact (official booking/cancellation, bad Lead) is not decided by the map: unchanged.
 * - A fact newer than the configuration keeps its own time and key.
 * Pure.
 */
export function configurationDrivenDesired(
  desired: DesiredPeriod | null,
  input: Readonly<{
    stored_fingerprint: string | null;
    fingerprint: string;
    eligibility: DeskEligibility;
    configuration: Pick<ActiveConfiguration, "revision" | "updated_at">;
    as_of: Date;
  }>,
): DesiredPeriod | null {
  if (!desired || input.stored_fingerprint === null || input.stored_fingerprint === input.fingerprint) return desired;
  if (input.eligibility.outcome === "closed") return desired;
  const activatedAt = new Date(Math.min(+(input.configuration.updated_at ?? input.as_of), +input.as_of));
  if (+activatedAt <= +desired.effective_at) return desired;
  return {
    ...desired,
    effective_at: activatedAt,
    time_basis: "configuration_activated_at",
    transition_key: `${desired.transition_key}:c${input.configuration.revision}`,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function changedFields(subject: DeskSubjectRow, built: DeskSubjectFacts, status: DeskSubjectRow["status"], reviewReasons: string[]): SubjectUpdate {
  const update: Record<string, unknown> = {};
  const next: Record<string, unknown> = { ...built, status, review_reasons: reviewReasons };
  const current = subject as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) if (!same(current[key], value)) update[key] = value;
  if ("assigned_agent_id" in update) update.assignment_revision = subject.assignment_revision + 1;
  return update as SubjectUpdate;
}

/**
 * P05e/MANUAL-START automatic intake gate (`outreach_intake`, inside `outreach_lead_change`). A Lead is
 * admitted once, as `kind: intake`, only when the Owner's persisted gate is on and the Lead is genuinely
 * fresh: created after `intake_admission_at` AND received (through `leadInstant`) at or after it, from a
 * non-legacy source. Late-created historical records stay on the enrollment/review path. Ineligible or
 * closed Leads are not admitted; a fresh Lead whose priority needs review is admitted as a visible
 * `review` subject with no guessed cadence. olr B8: a fresh Lead whose received time is missing or
 * unreliable, or whose Job Number is ambiguous, is admitted held (`admissionHoldOf`), not refused.
 * Every refusal is the job's stored result, read by `GET /enrollment/admissions`.
 */
export type IntakeAdmission =
  | Readonly<{ admit: true; enrollment: DeskEnrollment }>
  | Readonly<{ admit: false; reason: string }>;

const HISTORICAL_ORIGINS = new Set(["legacy_import", "legacy_unknown"]);

export function intakeAdmissionOf(
  facts: DeskLeadFacts,
  configuration: ActiveConfiguration,
  asOf: Date,
  eligibility: DeskEligibility = evaluateDeskEligibility({ kind: "lead", facts }),
  decision: DeskPolicyDecision = resolveDeskPolicy(facts, configuration.value.cadence),
): IntakeAdmission {
  const { transition } = configuration.value;
  if (!transition.intake_admission_enabled || !transition.intake_admission_at) return { admit: false, reason: "intake_disabled" };
  const gate = new Date(transition.intake_admission_at);
  if (!facts.created_at || +facts.created_at <= +gate) return { admit: false, reason: "created_before_intake" };
  if (HISTORICAL_ORIGINS.has(facts.ingestion_origin ?? "")) return { admit: false, reason: "historical_import" };
  const received = receivedFactsOf(facts, asOf);
  // olr B8: a missing or unreliable received time no longer refuses. The Lead was created after the gate,
  // so it is fresh; `received_before_intake` cannot be checked. It is admitted held (`admissionHoldOf`:
  // review, no period) with its boundary at its creation, never at a guessed arrival.
  const reliable = isReliableReceived(received) && received.received_at !== null;
  if (reliable && +received.received_at! < +gate) return { admit: false, reason: "received_before_intake" };
  if (eligibility.outcome !== "eligible") return { admit: false, reason: `${eligibility.outcome}:${eligibility.reason}` };
  if (decision.kind === "unavailable") return { admit: false, reason: "policy_unavailable" };
  if (decision.kind === "accepted" && decision.workflow === "closed") return { admit: false, reason: "closed_priority" };
  // No approved default for the source (no recorded origin, or an origin the model never writes).
  if (decision.kind === "review" && decision.reason === "unsupported_intake_source") return { admit: false, reason: "unsupported_intake_source" };
  return {
    admit: true,
    enrollment: {
      cohort_id: `intake:${gate.toISOString()}`,
      kind: "intake",
      enrolled_at: asOf,
      activation_at: reliable ? received.received_at! : new Date(Math.max(+gate, +facts.created_at)),
      manifest_hash: null,
    },
  };
}
