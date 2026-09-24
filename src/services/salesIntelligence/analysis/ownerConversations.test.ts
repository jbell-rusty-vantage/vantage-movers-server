import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { unknownCoverageFixture } from "../fixtures";
import { hex } from "../assessment/presentation.fixtures";
import { CsiError } from "../auth";
import {
  CALL_SUMMARY_KEYS, CALL_SUMMARY_LABELS, cardSummary, decodeConversationCursor, ownerConversationsResponseSchema, ownerTranscriptResponseSchema,
  readOwnerConversations, readOwnerTranscript, recordingLabel, recordingState, selectCanonicalSummary, SPEAKER_LABELS,
  type CallRow, type ConversationRow, type NumberRow, type OwnerConversationsStore, type OwnerTranscriptStore, type RepLinkRow, type SummarySnapshotRow,
  type TranscriptPresenceRow, type TranscriptSnapshotRow,
} from "./ownerConversations";

/**
 * S4-CONV unit tests (data spec §6.7, §6.8; final spec §11.7). The stores are in-memory doubles with the Mongo
 * stores' filter and order semantics; they count calls so the fixed query shape per page is checked too.
 */
const NUMBER = hex(0x900);
const deps = { coverage: async () => unknownCoverageFixture, now: () => new Date("2026-09-23T18:00:00.000Z") };
const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 15, 0) + minute * 60_000);
const fullSummary = { overview: "Customer is moving a two-bedroom to Denver; email jane@example.com.", customer_wanted: "A quote for mid January.",
  money_and_dates: "Quoted $4,200 for Jan 15.", outcome: "Customer will think about it.", commitments: "Rep calls back Tuesday.", discrepancies: "" };
const step1 = (id: string, conversation: string, version: string | null, summary: Record<string, string> = fullSummary): SummarySnapshotRow =>
  ({ _id: id, conversation_id: conversation, transcript_version: version, analysis_summary: { summary, said_on_call: [] } });

type World = { number: NumberRow | null; calls: CallRow[]; conversations: ConversationRow[]; summaries: SummarySnapshotRow[];
  transcripts: TranscriptPresenceRow[]; links: RepLinkRow[] };
function memoryStore(world: World) {
  const calls: Record<string, number> = {};
  const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
  const order = (a: CallRow, b: CallRow) => (+b.started_at - +a.started_at) || String(b._id).localeCompare(String(a._id));
  const store: OwnerConversationsStore = {
    number: async () => { count("number"); return world.number; },
    calls: async (numberId, after, fetch) => {
      count("calls");
      assert.equal(numberId, NUMBER);
      return [...world.calls].sort(order).filter(c => !after || +c.started_at < +after.started_at || (+c.started_at === +after.started_at && String(c._id) < after.id)).slice(0, fetch);
    },
    conversations: async ids => { count("conversations"); return world.conversations.filter(c => ids.includes(String(c._id))); },
    summaries: async ids => { count("summaries"); return world.summaries.filter(s => ids.includes(String(s.conversation_id))); },
    transcripts: async pairs => { count("transcripts"); return world.transcripts.filter(t => pairs.some(p => p.conversation_id === String(t.conversation_id) && p.transcript_version === t.transcript_version)); },
    repLinks: async (accounts, extensions) => { count("repLinks"); return world.links.filter(l => accounts.includes(l.rc_account_id) && extensions.includes(l.rc_extension_id)); },
  };
  return { store, calls };
}
const call = (n: number, started: Date, over: Partial<CallRow> = {}): CallRow => ({ _id: hex(0x1000 + n), started_at: started, direction: "Inbound", duration_seconds: 60 + n,
  provider_result: "Call connected", contact_type: "human_conversation", provider_account_id: "acct", parties: [], recordings: [], ...over });
const conversation = (n: number, over: Partial<ConversationRow> = {}): ConversationRow => ({ _id: hex(0x2000 + n), started_at: at(n), contact_number_id: NUMBER,
  latest_completed_run_id: null, latest_transcript_version: `v${n}`, content_purged_at: null, media: { blob_pathname: `conversations/acct/rec-${n}.mp3`, purged_at: null }, summary: null, ...over });
const linked = (n: number) => [{ provider_recording_id: `rec-${n}`, lead_conversation_id: hex(0x2000 + n) }];

