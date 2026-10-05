import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { getCallLeadModel } from "../../../models/CallLead";
import { getFormLeadModel } from "../../../models/FormLead";
import { getSalesOutreachProjectionModel, getSalesOutreachSubjectModel } from "../../../models/salesOutreach";
import { mongoEvaluationStore, type EvaluationStore } from "../evaluation/store";
import type { DeskLeadRef } from "../subjects/leadFacts";
import { toStoredProjection, type StoredProjectionDetail, type StoredQueueRow } from "./present";
import { mongoAssignmentFilter, mongoQueueFilter, mongoQueueQuery, type QueueAssignment, type QueueMatch, type QueuePagePlan } from "./queueQuery";

/** Team cadence counts at one reference instant (overdue = earliest unsatisfied actionable deadline passed). */
export type TeamOverdueCounts = Readonly<{
  distinct_overdue: number;
  quoted_call_overdue: number;
  unassigned_total: number;
  unassigned_overdue: number;
}>;

/**
 * One Agent's cadence counts at a reference instant (rep-days and the team's Daily call goals rows):
 * overdue Leads by the same rule as `teamOverdue`, and the remaining attempts/sends of due or overdue
 * Call/SMS requirements on its active Leads. `*_unknown` counts due requirements whose remaining count
 * is unknown (no capture coverage on that channel yet).
 */
export type AgentCadenceCounts = Readonly<{
  overdue_leads: number;
  call_due_remaining: number;
  call_due_unknown: number;
  sms_due_remaining: number;
  sms_due_unknown: number;
}>;

export const NO_AGENT_CADENCE: AgentCadenceCounts = {
  overdue_leads: 0,
  call_due_remaining: 0,
  call_due_unknown: 0,
  sms_due_remaining: 0,
  sms_due_unknown: 0,
};

/** Stored channel statuses whose remaining attempts are due now or today (read-time derivation only turns `due` into `overdue`). */
export const DUE_CHANNEL_STATUSES = ["due", "overdue"] as const;

/**
 * Every read behind `GET /queue`, `GET /outreach/:id` and the team cadence cards. Read-only, bounded
 * and indexed:
 * - queue page / counts: `sales_outreach_projections` on the `sod_projection_q_*` indexes (filter and
 *   order in Mongo over the full set, keyset after the cursor, `limit + 1` rows);
 * - scope counts + assignment generation: subjects `sod_subject_status_assignee`;
 * - authoritative assignee: the Lead's `receiver_agent` by `_id`;
 * - detail: the evaluation loaders (subject, periods, plans, restrictions, assignment history, events).
 * The Mongo implementation is proven on the replica (`ops/sales-outreach/reads.replica.ts`); unit tests
 * use `MemoryDeskReadStore` (`testing.ts`) with the same plan semantics (`queueQuery.ts`).
 */
export type DeskQueueStore = Pick<
  EvaluationStore,
  "loadSubject" | "loadPeriods" | "loadPlans" | "loadRestrictions" | "loadAssignmentChanges" | "loadContactEvents"
