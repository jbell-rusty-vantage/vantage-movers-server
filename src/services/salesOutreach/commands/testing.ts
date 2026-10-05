import mongoose, { type ClientSession } from "mongoose";
import { CsiError, type CsiActor } from "../../salesIntelligence/auth";
import type { JobInput } from "../../salesIntelligence/jobs";
import { payloadHash, type appendCsiAudit, type executeCsiCommand } from "../../salesIntelligence/transactions";
import type { OutreachActor } from "../auth";
import type { DeskPlanRow, DeskRestrictionRow } from "../evaluation/store";
import { deskLeadKey, type DeskLeadRef } from "../subjects/leadFacts";
import type { DeskPeriodRow, DeskSubjectRow } from "../subjects/store";
import type { DeskCommandStore, LeadAssignment, NewPlan, NewRestriction, RestrictionListFilter } from "./store";

/**
 * Unit-test stand-ins for the desk commands (no Mongo): an in-memory command store with the same
 * fences as the real one (unique active plan, plan/restriction/subject CAS, Lead `domain_revision`),
 * a CSI ledger runner (actor scope + key, payload-hash conflicts, all-or-nothing operations) and an
 * audit recorder.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class MemoryDeskCommandStore implements DeskCommandStore {
  subjects = new Map<string, DeskSubjectRow>();
  periods: Array<Mutable<DeskPeriodRow>> = [];
  plans: DeskPlanRow[] = [];
  restrictions: Array<Mutable<DeskRestrictionRow> & { actor: unknown }> = [];
  leads = new Map<string, Mutable<LeadAssignment> & { name: string | null; source_value: string | null; set_at: Date | null }>();
  entityChanges: Array<{ lead: string; before: string | null; after: string | null; revision_after: number; command_name: string; actor_type: string }> = [];
  repNames = new Map<string, string>();
  numbers = new Set<string>();
  jobs = new Map<string, JobInput>();
  private ids = 0;

  nextId() {
    this.ids += 1;
    return this.ids.toString(16).padStart(24, "0");
  }
  snapshot() {
    const saved = structuredClone({
      subjects: this.subjects,
      plans: this.plans,
      restrictions: this.restrictions,
      leads: this.leads,
      entityChanges: this.entityChanges,
      jobs: this.jobs,
    });
    return () => Object.assign(this, structuredClone(saved));
  }

  async loadSubject(id: string) {
    const row = this.subjects.get(id);
    return row ? structuredClone(row) : null;
  }
  async loadPeriods(subjectId: string) {
    return this.periods.filter((p) => p.subject_id === subjectId);
  }
  async loadPlans(subjectId: string) {
    return structuredClone(this.plans.filter((p) => p.subject_id === subjectId));
  }
  async loadRestrictions(ids: readonly string[]) {
    return structuredClone(this.restrictions.filter((r) => ids.includes(r.contact_number_id)));
  }
  async loadLeadAssignment(lead: DeskLeadRef) {
    const row = this.leads.get(deskLeadKey(lead));
    return row ? { receiver_agent_id: row.receiver_agent_id, receiver_agent_source: row.receiver_agent_source, domain_revision: row.domain_revision } : null;
  }
  async reviewedRepName(agentId: string) {
    return this.repNames.get(agentId) ?? null;
  }
  async insertPlan(plan: NewPlan) {
    if (this.plans.some((p) => p.subject_id === plan.subject_id && p.status === "active")) throw new CsiError("REVISION_CONFLICT");
    const id = this.nextId();
    this.plans.push({ ...plan, id, status: "active", ended_at: null, end_reason: null });
    return id;
  }
  async endPlan(planId: string, expectedRevision: number, end: { status: "replaced" | "cancelled"; ended_at: Date; revision: number }) {
    const row = this.plans.find((p) => p.id === planId && p.status === "active" && p.revision === expectedRevision);
    if (!row) return false;
    Object.assign(row, { status: end.status, ended_at: end.ended_at, end_reason: end.status, revision: end.revision });
    return true;
  }
  async writeLeadAssignment(input: Parameters<DeskCommandStore["writeLeadAssignment"]>[0]) {
    const key = deskLeadKey(input.lead);
    const row = this.leads.get(key);
    if (!row) throw new CsiError("REVISION_CONFLICT");
    const before = row.receiver_agent_id;
    const revision = row.domain_revision + 1;
    this.leads.set(key, {
      receiver_agent_id: input.agent_id,
      receiver_agent_source: "manual",
      domain_revision: revision,
      name: input.agent_name,
      source_value: input.source_value,
      set_at: input.at,
    });
    this.entityChanges.push({ lead: key, before, after: input.agent_id, revision_after: revision, command_name: "sales_outreach_assignment", actor_type: input.context.actor.actor_type });
    return revision;
  }
  async updateSubjectAssignment(subjectId: string, expectedRevision: number, set: { assigned_agent_id: string | null; assignment_revision: number; lead_revision_seen: number }) {
    const row = this.subjects.get(subjectId);
    if (!row || row.revision !== expectedRevision) return false;
    this.subjects.set(subjectId, { ...row, ...set, revision: expectedRevision + 1 });
    return true;
  }
  async contactNumberExists(id: string) {
    return this.numbers.has(id);
  }
  async getRestriction(id: string) {
    const row = this.restrictions.find((r) => r.id === id);
    if (!row) return null;
    const { actor: _actor, ...rest } = structuredClone(row);
    void _actor;
    return rest;
  }
  async listRestrictions(filter: RestrictionListFilter) {
    return this.restrictions
      .filter((r) => (filter.state === "all" || r.state === filter.state) && (!filter.after_id || r.id < filter.after_id))
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, filter.limit)
      .map(({ actor: _actor, ...rest }) => structuredClone(rest));
  }
  async insertRestriction(row: NewRestriction) {
    const id = this.nextId();
    this.restrictions.push({
      id,
      contact_number_id: row.contact_number_id,
      channels: [...row.channels],
      until: row.until,
      origin: "owner",
      state: "active",
      created_at: new Date("2026-10-05T14:00:00.000Z"),
      updated_at: null,
      reason: row.reason,
      confirmed_at: null,
      confirmed_by: null,
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
      revision: 1,
      actor: row.actor,
    });
    return id;
  }
  async updateRestriction(id: string, expectedRevision: number, set: Record<string, unknown>) {
    const row = this.restrictions.find((r) => r.id === id && r.revision === expectedRevision);
    if (!row) return false;
    const actorOf = (v: unknown) => (v && typeof v === "object" ? String((v as { id: string }).id) : null);
    Object.assign(row, {
      ...("state" in set ? { state: set.state } : {}),
      ...("resolved_at" in set ? { resolved_at: set.resolved_at, resolved_by: actorOf(set.resolution_actor), resolution_reason: set.resolution_reason } : {}),
      ...("confirmed_at" in set ? { confirmed_at: set.confirmed_at, confirmed_by: actorOf(set.confirmation_actor) } : {}),
      revision: expectedRevision + 1,
    });
    return true;
  }
  async subjectIdsForNumber(numberId: string) {
    return [...this.subjects.values()].filter((s) => s.contact_number_ids.includes(numberId)).map((s) => s.id);
  }
  async enqueue(job: JobInput) {
    const created = !this.jobs.has(job.dedupe_key);
    this.jobs.set(job.dedupe_key, job);
    return { job_id: `job:${job.dedupe_key}`, created };
  }
}

/** CSI ledger + audit stand-ins over a set of in-memory stores (each exposing `snapshot()` for rollback). */
export class MemoryCommandLedger {
  ledger = new Map<string, { hash: string; response: unknown }>();
  audits: Array<{ event_kind: string; kind: string; subject_key: string; target_id: string; revision: number; prior: unknown; current: unknown; actor: CsiActor }> = [];
  now = new Date("2026-10-05T16:00:00.000Z");