test("S4-CONV conversations: keyset pages over (started_at desc, _id desc) are exact with ties, and the query shape is fixed per page", async () => {
  // 23 calls, three pairs share a started_at; every third call has a conversation.
  const world: World = { number: { _id: NUMBER }, calls: [], conversations: [], summaries: [], transcripts: [], links: [] };
  for (let n = 0; n < 23; n++) {
    const started = at(n % 7 === 0 ? n + 1 : n);
    const withConversation = n % 3 === 0;
    world.calls.push(call(n, started, withConversation ? { recordings: linked(n) } : { contact_type: "voicemail", provider_result: "Voicemail" }));
    if (withConversation) world.conversations.push(conversation(n));
  }
  const expected = [...world.calls].sort((a, b) => (+b.started_at - +a.started_at) || String(b._id).localeCompare(String(a._id))).map(c => String(c._id));
  const { store, calls } = memoryStore(world);
  const seen: string[] = [];
  let cursor: string | undefined, pages = 0;
  do {
    const result = await readOwnerConversations(NUMBER, { limit: "4", ...(cursor ? { cursor } : {}) }, { ...deps, store });
    assert.ok(result);
    ownerConversationsResponseSchema.parse(result);
    const page = [...result.data.items, ...result.data.other_calls].sort((a, b) => (Date.parse(b.started_at) - Date.parse(a.started_at)) || b.interaction_id.localeCompare(a.interaction_id));
    assert.ok(page.length <= 4);
    seen.push(...page.map(row => row.interaction_id));
    for (const item of result.data.items) assert.equal(item.conversation_id, hex(0x2000 + (parseInt(item.interaction_id, 16) - 0x1000)));
    cursor = result.data.next_cursor ?? undefined;
    pages++;
  } while (cursor);
  assert.deepEqual(seen, expected);
  assert.equal(pages, 6);
  // One read of each kind per page; no per-row query.
  for (const name of ["number", "calls", "conversations", "summaries", "transcripts", "repLinks"]) assert.equal(calls[name], pages, name);
  // A limit that divides the set exactly ends with a null cursor, not an empty extra page.
  const exact = await readOwnerConversations(NUMBER, { limit: "23" }, { ...deps, store });
  assert.equal(exact?.data.next_cursor, null);
  assert.equal((exact?.data.items.length ?? 0) + (exact?.data.other_calls.length ?? 0), 23);
});

