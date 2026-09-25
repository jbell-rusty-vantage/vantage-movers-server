import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { timelineV2PageDtoSchema, type TimelineV2EventDto } from "../../numberActivity/dto";
import { legacyConversationFallbackEnabled, conversationSource as v1ConversationSource } from "../../numberActivity/timeline";
import { installFakeMongo } from "../story/fakeMongo.fixtures";
import { compareTimelineOrder } from "../story/sources";
import { buildS4TimelineDocs, S4_AS_OF, S4_E164, S4_IDS, type S4Docs } from "../story/timeline.fixtures";
import { readNumberTimelineV2, readOutreachTimeline, REP_HIDDEN_TIMELINE_KINDS } from "./timelineRead";

/**
 * Pure proof of the timeline v2 read over the real story readers (S4-TIMELINE), with the
 * deterministic S4 documents served by the in-memory Mongo fake. B12: a subject with ≥ 300 events
 * across every source, including the slack sources with out-of-order times, paged at `limit=7`,
 * concatenates to the list read in pages of 200 (no repeats, no skips, strict total order). Also
 * B13, the three reader fixes, D6, the kinds filter, the bounded read count and the DTO shapes.
 * The replica repeats this on a real `mongod` (`scripts/dev_ops/test-si-timeline.ts`).
 */
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID ||= "csi-local-proof";
const now = () => S4_AS_OF;
const coverage = { known_through: S4_AS_OF.toISOString(), gaps: [], capabilities: {}, ai_paused: false };
type Reader = (cursor: string | undefined, limit: number) => Promise<{ items: TimelineV2EventDto[]; cursor: string | null } | null>;
const numberReader = (id: string, kinds: string[] | null = null): Reader => (cursor, limit) =>
  readNumberTimelineV2(id, { cursor, limit, kinds }, { now, coverage }).then(page => page?.data ?? null);
const outreachReader = (id: string, kinds: string[] | null = null): Reader => (cursor, limit) =>
  readOutreachTimeline(id, { cursor, limit, kinds }, { now, coverage }).then(page => page?.data ?? null);

const repOutreachReader = (id: string, kinds: string[] | null = null): Reader => (cursor, limit) =>
  readOutreachTimeline(id, { cursor, limit, kinds, audience: "rep" }, { now, coverage }).then(page => page?.data ?? null);

async function pageAll(read: Reader, limit: number) {
  const items: TimelineV2EventDto[] = [];
  let cursor: string | undefined;
  for (let pages = 0; ; pages++) {
    assert.ok(pages < 1000, "terminates");
    const page = await read(cursor, limit);
    assert.ok(page, "subject resolves");
    assert.ok(page.items.length <= limit);
    items.push(...page.items);
    if (!page.cursor) return items;
    assert.equal(page.items.length, limit, "a page with a cursor is full");
    cursor = page.cursor;
  }
}
const keys = (items: TimelineV2EventDto[]) => items.map(e => `${e.kind}:${e.id}`);
const countBy = (items: TimelineV2EventDto[]) => items.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});
async function exact(label: string, read: Reader, minimum: number) {
  const big = await pageAll(read, 200);
  assert.ok(big.length >= minimum, `${label}: ${big.length} events, expected ≥ ${minimum}`);
  assert.equal(new Set(keys(big)).size, big.length, `${label}: no repeats`);
  for (let i = 1; i < big.length; i++) assert.ok(compareTimelineOrder(big[i - 1]!, big[i]!) < 0, `${label}: strict order at ${i}`);
  for (const limit of [7, 13]) assert.deepEqual(keys(await pageAll(read, limit)), keys(big), `${label}: limit ${limit} = pages of 200`);
  return big;
}
const oidEq = (a: unknown, b: unknown) => String(a) === String(b);
const docs = (): S4Docs => buildS4TimelineDocs();

