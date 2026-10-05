import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import type { TemporalRepLink } from "../../salesIntelligence/repIdentity/resolve";
import type { JobInput } from "../../salesIntelligence/jobs";
import type { ContactEventStore, ContextRequest, StoredContactEvent } from "./apply";
import type { CallLegFacts, CallPartyFacts, CallSourceRow, ContactEventDraft, DeskLeadKey, DerivationContext, RestrictionInterval, SmsSourceRow, SubjectFacts } from "./derive";

/** Unit-test stand-ins for the contact-event derivation (no Mongo). */

export const ACCOUNT = "800000000001";
export const newId = () => new mongoose.Types.ObjectId().toHexString();
export const SESSION = {} as ClientSession;

export function reviewedLink(agentId: string, extension: string, from = new Date("2026-01-01T00:00:00Z"), extra: Partial<TemporalRepLink> = {}): TemporalRepLink {
  return {
    _id: newId(),
    revision: 1,
    agent_id: agentId,
    rc_account_id: ACCOUNT,
    rc_extension_id: extension,
    role_kind: "sales_rep",
    status: "reviewed",
    effective_from: from,
    effective_to: null,
    reviewed_at: from,
    reviewed_by: "owner",
    ...extra,
  };
}

export function party(extension: string | null, input: Partial<CallPartyFacts> = {}): CallPartyFacts {
  return { role: "user", direction: "Outbound", extension_id: extension, connected: false, answered_at: null, ...input };
}

export function leg(extension: string | null, start: string, input: Partial<CallLegFacts> = {}): CallLegFacts {
  return { leg_type: "SipToPstnMetered", direction: "Outbound", result: "Call connected", start_time: new Date(start), extension_id: extension, ...input };
}

/** A confirmed (settled, terminal) outbound call from `extension` to `numberId`. */
export function outboundCall(extension: string, numberId: string | null, start: string, input: Partial<CallSourceRow> = {}): CallSourceRow {
  return {
    id: newId(),
    provider_account_id: ACCOUNT,
    direction: "Outbound",
    contact_number_id: numberId,
    external_endpoint_kind: "external",
    started_at: new Date(start),
    answered_at: null,
    provider_connected: true,
    provider_result: "Call connected",
    contact_type: "unknown",
    parties: [party(extension)],
    legs: [leg(extension, start)],
    call_log_state: "settled",
    terminal: true,
    merged_into_id: null,
    purged_at: null,
    projection_revision: 3,
    ...input,
  };
}

/** A confirmed inbound call answered by `extension` (null = missed). */
export function inboundCall(extension: string | null, numberId: string | null, start: string, answeredAt: string | null = start, input: Partial<CallSourceRow> = {}): CallSourceRow {
  return {
    ...outboundCall(extension ?? "0", numberId, start),
    direction: "Inbound",
    provider_connected: extension !== null,
    provider_result: extension ? "Call connected" : "Missed",
    parties: extension ? [party(extension, { direction: "Inbound", connected: true, answered_at: answeredAt ? new Date(answeredAt) : null })] : [],
    legs: extension ? [leg(extension, answeredAt ?? start, { direction: "Inbound" })] : [],
    ...input,
  };
}

export function subjectFacts(input: Partial<SubjectFacts> & { workflow?: SubjectFacts["periods"][number]["workflow"] } = {}): SubjectFacts {
  const activation = input.activation_at ?? new Date("2026-09-01T12:00:00Z");
  return {
    id: input.id ?? newId(),
    revision: input.revision ?? 4,
    activation_at: activation,
    periods: input.periods ?? [{ workflow: input.workflow ?? "new", started_at: activation, ended_at: null }],
  };
}

export class ContextBuilder {
  links: TemporalRepLink[] = [];
  attached = new Map<string, DeskLeadKey[]>();
  subjects = new Map<DeskLeadKey, SubjectFacts>();
  restrictions = new Map<string, RestrictionInterval[]>();
  numbers = new Map<string, string>();