test("S4-CONV conversations: step-1 summary, legacy fallback, none; recording states; rep names only when reviewed; no blob path", async () => {
  const world: World = { number: { _id: NUMBER }, calls: [], conversations: [], summaries: [], transcripts: [], links: [] };
  const userParty = (extension: string) => [{ role: "user", extension_id: extension, connected: true }];
  // 1: structured, available media, transcript kept, reviewed rep.
  world.calls.push(call(1, at(50), { recordings: linked(1), direction: "Outbound", parties: userParty("101") }));
  world.conversations.push(conversation(1, { latest_completed_run_id: hex(0x3001), summary: { text: "synthesis", sections: { overview: "LEGACY MUST NOT SHOW" } } }));
  world.summaries.push(step1(hex(0x4001), hex(0x2001), "v1"), step1(hex(0x4000), hex(0x2001), "v0", { ...fullSummary, overview: "older transcript" }));
  world.transcripts.push({ conversation_id: hex(0x2001), transcript_version: "v1" });
  world.links.push({ _id: hex(0x5001), revision: 1, agent_id: hex(0x6001), rc_account_id: "acct", rc_extension_id: "101", role_kind: "sales_rep", status: "reviewed",
    effective_from: at(0), effective_to: null, agent_name_snapshot: "Dana Rep" });
  // 2: legacy summary, purged audio, transcript kept, proposed-only rep.
  world.calls.push(call(2, at(40), { recordings: linked(2), parties: userParty("202") }));
  world.conversations.push(conversation(2, { latest_completed_run_id: hex(0x3002), media: { blob_pathname: "conversations/acct/rec-2.mp3", purged_at: at(45) },
    summary: { text: "legacy text", sections: { overview: "Legacy overview", customer_wanted: "Wanted a quote", money_dates: "$3,000 in March", outcome: "Booked",
      promised: "Send estimate", mismatch: "Lead says April" } } }));
  world.transcripts.push({ conversation_id: hex(0x2002), transcript_version: "v2" });
  world.links.push({ _id: hex(0x5002), revision: 1, agent_id: hex(0x6002), rc_account_id: "acct", rc_extension_id: "202", role_kind: "sales_rep", status: "proposed",
    effective_from: at(0), effective_to: null, agent_name_snapshot: "Proposed Name" });
  // 3: not analysed, never fetched (no media): no summary, not recorded; transcript missing.
  world.calls.push(call(3, at(30), { recordings: linked(3), contact_type: "unknown" }));
  world.conversations.push(conversation(3, { media: null, latest_transcript_version: null }));
  // 4: legacy summary stored without sections reads as its overview; audio removed and no transcript.
  world.calls.push(call(4, at(20), { recordings: linked(4) }));
  world.conversations.push(conversation(4, { media: { blob_pathname: null, purged_at: at(25) }, summary: { text: "Only a text summary", sections: null } }));
  // 5: a call whose recording link points at a missing conversation is an other call.
  world.calls.push(call(5, at(10), { recordings: [{ provider_recording_id: "rec-5", lead_conversation_id: hex(0x2999) }], provider_result: "Missed", duration_seconds: null }));

  const { store } = memoryStore(world);
  const result = await readOwnerConversations(NUMBER, {}, { ...deps, store });
  assert.ok(result);
  ownerConversationsResponseSchema.parse(result);
  const [one, two, three, four] = result.data.items;
  assert.equal(result.data.items.length, 4);

  assert.equal(one!.summary_source, "call_summary");
  assert.deepEqual(one!.summary_sections.map(s => s.key), [...CALL_SUMMARY_KEYS]);
  assert.deepEqual(one!.summary_sections.map(s => s.label), ["Overview", "What the customer wanted", "Money and dates", "Outcome", "Commitments", "Discrepancies"]);
  assert.equal(one!.summary_sections[0]!.text, "Customer is moving a two-bedroom to Denver; email [REDACTED:EMAIL].");
  assert.equal(one!.summary_sections[5]!.text, null);
  assert.equal(one!.run_id, hex(0x3001));
  assert.equal(one!.recording_state, "available");
  assert.equal(one!.recording_label, "available");
  assert.equal(one!.media_available, true);
  assert.equal(one!.transcript_available, true);
  assert.deepEqual(one!.rep, { name: "Dana Rep", status: "reviewed" });
  assert.equal(one!.direction_label, "Outbound");
  assert.equal(one!.contact_type_label, "Human conversation");
  assert.equal(one!.started_at_label, "Sun Sep 20, 11:50 AM ET");

  assert.equal(two!.summary_source, "legacy");
  assert.deepEqual(Object.fromEntries(two!.summary_sections.map(s => [s.key, s.text])), { overview: "Legacy overview", customer_wanted: "Wanted a quote",
    money_and_dates: "$3,000 in March", outcome: "Booked", commitments: "Send estimate", discrepancies: "Lead says April" });
  assert.equal(two!.recording_state, "audio_removed");
  assert.equal(two!.recording_label, "audio removed under retention; transcript kept");
  assert.equal(two!.media_available, false);
  assert.equal(two!.transcript_available, true);
  assert.deepEqual(two!.rep, { name: null, status: "proposed" });

  assert.equal(three!.summary_source, null);
  assert.deepEqual(three!.summary_sections, []);
  assert.equal(three!.recording_state, "not_recorded");
  assert.equal(three!.recording_label, "not recorded");
  assert.equal(three!.transcript_available, false);
  assert.equal(three!.contact_type_label, "Contact unknown");
  assert.deepEqual(three!.rep, { name: null, status: "unknown" });

  assert.equal(four!.summary_source, "legacy");
  assert.equal(four!.summary_sections[0]!.text, "Only a text summary");
  assert.equal(four!.summary_sections[1]!.text, null);
  assert.equal(four!.recording_label, "audio removed under retention");

  assert.equal(result.data.other_calls.length, 1);
  assert.deepEqual({ ...result.data.other_calls[0], started_at_label: undefined }, { interaction_id: hex(0x1005), started_at: at(10).toISOString(), started_at_label: undefined,
    direction: "Inbound", direction_label: "Inbound", duration_seconds: null, rep: { name: null, status: "unknown" }, contact_type: "human_conversation",
    contact_type_label: "Human conversation", recording_count: 1, terminal: true, call_log_state: null, in_progress: false, result: "Missed" });

  const body = JSON.stringify(result);
  assert.doesNotMatch(body, /conversations\/acct|rec-\d\.mp3|blob/i);
  assert.doesNotMatch(body, /LEGACY MUST NOT SHOW|older transcript|Proposed Name/);
});