> & {
  findQueuePage(plan: QueuePagePlan): Promise<StoredQueueRow[]>;
  countQueue(match: QueueMatch): Promise<number>;
  /** Active/review subjects in the scope and the projections that exist for them. */
  countScope(assignment: QueueAssignment): Promise<{ subjects: number; projections: number }>;
  /** A digest that changes whenever the set of subjects in an assigned scope (or their assignment revisions) changes. */
  assignmentGeneration(assignment: QueueAssignment): Promise<string>;
  /** Subject id → its Lead's authoritative `receiver_agent` (absent Lead = missing from the map). */
  leadAssignees(subjectIds: readonly string[]): Promise<Map<string, string | null>>;
  leadAssignee(lead: DeskLeadRef): Promise<string | null | undefined>;
  teamOverdue(asOf: Date): Promise<TeamOverdueCounts>;
  /** Per-Agent cadence counts for the named Agents (an Agent with no active Lead is absent from the map). */
  agentCadence(asOf: Date, agentIds: readonly string[]): Promise<ReadonlyMap<string, AgentCadenceCounts>>;
  loadProjectionDetail(subjectId: string): Promise<StoredProjectionDetail | null>;
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const leadModel = (model: DeskLeadRef["model"]) => (model === "FormLead" ? getFormLeadModel() : getCallLeadModel());
const LISTED = { $in: ["active", "review"] };
/** Filters are built as plain records (the typed mongoose filter does not model dotted keys and sentinels). */
type Filter = Record<string, unknown>;

/** The queue row fields (no window history, fingerprints or detail beyond the schedule day). */
const QUEUE_PROJECTION = {
  subject_id: 1,
  assigned_agent_id: 1,
  subject_status: 1,
  display: 1,
  queue_keys: 1,
  call: 1,
  sms: 1,
  oldest_actionable_due_at: 1,
  next_action_due_at: 1,
  last_interaction_at: 1,
  received_at: 1,
  workflow: 1,
  priority_raw: 1,
  status_flags: 1,
  exposure: 1,
  computed_as_of: 1,
  publication_revision: 1,
  policy_fingerprint: 1,
  "detail.schedule_day": 1,
} as const;

/** Digest of `(subject id, assignment revision)` pairs; equal sets ⇒ equal digests. */
export function assignmentDigest(pairs: ReadonlyArray<readonly [string, number]>): string {
  const sorted = [...pairs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 32);
}

/** Active Leads overdue at `asOf`: the earliest unsatisfied actionable deadline (blocked channels excluded) has passed. */
const overdueFilter = (asOf: Date): Filter => ({ subject_status: "active", "queue_keys.urgency_due": { $lte: asOf } });

/** Overdue active Leads per assigned Agent among `agentIds` (the team card's rule, scoped). */
async function overdueByAgent(asOf: Date, agentIds: readonly string[]): Promise<Map<string, number>> {
  const rows = await getSalesOutreachProjectionModel().aggregate<{ _id: unknown; n: number }>([
    { $match: { ...overdueFilter(asOf), assigned_agent_id: { $in: agentIds.map(oid) } } },
    { $group: { _id: "$assigned_agent_id", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.n]));
}

const DUE = [...DUE_CHANNEL_STATUSES];
/** `$sum` terms for one channel: remaining of a due requirement, and 1 per due requirement with an unknown remaining. */
const dueSums = (channel: "call" | "sms") => {
  const due = { $in: [`$${channel}.status`, DUE] };
  const known = { $isNumber: `$${channel}.remaining` };
  return {
    [`${channel}_due_remaining`]: { $sum: { $cond: [{ $and: [due, known] }, `$${channel}.remaining`, 0] } },
    [`${channel}_due_unknown`]: { $sum: { $cond: [{ $and: [due, { $not: [known] }] }, 1, 0] } },
  };
};

/** Assigned scopes larger than this fall back to a count + revision-sum digest (still changes on any move). */
const GENERATION_EXACT_LIMIT = 5000;

export const mongoDeskQueueStore: DeskQueueStore = {
  loadSubject: mongoEvaluationStore.loadSubject,
  loadPeriods: mongoEvaluationStore.loadPeriods,
  loadPlans: mongoEvaluationStore.loadPlans,
  loadRestrictions: mongoEvaluationStore.loadRestrictions,
  loadAssignmentChanges: mongoEvaluationStore.loadAssignmentChanges,
  loadContactEvents: mongoEvaluationStore.loadContactEvents,

  async findQueuePage(plan) {
    const { filter, sort } = mongoQueueQuery(plan);
    const rows = await getSalesOutreachProjectionModel().find(filter, QUEUE_PROJECTION).sort(sort).limit(plan.limit).allowDiskUse(true).lean();
    return rows.map((row) => toStoredProjection(String(row.subject_id), row as unknown as Record<string, unknown>));
  },

  countQueue: (match) => getSalesOutreachProjectionModel().countDocuments(mongoQueueFilter(match)),

  async countScope(assignment) {
    const scope = mongoAssignmentFilter(assignment);
    const subjectFilter: Filter = { status: LISTED, ...scope };
    const projectionFilter: Filter = { subject_status: LISTED, ...scope };
    const [subjects, projections] = await Promise.all([
      getSalesOutreachSubjectModel().countDocuments(subjectFilter),
      getSalesOutreachProjectionModel().countDocuments(projectionFilter),
    ]);
    return { subjects, projections };
  },

  async assignmentGeneration(assignment) {
    if (assignment.kind === "all") return "all";
    const filter: Filter = { status: LISTED, ...mongoAssignmentFilter(assignment) };
    const rows = await getSalesOutreachSubjectModel()
      .find(filter, { _id: 1, assignment_revision: 1 })
      .sort({ _id: 1 })
      .limit(GENERATION_EXACT_LIMIT + 1)
      .lean();
    if (rows.length <= GENERATION_EXACT_LIMIT)
      return assignmentDigest(rows.map((row) => [String(row._id), Number(row.assignment_revision ?? 0)] as const));
    const [summary] = await getSalesOutreachSubjectModel().aggregate<{ n: number; rev: number }>([
      { $match: filter },
      { $group: { _id: null, n: { $sum: 1 }, rev: { $sum: "$assignment_revision" } } },
    ]);
    return `sum:${summary?.n ?? 0}:${summary?.rev ?? 0}`;
  },

  async leadAssignees(subjectIds) {
    const out = new Map<string, string | null>();
    const ids = subjectIds.filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return out;
    const subjects = await getSalesOutreachSubjectModel().find({ _id: { $in: ids.map(oid) } }, { lead_model: 1, lead_id: 1 }).lean();
    for (const model of ["FormLead", "CallLead"] as const) {
      const mine = subjects.filter((s) => s.lead_model === model);
      if (!mine.length) continue;
      const leads = await leadModel(model).collection
        .find({ _id: { $in: mine.map((s) => s.lead_id) } }, { projection: { receiver_agent: 1 } })
        .toArray();
      const byLead = new Map(leads.map((lead) => [String(lead._id), lead.receiver_agent ? String(lead.receiver_agent) : null]));
      for (const s of mine) if (byLead.has(String(s.lead_id))) out.set(String(s._id), byLead.get(String(s.lead_id)) ?? null);
    }
    return out;
  },

  async leadAssignee(lead) {
    if (!mongoose.isValidObjectId(lead.id)) return undefined;
    const row = await leadModel(lead.model).collection.findOne({ _id: oid(lead.id) }, { projection: { receiver_agent: 1 } });
    if (!row) return undefined;
    return row.receiver_agent ? String(row.receiver_agent) : null;
  },

  async teamOverdue(asOf) {
    const Projection = getSalesOutreachProjectionModel();
    const overdue = overdueFilter(asOf);
    const quoted: Filter = { subject_status: "active", workflow: "quoted", "queue_keys.call_due": { $lte: asOf } };
    const unassigned: Filter = { subject_status: LISTED, assigned_agent_id: null };
    const unassignedOverdue: Filter = { ...overdue, assigned_agent_id: null };
    const [distinct_overdue, quoted_call_overdue, unassigned_total, unassigned_overdue] = await Promise.all([
      Projection.countDocuments(overdue),
      Projection.countDocuments(quoted),
      Projection.countDocuments(unassigned),
      Projection.countDocuments(unassignedOverdue),
    ]);
    return { distinct_overdue, quoted_call_overdue, unassigned_total, unassigned_overdue };
  },

  async agentCadence(asOf, agentIds) {
    const ids = agentIds.filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return new Map();
    const [overdue, due] = await Promise.all([
      overdueByAgent(asOf, ids),
      getSalesOutreachProjectionModel().aggregate<{ _id: unknown } & Omit<AgentCadenceCounts, "overdue_leads">>([
        { $match: { subject_status: "active", assigned_agent_id: { $in: ids.map(oid) } } },
        { $group: { _id: "$assigned_agent_id", ...dueSums("call"), ...dueSums("sms") } },
      ]),
    ]);
    const out = new Map<string, AgentCadenceCounts>();
    for (const row of due) {
      const { _id, ...sums } = row;
      out.set(String(_id), { ...NO_AGENT_CADENCE, ...sums, overdue_leads: overdue.get(String(_id)) ?? 0 });
    }
    for (const [agent, n] of overdue) if (!out.has(agent)) out.set(agent, { ...NO_AGENT_CADENCE, overdue_leads: n });
    return out;
  },

  async loadProjectionDetail(subjectId) {
    if (!mongoose.isValidObjectId(subjectId)) return null;
    const row = await getSalesOutreachProjectionModel().findOne({ subject_id: oid(subjectId) }).lean();
    return row ? toStoredProjection(subjectId, row as unknown as Record<string, unknown>) : null;
  },
};