test("B12 (real readers): Number scope, ≥ 300 events, every source and kind, limit 7 = pages of 200", async t => {
  const data = docs();
  installFakeMongo(t, data);
  const all = await exact("N1", numberReader(String(S4_IDS.n1)), 300);
  const byKind = countBy(all);
  for (const kind of ["lead_received", "call_qualified", "call", "conversation_analyzed", "conversation_recorded", "assessment_published", "granot_priority_changed",
    "quoted_changed", "granot_observed", "number_attached", "followup_created", "followup_completed", "followup_cancelled", "followup_superseded", "assigned", "owner_note",
    "closed", "reopened", "waiting_set", "review_opened", "review_resolved", "restriction_set", "nudge_sent", "followup_snoozed", "call_started", "call_ended",
    "analysis_submitted", "owner_correction", "booking_recorded", "cancellation_recorded", "lead_message_sent"]) assert.ok((byKind[kind] ?? 0) > 0, `kind ${kind} present`);
  // Counts straight from the fixture documents.
  assert.equal(byKind.call, data.calls.filter(c => oidEq(c.contact_number_id, S4_IDS.n1)).length);
  const addresses = [S4_E164.n1, "3055550101", "13055550101"];
  assert.equal(byKind.lead_message_sent, data.messages.filter(m => addresses.includes(String(m.to))
    || [String(S4_IDS.leadA), String(S4_IDS.leadB)].includes(String((m.lead_ref as { id?: unknown } | null)?.id))).length);
  assert.equal(byKind.followup_created, data.followups.filter(f => oidEq(f.outreach_record_id, S4_IDS.recordA) || oidEq(f.outreach_record_id, S4_IDS.recordB)).length);
  assert.equal(byKind.lead_received, 2, "the rejected Lead is not in scope");
  assert.equal(byKind.conversation_recorded, 1, "conversations with a call fold into it; the standalone one stays (routine)");
  assert.equal(byKind.assessment_published, 5, "shadow and failed artifacts are excluded");
  assert.equal(byKind.granot_priority_changed + byKind.quoted_changed, data.entity_changes.filter(c => ["FormLead", "CallLead"].includes(String((c.entity as { model: string }).model))
    && [String(S4_IDS.leadA), String(S4_IDS.leadB)].includes(String((c.entity as { id: string }).id))).length);
  assert.ok(all.some(e => e.kind === "number_attached" && e.detail.state === "rejected"), "the rejection itself is an event");
  console.log(`# N1 ${all.length} events ${JSON.stringify(byKind)}`);
});

test("B12 (real readers): Outreach scope, Lead-only record, kinds filters", async t => {
  installFakeMongo(t, docs());
  const n1 = await pageAll(numberReader(String(S4_IDS.n1)), 200);
  const scoped = await exact("record A", outreachReader(String(S4_IDS.recordA)), 150);
  const byKind = countBy(scoped);
  assert.equal(byKind.lead_received, 1);
  assert.equal(byKind.call, countBy(n1).call, "the primary Number's calls");
  assert.ok(!scoped.some(e => e.kind.startsWith("followup_") && e.subject_key === `lead:CallLead:${S4_IDS.leadB}`), "Lead B's work is not on Lead A's record");
  assert.ok(scoped.every(e => e.job_no === null), "scope outreach never prefixes a Job");
  const calls = await exact("N1 calls tab", numberReader(String(S4_IDS.n1), ["call"]), 100);
  assert.deepEqual(keys(calls), keys(n1.filter(e => e.kind === "call")), "Calls tab = the call subsequence");
  const slack = ["lead_message_sent", "granot_priority_changed", "quoted_changed"];
  assert.deepEqual(keys(await exact("N1 slack kinds", numberReader(String(S4_IDS.n1), slack), 50)), keys(n1.filter(e => slack.includes(e.kind))));
  const leadOnly = await exact("record L", outreachReader(String(S4_IDS.recordL)), 5);
  assert.ok(leadOnly.some(e => e.kind === "lead_message_sent") && leadOnly.every(e => e.kind !== "call"), "Lead-only: its Lead's messages, no calls");
  await exact("N2", numberReader(String(S4_IDS.n2)), 100);
  await exact("record M", outreachReader(String(S4_IDS.recordM)), 100);
});

test("V-T3 M8: a rep's Outreach timeline drops nudges and Owner notes before the page is cut; restrictions stay", async t => {
  installFakeMongo(t, docs());
  for (const record of [S4_IDS.recordA, S4_IDS.recordM]) {
    const owner = await pageAll(outreachReader(String(record)), 200);
    const hidden = owner.filter(e => REP_HIDDEN_TIMELINE_KINDS.includes(e.kind));
    assert.ok(hidden.some(e => e.kind === "nudge_sent") && hidden.some(e => e.kind === "owner_note"), "the fixture carries both Owner-only kinds");
    // Exact paging over the filtered stream: limit 7 and 13 concatenate to pages of 200, no repeats.
    const rep = await exact(`rep ${record}`, repOutreachReader(String(record)), 1);
    assert.deepEqual(keys(rep), keys(owner.filter(e => !REP_HIDDEN_TIMELINE_KINDS.includes(e.kind))), "the Owner's stream minus the hidden kinds");
    const restrictions = owner.filter(e => e.kind.startsWith("restriction_"));
    assert.ok(restrictions.length > 0, "the fixture carries a restriction event");
    assert.deepEqual(keys(rep.filter(e => e.kind.startsWith("restriction_"))), keys(restrictions), "do-not-call stays visible to the rep");
    // Asking for a hidden kind yields nothing (no reader output leaks through the kinds filter).
    assert.deepEqual(await pageAll(repOutreachReader(String(record), ["nudge_sent", "owner_note"]), 50), []);
  }
});