test("S4-CONV conversations: missing, purged and purge-pending Numbers are 404; cursors are validated", async () => {
  for (const number of [null, { _id: NUMBER, purged_at: at(1) }, { _id: NUMBER, content_purge_pending: true }]) {
    const { store } = memoryStore({ number, calls: [], conversations: [], summaries: [], transcripts: [], links: [] });
    assert.equal(await readOwnerConversations(NUMBER, {}, { ...deps, store }), null);
  }
  const { store } = memoryStore({ number: { _id: NUMBER }, calls: [], conversations: [], summaries: [], transcripts: [], links: [] });
  await assert.rejects(readOwnerConversations(NUMBER, { cursor: "nope" }, { ...deps, store }));
  await assert.rejects(readOwnerConversations(NUMBER, { limit: "101" }, { ...deps, store }));
  await assert.rejects(readOwnerConversations(NUMBER, { other: "1" }, { ...deps, store }));
  assert.throws(() => decodeConversationCursor("99999999999999999.abc"), (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT");
  const empty = await readOwnerConversations(NUMBER, {}, { ...deps, store });
  assert.deepEqual(empty?.data, { contact_number_id: NUMBER, items: [], other_calls: [], next_cursor: null });
  assert.equal(empty?.as_of, "2026-09-23T18:00:00.000Z");
});

test("S4-CONV canonical summary selection is prior.ts's: the current transcript version, else the newest row; unreadable rows are skipped", () => {
  const rows = [step1(hex(0x10), "c", "old"), step1(hex(0x12), "c", "newest-other"), step1(hex(0x11), "c", "current", { ...fullSummary, overview: "current" })];
  assert.equal(selectCanonicalSummary(rows, "current")?.snapshot_id, hex(0x11));
  assert.equal(selectCanonicalSummary(rows, "missing")?.snapshot_id, hex(0x12));
  assert.equal(selectCanonicalSummary([], "current"), null);
  assert.equal(selectCanonicalSummary([{ _id: hex(1), conversation_id: "c", transcript_version: "v", analysis_summary: { bad: true } }], "v"), null);
  // Content purge hides the legacy summary too.
  assert.deepEqual(cardSummary({ _id: hex(2), content_purged_at: at(1), summary: { text: "t", sections: { overview: "o" } } }, []), { summary_source: null, summary_sections: [] });
  assert.equal(recordingState({ media: { blob_pathname: "x", purged_at: at(1) } }), "audio_removed");
  assert.equal(recordingState({ media: null }), "not_recorded");
  assert.equal(recordingLabel("audio_removed", false), "audio removed under retention");
});

test("S4-CONV labels are the S3-PRES strings (no drift from assessment/presentation.ts)", () => {
  const source = readFileSync("src/services/salesIntelligence/assessment/presentation.ts", "utf8");
  const literal = (name: string) => {
    const match = new RegExp(`const ${name}(?::[^=]+)? = (\\{[^}]+\\})`).exec(source);
    assert.ok(match, name);
    return Object.fromEntries([...match[1]!.matchAll(/(\w+): "([^"]+)"/g)].map(m => [m[1], m[2]]));
  };
  assert.deepEqual(literal("SUMMARY_LABELS"), { ...CALL_SUMMARY_LABELS });
  assert.deepEqual(literal("PARTY_LABELS"), { ...SPEAKER_LABELS });
});

// ── Transcript ───────────────────────────────────────────────────────
const CONVERSATION = hex(0x7001), SNAPSHOT = hex(0x7002);
function transcriptStore(over: { conversation?: ConversationRow | null; number?: NumberRow | null; snapshot?: TranscriptSnapshotRow | null; segments?: unknown[] } = {}) {
  const segments = over.segments ?? Array.from({ length: 250 }, (_, i) => ({ sid: i + 1, start_ms: i % 10 === 9 ? null : i * 1000, end_ms: i % 10 === 9 ? null : i * 1000 + 900,
    timing_source: i % 10 === 9 ? "unavailable" : "provider", speaker: i % 2 ? "rep" : "customer", text: i === 0 ? "Card 4111 1111 1111 1111 please" : `segment ${i + 1}` }));
  const reads: Array<{ offset: number; limit: number }> = [];
  const store: OwnerTranscriptStore = {
    conversation: async id => (over.conversation === undefined ? { _id: id, started_at: new Date("2026-09-20T15:00:00.000Z"), contact_number_id: NUMBER, latest_transcript_version: "tv2", content_purged_at: null } : over.conversation),
    number: async () => (over.number === undefined ? { _id: NUMBER } : over.number),
    transcript: async (conversationId, version) => {
      assert.equal(conversationId, CONVERSATION); assert.equal(version, "tv2");
      return over.snapshot === undefined ? { _id: SNAPSHOT, transcript_version: "tv2", completeness: { complete: true, missing_ranges: [] } } : over.snapshot;
    },
    segments: async (snapshotId, offset, limit) => { assert.equal(snapshotId, SNAPSHOT); reads.push({ offset, limit }); return { total: segments.length, segments: segments.slice(offset, offset + limit) }; },
  };
  return { store, reads };
}

test("S4-CONV transcript: $slice pages, offsets, completeness ranges, segment ids, speaker labels, at, redaction", async () => {
  const { store, reads } = transcriptStore();
  const first = await readOwnerTranscript(CONVERSATION, {}, { ...deps, store });
  assert.ok(first);
  ownerTranscriptResponseSchema.parse(first);
  assert.equal(first.data.available, true);
  assert.equal(first.data.segments.length, 100);
  assert.deepEqual(reads[0], { offset: 0, limit: 100 });
  assert.equal(first.data.total, 250);
  assert.equal(first.data.next_offset, 100);
  assert.deepEqual(first.data.completeness, { complete: false, missing_ranges: ["segments_after:100"] });
  const [a, b] = first.data.segments;
  assert.deepEqual(a, { sid: 1, start_ms: 0, end_ms: 900, timing_source: "provider", speaker: "customer", speaker_label: "Customer",
    text: "Card [REDACTED:CARD] please", at: "2026-09-20T15:00:00.000Z" });
  assert.equal(b!.speaker_label, "Rep");
  assert.equal(b!.at, "2026-09-20T15:00:01.000Z");
  assert.equal(first.data.segments[9]!.at, null);

  const middle = await readOwnerTranscript(CONVERSATION, { offset: "100", limit: "100" }, { ...deps, store });
  assert.equal(middle?.data.segments[0]!.sid, 101);
  assert.deepEqual(middle?.data.completeness.missing_ranges, ["segments_before:100", "segments_after:200"]);
  const last = await readOwnerTranscript(CONVERSATION, { offset: "200" }, { ...deps, store });
  assert.equal(last?.data.segments.length, 50);
  assert.equal(last?.data.next_offset, null);
  assert.deepEqual(last?.data.completeness, { complete: false, missing_ranges: ["segments_before:200"] });
  const end = await readOwnerTranscript(CONVERSATION, { offset: "250" }, { ...deps, store });
  assert.equal(end?.data.segments.length, 0);
  await assert.rejects(readOwnerTranscript(CONVERSATION, { offset: "251" }, { ...deps, store }), (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT");
  await assert.rejects(readOwnerTranscript(CONVERSATION, { limit: "101" }, { ...deps, store }));

  // A short transcript read in one page is complete; the snapshot's own missing ranges are carried.
  const short = transcriptStore({ segments: [{ sid: 3, start_ms: 500, end_ms: 800, timing_source: "provider", speaker: "unknown", text: "hi" }],
    snapshot: { _id: SNAPSHOT, transcript_version: "tv2", completeness: { complete: false, missing_ranges: ["provider_gap:10-20"] } } });
  const one = await readOwnerTranscript(CONVERSATION, {}, { ...deps, store: short.store });
  assert.deepEqual(one?.data.completeness, { complete: false, missing_ranges: ["provider_gap:10-20"] });
  assert.equal(one?.data.segments[0]!.speaker_label, "Speaker unknown");
  const complete = transcriptStore({ segments: [{ sid: 1, start_ms: null, end_ms: null, timing_source: "unavailable", speaker: "rep", text: "hello" }] });
  assert.deepEqual((await readOwnerTranscript(CONVERSATION, {}, { ...deps, store: complete.store }))?.data.completeness, { complete: true, missing_ranges: [] });
});

test("S4-CONV transcript: missing conversation 404; purged, missing or retention-pending transcripts read as unavailable", async () => {
  assert.equal(await readOwnerTranscript(CONVERSATION, {}, { ...deps, store: transcriptStore({ conversation: null }).store }), null);
  const cases: Array<[Parameters<typeof transcriptStore>[0], string]> = [
    [{ snapshot: null }, "transcript_unavailable"],
    [{ number: { _id: NUMBER, content_purge_pending: true } }, "retention_pending"],
    [{ conversation: { _id: CONVERSATION, started_at: null, contact_number_id: null, latest_transcript_version: null } }, "transcript_unavailable"],
    [{ conversation: { _id: CONVERSATION, started_at: null, contact_number_id: null, latest_transcript_version: "tv2", content_purged_at: at(1) } }, "transcript_unavailable"],
  ];
  for (const [over, reason] of cases) {
    const result = await readOwnerTranscript(CONVERSATION, {}, { ...deps, store: transcriptStore(over).store });
    assert.ok(result);
    ownerTranscriptResponseSchema.parse(result);
    assert.equal(result.data.available, false);
    assert.deepEqual(result.data.segments, []);
    assert.deepEqual(result.data.completeness, { complete: false, missing_ranges: [reason] });
  }
});

test("S5c-CALLS C16/C17: other_calls and cards carry terminal, call_log_state and in_progress; an in-progress call has no result or duration", async () => {
  const world: World = { number: { _id: NUMBER }, calls: [], conversations: [], summaries: [], transcripts: [], links: [] };
  // A webhook-only in-progress call (direction still Unknown), a historical call (no call_log_state, terminal true) and a settled card.
  world.calls.push(call(1, at(30), { terminal: false, call_log_state: null, direction: "Unknown", provider_result: "Missed", duration_seconds: 42 }));
  world.calls.push(call(2, at(20), { terminal: true, call_log_state: null, provider_result: "Missed", contact_type: "unknown" }));
  world.calls.push(call(3, at(10), { terminal: true, call_log_state: "settled", recordings: linked(3) }));
  world.conversations.push(conversation(3));
  const { store } = memoryStore(world);
  const result = await readOwnerConversations(NUMBER, {}, { ...deps, store });
  assert.ok(result);
  assert.doesNotThrow(() => ownerConversationsResponseSchema.parse(result));
  const [live, historical] = result.data.other_calls;
  assert.equal(live!.interaction_id, hex(0x1001));
  assert.deepEqual({ terminal: live!.terminal, call_log_state: live!.call_log_state, in_progress: live!.in_progress, result: live!.result,
    duration_seconds: live!.duration_seconds, direction: live!.direction }, { terminal: false, call_log_state: null, in_progress: true, result: null, duration_seconds: null, direction: "Unknown" });
  // C17: call_log_state null with terminal true is final everywhere.
  assert.deepEqual({ terminal: historical!.terminal, call_log_state: historical!.call_log_state, in_progress: historical!.in_progress, result: historical!.result,
    duration_seconds: historical!.duration_seconds }, { terminal: true, call_log_state: null, in_progress: false, result: "Missed", duration_seconds: 62 });
  const card = result.data.items[0]!;
  assert.deepEqual({ terminal: card.terminal, call_log_state: card.call_log_state, in_progress: card.in_progress, duration_seconds: card.duration_seconds },
    { terminal: true, call_log_state: "settled", in_progress: false, duration_seconds: 63 });
  // After the settle the same call is final.
  world.calls[0] = { ...world.calls[0]!, terminal: true, call_log_state: "settled", direction: "Inbound", provider_result: "Call connected", duration_seconds: 420 };
  const settled = await readOwnerConversations(NUMBER, {}, { ...deps, store: memoryStore(world).store });
  const after = settled!.data.other_calls[0]!;
  assert.deepEqual({ in_progress: after.in_progress, result: after.result, duration_seconds: after.duration_seconds, call_log_state: after.call_log_state },
    { in_progress: false, result: "Call connected", duration_seconds: 420, call_log_state: "settled" });
  // A row without `terminal` (stored before the field) reads as final.
  const legacy = { ...world.calls[1]! }; delete (legacy as { terminal?: unknown }).terminal;
  world.calls[1] = legacy;
  const old = await readOwnerConversations(NUMBER, {}, { ...deps, store: memoryStore(world).store });
  assert.equal(old!.data.other_calls[1]!.in_progress, false);
});
