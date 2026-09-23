import assert from "node:assert/strict";
import { test } from "node:test";
import { unknownCoverageFixture } from "../fixtures";
import { hex, legacyEnvelope, snapshot } from "../assessment/presentation.fixtures";
import type { EffectRow, FindingRow, FollowupLite, ReviewItemRow, SnapshotRow } from "../assessment/presentation";
import type { RecordLite } from "../assessment/reads";
import {
  compareCurrentFindings, CURRENT_FINDINGS_CONVERSATION_LIMIT, currentFindingsResponseSchema, findingReviewActions, readCurrentFindings,
  type CurrentConversationRow, type CurrentFindingsStore, type CurrentRunRow,
} from "./currentFindings";

/**
 * S3-FINDINGS unit tests (data spec §6.11 A, final spec §11.5, B20 in memory). The store is an in-memory
 * double with the Mongo store's filter semantics; it counts calls so the query shape is checked too.
 */
const NUMBER = hex(0x200), RECORD = hex(0x201), LEAD = hex(0x202);
const at = (day: number, hour = 15) => new Date(Date.UTC(2026, 8, day, hour));
const envelope = legacyEnvelope();
const moveFact = envelope.findings[0]!, callback = envelope.findings[1]!;
const quoted = { ...moveFact, key: "f3", kind: "quoted_amount", claim: "Quoted $4,200", actor: "rep", value: { amount_text: "$4,200", currency: "USD", meaning: "quote_total" } };
const coaching = { ...moveFact, key: "f4", kind: "coaching_note", claim: "Rep did not confirm the date", basis: "model_inference", actor: "unknown",
  value: { description: "Rep did not confirm the date" } };
const restriction = { ...moveFact, key: "f5", kind: "contact_restriction", claim: "No calls until October", clarity: "uncertain",
  value: { channels: ["call"], restriction: "until", until_text: "October" } };

type World = { record: RecordLite | null; purge: boolean; conversations: CurrentConversationRow[]; findings: FindingRow[]; runs: CurrentRunRow[];
  effects: EffectRow[]; reviews: Array<ReviewItemRow & { subject_key: string }>; snapshots: SnapshotRow[]; followups: FollowupLite[] };
const record = (over: Partial<RecordLite> = {}): RecordLite => ({ _id: RECORD, state: "open", subject: { kind: "lead", model: "FormLead", id: LEAD },
  primary_contact_number_id: NUMBER, ...over });
const run = (id: string, conversation: string | null, over: Partial<CurrentRunRow> = {}): CurrentRunRow => ({ _id: id, conversation_id: conversation, contact_number_id: NUMBER,
  status: "completed", purged_at: null, purge_started_at: null, manifest_snapshot_ids: [], step_artifacts: null, subject_key: conversation ? `conversation:${conversation}` : `number:${NUMBER}`,
  output: { schema_version: "csi-envelope-v1" }, ...over });
const finding = (id: string, runId: string, conversation: string | null, assertion: unknown, over: Partial<FindingRow> = {}): FindingRow => ({ _id: id, run_id: runId,
  conversation_id: conversation, revision: 1, assertion, review_state: "unreviewed", superseded_by: null, purged_at: null, resolved: null, ...over });

function memoryStore(world: World) {
  const calls: Record<string, number> = {};
  const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
  const store: CurrentFindingsStore = {
    record: async () => { count("record"); return world.record; },
    purgePending: async () => { count("purgePending"); return world.purge; },
    conversations: async (_number, limit) => { count("conversations"); return [...world.conversations].sort((a, b) => +(b.started_at ?? 0) - +(a.started_at ?? 0)).slice(0, limit); },
    findings: async (pairs, includeSuperseded) => { count("findings");
      return world.findings.filter(f => pairs.some(p => p.conversation_id === String(f.conversation_id) && p.run_id === String(f.run_id)) && !f.purged_at
        && (includeSuperseded || f.superseded_by == null)); },
    runs: async ids => { count("runs"); return world.runs.filter(r => ids.includes(String(r._id))); },
    effects: async (runIds, findingIds) => { count("effects"); return world.effects.filter(e => findingIds.includes(String(e.finding_id))); },
    reviewItems: async (subjects, findingIds) => { count("reviewItems");
      return world.reviews.filter(r => subjects.includes(r.subject_key) && r.state === "open" && (r.evidence_ids ?? []).some(id => findingIds.includes(String(id)))); },
    snapshots: async ids => { count("snapshots"); return world.snapshots.filter(s => ids.includes(String(s._id))); },
    followups: async ids => { count("followups"); return world.followups.filter(f => ids.includes(String(f._id))); },
    transcripts: async () => { count("transcripts"); return []; },
  };
  return { store, calls };
}
const deps = (store: CurrentFindingsStore) => ({ store, coverage: async () => unknownCoverageFixture });