test("B13, reader fixes, D6, chips, actions and job prefixes (real readers)", async t => {
  const data = docs();
  installFakeMongo(t, data);
  const all = await pageAll(numberReader(String(S4_IDS.n1)), 200);
  const paired = all.find(e => e.id === `granot_priority_changed:${S4_IDS.pairedChange}`)!;
  const change = data.entity_changes.find(c => oidEq(c._id, S4_IDS.pairedChange))!;
  const observation = data.observations.find(o => oidEq(o._id, S4_IDS.pairedObservation))!;
  assert.equal(paired.happened_at, (observation.captured_at as Date).toISOString(), "B13 paired: happened_at = captured_at");
  assert.equal(paired.observed_at, (change.applied_at as Date).toISOString(), "B13 paired: observed_at = applied_at");
  assert.equal(paired.recorded_late, true);
  const unpaired = all.find(e => e.id === `granot_priority_changed:${S4_IDS.unpairedChange}`)!;
  assert.equal(unpaired.happened_at, (data.entity_changes.find(c => oidEq(c._id, S4_IDS.unpairedChange))!.applied_at as Date).toISOString());
  assert.equal(unpaired.observed_at, unpaired.happened_at, "B13 unpaired: applied_at for both");
  assert.equal(unpaired.recorded_late, false);

  const cancelled = all.find(e => e.id === `followup_cancelled:${S4_IDS.cancelledFollowupWithAudit}`)!;
  const audit = data.audits.find(a => oidEq(a._id, S4_IDS.cancelAudit))!;
  const row = data.followups.find(f => oidEq(f._id, S4_IDS.cancelledFollowupWithAudit))!;
  assert.equal(cancelled.happened_at, (audit.happened_at as Date).toISOString(), "fix: cancel timed by the audit row");
  assert.notEqual(cancelled.happened_at, (row.updatedAt as Date).toISOString());
  const noAudit = all.find(e => e.kind === "followup_cancelled" && e.detail.description === "Follow-up 9: call back about the estimate")!;
  assert.equal(noAudit.happened_at, (data.followups.find(f => f.description === "Follow-up 9: call back about the estimate")!.updatedAt as Date).toISOString(), "no audit row: updatedAt");
  const superseded = all.filter(e => e.kind === "followup_superseded");
  assert.ok(superseded.length > 0 && superseded.every(e => data.audits.some(a => (a.invalidation as { target_id: string }).target_id === e.detail.followup_id
    && (a.happened_at as Date).toISOString() === e.happened_at)), "supersedes timed by their audit rows");
  const undated = all.find(e => e.id === `booking_recorded:${S4_IDS.bookingNoDate}`)!;
  assert.ok(undated, "fix: an undated Booking is on the timeline");
  assert.equal(undated.happened_at, undated.observed_at);
  assert.equal(undated.recorded_late, false);
  assert.equal(undated.detail.book_date_missing, true);
  assert.equal(undated.title, "Booked · binder $800 · Marcus Bell");
  assert.equal(undated.action?.kind, "open_booking");

  for (const call of all.filter(e => e.kind === "call")) {
    const source = data.calls.find(c => oidEq(c._id, call.call!.interaction_id))!;
    assert.equal(call.observed_at, (source.first_observed_at as Date).toISOString(), "D6: first_observed_at");
    assert.equal(call.recorded_late, +(source.first_observed_at as Date) - +(source.started_at as Date) > 3_600_000);
    assert.equal(call.chips.includes("Recording"), (source.recordings as unknown[]).length > 0);
  }
  const analyzed = all.filter(e => e.kind === "call" && e.call?.recording_state === "analyzed");
  assert.ok(analyzed.length > 0 && analyzed.every(e => e.chips.includes("Analyzed") && e.action?.kind === "open_conversation"));
  assert.ok(all.some(e => e.kind === "call" && e.call?.recording_state === "recorded" && e.action === null), "a recorded, unanalyzed call has no action");
  assert.equal(all.find(e => e.kind === "call" && e.call?.rep?.status === "reviewed")!.call!.rep!.name, "Dana Reyes");
  assert.equal(all.find(e => e.kind === "call" && e.call?.rep?.status === "proposed")!.call!.rep!.name, null, "no name before review");
  assert.equal(all.find(e => e.kind === "lead_received" && e.subject_key === `lead:FormLead:${S4_IDS.leadA}`)!.job_no, "5590101", "multi-Lead Number: Job prefix");
  assert.equal(all.find(e => e.kind === "lead_received" && e.subject_key === `lead:CallLead:${S4_IDS.leadB}`)!.job_no, "5590102");
  assert.ok(all.filter(e => e.kind === "call").every(e => e.job_no === null));
  assert.ok(all.filter(e => e.routine).every(e => ["conversation_recorded", "granot_observed", "analysis_submitted"].includes(e.kind)));
  const snoozed = all.find(e => e.kind === "followup_snoozed")!;
  assert.match(snoozed.title, /^Snoozed until /);
  const single = (await pageAll(numberReader(String(S4_IDS.n2)), 200)).filter(e => e.kind === "lead_received");
  assert.ok(single.every(e => e.job_no === null), "a single-Lead Number never prefixes");
});

