import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import { attentionRowDtoSchema, type AttentionRowDto } from "../dto";
import { unknownCoverageFixture } from "../fixtures";
import { payloadHash } from "../transactions";
import { moveAssessmentProjectionDto } from "../assessment/presentation";
import { attentionCursorDigest, attentionQuerySchema, attentionSortKeys, clearParsedAttentionSnapshots, compressAttentionRows, readAttention, sortAttentionRows } from "./attention";

process.env.TEST_MODE = "true";
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "isolated";

const hex = (n: number) => n.toString(16).padStart(24, "0");
const derived = (band: number | null) => ({ overdue: false, no_owner: false, no_next_action: false, cooldown: false, attention_band: band, reasons: band ? [`band_${band}`] : [],
  review_item_ids: [], call_blockers: [], age_wall_ms: 0, age_staffed_ms: 0, policy_version: "csi-policy-v1" });
type Projection = Parameters<typeof moveAssessmentProjectionDto>[0]["move_assessment"];
/** A frozen row built the way publication builds it: projection DTO first, then sort keys from the row. */
function row(n: number, band: number | null, options: { projection?: Projection; state?: string; in_attention?: boolean; terminal?: boolean; pending?: boolean } = {}): AttentionRowDto {
  const state = options.state ?? "open";
  const lead_progress = options.terminal ? { disposition: "crm_dead", provenance: "accepted", override: null } : null;
  const move_assessment = moveAssessmentProjectionDto({ state, lead_progress, move_assessment: options.projection ?? null }, options.pending);
  const subject = { kind: "lead" as const, model: "FormLead" as const, id: hex(n) };
  const outreach = { id: hex(n), revision: 1, subject, state, reason: null, move_assessment,
    assignment: { agent: null, origin: null, assigned_at: null, evidence_ref: null, owner_instruction_id: null }, followups: [], followups_cursor: null, next_action: null,
    first_human_conversation_at: null, last_meaningful_contact_at: null, derived: derived(band), related_record_links: [], allowed_actions: [] };
  const base = { subject_key: `lead:FormLead:${hex(n)}`, subject, outreach, derived: derived(band), allowed_actions: [] };
  return attentionRowDtoSchema.parse({ ...base, sort_keys: attentionSortKeys(base as never), ...(options.in_attention === undefined ? {} : { in_attention: options.in_attention }) });
}
const ready = (ti: number | null, ml: number | null, stale = false): Projection =>
  ({ artifact_id: hex(900), status: "ready", transaction_intent: ti, move_likelihood: ml, transaction_intent_confidence: "medium", move_likelihood_confidence: "high",
    context_as_of: new Date("2026-09-22T00:00:00Z"), latest_conversation_at: null, stale, stale_reason: stale ? "move_date_passed" : null, published_at: new Date("2026-09-22T00:00:00Z") });

// Stored band order, as publication writes it: bands ascending, then no-band rows.
const rows = [
  row(1, 1, { projection: ready(25, 50), in_attention: true }),
  row(2, 3, { projection: ready(null, 75), in_attention: true }), // assessed Unknown intent
  row(3, 5, { in_attention: true }), // Not assessed
  row(4, 7, { projection: ready(100, 100), in_attention: true }),
  row(5, null, { projection: ready(75, 25), in_attention: false }), // no band: all_outreach only
  row(6, null, { projection: ready(90, 90, true), in_attention: false }), // stale keeps its number
  row(7, 2, { projection: ready(60, 60), in_attention: true, terminal: true }), // CRM terminal: not applicable
  row(8, 4, { projection: ready(80, 80), in_attention: true, state: "closed" }), // closed with a badge
  row(9, 6, { projection: ready(40, 40) }), // older snapshot row: no marker → in Attention
];

function mockSnapshot(t: TestContext, list: readonly AttentionRowDto[]) {
  const snapshot = { snapshot_id: "outreach:scores", as_of: new Date("2026-09-22T12:00:00Z"), expires_at: null, counts: { total_items: list.length }, rows: [],
    rows_gzip_base64: compressAttentionRows(list) };
  // Every test publishes its own rows under one snapshot id, so the parsed-snapshot cache starts empty.
  clearParsedAttentionSnapshots();
  const query = { select: () => query, sort: () => query, lean: async () => snapshot };
  t.mock.method(getSalesIntelligenceAttentionSnapshotModel(), "findOne", () => query);
}
const deps = { now: new Date("2026-09-22T12:01:00Z"), coverage: async () => unknownCoverageFixture };
const keys = (page: Awaited<ReturnType<typeof readAttention>>) => page.data.items.map(item => Number.parseInt(item.subject_key.split(":")[2]!, 16));
async function all(query: Record<string, unknown>) {
  const out: number[] = [];
  let cursor: string | undefined;
  do {
    const page = await readAttention({ ...query, limit: 2, ...(cursor ? { cursor } : {}) }, deps);
    out.push(...keys(page));
    cursor = page.data.cursor ?? undefined;
  } while (cursor);
  return out;
}

