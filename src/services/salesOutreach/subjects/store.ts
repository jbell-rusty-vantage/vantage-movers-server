import mongoose, { type ClientSession } from "mongoose";
import type {
  SalesOutreachLeadModel,
  SalesOutreachPeriodStartKind,
  SalesOutreachWorkflow,
} from "../../../config/domain/salesOutreach";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getCallLeadModel } from "../../../models/CallLead";
import { getFormLeadModel } from "../../../models/FormLead";
import { getGranotObservationModel } from "../../../models/GranotObservation";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesOutreachPolicyPeriodModel, getSalesOutreachSubjectModel } from "../../../models/salesOutreach";
import { getRingCentralRepSmsEvidenceModel } from "../../../models/salesOutreach/repSmsEvidence";
import { enqueueCsiJob } from "../../salesIntelligence/jobs";
import { enqueueOutreachContactChangeJobs, type ContactChangeSource } from "../capture/contactChangeWake";
import { DESK_LEAD_PROJECTION, deskLeadKey, toDeskLeadFacts, type DeskLeadFacts, type DeskLeadRef } from "./leadFacts";
import type { NewPeriod } from "./periodPlanner";
import type { DeskReceivedFacts, DeskSubjectFacts } from "./subjectBuilder";

/** How a subject entered the desk (`sales_outreach_subjects.enrollment`). */
export type DeskEnrollment = Readonly<{
  cohort_id: string;
  kind: "pilot" | "intake" | "expansion";
  enrolled_at: Date;
  /** Fixed boundary: nothing is due before it (P10a cohort activation / intake admission). */
  activation_at: Date;
  manifest_hash: string | null;
}>;

/** Reads run inside the caller's transaction, or with no session for read-only reports. */
export type ReadSession = ClientSession | null;

export type DeskSubjectStatus = "active" | "closed" | "review";

export type DeskSubjectRow = DeskSubjectFacts &
  Readonly<{
    id: string;
    lead: DeskLeadRef;
    enrollment: DeskEnrollment;
    status: DeskSubjectStatus;
    review_reasons: string[];
    assignment_revision: number;
    revision: number;
  }>;

export type DeskPeriodRow = Readonly<{
  id: string;
  subject_id: string;
  transition_key: string;
  workflow: SalesOutreachWorkflow;
  start_kind: SalesOutreachPeriodStartKind;
  priority: string | null;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
}>;

export type NewSubject = Omit<DeskSubjectRow, "id" | "revision">;
export type SubjectUpdate = Partial<Omit<DeskSubjectRow, "id" | "lead" | "enrollment" | "revision">>;
/** Period provenance written with every new period (age anchor through the restored adapter). */
export type PeriodProvenance = Readonly<{
  policy_version: string;
  activation_boundary: Date;
  received: DeskReceivedFacts;
}>;

/**
 * olr C4 re-derive wake: `outreach_contact_change` for the newest calls and SMS (each up to
 * `limit_per_kind`) of the Contact Numbers whose `lead` is this Lead (only those credit it), at or
 * after `since` (and before `until` when given). `source_revision` makes the dedupe key
 * (`sod:contact_change:<kind>:<id>:<revision>`), so a replayed change enqueues nothing new.
 */
export type ContactWakeRequest = Readonly<{
  lead: DeskLeadRef;
  since: Date;
  /**
   * olr BW1: optional exclusive upper bound (the B1 repair re-derives only the window its moved period
   * start uncovered; contacts at or after the new start keep the same period and workflow).
   * Absent = no bound (C4 wakes).
   */
  until?: Date | null;
  source_revision: string;
  limit_per_kind: number;
  now: Date;
}>;

/** Bound on the numbers one Lead's wake reads (a Lead has a handful). */
export const CONTACT_WAKE_MAX_NUMBERS = 50;

/**
 * Every read and write the subject services need. All methods run inside the caller's transaction
 * session; reads are bounded by the caller's page (≤ 100 Leads) and use declared indexes.
 * The Mongo implementation is proven on the replica (`ops/sales-outreach/subjects.replica.ts`); unit
 * tests use `MemoryDeskSubjectStore` (`testing.ts`).
 */