  constructor(private readonly stores: Array<{ snapshot(): () => void }>) {}

  readonly audit: typeof appendCsiAudit = async (context, input) => {
    this.audits.push({ ...input, actor: context.actor });
  };

  readonly run = (async (input: Parameters<typeof executeCsiCommand>[0]) => {
    const scope = input.actor.kind === "rep" || input.actor.kind === "manager" ? input.actor.kind : "owner";
    const key = `${scope}:${input.actor.id}\n${input.idempotency_key}`;
    const hash = payloadHash({ command: input.command, payload: input.payload });
    const prior = this.ledger.get(key);
    if (prior) {
      if (prior.hash !== hash) throw new CsiError("IDEMPOTENCY_CONFLICT");
      return { response: structuredClone(prior.response), replayed: true };
    }
    const restores = this.stores.map((s) => s.snapshot());
    const audits = this.audits.length;
    try {
      const response = await input.operation({
        session: { inTransaction: () => true } as unknown as ClientSession,
        command_id: new mongoose.Types.ObjectId(),
        now: this.now,
        actor: input.actor as CsiActor,
      });
      this.ledger.set(key, { hash, response: structuredClone(response) });
      return { response, replayed: false };
    } catch (error) {
      for (const restore of restores) restore();
      this.audits.length = audits;
      throw error;
    }
  }) as typeof executeCsiCommand;
}

/** A trusted desk actor for unit tests (identity normally comes from the signed headers). */
export function deskActor(role: OutreachActor["role"], id: string, agentId: string | null = null): OutreachActor {
  return { role, actor: { kind: role, id, request_id: `req-${id}`, run_id: null } as CsiActor, agent_id: agentId };
}