test("publication projection: closed and CRM-terminal rows are not applicable with null scores; stale keeps its number; pending and not assessed stay distinct", () => {
  const closed = rows.find(r => r.subject_key.endsWith(hex(8)))!.sort_keys!;
  assert.deepEqual([closed.transaction_intent, closed.move_likelihood, closed.assessment_status], [null, null, "not_applicable"]);
  const terminal = rows.find(r => r.subject_key.endsWith(hex(7)))!.sort_keys!;
  assert.deepEqual([terminal.transaction_intent, terminal.assessment_status], [null, "not_applicable"]);
  const stale = rows.find(r => r.subject_key.endsWith(hex(6)))!.sort_keys!;
  assert.deepEqual([stale.transaction_intent, stale.assessment_stale, stale.assessment_status], [90, true, "ready"]);
  const unknown = rows.find(r => r.subject_key.endsWith(hex(2)))!.sort_keys!;
  assert.deepEqual([unknown.transaction_intent, unknown.assessment_status], [null, "ready"], "assessed Unknown");
  const none = rows.find(r => r.subject_key.endsWith(hex(3)))!;
  assert.equal(none.outreach?.move_assessment, null, "Not assessed carries no projection");
  assert.deepEqual([none.sort_keys!.transaction_intent, none.sort_keys!.assessment_status], [null, null]);
  const pending = row(10, null, { pending: true }).sort_keys!;
  assert.deepEqual([pending.transaction_intent, pending.assessment_status], [null, "pending"]);
  for (const status of ["purged", "failed"]) {
    const keys = row(11, null, { projection: { ...ready(80, 80), status } }).sort_keys!;
    assert.deepEqual([keys.transaction_intent, keys.move_likelihood, keys.assessment_status], [null, null, status]);
  }
  // A time-sort-only row from an older snapshot has no score keys; it sorts last as null.
  assert.deepEqual(sortAttentionRows([{ subject_key: "b", sort_keys: { next_action_due: null, lead_received: null, last_human_contact: null, last_lead_progress: null } },
    { subject_key: "a", sort_keys: { next_action_due: null, lead_received: null, last_human_contact: null, last_lead_progress: null, transaction_intent: 10 } }], "transaction_intent", "desc").map(r => r.subject_key), ["a", "b"]);
});

test("score sorts over all_outreach: Band 7 score 100 precedes Band 1 score 25; asc/desc; Unknowns last both ways; ties on subject_key", async t => {
  mockSnapshot(t, rows);
  const desc = await all({ view: "all_outreach", sort: "transaction_intent" });
  // 100(4) 90(6) 75(5) 40(9) 25(1) then nulls by subject_key: 2 (Unknown), 3 (Not assessed), 7 (not applicable). Closed 8 is hidden.
  assert.deepEqual(desc, [4, 6, 5, 9, 1, 2, 3, 7]);
  assert.ok(desc.indexOf(4) < desc.indexOf(1), "Band 7 score 100 precedes Band 1 score 25");
  assert.deepEqual(await all({ view: "all_outreach", sort: "transaction_intent", direction: "asc" }), [1, 9, 5, 6, 4, 2, 3, 7]);
  const first = await readAttention({ view: "all_outreach", sort: "transaction_intent", limit: 3 }, deps);
  assert.equal(first.data.direction, "desc", "score sorts default to Highest first");
  assert.equal(first.data.total_items, 8, "counts describe the filtered population");
  // Ties resolve on subject_key, never band or confidence.
  const tied = [row(20, 7, { projection: ready(50, 50), in_attention: true }), row(19, 1, { projection: ready(50, 50), in_attention: true })];
  assert.deepEqual(sortAttentionRows(tied, "move_likelihood", "desc").map(r => r.subject_key), [tied[1]!.subject_key, tied[0]!.subject_key]);
  assert.deepEqual(sortAttentionRows(tied, "move_likelihood", "asc").map(r => r.subject_key), [tied[1]!.subject_key, tied[0]!.subject_key]);
});