test("bounded reads: a deep page costs no more reads than the first; DTO shapes; misses", async t => {
  const counter = installFakeMongo(t, docs());
  counter.queries = 0;
  const first = await readNumberTimelineV2(String(S4_IDS.n1), { limit: 50 }, { now, coverage });
  const firstReads = counter.queries;
  let cursor = first!.data.cursor!;
  for (let i = 0; i < 4; i++) cursor = (await readNumberTimelineV2(String(S4_IDS.n1), { limit: 50, cursor }, { now, coverage }))!.data.cursor!;
  counter.queries = 0;
  await readNumberTimelineV2(String(S4_IDS.n1), { limit: 50, cursor }, { now, coverage });
  const deepReads = counter.queries;
  console.log(`# reads per page: first ${firstReads}, sixth ${deepReads}`);
  assert.ok(firstReads <= 30, `first page ${firstReads} reads`);
  assert.ok(deepReads <= firstReads + 8, `deep page ${deepReads} vs first ${firstReads}`);
  counter.queries = 0;
  await readNumberTimelineV2(String(S4_IDS.n1), { limit: 50, kinds: ["call"] }, { now, coverage });
  assert.ok(counter.queries <= 10, `the Calls tab runs one reader (${counter.queries} reads)`);
  assert.doesNotThrow(() => timelineV2PageDtoSchema.parse(first));
  const adminTimelineSchema = z.object({ as_of: z.string(), coverage: z.object({ known_through: z.string().nullable(), gaps: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() })), ai_paused: z.boolean() }),
    data: z.object({ number_id: z.string(), items: z.array(z.object({ id: z.string(), kind: z.string(), happened_at: z.string(), observed_at: z.string(), description: z.string(),
      evidence_refs: z.array(z.string()), detail: z.record(z.string(), z.json()) })), cursor: z.string().nullable() }) });
  assert.doesNotThrow(() => adminTimelineSchema.parse(JSON.parse(JSON.stringify(first))), "flag on: the current admin still parses the Number page");
  assert.deepEqual(first!.data.coverage.truncated_sources, []);
  assert.equal(await readNumberTimelineV2("64b000000000000000000fff", {}, { now, coverage }), null);
  assert.equal(await readOutreachTimeline("not-an-id", {}, { now, coverage }), null);
});

test("D4: the v1 legacy conversation scan is on by default and can be turned off", async t => {
  installFakeMongo(t, docs());
  const input = { number_id: String(S4_IDS.n1), e164: S4_E164.n1, national_ten: "3055550101", limit: 400, cursor: null };
  const saved = process.env.SALES_INTELLIGENCE_LEGACY_CONVERSATION_FALLBACK_DISABLED;
  try {
    process.env.SALES_INTELLIGENCE_LEGACY_CONVERSATION_FALLBACK_DISABLED = "";
    const on = (await v1ConversationSource(input)).map(e => e.id);
    const off = (await v1ConversationSource({ ...input, legacy_conversations: false })).map(e => e.id);
    assert.ok(on.includes(String(S4_IDS.legacyConversation)), "default (absent option): fallback on");
    assert.ok(!off.includes(String(S4_IDS.legacyConversation)), "gate off: no legacy scan");
    assert.equal(on.length - off.length, 1);
    assert.equal(legacyConversationFallbackEnabled(), true);
    process.env.SALES_INTELLIGENCE_LEGACY_CONVERSATION_FALLBACK_DISABLED = "true";
    assert.equal(legacyConversationFallbackEnabled(), false);
  } finally {
    if (saved === undefined) delete process.env.SALES_INTELLIGENCE_LEGACY_CONVERSATION_FALLBACK_DISABLED;
    else process.env.SALES_INTELLIGENCE_LEGACY_CONVERSATION_FALLBACK_DISABLED = saved;
  }
});