// Two conversations, each with an older run and a latest run, plus a Number run.
const C1 = hex(0x301), C2 = hex(0x302), OLD1 = hex(0x401), NEW1 = hex(0x402), OLD2 = hex(0x403), NEW2 = hex(0x404), NUMBER_RUN = hex(0x405);
const F = { oldOnC1: hex(0x501), c1Callback: hex(0x502), c1Move: hex(0x503), c1Superseded: hex(0x504), c2Quoted: hex(0x505), c2Retracted: hex(0x506),
  numberRun: hex(0x507), c2Coaching: hex(0x508), c2Restriction: hex(0x509), c2Broken: hex(0x50a), oldOnC2: hex(0x50b) };
const FOLLOWUP = hex(0x601), REVIEW = hex(0x701), TRANSCRIPT = hex(0x801);
const transcriptResponse = { transcript: { conversation_id: C1, transcript_version: "v1", segments: [{ sid: 3, start_ms: 65_000, speaker: "customer", text: "We move on the fifteenth" },
  { sid: 4, start_ms: 70_000, speaker: "customer", text: "of October." }] } };
function world(): World {
  return {
    record: record(), purge: false,
    conversations: [{ _id: C1, latest_completed_run_id: NEW1, started_at: at(10) }, { _id: C2, latest_completed_run_id: NEW2, started_at: at(14) }],
    runs: [run(OLD1, C1), run(NEW1, C1, { manifest_snapshot_ids: [TRANSCRIPT] }), run(OLD2, C2), run(NEW2, C2), run(NUMBER_RUN, null)],
    findings: [
      finding(F.oldOnC1, OLD1, C1, moveFact),
      finding(F.oldOnC2, OLD2, C2, callback),
      finding(F.c1Callback, NEW1, C1, callback, { resolved: { due_at: at(18, 14) } }),
      finding(F.c1Move, NEW1, C1, { ...moveFact, evidence: [{ ...moveFact.evidence[0]!, snapshot_id: TRANSCRIPT, conversation_id: C1 }] }),
      finding(F.c1Superseded, NEW1, C1, { ...callback, key: "f9", claim: "Rep will call Monday" }, { superseded_by: F.c1Callback }),
      finding(F.c2Quoted, NEW2, C2, quoted, { resolved: { amount_cents: 420_000 } }),
      finding(F.c2Retracted, NEW2, C2, { ...callback, key: "f8", claim: "Rep will text tonight" }, { review_state: "retracted", revision: 3 }),
      finding(F.c2Coaching, NEW2, C2, coaching, { review_state: "confirmed", revision: 2 }),
      finding(F.c2Restriction, NEW2, C2, restriction),
      finding(F.c2Broken, NEW2, C2, { kind: "move_fact", claim: 42 }),
      finding(F.numberRun, NUMBER_RUN, null, callback),
    ],
    effects: [
      { _id: hex(0x901), finding_id: F.c1Callback, effect_kind: "create_followup", status: "applied", reason: null, target_id: FOLLOWUP },
      { _id: hex(0x902), finding_id: F.c1Callback, effect_kind: "supersede", status: "applied", reason: "superseded_by_later_finding", target_id: F.c1Superseded },
      { _id: hex(0x903), finding_id: F.c2Quoted, effect_kind: "open_review", status: "needs_review", reason: "prior_finding_contradicted", target_id: REVIEW },
    ],
    reviews: [{ _id: REVIEW, subject_key: `conversation:${C2}`, cause_kind: "unclear_commitment", state: "open", evidence_ids: [F.c2Restriction] }],
    snapshots: [snapshot(TRANSCRIPT, transcriptResponse)],
    followups: [{ _id: FOLLOWUP, kind: "call", description: "Call back Friday", status: "open", due_at: at(18, 14) }],
  };
}

