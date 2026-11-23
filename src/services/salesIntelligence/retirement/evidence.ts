import { ObjectId, type Db, type Document } from "mongodb";
import { contactEventId } from "../../salesOutreach/contacts/derive";
import { routinePurgeAt } from "../jobs";

/**
 * Validated retirement, step 1: prove each completed job's lifecycle effect from the business record it produced,
 * independently of the queue. Reference doc: docs/knowledge/validated-retirement.md.
 *
 * - `retire`: the result has a routine shape (`routinePurgeAt`) AND its effect is present. The row becomes a receipt
 *   that leaves at the end of its replay window.
 * - `hold`: routine shape, effect not found. The full row stays for the ordinary 14 days and is reported.
 * - `keep`: not routine. The row keeps its ordinary window (readers such as admissions use it).
 * Every verdict is archived to GCS first.
 */
export type RetirementVerdict =
  /** `compact: false`: a routine job that succeeded after a retry keeps its full row until `purge_at`. */
  | { verdict: "retire"; purge_at: Date; compact: boolean }
  | { verdict: "hold"; reason: string }
  | { verdict: "keep"; reason: "ordinary_window" };

/** The business facts the checks need, keyed for direct lookup. Loaded in one indexed read per kind and batch. */
export type Effects = {
  /** subject id → { publication_revision, computed_as_of } */
  projections: Map<string, { publication_revision: number; computed_as_of: Date | null }>;
  /** `<agent>:<day>` → publication_revision */
  repDays: Map<string, number>;
  /** call interaction id → projection_revision */
  calls: Map<string, number>;
  /** call ids that have a derived contact event */
  contactEvents: Set<string>;
  /** subject id → `outreach-lead:<model>:<id>` */
  subjectLeads: Map<string, string>;
};

const asDate = (v: unknown) => (v instanceof Date ? v : typeof v === "string" ? new Date(v) : null);
const oid = (v: string) => new ObjectId(v);
const isId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{24}$/.test(v);
const ref0 = (doc: Document) => String(doc.input_refs?.[0] ?? "");

/** Loads every fact a batch needs: at most five `$in` reads on unique or leading-key indexes. */
export async function loadEffects(db: Db, docs: readonly Document[]): Promise<Effects> {
  const effects: Effects = { projections: new Map(), repDays: new Map(), calls: new Map(), contactEvents: new Set(), subjectLeads: new Map() };
  const subjects = new Set<string>(), leadSubjects = new Set<string>(), agents = new Set<string>(), days = new Set<string>(), calls = new Set<string>();
  for (const doc of docs) {
    const result = doc.result as Record<string, unknown> | undefined;
    if (doc.stage === "outreach_evaluate" && isId(ref0(doc))) subjects.add(ref0(doc));
    if (doc.stage === "outreach_lead_change" && isId(result?.subject_id)) { subjects.add(result.subject_id); leadSubjects.add(result.subject_id); }
    if (doc.stage === "outreach_rep_day") { agents.add(ref0(doc)); days.add(String(doc.subject_key).split(":").at(-1)!); }
    if (doc.stage === "outreach_contact_change" && isId(ref0(doc))) calls.add(ref0(doc));
    if (doc.stage === "capture_projection" && Array.isArray(result?.results))
      for (const session of result.results as Array<{ interaction_id?: unknown }>) if (isId(session.interaction_id)) calls.add(session.interaction_id);
  }
  if (subjects.size) {
    for (const p of await db.collection("sales_outreach_projections").find({ subject_id: { $in: [...subjects].map(oid) } },
      { projection: { subject_id: 1, publication_revision: 1, computed_as_of: 1 } }).toArray())
      effects.projections.set(String(p.subject_id), { publication_revision: Number(p.publication_revision ?? 0), computed_as_of: asDate(p.computed_as_of) });
  }
  if (leadSubjects.size) {
    for (const s of await db.collection("sales_outreach_subjects").find({ _id: { $in: [...leadSubjects].map(oid) } },
      { projection: { lead_model: 1, lead_id: 1 } }).toArray())
      effects.subjectLeads.set(String(s._id), `outreach-lead:${s.lead_model}:${s.lead_id}`);
  }
  if (agents.size) {
    for (const r of await db.collection("sales_outreach_rep_day_projections").find({ agent_id: { $in: [...agents].filter(isId).map(oid) }, business_day: { $in: [...days] } },
      { projection: { agent_id: 1, business_day: 1, publication_revision: 1 } }).toArray())
      effects.repDays.set(`${r.agent_id}:${r.business_day}`, Number(r.publication_revision ?? 0));
  }
  if (calls.size) {
    const ids = [...calls];
    for (const c of await db.collection("call_interactions").find({ _id: { $in: ids.map(oid) } }, { projection: { projection_revision: 1 } }).toArray())
      effects.calls.set(String(c._id), Number(c.projection_revision ?? 0));
    const eventIds = ids.map((id) => contactEventId("call", id));
    for (const e of await db.collection("sales_outreach_contact_events").find({ _id: { $in: eventIds.map(oid) }, source_kind: "call" },
      { projection: { source_id: 1, revision: 1, input_fingerprint: 1 } }).toArray())
      if (Number(e.revision) > 0 && e.input_fingerprint && String(e._id) === contactEventId("call", String(e.source_id))) effects.contactEvents.add(String(e.source_id));
  }
  return effects;
}

/** Whether the job's lifecycle effect is present in its business record. */
export function effectProven(doc: Document, effects: Effects): boolean {
  const result = (doc.result ?? {}) as Record<string, unknown>;
  const ref = ref0(doc);
  switch (doc.stage) {
    case "outreach_evaluate":
      return (effects.projections.get(ref)?.publication_revision ?? -1) >= Number(result.publication_revision);
    case "outreach_rep_day":
      return (effects.repDays.get(`${ref}:${String(doc.subject_key).split(":").at(-1)}`) ?? -1) >= Number(result.publication_revision);
    case "outreach_contact_change": {
      const revision = Number(String(doc.dedupe_key).split(":r").at(-1));
      return effects.contactEvents.has(ref) && (effects.calls.get(ref) ?? -1) >= revision;
    }
    case "outreach_lead_change": {
      // The Lead refresh nominated an evaluation; a later evaluated projection of the same Lead's subject consumed it.
      const subject = String(result.subject_id);
      const evaluated = effects.projections.get(subject);
      return effects.subjectLeads.get(subject) === doc.subject_key && !!evaluated && evaluated.publication_revision > 0
        && !!evaluated.computed_as_of && +evaluated.computed_as_of >= +asDate(doc.completed_at)!;
    }
    case "capture_projection":
      return Array.isArray(result.results) && (result.results as Array<{ interaction_id: string; projection_revision: number }>)
        .every((s) => (effects.calls.get(s.interaction_id) ?? -1) >= s.projection_revision);
    default:
      return false;
  }
}

export function verdictOf(doc: Document, effects: Effects): RetirementVerdict {
  const completed = asDate(doc.completed_at);
  const purge = completed && Array.isArray(doc.input_refs) ? routinePurgeAt(doc as never, doc.result, completed) : undefined;
  if (!purge) return { verdict: "keep", reason: "ordinary_window" };
  // A completed row still carrying a lease, or never leased, is not a settled completion.
  if (doc.lease_owner || doc.leased_until || !(Number(doc.lease_epoch) >= 1)) return { verdict: "hold", reason: `${doc.stage}:lease_state` };
  if (!effectProven(doc, effects)) return { verdict: "hold", reason: `${doc.stage}:effect_missing` };
  return { verdict: "retire", purge_at: purge, compact: doc.reason == null };
}