  link(agentId: string, extension: string, extra: Partial<TemporalRepLink> = {}) {
    this.links.push(reviewedLink(agentId, extension, undefined, extra));
    return this;
  }
  /** Attaches a new Lead to `numberId` and, unless `subject` is null, enrolls it. */
  lead(numberId: string, subject: SubjectFacts | null = subjectFacts()): { key: DeskLeadKey; subject: SubjectFacts | null } {
    const key = `FormLead:${newId()}` as DeskLeadKey;
    this.attached.set(numberId, [...(this.attached.get(numberId) ?? []), key]);
    if (subject) this.subjects.set(key, subject);
    return { key, subject };
  }
  restrict(numberId: string, channels: Array<"call" | "text">, from: string, to: string | null = null) {
    this.restrictions.set(numberId, [...(this.restrictions.get(numberId) ?? []), { channels, from: new Date(from), to: to ? new Date(to) : null }]);
    return this;
  }
  number(e164: string, numberId: string) {
    this.numbers.set(e164, numberId);
    return this;
  }
  build(): DerivationContext {
    return { links: this.links, attached_leads: this.attached, subjects: this.subjects, restrictions: this.restrictions, numbers_by_e164: this.numbers };
  }
}

export type MemoryEvent = ContactEventDraft & { id: string; revision: number };

export class MemoryContactEventStore implements ContactEventStore {
  calls = new Map<string, CallSourceRow>();
  sms = new Map<string, SmsSourceRow>();
  events = new Map<string, MemoryEvent>();
  jobs = new Map<string, { job_id: string; input: JobInput }>();
  requests: ContextRequest[] = [];
  writes = 0;
  constructor(public context: DerivationContext) {}

  async loadCalls(ids: readonly string[]) {
    return ids.flatMap((id) => (this.calls.has(id) ? [this.calls.get(id)!] : []));
  }
  async loadSms(ids: readonly string[]) {
    return ids.flatMap((id) => (this.sms.has(id) ? [this.sms.get(id)!] : []));
  }
  async loadContext(request: ContextRequest) {
    this.requests.push(request);
    return this.context;
  }
  async loadEvents(ids: readonly string[]) {
    const out = new Map<string, StoredContactEvent>();
    for (const id of ids) {
      const row = this.events.get(id);
      if (row) out.set(id, { id, subject_id: row.subject_id, goal_agent_id: row.goal_agent_id, business_date: row.business_date, input_fingerprint: row.input_fingerprint, revision: row.revision });
    }
    return out;
  }
  async writeEvent(id: string, draft: ContactEventDraft, previous: StoredContactEvent | null) {
    const current = this.events.get(id);
    if ((current?.revision ?? null) !== (previous?.revision ?? null)) throw new Error("revision moved");
    const revision = (previous?.revision ?? 0) + 1;
    this.events.set(id, { ...draft, id, revision });
    this.writes++;
    return revision;
  }
  async subjectRevisions(ids: readonly string[]) {
    const all = [...this.context.subjects.values()];
    return new Map(ids.flatMap((id) => {
      const subject = all.find((s) => s.id === id);
      return subject ? [[id, subject.revision] as [string, number]] : [];
    }));
  }
  async enqueue(job: JobInput) {
    const existing = this.jobs.get(job.dedupe_key);
    if (existing) return { job_id: existing.job_id, created: false };
    const job_id = newId();
    this.jobs.set(job.dedupe_key, { job_id, input: job });
    return { job_id, created: true };
  }
  jobsOf(stage: string) {
    return [...this.jobs.values()].filter((j) => j.input.stage === stage).map((j) => j.input);
  }
}

/** Runs `fn` with a fake session (the memory stores ignore it). */
export const memoryTransaction = async <T>(fn: (session: ClientSession) => Promise<T>) => fn(SESSION);