test("B20 (unit): current findings are the latest run's per conversation, superseded dropped unless asked, retracted kept, Number and older runs excluded", async () => {
  const { store, calls } = memoryStore(world());
  const response = await readCurrentFindings(RECORD, { scope: "production" }, deps(store));
  const parsed = currentFindingsResponseSchema.parse(response);
  const { items, reason, truncated } = parsed.data;
  assert.deepEqual([reason, truncated], [null, false]);
  assert.deepEqual(items.map(i => i.id), [F.c2Retracted, F.c1Callback, F.c2Quoted, F.c2Restriction, F.c1Move, F.c2Coaching],
    "commitments (newest call first) › money › restrictions › move facts › coaching; older-run, Number-run, superseded and unparseable findings are not listed");
  const byId = new Map(items.map(i => [i.id, i]));
  assert.deepEqual([byId.get(F.c2Retracted)!.work_result, byId.get(F.c2Retracted)!.review_state], ["retracted", "retracted"]);
  assert.deepEqual([byId.get(F.c1Callback)!.work_result, byId.get(F.c1Callback)!.work_result_detail], ["applied", "follow-up due Sep 18, 10:00 AM ET"],
    "the supersede bookkeeping effect never reads as the work result");
  assert.deepEqual([byId.get(F.c1Callback)!.value_line, byId.get(F.c1Callback)!.source_word, byId.get(F.c1Callback)!.action_status_word, byId.get(F.c1Callback)!.category_label],
    ["Due Fri Sep 18, 10:00 AM ET", "Rep said", "Promised", "Commitments and next steps"]);
  assert.deepEqual([byId.get(F.c2Quoted)!.value_line, byId.get(F.c2Quoted)!.work_result], ["$4,200 · quote total", "not_applicable"],
    "a relation-driven open_review effect is bookkeeping, not this finding's work");
  assert.deepEqual([byId.get(F.c2Restriction)!.work_result, byId.get(F.c2Restriction)!.clarity], ["needs_review", "uncertain"], "an open review item naming the finding");
  assert.deepEqual([byId.get(F.c2Coaching)!.source_word, byId.get(F.c2Coaching)!.value_line], ["Model inference", null]);
  assert.deepEqual([byId.get(F.c1Callback)!.call_at, byId.get(F.c2Quoted)!.call_at], [at(10).toISOString(), at(14).toISOString()]);
  // Evidence items in the run-presentation shape, resolved from the loaded snapshot.
  const evidence = byId.get(F.c1Move)!.evidence;
  assert.equal(evidence.length, 1);
  assert.deepEqual([evidence[0]!.kind, evidence[0]!.availability, evidence[0]!.quote, evidence[0]!.speaker, evidence[0]!.speaker_label, evidence[0]!.at],
    ["transcript_quote", "retained", "We move on the fifteenth of October.", "customer", "Customer", new Date(+at(10) + 65_000).toISOString()]);
  assert.deepEqual(evidence[0]!.open, { kind: "analysis_evidence", run_id: NEW1, snapshot_id: TRANSCRIPT });
  // Review actions: only unreviewed findings, with the finding revision as the fence.
  assert.deepEqual(byId.get(F.c1Callback)!.allowed_actions.map(a => [a.action, a.enabled, a.expected_revision]),
    [["confirm_finding", true, 1], ["correct_finding", true, 1], ["retract_finding", true, 1]]);
  assert.ok(byId.get(F.c2Retracted)!.allowed_actions.every(a => !a.enabled && a.blocker_codes[0] === "ILLEGAL_TRANSITION" && a.expected_revision === 3));
  assert.ok(byId.get(F.c2Coaching)!.allowed_actions.every(a => !a.enabled));
  assert.deepEqual(calls, { record: 1, purgePending: 1, conversations: 1, findings: 1, runs: 1, effects: 1, reviewItems: 1, snapshots: 1, followups: 1 },
    "transcripts are not read when the cited snapshot carries the segments");

  const withSuperseded = currentFindingsResponseSchema.parse(await readCurrentFindings(RECORD, { include_superseded: "true" }, deps(memoryStore(world()).store))).data.items;
  const superseded = withSuperseded.find(i => i.id === F.c1Superseded);
  assert.ok(superseded, "include_superseded=true lists the superseded finding");
  assert.deepEqual([superseded.work_result, superseded.work_result_detail, superseded.superseded_by], ["superseded", F.c1Callback, F.c1Callback]);
  assert.equal(withSuperseded.length, items.length + 1);
});

