import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getSalesIntelligencePolicyPointerModel } from "../../../models/SalesIntelligencePolicyPointer";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { resetCaptureCoverageCache } from "../../numberActivity/coverage";
import { attachedForItem, getContactNumberDetail, toNumberSearchItem, type ContactNumberLean } from "../../numberActivity/contactNumbers";
import { numberSearchItemDtoSchema } from "../../numberActivity/dto";
import type { CoverageDto } from "../dto";
import { leadStatusWord, loadAttachedLeadProgressForNumbers, readNumberOutreach } from "./reads";

/**
 * S4-NUMBER unit proof (data spec §7 D2, V15, final spec §9.1 / D5) over a small in-memory Mongo
 * stand-in: every model read and raw collection read is counted, so the Number detail's read count
 * can be compared for 1 and 8 Outreach records. The replica repeats the V15 cases on a real mongod
 * (`scripts/dev_ops/test-si-number.ts`).
 */
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID ||= "csi-local-proof";
const NOW = new Date("2026-09-23T15:00:00.000Z");
const oid = () => new mongoose.Types.ObjectId();
type Doc = Record<string, unknown>;

// ---- minimal filter evaluator (equality with null-matches-missing, $in, $ne, $nin, $gt/$gte/$lt/$lte, $exists, $or, $and, dotted paths) ----
const norm = (v: unknown) => (v instanceof mongoose.Types.ObjectId ? `oid:${String(v)}` : v instanceof Date ? `date:${+v}` : v);
const eq = (a: unknown, b: unknown) => (a == null && b == null) || norm(a) === norm(b) || (typeof a === "string" && b instanceof mongoose.Types.ObjectId && a === String(b)) || (typeof b === "string" && a instanceof mongoose.Types.ObjectId && b === String(a));
function at(doc: unknown, path: string[]): unknown[] {
  if (!path.length) return Array.isArray(doc) ? [doc, ...doc] : [doc];
  if (Array.isArray(doc)) return doc.flatMap(item => at(item, path));
  if (!doc || typeof doc !== "object") return [undefined];
  return at((doc as Doc)[path[0]!], path.slice(1));
}
const cmp = (a: unknown, b: unknown) => { const x = a instanceof Date ? +a : typeof a === "string" && !Number.isNaN(Date.parse(a)) && b instanceof Date ? Date.parse(a) : a; const y = b instanceof Date ? +b : typeof b === "string" && a instanceof Date ? Date.parse(b) : b; return (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0; };
function cond(values: unknown[], c: unknown): boolean {
  if (c && typeof c === "object" && !(c instanceof Date) && !(c instanceof mongoose.Types.ObjectId) && !Array.isArray(c) && Object.keys(c).some(k => k.startsWith("$"))) {
    return Object.entries(c as Doc).every(([op, arg]) => {
      switch (op) {
        case "$in": return (arg as unknown[]).some(a => values.some(v => eq(v, a)));
        case "$nin": return !(arg as unknown[]).some(a => values.some(v => eq(v, a)));
        case "$ne": return !values.some(v => eq(v, arg));
        case "$gt": return values.some(v => v != null && cmp(v, arg) > 0);
        case "$gte": return values.some(v => v != null && cmp(v, arg) >= 0);
        case "$lt": return values.some(v => v != null && cmp(v, arg) < 0);
        case "$lte": return values.some(v => v != null && cmp(v, arg) <= 0);
        case "$exists": return values.some(v => v !== undefined) === Boolean(arg);
        case "$type": return values.some(v => typeof v === arg);
        default: return false; // unsupported operators never match (coverage counts read 0)
      }
    });
  }
  return values.some(v => eq(v, c));
}
function matches(doc: Doc, filter: Doc = {}): boolean {
  return Object.entries(filter).every(([key, c]) => {
    if (key === "$or") return (c as Doc[]).some(f => matches(doc, f));
    if (key === "$and") return (c as Doc[]).every(f => matches(doc, f));
    return cond(at(doc, key.split(".")), c);
  });
}

type Counter = { reads: string[] };
class FakeQuery<T> implements PromiseLike<T> {
  constructor(private readonly run: () => T) {}
  select() { return this; } sort() { return this; } limit() { return this; } lean() { return this; } session() { return this; } populate() { return this; }
  exec() { return Promise.resolve(this.run()); }
  then<A = T, B = never>(ok?: ((value: T) => A | PromiseLike<A>) | null, ko?: ((reason: unknown) => B | PromiseLike<B>) | null) { return this.exec().then(ok, ko); }
}
type Store = Record<string, Doc[]>;
const MODELS = {
  contact_numbers: getContactNumberModel, attachments: getNumberLeadAttachmentModel, calls: getCallInteractionModel, records: getOutreachRecordModel,
  conversations: getLeadConversationModel, restrictions: getSalesIntelligenceContactRestrictionModel, reviews: getSalesIntelligenceReviewItemModel,
  followups: getOutreachFollowupModel, audit: getSalesIntelligenceAuditEventModel, jobs: getSalesIntelligenceJobModel,
  policy: getSalesIntelligencePolicyPointerModel, sync: getSalesIntelligenceSyncStateModel,
} as const;
function install(t: TestContext, store: Store): Counter {
  const counter: Counter = { reads: [] };
  for (const [name, get] of Object.entries(MODELS)) {
    const model = get() as unknown as Record<string, unknown>;
    const rows = () => store[name] ?? [];
    const read = <T>(op: string, run: () => T) => { counter.reads.push(`${name}.${op}`); return new FakeQuery(run); };
    t.mock.method(model, "find", ((f?: Doc) => read("find", () => rows().filter(d => matches(d, f)))) as never);
    t.mock.method(model, "findOne", ((f?: Doc) => read("findOne", () => rows().find(d => matches(d, f)) ?? null)) as never);
    t.mock.method(model, "findById", ((id: unknown) => read("findById", () => rows().find(d => eq(d._id, id)) ?? null)) as never);
    t.mock.method(model, "countDocuments", ((f?: Doc) => read("countDocuments", () => rows().filter(d => matches(d, f)).length)) as never);
    t.mock.method(model, "exists", ((f?: Doc) => read("exists", () => { const d = rows().find(r => matches(r, f)); return d ? { _id: d._id } : null; })) as never);
    t.mock.method(model, "distinct", ((field: string, f?: Doc) => read("distinct", () => [...new Set(rows().filter(d => matches(d, f)).flatMap(d => at(d, field.split("."))))])) as never);
    t.mock.method(model, "aggregate", (() => read("aggregate", () => [])) as never);
  }
  const connection = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const raw = (name: string) => ({
    find: (f?: Doc) => ({ toArray: async () => { counter.reads.push(`raw:${name}.find`); return (store[name] ?? []).filter(d => matches(d, f)); } }),
    findOne: async (f?: Doc) => { counter.reads.push(`raw:${name}.findOne`); return (store[name] ?? []).find(d => matches(d, f)) ?? null; },
  });
  t.mock.method(connection, "collection", raw as never);
  // The stored Coverage projection is read through `connection.db` (no stored row → derived from the counts above).
  const previous = Object.getOwnPropertyDescriptor(connection, "db");
  Object.defineProperty(connection, "db", { configurable: true, get: () => ({ collection: raw }) });
  t.after(() => { if (previous) Object.defineProperty(connection, "db", previous); else delete (connection as unknown as Doc).db; });
  return counter;
}

// ---- fixtures ----
const COVERAGE: CoverageDto = { known_through: NOW.toISOString(), gaps: [], capabilities: {}, ai_paused: false } as unknown as CoverageDto;
const numberDoc = (e164: string, over: Doc = {}) => ({ ...new (getContactNumberModel())({ e164, national_ten: e164.slice(2), digits_reversed: [...e164.slice(2)].reverse().join(""),
  first_observed_at: new Date("2026-09-01T00:00:00Z"), last_activity_at: new Date("2026-09-22T00:00:00Z"), ...over }).toObject() });
const edge = (numberId: unknown, leadId: unknown, state = "attached") => new (getNumberLeadAttachmentModel())({ contact_number_id: numberId,
  lead_ref: { model: "FormLead", id: leadId }, state, certainty: state === "attached" ? "exact" : "unsure", decided_by: "automatic" }).toObject();
const READY = { artifact_id: oid(), status: "ready", transaction_intent: 75, move_likelihood: 100, transaction_intent_confidence: "medium", move_likelihood_confidence: "high",
  context_as_of: new Date("2026-09-22T00:00:00Z"), latest_conversation_at: null, stale: false, stale_reason: null, published_at: new Date("2026-09-22T00:00:00Z"), conflict_targets: [] };
const outreach = (leadId: unknown, numberId: unknown, over: Doc = {}) => ({ ...new (getOutreachRecordModel())({ subject: { kind: "lead", model: "FormLead", id: leadId },
  primary_contact_number_id: numberId, state: "unworked", trigger_kind: "lead_arrival", trigger_at: new Date("2026-09-20T12:00:00Z"), policy_version: 1 }).toObject(), ...over });
const lead = (id: unknown, over: Doc = {}) => ({ _id: id, name: "Maria Lopez", job_no: "5564884", move_date: new Date("2026-10-15T00:00:00Z"), ...over });
const subjectKeyOf = (leadId: unknown) => `lead:FormLead:${String(leadId)}`;

/** One Number with `n` Leads attached (each with its own Outreach record, follow-up, restriction-free) plus review items. */
function detailStore(n: number) {
  const number = numberDoc("+16175553819");
  const leads = Array.from({ length: n }, () => oid());
  const records = leads.map(id => outreach(id, number._id, { move_assessment: READY }));
  const store: Store = {
    contact_numbers: [number], attachments: leads.map(id => edge(number._id, id)), records,
    followups: records.map(r => new (getOutreachFollowupModel())({ outreach_record_id: r._id, commitment_key: String(oid()), kind: "call", description: "Call back", origin: "rep_promise",
      due_at: null, date_resolution: { precision: "unresolved", timezone: "America/New_York", anchor: NOW, policy_version: 1 } }).toObject()),
    restrictions: [], reviews: records.map(r => ({ _id: oid(), revision: 1, subject_key: subjectKeyOf(r.subject.id), cause_kind: "identity", cause_key: String(oid()),
      state: "open", evidence_ids: [], opened_at: NOW, updatedAt: NOW, resolved_at: null, resolution_reason: null })),
    jobs: [{ _id: oid(), deployment: process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID, database: getMongoDatabaseName(), stage: "move_assessment", status: "pending", subject_key: subjectKeyOf(leads[0]) }],
    form_leads: leads.map(id => lead(id)),
  };
  return { store, number, leads };
}

test("D2: GET /numbers/:id read count is independent of the number of Outreach records (1 vs 8)", async t => {
  const counts: Record<number, string[]> = {};
  for (const n of [1, 8]) {
    await t.test(`${n} records`, async t2 => {
      const { store, number, leads } = detailStore(n);
      const counter = install(t2, store);
      resetCaptureCoverageCache();
      const detail = await getContactNumberDetail(String(number._id), { now: () => NOW });
      assert.ok(detail);
      assert.equal(detail.data.outreach_records.length, n);
      assert.equal(detail.data.connections.outreach_records_total, n);
      assert.equal(detail.as_of, NOW.toISOString(), "as_of is the injected clock");
      counts[n] = [...counter.reads].sort();
      assert.equal(counter.reads.filter(r => r === "jobs.exists").length, 0, "no per-record sales_intelligence_jobs.exists");
      assert.equal(counter.reads.filter(r => r === "jobs.distinct").length, 1, "one pending-assessment distinct");
      assert.equal(counter.reads.filter(r => r.startsWith("attachments.find")).length, 2, "the detail's edges read plus the side data's lead-keyed attached-edges read; no second Number-keyed read");
      assert.equal(counter.reads.filter(r => r.startsWith("contact_numbers.")).length, 2, "the detail read plus the side data's suppressed-number read");
      assert.equal(counter.reads.filter(r => r.startsWith("restrictions.")).length, 1, "restrictions once");
      assert.equal(counter.reads.filter(r => r.startsWith("reviews.")).length, 1, "review items once");
      // The pending set reaches each record: only the first Lead has a queued job; its projection stays `ready` (scored).
      const byLead = new Map(detail.data.outreach_records.map(o => [o.subject.kind === "lead" ? o.subject.id : "", o]));
      assert.equal(byLead.get(String(leads[0]))?.move_assessment?.status, "ready");
      assert.equal(detail.data.review_items.length, n, "each record's review item is returned");
    });
  }
  assert.deepEqual(counts[1], counts[8], "same reads, same kinds, for 1 and 8 Outreach records");
  t.diagnostic(`reads per GET /numbers/:id = ${counts[1]!.length}: ${counts[1]!.join(", ")}`);
});

test("D2: readNumberOutreach passes the pending set per record (a record with no projection reads Pending only when queued)", async t => {
  const number = numberDoc("+16175550001");
  const [queued, idle] = [oid(), oid()];
  const store: Store = { contact_numbers: [number], attachments: [edge(number._id, queued), edge(number._id, idle)],
    records: [outreach(queued, number._id), outreach(idle, number._id)], form_leads: [lead(queued), lead(idle)],
    jobs: [{ _id: oid(), deployment: process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID, database: getMongoDatabaseName(), stage: "move_assessment", status: "leased", subject_key: subjectKeyOf(queued) },
      // Another deployment's job never counts (csiDataset scope).
      { _id: oid(), deployment: "other-deployment", database: getMongoDatabaseName(), stage: "move_assessment", status: "pending", subject_key: subjectKeyOf(idle) }] };
  const counter = install(t, store);
  const out = await readNumberOutreach(String(number._id), { edges: store.attachments as never, number, now: NOW, coverage: COVERAGE });
  const byLead = new Map(out.outreach_records.map(o => [o.subject.kind === "lead" ? o.subject.id : "", o.move_assessment]));
  assert.equal(byLead.get(String(queued))?.status, "pending");
  assert.equal(byLead.get(String(idle)), null, "not queued in this dataset: no projection");
  assert.equal(counter.reads.filter(r => r.startsWith("attachments.find")).length, 1, "only the side data's lead-keyed read; the Number's edges came from the caller");
  assert.equal(counter.reads.filter(r => r === "contact_numbers.find" || r === "contact_numbers.findById").length, 1, "only the suppressed-number check; the Number came from the caller");
});

test("V15 / D5: resolved → move_assessment + lead_status; multiple and none → no score, no Lead fields", async t => {
  const [one, two, none, pendingNo, passed] = ["+16175550101", "+16175550102", "+16175550103", "+16175550104", "+16175550105"].map(e => numberDoc(e));
  const [leadA, leadB, leadC, leadD, leadE] = [oid(), oid(), oid(), oid(), oid()];
  const booking = { _id: oid(), lead_model: "FormLead", lead_ref: leadA, book_date: new Date("2026-09-21T00:00:00Z"), job_no: "5564884" };
  const store: Store = {
    contact_numbers: [one!, two!, none!, pendingNo!, passed!],
    attachments: [edge(one!._id, leadA), edge(two!._id, leadB), edge(two!._id, leadC), edge(none!._id, leadC, "candidate"), edge(pendingNo!._id, leadD), edge(passed!._id, leadE)],
    records: [outreach(leadA, one!._id, { move_assessment: READY, state: "closed", closed_reason: "booked", closure_origin: "official" }),
      outreach(leadB, two!._id, { move_assessment: READY }), outreach(leadC, two!._id, { move_assessment: READY }),
      outreach(leadD, pendingNo!._id), outreach(leadE, passed!._id, { move_assessment: READY })],
    form_leads: [lead(leadA, { booked: true }), lead(leadB), lead(leadC), lead(leadD), lead(leadE, { move_date: new Date("2026-09-01T00:00:00Z") })],
    booked_leads: [booking],
    jobs: [{ _id: oid(), deployment: process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID, database: getMongoDatabaseName(), stage: "move_assessment", status: "retry", subject_key: subjectKeyOf(leadD) }],
  };
  const counter = install(t, store);
  const map = await loadAttachedLeadProgressForNumbers([one!, two!, none!, pendingNo!, passed!].map(n => String(n._id)), NOW);
  const a = map.get(String(one!._id))!;
  assert.equal(a.status, "resolved");
  assert.equal(a.lead_status, "booked");
  assert.equal(a.move_assessment?.transaction_intent ?? null, null, "a closed record's assessment is not applicable: no score");
  const multiple = map.get(String(two!._id))!;
  assert.deepEqual(multiple, { status: "multiple" }, "two attached Leads: never a score (A19 server half)");
  assert.deepEqual(map.get(String(none!._id)), { status: "none" }, "a lone candidate resolves nothing");
  assert.equal(map.get(String(pendingNo!._id))?.move_assessment?.status, "pending", "queued with no projection → Pending");
  const stale = map.get(String(passed!._id))!;
  assert.equal(stale.move_assessment?.transaction_intent, 75, "resolved open record shows its scores");
  assert.equal(stale.move_assessment?.stale, true);
  assert.equal(stale.move_assessment?.stale_reason, "move_date_passed", "the Outreach DTO's moveDatePassed rule at `now`");
  assert.equal(stale.lead_status, "open");
  assert.equal(counter.reads.filter(r => r === "jobs.distinct").length, 1, "one batched pending read for the page");
  assert.equal(counter.reads.filter(r => r === "jobs.exists").length, 0);

  // Row mapper: outreach_records_total from the rollup on every status; Lead fields only on resolved.
  const row = { ...two!, rollups: { ...(two!.rollups as object), outreach_records_total: 2 } } as unknown as ContactNumberLean;
  const item = toNumberSearchItem(row, { kind: "none" }, multiple);
  assert.deepEqual(item.attached_lead_progress, { status: "multiple", outreach_records_total: 2 });
  const resolvedItem = toNumberSearchItem({ ...row, _id: passed!._id } as ContactNumberLean, { kind: "none" }, stale);
  assert.equal(resolvedItem.attached_lead_progress?.move_assessment?.move_likelihood, 100);
  assert.equal(resolvedItem.attached_lead_progress?.outreach_records_total, 2);
  numberSearchItemDtoSchema.parse(resolvedItem);
  assert.deepEqual(attachedForItem({ status: "multiple", move_assessment: stale.move_assessment, lead_status: "open" } as never), { status: "multiple" }, "the mapper strips a score from a non-resolved status");
});

test("lead_status words (final spec §9.1 line 2)", () => {
  const b = { _id: oid(), book_date: new Date("2026-09-21T00:00:00Z") };
  const closed = (reason: string, origin: string) => ({ state: "closed", closed_reason: reason, closure_origin: origin }) as never;
  const open = { state: "unworked", closed_reason: null, closure_origin: null } as never;
  assert.equal(leadStatusWord(open, null, [], new Map()), null, "no Lead row: no word");
  assert.equal(leadStatusWord(open, { _id: oid() } as never, [], new Map()), "open");
  assert.equal(leadStatusWord(open, { _id: oid() } as never, [b], new Map()), "booked", "exact Booking row");
  assert.equal(leadStatusWord(open, { _id: oid() } as never, [b], new Map([[String(b._id), [{ _id: oid() }]]])), "booked_then_cancelled", "exact Cancellation row");
  assert.equal(leadStatusWord(open, { _id: oid(), cancelled: true } as never, [], new Map()), "booked_then_cancelled");
  for (const flag of ["duplicate", "bad_lead", "no_sync"]) assert.equal(leadStatusWord(open, { _id: oid(), [flag]: true } as never, [], new Map()), "not_booked", flag);
  assert.equal(leadStatusWord(closed("crm_dead", "crm_disposition"), { _id: oid() } as never, [], new Map()), "not_booked", "CRM disposition closure");
  assert.equal(leadStatusWord(closed("owner", "owner"), { _id: oid() } as never, [], new Map()), "open", "an Owner close is Outreach state, not a Lead status");
});