export type DeskSubjectStore = {
  loadLeads(refs: readonly DeskLeadRef[], session: ReadSession): Promise<DeskLeadFacts[]>;
  findSubjects(refs: readonly DeskLeadRef[], session: ReadSession): Promise<DeskSubjectRow[]>;
  findPeriods(subjectId: string, session: ReadSession): Promise<DeskPeriodRow[]>;
  /** Agents (of `agentIds`) with a reviewed `sales_rep` identity link effective at `at`. */
  reviewedRepIds(agentIds: readonly string[], at: Date, session: ReadSession): Promise<Set<string>>;
  /** Lead key → Contact Number ids whose `lead` or `other_leads` hold the Lead (All Numbers, IMPL-07). */
  linkedNumberIds(refs: readonly DeskLeadRef[], session: ReadSession): Promise<Map<string, string[]>>;
  /** Normalized Job Number → how many non-duplicate Form/Call Leads carry it. */
  jobNumberLeadCounts(jobNumbers: readonly string[], session: ReadSession): Promise<Map<string, number>>;
  /** Lead keys with a blank/malformed Granot priority update newer than their last accepted one (P05e). */
  priorityUncertainLeads(facts: readonly DeskLeadFacts[], session: ReadSession): Promise<Set<string>>;
  insertSubject(subject: NewSubject, session: ClientSession): Promise<string>;
  /** CAS on `revision`; false when another writer moved it first. */
  updateSubject(id: string, expectedRevision: number, update: SubjectUpdate, session: ClientSession): Promise<boolean>;
  /** Ends the active period `id`; false when it is no longer the active one. */
  closePeriod(id: string, endedAt: Date, endReason: string, session: ClientSession): Promise<boolean>;
  insertPeriod(subjectId: string, period: NewPeriod, provenance: PeriodProvenance, session: ClientSession): Promise<string>;
  /** Nominates the subject's `outreach_evaluate` job for this subject revision (consumer: evaluator wiring). */
  requestEvaluation(subjectId: string, subjectRevision: number, session: ClientSession): Promise<void>;
  /** olr C4: nominates the re-derive of the Lead's credited calls and SMS; returns the jobs enqueued (new or deduplicated). */
  nominateContactSources(request: ContactWakeRequest, session: ClientSession): Promise<number>;
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);
/** The wake's time range on one instant field: `[since, until)`, or `[since, ∞)` without `until`. */
const windowOf = (request: ContactWakeRequest) => (request.until ? { $gte: request.since, $lt: request.until } : { $gte: request.since });
const leadModel = (model: SalesOutreachLeadModel) => (model === "FormLead" ? getFormLeadModel() : getCallLeadModel());
const MAX_OBSERVATIONS = 500;

export type SubjectLean = Record<string, unknown> & {
  _id: unknown;
  lead_model: SalesOutreachLeadModel;
  lead_id: unknown;
  enrollment: Record<string, unknown>;
  display: Record<string, unknown>;
  priority: Record<string, unknown>;
};

export function toSubjectRow(row: SubjectLean): DeskSubjectRow {
  const enrollment = row.enrollment as { cohort_id: string; kind: DeskEnrollment["kind"]; enrolled_at: Date; activation_at: Date; manifest_hash: string | null };
  const priority = row.priority as { raw: string | null; accepted_at: Date | null; observation_id: unknown; basis: DeskSubjectRow["priority"]["basis"]; uncertain?: boolean };
  return {
    id: String(row._id),
    lead: { model: row.lead_model, id: String(row.lead_id) },
    enrollment: { ...enrollment, manifest_hash: enrollment.manifest_hash ?? null },
    status: row.status as DeskSubjectStatus,
    review_reasons: [...((row.review_reasons as string[]) ?? [])],
    received_at: (row.received_at as Date | null) ?? null,
    received_date: (row.received_date as string | null) ?? null,
    received_quality: row.received_quality as DeskSubjectRow["received_quality"],
    adapter_version: row.adapter_version as DeskSubjectRow["adapter_version"],
    display: row.display as unknown as DeskSubjectRow["display"],
    priority: {
      raw: priority.raw ?? null,
      accepted_at: priority.accepted_at ?? null,
      observation_id: priority.observation_id ? String(priority.observation_id) : null,
      basis: priority.basis,
      uncertain: priority.uncertain === true,
    },
    assigned_agent_id: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
    assignment_revision: Number(row.assignment_revision ?? 0),
    lead_revision_seen: Number(row.lead_revision_seen ?? 0),
    decision_fingerprint: typeof row.decision_fingerprint === "string" ? row.decision_fingerprint : null,
    contact_number_ids: ((row.contact_number_ids as unknown[]) ?? []).map(String),
    revision: Number(row.revision ?? 1),
  };
}

/** Subject fields as stored (ObjectId references; priority observation id). */
function toStored(update: SubjectUpdate): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...update };
  if ("assigned_agent_id" in update) stored.assigned_agent_id = update.assigned_agent_id ? oid(update.assigned_agent_id) : null;
  if (update.contact_number_ids) stored.contact_number_ids = update.contact_number_ids.map(oid);
  if (update.priority)
    stored.priority = { ...update.priority, observation_id: update.priority.observation_id ? oid(update.priority.observation_id) : null };
  return stored;
}

