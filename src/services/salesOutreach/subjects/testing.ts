import { randomBytes } from "node:crypto";
import type { ClientSession } from "mongoose";
import type { SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import type { ActiveConfiguration } from "../config/load";
import { activeInspection } from "../reads/testing";
import { deskLeadKey, type DeskLeadFacts, type DeskLeadRef } from "./leadFacts";
import type { NewPeriod } from "./periodPlanner";
import type { DeskPeriodRow, DeskSubjectRow, DeskSubjectStore, NewSubject, PeriodProvenance, SubjectUpdate } from "./store";

/** Unit-test stand-ins for the subject services (no Mongo): an in-memory store that records writes. */
export const fakeSession = { inTransaction: () => true } as unknown as ClientSession;
export const objectId = () => randomBytes(12).toString("hex");

type StoredPeriod = DeskPeriodRow & { provenance: PeriodProvenance; policy_version: string; time_basis: NewPeriod["time_basis"] };

export class MemoryDeskSubjectStore implements DeskSubjectStore {
  leads = new Map<string, DeskLeadFacts>();
  subjects: DeskSubjectRow[] = [];
  periods: StoredPeriod[] = [];
  reviewedReps = new Set<string>();
  numbers = new Map<string, string[]>();
  uncertain = new Set<string>();
  evaluations: Array<{ subject_id: string; revision: number }> = [];
  writes: string[] = [];

  addLead(facts: DeskLeadFacts) {
    this.leads.set(deskLeadKey(facts.ref), facts);
    return facts;
  }
  async loadLeads(refs: readonly DeskLeadRef[]) {
    return refs.flatMap((ref) => this.leads.get(deskLeadKey(ref)) ?? []);
  }
  async findSubjects(refs: readonly DeskLeadRef[]) {
    const keys = new Set(refs.map(deskLeadKey));
    return this.subjects.filter((s) => keys.has(deskLeadKey(s.lead))).map((s) => structuredClone(s));
  }
  async findPeriods(subjectId: string) {
    return this.periods.filter((p) => p.subject_id === subjectId).sort((a, b) => +a.started_at - +b.started_at);
  }
  async reviewedRepIds(agentIds: readonly string[]) {
    return new Set(agentIds.filter((id) => this.reviewedReps.has(id)));
  }
  async attachedNumberIds(refs: readonly DeskLeadRef[]) {
    return new Map(refs.flatMap((ref) => (this.numbers.has(deskLeadKey(ref)) ? [[deskLeadKey(ref), this.numbers.get(deskLeadKey(ref))!] as const] : [])));
  }
  async jobNumberLeadCounts(jobNumbers: readonly string[]) {
    const counts = new Map<string, number>();
    for (const lead of this.leads.values())
      if (lead.normalized_job_no && !lead.duplicate && jobNumbers.includes(lead.normalized_job_no))
        counts.set(lead.normalized_job_no, (counts.get(lead.normalized_job_no) ?? 0) + 1);
    return counts;
  }
  async priorityUncertainLeads(facts: readonly DeskLeadFacts[]) {
    return new Set(facts.map((f) => deskLeadKey(f.ref)).filter((key) => this.uncertain.has(key)));
  }
  async insertSubject(subject: NewSubject) {
    if (this.subjects.some((s) => deskLeadKey(s.lead) === deskLeadKey(subject.lead))) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    const id = objectId();
    this.subjects.push({ ...structuredClone(subject), id, revision: 1 });
    this.writes.push(`insertSubject:${id}`);
    return id;
  }
  async updateSubject(id: string, expectedRevision: number, update: SubjectUpdate) {
    const index = this.subjects.findIndex((s) => s.id === id && s.revision === expectedRevision);
    if (index < 0) return false;
    this.subjects[index] = { ...this.subjects[index]!, ...structuredClone(update), revision: expectedRevision + 1 };
    this.writes.push(`updateSubject:${id}`);
    return true;
  }
  async closePeriod(id: string, endedAt: Date, endReason: string) {
    const period = this.periods.find((p) => p.id === id && p.ended_at === null);
    if (!period) return false;
    Object.assign(period, { ended_at: endedAt, end_reason: endReason });
    this.writes.push(`closePeriod:${id}`);
    return true;
  }
  async insertPeriod(subjectId: string, period: NewPeriod, provenance: PeriodProvenance) {
    if (this.periods.some((p) => p.subject_id === subjectId && p.transition_key === period.transition_key)) throw Object.assign(new Error("E11000"), { code: 11000 });
    if (this.periods.some((p) => p.subject_id === subjectId && p.ended_at === null)) throw Object.assign(new Error("E11000 active"), { code: 11000 });
    const id = objectId();
    this.periods.push({ id, subject_id: subjectId, ...period, ended_at: null, end_reason: null, provenance, policy_version: provenance.policy_version });
    this.writes.push(`insertPeriod:${id}`);
    return id;
  }
  async requestEvaluation(subjectId: string, revision: number) {
    this.evaluations.push({ subject_id: subjectId, revision });
    this.writes.push(`requestEvaluation:${subjectId}`);
  }
}

/** FINAL-01 cadence mapping fields the subject services read, on top of an otherwise bootstrap value. */
export const APPROVED_MAPPING: SalesOutreachConfigurationInput["cadence"] = {
  intake_default_rule: { website_form: "new", best_relocation: "new", ringcentral_call: "new", manual: "new", granot_created: "review" },
  priority_map: {
    codes: [
      { code: "0", workflow: "new", closure_reason: null },
      { code: "1", workflow: "quoted", closure_reason: null },
      { code: "3", workflow: "discretion", closure_reason: null },
      { code: "5", workflow: "closed", closure_reason: "granot_booked" },
      { code: "7", workflow: "closed", closure_reason: "crm_bad_disposition" },
      { code: "8", workflow: "closed", closure_reason: "crm_dead_disposition" },
    ],
    unmapped_workflow: "none",
    official_booking_workflow: "closed",
  },
};

export function deskConfiguration(input: SalesOutreachConfigurationInput = {}, version = "v-test", revision = 3): ActiveConfiguration {
  const inspection = activeInspection({ ...input, cadence: { ...APPROVED_MAPPING, ...input.cadence } }, version, revision);
  if (inspection.state !== "active") throw new Error("expected active");
  return inspection;
}

/** A Form/Call Lead's desk facts with sensible live-ingestion defaults. */
export function leadFacts(overrides: Partial<Omit<DeskLeadFacts, "ref">> & { model?: DeskLeadRef["model"]; id?: string } = {}): DeskLeadFacts {
  const { model = "FormLead", id = objectId(), ...rest } = overrides;
  return {
    ref: { model, id },
    ingestion_origin: model === "FormLead" ? "wordpress_form" : "ringcentral",
    // ET wall clock 10:00 on 2026-10-01 (= 14:00Z, EDT).
    timestamp: new Date("2026-10-01T10:00:00.000Z"),
    created_at: new Date("2026-10-01T14:00:05.000Z"),
    domain_revision: 1,
    last_changed_at: new Date("2026-10-01T14:00:05.000Z"),
    granot_priority: null,
    accepted_observation: null,
    booked_id: null,
    cancelled_id: null,
    duplicate: false,
    bad_lead: null,
    no_sync: false,
    created_on_unmatched: false,
    form_fill: false,
    receiver_agent_id: null,
    job_no: null,
    normalized_job_no: null,
    phone: "(555) 010-0000",
    normalized_phone: "5550100000",
    name: "Synthetic Customer",
    move_date: null,
    ...rest,
  };
}

/** An accepted Granot priority on a Lead (as `leadDesiredState.ts` writes it). */
export function accepted(code: string, capturedAt: string, observationId = objectId()) {
  return { granot_priority: code, accepted_observation: { observation_id: observationId, captured_at: new Date(capturedAt) } };
}
