import type { TestContext } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getGranotObservationModel } from "../../../models/GranotObservation";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getLeadMessageModel } from "../../../models/LeadMessage";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import type { S4Collection, S4Docs } from "./timeline.fixtures";

/**
 * Test-only in-memory stand-in for the reads the story readers and the timeline issue: model
 * `find` / `findOne` / `aggregate` (chain `select`, `sort`, `limit`, `lean`, `exec`, thenable) and raw
 * `collection(name).find(filter, {projection}).sort().limit().toArray()`. The filter evaluator covers
 * the operators those readers use (equality with null-matches-missing, `$in`, `$nin`, `$ne`, `$lt`,
 * `$lte`, `$gt`, `$gte`, `$exists`, `$type`, `$or`, `$and`, dotted paths through arrays); sort follows
 * Mongo's null-first ascending order; projections are applied. Unsupported shapes throw, so a reader
 * change that needs more cannot pass silently. `counter.queries` counts every read.
 */
type Doc = Record<string, unknown>;
const isOid = (v: unknown): v is mongoose.Types.ObjectId => v instanceof mongoose.Types.ObjectId;
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !isOid(v);

function valuesAt(value: unknown, path: string[]): unknown[] {
  if (!path.length) return [value];
  if (Array.isArray(value)) {
    const [head] = path;
    if (/^\d+$/.test(head!)) return valuesAt(value[Number(head)], path.slice(1));
    return value.flatMap(item => valuesAt(item, path));
  }
  if (!isPlain(value)) return [];
  if (!(path[0]! in value)) return [];
  const next = value[path[0]!];
  if (path.length === 1 && Array.isArray(next)) return [next, ...next];
  return valuesAt(next, path.slice(1));
}
/** Equality as Mongoose casts it: an ObjectId equals its hex string; dates by instant. */
const scalar = (v: unknown) => (isOid(v) ? v.toHexString() : v instanceof Date ? `date:${+v}` : v);
const eq = (a: unknown, b: unknown) => (a === null || a === undefined ? b === null || b === undefined : scalar(a) === scalar(b));
function cmp(a: unknown, b: unknown): number {
  const rank = (v: unknown) => (v === null || v === undefined ? 0 : typeof v === "number" ? 1 : typeof v === "string" ? 2 : isOid(v) ? 3 : typeof v === "boolean" ? 4 : v instanceof Date ? 5 : 6);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  const x = isOid(a) ? a.toHexString() : a instanceof Date ? +a : (a as number | string);
  const y = isOid(b) ? b.toHexString() : b instanceof Date ? +b : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
}
const comparable = (v: unknown, c: unknown) => v !== null && v !== undefined && (v instanceof Date) === (c instanceof Date) && isOid(v) === isOid(c);

function fieldMatches(values: unknown[], cond: unknown): boolean {
  if (isPlain(cond) && Object.keys(cond).some(k => k.startsWith("$"))) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case "$in": return (arg as unknown[]).some(c => (c === null ? values.length === 0 || values.some(v => v === null || v === undefined) : values.some(v => eq(v, c))));
        case "$nin": return !(arg as unknown[]).some(c => (c === null ? values.length === 0 || values.some(v => v === null) : values.some(v => eq(v, c))));
        case "$ne": return arg === null ? values.some(v => v !== null && v !== undefined) : !values.some(v => eq(v, arg));
        case "$lt": return values.some(v => comparable(v, arg) && cmp(v, arg) < 0);
        case "$lte": return values.some(v => comparable(v, arg) && cmp(v, arg) <= 0);
        case "$gt": return values.some(v => comparable(v, arg) && cmp(v, arg) > 0);
        case "$gte": return values.some(v => comparable(v, arg) && cmp(v, arg) >= 0);
        case "$exists": return (values.some(v => v !== undefined)) === Boolean(arg);
        case "$type": if (arg === "string") return values.some(v => typeof v === "string"); throw new Error(`fake mongo: $type ${String(arg)}`);
        default: throw new Error(`fake mongo: unsupported operator ${op}`);
      }
    });
  }
  if (cond instanceof RegExp) throw new Error("fake mongo: regex unsupported");
  return cond === null ? values.length === 0 || values.some(v => v === null || v === undefined) : values.some(v => eq(v, cond));
}
export function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Record<string, unknown>[]).some(f => matches(doc, f));
    if (key === "$and") return (cond as Record<string, unknown>[]).every(f => matches(doc, f));
    if (key.startsWith("$")) throw new Error(`fake mongo: unsupported ${key}`);
    return fieldMatches(valuesAt(doc, key.split(".")), cond);
  });
}