test("multipage walks are stable and equal the one-page order; a zero is a real value ahead of Unknown", async t => {
  const withZero = [...rows, row(12, null, { projection: ready(0, 0), in_attention: false })];
  mockSnapshot(t, withZero);
  const onePage = keys(await readAttention({ view: "all_outreach", sort: "move_likelihood", limit: 200 }, deps));
  assert.deepEqual(await all({ view: "all_outreach", sort: "move_likelihood" }), onePage);
  assert.deepEqual(onePage, [4, 6, 2, 1, 9, 5, 12, 3, 7]);
  assert.deepEqual(await all({ view: "all_outreach", sort: "move_likelihood" }), onePage, "repeatable");
});

test("views: a no-band eligible row is reachable only in all_outreach; closed work only through an explicit state; default Attention unchanged", async t => {
  mockSnapshot(t, rows);
  const attention = await all({});
  // Stored order, minus in_attention:false rows; the unmarked older row stays in Attention; the closed row with a badge stays too.
  assert.deepEqual(attention, [1, 2, 3, 4, 7, 8, 9]);
  assert.ok(!attention.includes(5));
  assert.ok((await all({ view: "all_outreach" })).includes(5));
  assert.ok(!(await all({ view: "all_outreach" })).includes(8), "closed work is not in all_outreach by default");
  assert.deepEqual(await all({ view: "all_outreach", state: "closed" }), [8]);
  // The default request keeps the pre-sort digest shape: payloadHash of the filters alone.
  const first = await readAttention({ limit: 2 }, deps);
  const cursor = JSON.parse(Buffer.from(first.data.cursor!, "base64url").toString()) as { digest: string };
  assert.equal(cursor.digest, payloadHash({}));
  assert.equal(first.data.view, "attention");
  assert.equal(first.data.freshness, "all");
  // A time sort keeps the LP-06 digest shape.
  assert.equal(attentionCursorDigest({ sort: "lead_received", direction: "desc", view: "attention" }),
    payloadHash({ sort: "lead_received", direction: "desc", view: "attention" }));
  assert.equal(attentionCursorDigest({ sort: "attention", direction: "asc", view: "attention", freshness: "all" }), payloadHash({}));
});

test("freshness=fresh excludes stale rows; cursors reject a changed sort, direction, view, filter or freshness", async t => {
  mockSnapshot(t, rows);
  assert.ok(!(await all({ view: "all_outreach", sort: "transaction_intent", freshness: "fresh" })).includes(6));
  assert.ok((await all({ view: "all_outreach", sort: "transaction_intent", freshness: "all" })).includes(6));
  const base = { view: "all_outreach", sort: "transaction_intent", limit: 2 } as const;
  const first = await readAttention(base, deps);
  const cursor = first.data.cursor!;
  assert.equal((await readAttention({ ...base, cursor }, deps)).data.items.length, 2);
  for (const changed of [{ sort: "move_likelihood" }, { direction: "asc" }, { view: "attention" }, { band: "7" }, { freshness: "fresh" }, { sort: "attention" }]) {
    await assert.rejects(readAttention({ ...base, ...changed, cursor } as Parameters<typeof readAttention>[0], deps), { code: "INVALID_INPUT" }, JSON.stringify(changed));
  }
  // `freshness=all` is the documented default and keeps the same cursor.
  assert.equal((await readAttention({ ...base, freshness: "all", cursor }, deps)).data.items.length, 2);
  const attentionCursor = (await readAttention({ limit: 2 }, deps)).data.cursor!;
  await assert.rejects(readAttention({ limit: 2, view: "all_outreach", cursor: attentionCursor }, deps), { code: "INVALID_INPUT" });
});

test("query schema: new enums parse, unknown values and parameters are rejected", () => {
  const parsed = attentionQuerySchema.parse({ sort: "move_likelihood", view: "all_outreach", freshness: "fresh" });
  assert.deepEqual([parsed.sort, parsed.view, parsed.freshness, parsed.direction], ["move_likelihood", "all_outreach", "fresh", undefined]);
  assert.equal(attentionQuerySchema.parse({}).view, "attention");
  assert.equal(attentionQuerySchema.parse({}).freshness, undefined);
  assert.throws(() => attentionQuerySchema.parse({ view: "everything" }));
  assert.throws(() => attentionQuerySchema.parse({ freshness: "stale" }));
  assert.throws(() => attentionQuerySchema.parse({ sort: "confidence" }));
});