export const mongoDeskSubjectStore: DeskSubjectStore = {
  async loadLeads(refs, session) {
    const facts: DeskLeadFacts[] = [];
    for (const model of ["FormLead", "CallLead"] as const) {
      const ids = refs.filter((ref) => ref.model === model).map((ref) => oid(ref.id));
      if (!ids.length) continue;
      const rows = await (leadModel(model) as mongoose.Model<unknown>)
        .find({ _id: { $in: ids } }, DESK_LEAD_PROJECTION)
        .session(session)
        .lean();
      for (const row of rows as Array<Record<string, unknown> & { _id: unknown }>) facts.push(toDeskLeadFacts(model, row));
    }
    return facts;
  },

  async findSubjects(refs, session) {
    if (!refs.length) return [];
    const rows = await getSalesOutreachSubjectModel()
      .find({ $or: refs.map((ref) => ({ lead_model: ref.model, lead_id: oid(ref.id) })) })
      .session(session)
      .lean();
    return (rows as unknown as SubjectLean[]).map(toSubjectRow);
  },

  async findPeriods(subjectId, session) {
    const rows = await getSalesOutreachPolicyPeriodModel()
      .find({ subject_id: oid(subjectId) })
      .sort({ started_at: 1, _id: 1 })
      .limit(1000)
      .session(session)
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      subject_id: String(row.subject_id),
      transition_key: row.transition_key,
      workflow: row.workflow as SalesOutreachWorkflow,
      start_kind: row.start_kind as SalesOutreachPeriodStartKind,
      priority: row.priority ?? null,
      started_at: row.started_at,
      ended_at: row.ended_at ?? null,
      end_reason: row.end_reason ?? null,
    }));
  },

  async reviewedRepIds(agentIds, at, session) {
    const unique = [...new Set(agentIds)].filter((id) => mongoose.isValidObjectId(id));
    if (!unique.length) return new Set();
    const rows = await getRepIdentityLinkModel()
      .find(
        {
          agent_id: { $in: unique.map(oid) },
          status: "reviewed",
          role_kind: "sales_rep",
          effective_from: { $lte: at },
          $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
        },
        { agent_id: 1 },
      )
      .session(session)
      .lean();
    return new Set(rows.map((row) => String(row.agent_id)));
  },

  async linkedNumberIds(refs, session) {
    const byLead = new Map<string, string[]>();
    if (!refs.length) return byLead;
    const ids = refs.map((ref) => oid(ref.id));
    // Indexes `contact_number_lead` and `contact_number_other_leads`.
    const rows = (await getContactNumberModel()
      .find({ purged_at: null, $or: [{ "lead.id": { $in: ids } }, { "other_leads.id": { $in: ids } }] }, { lead: 1, other_leads: 1 })
      .session(session)
      .lean()) as unknown as Array<{ _id: unknown; lead?: { model: SalesOutreachLeadModel; id: unknown } | null; other_leads?: Array<{ model: SalesOutreachLeadModel; id: unknown }> }>;
    for (const row of rows) {
      for (const lead of [...(row.lead ? [row.lead] : []), ...(row.other_leads ?? [])]) {
        if (!refs.some((ref) => ref.model === lead.model && ref.id === String(lead.id))) continue;
        const key = deskLeadKey({ model: lead.model, id: String(lead.id) });
        const list = byLead.get(key) ?? [];
        if (!list.includes(String(row._id))) list.push(String(row._id));
        byLead.set(key, list);
      }
    }
    for (const list of byLead.values()) list.sort();
    return byLead;
  },

  async jobNumberLeadCounts(jobNumbers, session) {
    const counts = new Map<string, number>();
    const unique = [...new Set(jobNumbers)];
    if (!unique.length) return counts;
    for (const model of ["FormLead", "CallLead"] as const) {
      const rows = await (leadModel(model) as mongoose.Model<unknown>)
        .find({ normalized_job_no: { $in: unique }, duplicate: { $ne: true } }, { normalized_job_no: 1 })
        .session(session)
        .lean();
      for (const row of rows as Array<{ normalized_job_no?: string }>)
        if (row.normalized_job_no) counts.set(row.normalized_job_no, (counts.get(row.normalized_job_no) ?? 0) + 1);
    }
    return counts;
  },

  async priorityUncertainLeads(facts, session) {
    const uncertain = new Set<string>();
    const withJob = facts.filter((f) => f.normalized_job_no);
    if (!withJob.length) return uncertain;
    const rows = await getGranotObservationModel()
      .find(
        {
          "identity.normalized_job_no": { $in: [...new Set(withJob.map((f) => f.normalized_job_no!))] },
          "priority.valid": false,
          "priority.raw": { $exists: true, $ne: null },
        },
        { "identity.normalized_job_no": 1, captured_at: 1 },
      )
      .sort({ captured_at: -1 })
      .limit(MAX_OBSERVATIONS)
      .session(session)
      .lean();
    const newest = new Map<string, Date>();
    for (const row of rows as Array<{ identity?: { normalized_job_no?: string }; captured_at: Date }>) {
      const job = row.identity?.normalized_job_no;
      if (job && !newest.has(job)) newest.set(job, row.captured_at);
    }
    for (const lead of withJob) {
      const seen = newest.get(lead.normalized_job_no!);
      if (seen && (!lead.accepted_observation || +seen > +lead.accepted_observation.captured_at)) uncertain.add(deskLeadKey(lead.ref));
    }
    return uncertain;
  },

  async insertSubject(subject, session) {
    const { lead, enrollment, ...fields } = subject;
    const [created] = await getSalesOutreachSubjectModel().create(
      [{ ...toStored(fields), lead_model: lead.model, lead_id: oid(lead.id), enrollment, revision: 1 }],
      { session },
    );
    return String(created!._id);
  },

  async updateSubject(id, expectedRevision, update, session) {
    const result = await getSalesOutreachSubjectModel().updateOne(
      { _id: oid(id), revision: expectedRevision },
      { $set: { ...toStored(update), revision: expectedRevision + 1 } },
      { session, runValidators: true },
    );
    return result.modifiedCount === 1;
  },

  async closePeriod(id, endedAt, endReason, session) {
    const result = await getSalesOutreachPolicyPeriodModel().updateOne(
      { _id: oid(id), ended_at: null },
      { $set: { ended_at: endedAt, end_reason: endReason }, $inc: { revision: 1 } },
      { session, runValidators: true },
    );
    return result.modifiedCount === 1;
  },

  async insertPeriod(subjectId, period, provenance, session) {
    const [created] = await getSalesOutreachPolicyPeriodModel().create(
      [
        {
          subject_id: oid(subjectId),
          ...period,
          policy_version: provenance.policy_version,
          activation_boundary: provenance.activation_boundary,
          ended_at: null,
          end_reason: null,
          age_anchor: provenance.received.received_date,
          anchor_quality: provenance.received.received_quality,
          adapter_version: provenance.received.adapter_version,
          revision: 1,
        },
      ],
      { session },
    );
    return String(created!._id);
  },

  async requestEvaluation(subjectId, subjectRevision, session) {
    await enqueueCsiJob(evaluationJobInput(subjectId, subjectRevision), session);
  },

  async nominateContactSources(request, session) {
    // Index `contact_number_lead`: the numbers that credit this Lead (`contacts/mongoStore.ts` loadContext).
    const numbers = (await getContactNumberModel()
      .find({ "lead.id": oid(request.lead.id), "lead.model": request.lead.model }, { e164: 1 })
      .limit(CONTACT_WAKE_MAX_NUMBERS)
      .session(session)
      .lean()) as unknown as Array<{ _id: mongoose.Types.ObjectId; e164?: string | null }>;
    if (!numbers.length) return 0;
    // Index `call_interaction_number_started_id` (contact_number_id, started_at desc, _id desc).
    const calls = await getCallInteractionModel()
      .find({ contact_number_id: { $in: numbers.map((row) => row._id) }, merged_into_id: null, started_at: windowOf(request) }, { _id: 1 })
      .sort({ started_at: -1, _id: -1 })
      .limit(request.limit_per_kind)
      .session(session)
      .lean();
    const e164s = numbers.flatMap((row) => (row.e164 ? [row.e164] : []));
    // Index `sod_rsms_counterpart_created` (bounded by the Lead's numbers). Outbound event time is
    // `send_at ?? provider_created_at`, so a message scheduled before `since` and sent after it is in the window.
    const sms = e164s.length
      ? await getRingCentralRepSmsEvidenceModel()
        .find(
          { counterpart_numbers: { $in: e164s }, $or: [{ provider_created_at: windowOf(request) }, { send_at: windowOf(request) }] },
          { _id: 1 },
        )
        .sort({ provider_created_at: -1, _id: -1 })
        .limit(request.limit_per_kind)
        .session(session)
        .lean()
      : [];
    const sources: ContactChangeSource[] = [
      ...calls.map((row) => ({ source_kind: "call" as const, source_id: String(row._id), source_revision: request.source_revision })),
      ...sms.map((row) => ({ source_kind: "sms" as const, source_id: String(row._id), source_revision: request.source_revision })),
    ];
    // The caller already checked the desk wants contact evidence (persisted controls, same transaction).
    const jobs = await enqueueOutreachContactChangeJobs(sources, session, request.now, { wanted: async () => true });
    return jobs.length;
  },
};

/** The `outreach_evaluate` job identity for one subject revision (idempotent per revision). */
export function evaluationJobInput(subjectId: string, subjectRevision: number) {
  return {
    stage: "outreach_evaluate" as const,
    subject_key: `outreach-subject:${subjectId}`,
    dedupe_key: `sod:evaluate:${subjectId}:r${subjectRevision}`,
    input_revision: subjectRevision,
    input_refs: [subjectId],
  };
}