function sortRows(rows: Doc[], sort: Record<string, 1 | -1> | null): Doc[] {
  if (!sort) return rows;
  const keys = Object.entries(sort);
  return [...rows].sort((a, b) => {
    for (const [key, dir] of keys) {
      const c = cmp(valuesAt(a, key.split("."))[0], valuesAt(b, key.split("."))[0]);
      if (c) return dir === -1 ? -c : c;
    }
    return 0;
  });
}
function projectDoc(doc: Doc, projection: unknown): Doc {
  const paths = typeof projection === "string" ? projection.split(/\s+/).filter(Boolean)
    : isPlain(projection) ? Object.entries(projection).filter(([, v]) => v === 1 || v === true).map(([k]) => k) : [];
  if (typeof projection === "string" && paths.some(p => p.startsWith("-"))) throw new Error("fake mongo: exclusion projection");
  if (!paths.length) return { ...doc };
  const out: Doc = { _id: doc._id };
  for (const path of paths) {
    const parts = path.split(".");
    let src: unknown = doc, dst: Doc = out;
    for (let i = 0; i < parts.length; i++) {
      if (!isPlain(src) || !(parts[i]! in src)) break;
      const next = src[parts[i]!];
      if (i === parts.length - 1 || !isPlain(next)) { dst[parts[i]!] = next; break; }
      dst[parts[i]!] = isPlain(dst[parts[i]!]) ? dst[parts[i]!] : {};
      dst = dst[parts[i]!] as Doc; src = next;
    }
  }
  return out;
}

export type FakeCounter = { queries: number };
class FakeQuery {
  private sortSpec: Record<string, 1 | -1> | null = null;
  private limitN: number | null = null;
  constructor(private rows: () => Doc[], private filter: Record<string, unknown>, private projection: unknown, private single: boolean, private counter: FakeCounter) {}
  select(p: unknown) { this.projection = p; return this; }
  sort(s: Record<string, 1 | -1>) { this.sortSpec = s; return this; }
  limit(n: number) { this.limitN = n; return this; }
  lean() { return this; }
  session() { return this; }
  hint() { return this; }
  private run() {
    this.counter.queries++;
    let out = sortRows(this.rows().filter(d => matches(d, this.filter)), this.sortSpec);
    if (this.limitN !== null && this.limitN > 0) out = out.slice(0, this.limitN);
    const projected = out.map(d => projectDoc(d, this.projection));
    return this.single ? projected[0] ?? null : projected;
  }
  exec() { return Promise.resolve(this.run()); }
  toArray() { return this.exec(); }
  then<T>(resolve: (v: unknown) => T, reject?: (e: unknown) => T) { return this.exec().then(resolve, reject); }
}

function aggregate(rows: () => Doc[], pipeline: Array<Record<string, unknown>>, counter: FakeCounter) {
  counter.queries++;
  let out = rows();
  for (const stage of pipeline) {
    if (stage.$match) out = out.filter(d => matches(d, stage.$match as Record<string, unknown>));
    else if (stage.$limit) out = out.slice(0, Number(stage.$limit));
    else if (stage.$group) { if (out.length) throw new Error("fake mongo: $group over documents unsupported"); }
    else throw new Error(`fake mongo: unsupported stage ${Object.keys(stage)[0]}`);
  }
  return Promise.resolve(out);
}

const MODEL_BY_COLLECTION: Partial<Record<S4Collection, () => mongoose.Model<never>>> = {
  contactNumbers: getContactNumberModel as never, calls: getCallInteractionModel as never, conversations: getLeadConversationModel as never,
  messages: getLeadMessageModel as never, observations: getGranotObservationModel as never, attachments: getNumberLeadAttachmentModel as never,
  records: getOutreachRecordModel as never, followups: getOutreachFollowupModel as never, audits: getSalesIntelligenceAuditEventModel as never,
  artifacts: getMoveAssessmentArtifactModel as never, instructions: getSalesIntelligenceOwnerInstructionModel as never, repLinks: getRepIdentityLinkModel as never,
};
const RAW_COLLECTIONS: readonly S4Collection[] = ["form_leads", "call_leads", "entity_changes", "booked_leads", "cancelled_leads"];

/** Serves `docs` to every story/timeline read for the rest of the test (restored by `t.mock`). */
export function installFakeMongo(t: TestContext, docs: S4Docs): FakeCounter {
  const counter: FakeCounter = { queries: 0 };
  const serve = (model: mongoose.Model<never>, rows: () => Doc[]) => {
    t.mock.method(model, "find", ((filter: Record<string, unknown> = {}, projection?: unknown) => new FakeQuery(rows, filter, projection, false, counter)) as never);
    t.mock.method(model, "findOne", ((filter: Record<string, unknown> = {}, projection?: unknown) => new FakeQuery(rows, filter, projection, true, counter)) as never);
    t.mock.method(model, "aggregate", ((pipeline: Array<Record<string, unknown>>) => aggregate(rows, pipeline, counter)) as never);
  };
  for (const [name, getModel] of Object.entries(MODEL_BY_COLLECTION) as Array<[S4Collection, () => mongoose.Model<never>]>) serve(getModel(), () => docs[name]);
  serve(getIntelligenceEvidenceSnapshotModel() as never, () => []);
  serve(getIntelligenceFindingModel() as never, () => []);
  const connection = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  t.mock.method(connection, "collection", ((name: string) => {
    if (!(RAW_COLLECTIONS as readonly string[]).includes(name)) throw new Error(`fake mongo: raw collection ${name}`);
    return { find: (filter: Record<string, unknown> = {}, options?: { projection?: unknown }) => new FakeQuery(() => docs[name as S4Collection], filter, options?.projection, false, counter) };
  }) as never);
  return counter;
}
