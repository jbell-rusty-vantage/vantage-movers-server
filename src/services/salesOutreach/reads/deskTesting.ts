import { MemoryEvaluationStore } from "../evaluation/testing";
import { deskLeadKey, type DeskLeadRef } from "../subjects/leadFacts";
import { assignmentDigest, DUE_CHANNEL_STATUSES, NO_AGENT_CADENCE, type AgentCadenceCounts, type DeskQueueStore, type TeamOverdueCounts } from "./deskStore";
import { toStoredProjection, type StoredProjectionDetail } from "./present";
import { matchesQueue, memoryQueuePage, type QueueAssignment, type QueueMatch, type QueuePagePlan } from "./queueQuery";

/**
 * Unit-test stand-in for the desk queue/detail/team store (no Mongo). Projections and subjects come from
 * a `MemoryEvaluationStore` (so tests can build rows with the real evaluator), Leads' authoritative
 * `receiver_agent` from `leads`. Queue semantics are `queueQuery.ts`'s, shared with the Mongo plan.
 */
export class MemoryDeskReadStore implements DeskQueueStore {
  /** Lead key (`model:id`) → `receiver_agent` (null = unassigned); absent = the Lead does not exist. */
  leads = new Map<string, string | null>();
  pages: QueuePagePlan[] = [];

  constructor(readonly evaluation: MemoryEvaluationStore = new MemoryEvaluationStore()) {}

  /** Every stored projection row, normalized like a Mongo read. */
  rows(): StoredProjectionDetail[] {
    return [...this.evaluation.projections.entries()].map(([subjectId, row]) =>
      toStoredProjection(subjectId, { ...row.doc, subject_id: subjectId, revision: row.revision } as Record<string, unknown>),
    );
  }

  setLead(lead: DeskLeadRef, receiver: string | null) {
    this.leads.set(deskLeadKey(lead), receiver);
  }

  loadSubject = (id: string) => this.evaluation.loadSubject(id);
  loadPeriods = (id: string) => this.evaluation.loadPeriods(id);
  loadPlans = (id: string) => this.evaluation.loadPlans(id);
  loadRestrictions = (ids: readonly string[]) => this.evaluation.loadRestrictions(ids);
  loadAssignmentChanges = (lead: DeskLeadRef) => this.evaluation.loadAssignmentChanges(lead);
  loadContactEvents = (id: string) => this.evaluation.loadContactEvents(id);

  async findQueuePage(plan: QueuePagePlan) {
    this.pages.push(plan);
    return memoryQueuePage(this.rows(), plan);
  }

  async countQueue(match: QueueMatch) {
    return this.rows().filter((row) => matchesQueue(match, row)).length;
  }

  private inScope(assignment: QueueAssignment, agent: string | null) {
    if (assignment.kind === "agent") return agent === assignment.agent_id;
    if (assignment.kind === "unassigned") return agent === null;
    return true;
  }

  async countScope(assignment: QueueAssignment) {
    const subjects = [...this.evaluation.subjects.values()].filter(
      (s) => (s.status === "active" || s.status === "review") && this.inScope(assignment, s.assigned_agent_id),
    ).length;
    const projections = this.rows().filter(
      (r) => (r.subject_status === "active" || r.subject_status === "review") && this.inScope(assignment, r.assigned_agent_id),
    ).length;
    return { subjects, projections };
  }

  async assignmentGeneration(assignment: QueueAssignment) {
    if (assignment.kind === "all") return "all";
    return assignmentDigest(
      [...this.evaluation.subjects.values()]
        .filter((s) => (s.status === "active" || s.status === "review") && this.inScope(assignment, s.assigned_agent_id))
        .map((s) => [s.id, s.assignment_revision] as const),
    );
  }

  async leadAssignees(subjectIds: readonly string[]) {
    const out = new Map<string, string | null>();
    for (const id of subjectIds) {
      const subject = this.evaluation.subjects.get(id);
      if (!subject) continue;
      const key = deskLeadKey(subject.lead);
      if (this.leads.has(key)) out.set(id, this.leads.get(key) ?? null);
    }
    return out;
  }

  async leadAssignee(lead: DeskLeadRef) {
    const key = deskLeadKey(lead);
    return this.leads.has(key) ? (this.leads.get(key) ?? null) : undefined;
  }

  async teamOverdue(asOf: Date): Promise<TeamOverdueCounts> {
    const rows = this.rows();
    const overdue = rows.filter((r) => r.subject_status === "active" && +r.queue_keys.urgency_due <= +asOf);
    return {
      distinct_overdue: overdue.length,
      quoted_call_overdue: rows.filter((r) => r.subject_status === "active" && r.workflow === "quoted" && +r.queue_keys.call_due <= +asOf).length,
      unassigned_total: rows.filter((r) => (r.subject_status === "active" || r.subject_status === "review") && r.assigned_agent_id === null).length,
      unassigned_overdue: overdue.filter((r) => r.assigned_agent_id === null).length,
    };
  }

  async agentCadence(asOf: Date, agentIds: readonly string[]) {
    const due = (status: string) => (DUE_CHANNEL_STATUSES as readonly string[]).includes(status);
    const out = new Map<string, { -readonly [K in keyof AgentCadenceCounts]: number }>();
    for (const r of this.rows()) {
      if (r.subject_status !== "active" || !r.assigned_agent_id || !agentIds.includes(r.assigned_agent_id)) continue;
      const c = out.get(r.assigned_agent_id) ?? { ...NO_AGENT_CADENCE };
      if (+r.queue_keys.urgency_due <= +asOf) c.overdue_leads += 1;
      if (due(r.call.status)) {
        if (r.call.remaining === null) c.call_due_unknown += 1;
        else c.call_due_remaining += r.call.remaining;
      }
      if (due(r.sms.status)) {
        if (r.sms.remaining === null) c.sms_due_unknown += 1;
        else c.sms_due_remaining += r.sms.remaining;
      }
      out.set(r.assigned_agent_id, c);
    }
    return out as ReadonlyMap<string, AgentCadenceCounts>;
  }

  async loadProjectionDetail(subjectId: string) {
    return this.rows().find((r) => r.subject_id === subjectId) ?? null;
  }
}
