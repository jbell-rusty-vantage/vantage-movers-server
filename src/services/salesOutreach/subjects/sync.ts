import type { ClientSession } from "mongoose";
import { CsiError } from "../../salesIntelligence/auth";
import type { ActiveConfiguration } from "../config/load";
import { evaluateDeskEligibility, type DeskEligibility } from "./eligibility";
import { deskLeadKey, type DeskLeadFacts } from "./leadFacts";
import { planPeriodTransition, type PeriodPlan } from "./periodPlanner";
import { resolveDeskPolicy, type DeskPolicyDecision } from "./policyMapping";
import type { DeskEnrollment, DeskSubjectRow, DeskSubjectStore, ReadSession, SubjectUpdate } from "./store";
import {
  buildSubjectFacts,
  desiredPeriodOf,
  isReliableReceived,
  receivedFactsOf,
  subjectStatusOf,
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
  const [reviewed, numbers, uncertain, jobCounts] = await Promise.all([
    store.reviewedRepIds(facts.flatMap((f) => (f.receiver_agent_id ? [f.receiver_agent_id] : [])), asOf, session),
    store.attachedNumberIds(refs, session),
    store.priorityUncertainLeads(facts, session),
    store.jobNumberLeadCounts(facts.flatMap((f) => (f.normalized_job_no && !f.duplicate ? [f.normalized_job_no] : [])), session),
  ]);
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
}>;

/**
 * Brings one desk subject in line with its Lead's current facts, in the caller's transaction
 * (IMPLEMENTATION-PLAN §6.2 `outreach_lead_change`, enrollment apply, intake):
 * - subject facts from the Lead (received time via `leadInstant`, display, priority, IMPL-01
 *   assignment, IMPL-07 attached numbers);
 * - P05h eligibility and the P05d/P05e policy decision, from the persisted configuration only;
 * - the policy-period plan: close + open in this same session (one transaction), a repeated accepted
 *   priority or a replayed transition is a no-op, a closure is final;
 * - CAS on the subject revision, and an `outreach_evaluate` nomination for every new revision.
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
  const built = buildSubjectFacts(facts, decision, {
    as_of: context.as_of,
    reviewed_rep_ids: context.reviewed_rep_ids,
    contact_number_ids: context.numbers_by_lead.get(deskLeadKey(facts.ref)) ?? [],
    priority_uncertain: context.uncertain_leads.has(deskLeadKey(facts.ref)),
  });
  const periods = subject ? await store.findPeriods(subject.id, session) : [];
  const active = periods.find((p) => p.ended_at === null) ?? null;
  const plan = planPeriodTransition({
    active,
    desired: desiredPeriodOf(facts, eligibility, decision, context.as_of),
    recorded_keys: new Set(periods.map((p) => p.transition_key)),
    first_start: { kind: enrollment.kind === "intake" ? "intake" : "activation", boundary: enrollment.activation_at, has_prior_periods: periods.length > 0 },
  });
  const activeWorkflowAfter = plan.action === "none" ? (active?.workflow ?? null) : plan.period.workflow;
  const { status, review_reasons } = subjectStatusOf({
    eligibility,
    decision,
    received: built,
    active_workflow: activeWorkflowAfter,
    current_status: subject?.status ?? null,
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
      return { outcome: "unchanged", subject_id: subject.id, subject_revision: subject.revision, status, period: "none", period_reason: plan.reason };
    if (!(await store.updateSubject(subject.id, subject.revision, update, session))) throw new CsiError("REVISION_CONFLICT");
    subjectId = subject.id;
    revision = subject.revision + 1;
    outcome = "updated";
    bookkeepingOnly = plan.action === "none" && Object.keys(update).every((key) => key === "lead_revision_seen");
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
  return { outcome, subject_id: subjectId, subject_revision: revision, status, period: plan.action, period_reason: plan.action === "none" ? plan.reason : null };
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
 * non-legacy source. Late-created historical records stay on the enrollment/review path. Ineligible,
 * closed or unverifiable Leads are not admitted; a fresh Lead whose priority needs review is admitted as
 * a visible `review` subject with no guessed cadence.
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
  if (!isReliableReceived(received) || !received.received_at) return { admit: false, reason: "received_time_unreliable" };
  if (+received.received_at < +gate) return { admit: false, reason: "received_before_intake" };
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
      activation_at: received.received_at,
      manifest_hash: null,
    },
  };
}