test("current findings: no Number, retention pending, missing record, truncation at the conversation bound", async () => {
  const noNumber = memoryStore({ ...world(), record: record({ primary_contact_number_id: null }) });
  const empty = currentFindingsResponseSchema.parse(await readCurrentFindings(RECORD, {}, deps(noNumber.store))).data;
  assert.deepEqual(empty, { items: [], reason: "no_number", truncated: false });
  assert.deepEqual(noNumber.calls, { record: 1 }, "a Lead-only subject reads nothing past the record");

  const reviewSubject = memoryStore({ ...world(), record: record({ primary_contact_number_id: null, subject: { kind: "number_review", contact_number_id: NUMBER } }) });
  assert.equal(currentFindingsResponseSchema.parse(await readCurrentFindings(RECORD, {}, deps(reviewSubject.store))).data.items.length, 6,
    "a Number-review subject falls back to its subject Number");

  const purge = currentFindingsResponseSchema.parse(await readCurrentFindings(RECORD, {}, deps(memoryStore({ ...world(), purge: true }).store))).data;
  assert.deepEqual(purge, { items: [], reason: "retention_pending", truncated: false });

  assert.equal(await readCurrentFindings(RECORD, {}, deps(memoryStore({ ...world(), record: null }).store)), null);
  await assert.rejects(readCurrentFindings(RECORD, { include_superseded: "yes" }, deps(memoryStore(world()).store)));
  await assert.rejects(readCurrentFindings(RECORD, { cursor: "1" }, deps(memoryStore(world()).store)), "unknown query parameters are rejected");
  await assert.rejects(readCurrentFindings("not-an-id", {}, deps(memoryStore(world()).store)));

  const many = world();
  many.conversations = Array.from({ length: CURRENT_FINDINGS_CONVERSATION_LIMIT + 1 }, (_, i) => ({ _id: hex(0x10000 + i), latest_completed_run_id: hex(0x20000 + i),
    started_at: new Date(+at(1) + i * 60_000) }));
  const bounded = currentFindingsResponseSchema.parse(await readCurrentFindings(RECORD, {}, deps(memoryStore(many).store))).data;
  assert.deepEqual([bounded.truncated, bounded.items.length], [true, 0]);
  const exact = world();
  exact.conversations = many.conversations.slice(0, CURRENT_FINDINGS_CONVERSATION_LIMIT);
  assert.equal(currentFindingsResponseSchema.parse(await readCurrentFindings(RECORD, {}, deps(memoryStore(exact).store))).data.truncated, false);
});

test("current findings: the store call shape does not grow with the number of findings", async () => {
  const shape = async (n: number) => {
    const w = world();
    w.findings = Array.from({ length: n }, (_, i) => finding(hex(0x30000 + i), i % 2 ? NEW1 : NEW2, i % 2 ? C1 : C2, { ...callback, key: `k${i}` }));
    w.effects = w.findings.map((f, i) => ({ _id: hex(0x40000 + i), finding_id: String(f._id), effect_kind: "create_followup", status: "applied", reason: null, target_id: FOLLOWUP }));
    const { store, calls } = memoryStore(w);
    const items = currentFindingsResponseSchema.parse(await readCurrentFindings(RECORD, {}, deps(store))).data.items;
    assert.equal(items.length, n);
    return calls;
  };
  assert.deepEqual(await shape(2), await shape(40));
});

test("current findings ordering and review actions (pure)", () => {
  const row = (category: string | null, call_at: string | null, conversation_id: string, id: string) =>
    ({ category: category as never, call_at, conversation_id, id });
  const rows = [row("coaching", "2026-09-20T00:00:00.000Z", "c", "1"), row("commitments", "2026-09-10T00:00:00.000Z", "a", "2"), row(null, "2026-09-25T00:00:00.000Z", "d", "3"),
    row("commitments", null, "e", "4"), row("commitments", "2026-09-12T00:00:00.000Z", "b", "6"), row("commitments", "2026-09-12T00:00:00.000Z", "b", "5"),
    row("money", "2026-09-01T00:00:00.000Z", "a", "7")];
  assert.deepEqual([...rows].sort(compareCurrentFindings).map(r => r.id), ["5", "6", "2", "4", "7", "1", "3"],
    "category order, newest call first, unknown call time last, stored order within a call, unknown kinds last");
  const locked = findingReviewActions({ id: hex(1), revision: 2, review_state: "unreviewed" }, run(hex(2), C1, { output: null }));
  assert.ok(locked.every(a => !a.enabled && a.blocker_codes[0] === "REVISION_CONFLICT"), "a run without an output accepts no finding command");
  assert.ok(findingReviewActions({ id: hex(1), revision: 2, review_state: "unreviewed" }, run(hex(2), null)).every(a => !a.enabled), "a Number run never owns effects");
  assert.ok(findingReviewActions({ id: hex(1), revision: 2, review_state: "unreviewed" }, undefined).every(a => !a.enabled));
});
