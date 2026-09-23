import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { unknownCoverageFixture } from "../../src/services/salesIntelligence/fixtures";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import {
  ownerConversationsResponseSchema, ownerTranscriptResponseSchema, readOwnerConversations, readOwnerTranscript,
} from "../../src/services/salesIntelligence/analysis/ownerConversations";
import { openOwnerConversationMedia, type BlobReader } from "../../src/services/salesIntelligence/conversations/ownerMedia";
import { MARK, seedLegacyConversation, seedNumber, seedSummaryConversation } from "./csi-move-assessment-fixtures";

/**
 * S4-CONV replica proof (data spec §6.7–6.9, final spec §11.7, R-A5, A18 server half). One Number with four calls:
 * a structured conversation (step-1 summary, stored audio), a legacy conversation (pre-structured run, legacy
 * summary sections), a conversation whose audio was removed under retention while its transcript is kept, and a
 * call without a conversation. The Mongo stores run against csi01; every DTO is parsed with the server schema;
 * the media route writes its audit row before a fake blob reader is called (the real blob store is never used).
 */
test("S4-CONV conversations, transcript and media on the csi01 replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.equal(getMongoDatabaseName(), "testvantagemovers_s4conv");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  await db.dropDatabase();
  t.after(async () => { mongoose.set("debug", false); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the S4-CONV replica proof"); });
  const at = (day: number, hour = 15) => new Date(`2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);
  const deps = { coverage: async () => unknownCoverageFixture };
  const PATHNAME = "conversations/synthetic/s4conv-structured.mp3";

  // ── Seed ─────────────────────────────────────────────────────────────
  const number = await seedNumber();
  const numberId = String(number._id);
  const link = async (conversation: { _id: unknown; call_interaction_id?: unknown }) => {
    const callId = conversation.call_interaction_id;
    const call = await getCallInteractionModel().findById(callId).lean();
    assert.ok(call);
    await getCallInteractionModel().collection.updateOne({ _id: call._id }, { $set: { "recordings.0.lead_conversation_id": conversation._id,
      contact_type: "human_conversation", duration_seconds: 240, provider_result: "Call connected" } });
    return String(call._id);
  };
  // 1. Structured: step-1 summary artifact on the current transcript version, stored audio.
  const structured = await seedSummaryConversation(numberId, at(20), { overview: "Customer is moving a two-bedroom to Denver.", money_and_dates: "Quoted $4,200 for mid January.",
    commitments: "Rep calls back Tuesday." }, [{ claim: "We are moving in January", speaker: "customer" }]);
  await getLeadConversationModel().collection.updateOne({ _id: structured.conversation._id }, { $set: { latest_completed_run_id: new mongoose.Types.ObjectId(),
    media: { blob_pathname: PATHNAME, blob_url: null, bytes: 1000, content_type: "audio/mpeg", stored_at: at(20), purged_at: null },
    // The findings-step synthesis under legacy keys: the card must not show it.
    summary: { sections: { overview: "SYNTHESIS NOT SHOWN" }, text: "SYNTHESIS NOT SHOWN", model: "m", prompt_version: "p", created_at: at(20) } } });
  const structuredCall = await link(structured.conversation);
  // 2. Legacy: a pre-structured run and a legacy summary, no step-1 artifact.
  const legacy = await seedLegacyConversation(numberId, at(18), { overview: "legacy run overview" });
  await getLeadConversationModel().collection.updateOne({ _id: legacy.conversation._id }, { $set: { latest_completed_run_id: new mongoose.Types.ObjectId(legacy.run_id),
    summary: { sections: { overview: "Legacy overview", customer_wanted: "Wanted a quote", money_dates: "$3,000 in March", outcome: "Booked",
      promised: "Send the estimate", mismatch: "Lead says April" }, text: "Legacy text", model: "m", prompt_version: "sales_intelligence_analyze_v2", created_at: at(18) } } });
  const legacyCall = await link(legacy.conversation);
  // 3. Purged audio, transcript kept (retention removed the blob; content not purged).
  const purged = await seedSummaryConversation(numberId, at(16), { overview: "Earlier call about storage." });
  await getLeadConversationModel().collection.updateOne({ _id: purged.conversation._id }, { $set: {
    media: { blob_pathname: null, blob_url: null, bytes: 1000, content_type: "audio/mpeg", stored_at: at(16), purged_at: at(21) } } });
  const purgedCall = await link(purged.conversation);
  // 4. A missed call with no recording.
  const missed = await getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: `s4conv-missed-${Date.now()}`, identity_basis: "telephony_session_id",
    contact_number_id: numberId, direction: "Inbound", started_at: at(14), first_observed_at: at(14), last_observed_at: at(14), terminal: true,
    inbound_route_id: "a".repeat(24), parties: [], recordings: [], provider_result: "Missed", contact_type: "unknown" });
  // A merged duplicate and a purged call are never listed.
  await getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: `s4conv-merged-${Date.now()}`, identity_basis: "telephony_session_id",
    contact_number_id: numberId, direction: "Inbound", started_at: at(19), first_observed_at: at(19), last_observed_at: at(19), terminal: true,
    inbound_route_id: "a".repeat(24), parties: [], recordings: [], merged_into_id: new mongoose.Types.ObjectId(missed._id) });

  // ── Conversations: keyset pages, both summary sources, recording states ──
  const ops: string[] = [];
  mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
  const pages: Array<NonNullable<Awaited<ReturnType<typeof readOwnerConversations>>>> = [];
  let cursor: string | undefined;
  do {
    ops.length = 0;
    const page = await readOwnerConversations(numberId, { limit: 2, ...(cursor ? { cursor } : {}) }, deps);
    assert.ok(page);
    ownerConversationsResponseSchema.parse(page);
    pages.push(page);
    // Fixed query shape: at most one read per collection per page (no per-card query).
    const counts = ops.reduce<Record<string, number>>((acc, op) => ({ ...acc, [op]: (acc[op] ?? 0) + 1 }), {});
    for (const [op, n] of Object.entries(counts)) assert.equal(n, 1, `${op} ran ${n} times on one page`);
    cursor = page.data.next_cursor ?? undefined;
  } while (cursor);
  mongoose.set("debug", false);
  assert.equal(pages.length, 2);
  const cards = pages.flatMap(p => p.data.items);
  const others = pages.flatMap(p => p.data.other_calls);
  assert.deepEqual(cards.map(c => c.interaction_id), [structuredCall, legacyCall, purgedCall]);
  assert.deepEqual(others.map(c => c.interaction_id), [String(missed._id)]);
  assert.equal(others[0]!.result, "Missed");

  const [one, two, three] = cards;
  assert.equal(one!.summary_source, "call_summary");
  assert.deepEqual(Object.fromEntries(one!.summary_sections.map(s => [s.key, s.text])), { overview: "Customer is moving a two-bedroom to Denver.", customer_wanted: null,
    money_and_dates: "Quoted $4,200 for mid January.", outcome: null, commitments: "Rep calls back Tuesday.", discrepancies: null });
  assert.equal(one!.recording_state, "available");
  assert.equal(one!.media_available, true);
  assert.equal(one!.transcript_available, true);
  assert.equal(one!.duration_seconds, 240);
  assert.equal(one!.contact_type_label, "Human conversation");

  assert.equal(two!.summary_source, "legacy");
  assert.deepEqual(Object.fromEntries(two!.summary_sections.map(s => [s.key, s.text])), { overview: "Legacy overview", customer_wanted: "Wanted a quote",
    money_and_dates: "$3,000 in March", outcome: "Booked", commitments: "Send the estimate", discrepancies: "Lead says April" });
  assert.equal(two!.run_id, legacy.run_id);
  assert.equal(two!.recording_state, "not_recorded");

  assert.equal(three!.summary_source, "call_summary");
  assert.equal(three!.recording_state, "audio_removed");
  assert.equal(three!.recording_label, "audio removed under retention; transcript kept");
  assert.equal(three!.media_available, false);
  assert.equal(three!.transcript_available, true);

  const body = JSON.stringify(pages);
  assert.doesNotMatch(body, /s4conv-structured|conversations\/synthetic|blob_|SYNTHESIS NOT SHOWN/);

  // ── Transcript: the purged-audio conversation keeps its transcript (A18 server half) ──
  const transcript = await readOwnerTranscript(String(purged.conversation._id), {}, deps);
  assert.ok(transcript);
  ownerTranscriptResponseSchema.parse(transcript);
  assert.equal(transcript.data.available, true);
  assert.equal(transcript.data.transcript_version, purged.conversation.latest_transcript_version);
  assert.equal(transcript.data.segments.length, 1);
  assert.equal(transcript.data.segments[0]!.sid, 1);
  assert.equal(transcript.data.segments[0]!.speaker_label, "Customer");
  assert.match(transcript.data.segments[0]!.text, new RegExp(MARK.segment));
  assert.deepEqual(transcript.data.completeness, { complete: true, missing_ranges: [] });
  assert.equal(await readOwnerTranscript(String(new mongoose.Types.ObjectId()), {}, deps), null);

  // ── Media: audit row exists before the (fake) blob read; purged audio is 404 with no audit row ──
  const actor = csiOperatorActor("s4conv-media-proof");
  const audits = () => getSalesIntelligenceAuditEventModel().countDocuments({ event_kind: "media_played" });
  let auditRowsAtRead = -1;
  const readBlob: BlobReader = async (pathname, range) => {
    assert.equal(pathname, PATHNAME);
    auditRowsAtRead = await audits();
    const size = 1000, start = range?.start ?? 0, end = range?.end ?? size - 1;
    return { status: range ? 206 : 200, content_type: "audio/mpeg", content_length: end - start + 1, content_range: range ? `bytes ${start}-${end}/${size}` : null,
      body: new Blob([new Uint8Array(end - start + 1)]).stream() };
  };
  const played = await openOwnerConversationMedia({ conversation_id: one!.conversation_id, actor, range: "bytes=0-99" }, { readBlob });
  assert.equal(played.kind, "stream");
  assert.ok(played.kind === "stream");
  assert.equal(played.status, 206);
  assert.equal(played.headers["Content-Range"], "bytes 0-99/1000");
  assert.equal(auditRowsAtRead, 1, "the media_played row is committed before the blob read");
  const row = await getSalesIntelligenceAuditEventModel().findOne({ event_kind: "media_played" }).lean();
  assert.ok(row);
  assert.equal((row.current as { conversation_id: string }).conversation_id, one!.conversation_id);
  assert.equal(row.actor.kind, "owner");
  assert.doesNotMatch(JSON.stringify([row, played.headers]), /s4conv-structured|conversations\/synthetic/);
  // A second range request in the same window reuses the row.
  const again = await openOwnerConversationMedia({ conversation_id: one!.conversation_id, actor, range: "bytes=100-" }, { readBlob });
  assert.equal(again.kind === "stream" && again.status, 206);
  assert.equal(await audits(), 1);
  const removed = await openOwnerConversationMedia({ conversation_id: three!.conversation_id, actor }, { readBlob });
  assert.deepEqual(removed, { kind: "not_found" });
  assert.equal(await audits(), 1);
});
