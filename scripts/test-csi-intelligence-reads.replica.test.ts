import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { loadReadScope, readIntelligenceEvidence, readLeads, readBookings, readCancellations } from "../src/services/salesIntelligence/analysis/reads";

test("CSI-17 bounded reads on disposable synthetic replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 120000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi17reads[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Network/provider access forbidden in scoped reads proof"); });
  const id = () => new mongoose.Types.ObjectId();
  const number = id(), foreignNumber = id(), call = id(), conversation = id(), snapshot = id(), newerSnapshot = id(), job = id(), run = id();
  const lead = id(), candidate = id(), foreignLead = id(), booking = id(), foreignBooking = id(), outreach = id(), followup = id(), instruction = id(), restriction = id();
  const at = new Date("2026-09-01T12:00:00.000Z"), later = new Date("2026-09-02T12:00:00.000Z");
  const subject = `lead:CallLead:${lead}`;
  await db.collection("contact_numbers").insertMany([{ _id: number, revision: 1, e164: "+12025550100", national_ten: "2025550100", classification: "sales", contact_eligibility: { state: "allowed" } }, { _id: foreignNumber, revision: 1, e164: "+12025550199" }]);
  await db.collection("call_leads").insertMany([
    { _id: lead, name: "Synthetic primary", phone_number: "2025550100", normalized_phone_number: "2025550100", job_no: "SYN-17", domain_revision: 3 },
    { _id: foreignLead, name: "Synthetic unrelated", phone_number: "2025550199", normalized_phone_number: "2025550199", job_no: "FOREIGN", domain_revision: 4 },
  ]);
  await db.collection("form_leads").insertOne({ _id: candidate, name: "Synthetic snapshot candidate", phone_number: "2025550111", ingested_contact_snapshot: { normalized_phone_number: "2025550100" }, domain_revision: 2 });
  await db.collection("booked_leads").insertMany([{ _id: booking, job_no: "SYN-17", customer_name: "Synthetic booked", domain_revision: 7 }, { _id: foreignBooking, job_no: "FOREIGN", customer_name: "Unrelated", domain_revision: 1 }]);
  const cancellation = id(), snapshotCancellation = id(), unrelatedCancellation = id();
  await db.collection("cancelled_leads").insertMany([
    { _id: cancellation, booked_lead: booking, reason: "Synthetic cancellation", domain_revision: 2, refund_amount: 200 },
    { _id: snapshotCancellation, booked_lead: id(), lead_ref_snapshot: { model: "CallLead", id: lead }, job_no_snapshot: "SYN-17", reason: "Synthetic removed booking", domain_revision: 1 },
    { _id: unrelatedCancellation, booked_lead: foreignBooking, reason: "Unrelated", domain_revision: 1 },
  ]);
  await db.collection("outreach_records").insertOne({ _id: outreach, revision: 2, subject: { kind: "lead", model: "CallLead", id: lead }, primary_contact_number_id: number, state: "open", assignment: { origin: "owner" }, responsible_agent_id: null });
  await db.collection("outreach_followups").insertOne({ _id: followup, outreach_record_id: outreach, revision: 1, status: "open", kind: "call", description: "Synthetic cvv 123", due_at: later, origin: "owner", responsible_agent_id: null });
  await db.collection("sales_intelligence_owner_instructions").insertOne({ _id: id(), instruction_id: instruction, subject_key: subject, revision: 2, field: "description", current: { note: "Synthetic owner note" }, state: "active" });
  await db.collection("sales_intelligence_contact_restrictions").insertOne({ _id: restriction, contact_number_id: number, revision: 1, state: "active", origin: "owner", channels: ["text"], until: later });
  await db.collection("call_interactions").insertOne({ _id: call, contact_number_id: number, merged_into_id: null, provider_account_id: "synthetic-account", started_at: at, last_observed_at: at, projection_revision: 2,
    direction: "Inbound", provider_result: "Accepted", provider_connected: true, contact_type: "human_conversation", duration_seconds: 60, terminal: true, recordings: [], sources: ["call_log"],
    parties: [{ role: "user", extension_id: "retired", connected: true }, { role: "user", extension_id: "proposed" }, { role: "user", extension_id: "conflict" }, { role: "user", extension_id: "unknown" }] });
  await db.collection("lead_conversations").insertOne({ _id: conversation, contact_number_id: number, call_interaction_id: call, provider_account_id: "synthetic-account", latest_transcript_version: "csi-transcript-v1:newer" });
  const segments = [1, 2, 3].map(sid => ({ sid, text: `Synthetic immutable segment ${sid}`, start_ms: null, end_ms: null, timing_source: "unavailable", speaker: "unknown" }));
  await db.collection("intelligence_evidence_snapshots").insertMany([
    { _id: snapshot, ...csiDataset(), source_type: "transcript", conversation_id: conversation, transcript_version: "csi-transcript-v1:pinned", completeness: { complete: true, cursor: null, missing_ranges: [] }, segments },
    { _id: newerSnapshot, ...csiDataset(), source_type: "transcript", conversation_id: conversation, transcript_version: "csi-transcript-v1:newer", completeness: { complete: true, cursor: null, missing_ranges: [] }, segments: [{ ...segments[0], text: "Newer forbidden substitution" }] },
  ]);
  await db.collection("sales_intelligence_jobs").insertOne({ _id: job, input_refs: [conversation, snapshot] });
  const retiredAgent = id();
  const link = (extension: string, status: string) => ({ _id: id(), revision: 1, rc_account_id: "synthetic-account", rc_extension_id: extension, agent_id: id(), agent_name_snapshot: "Synthetic Agent", role_kind: "sales_rep", status, effective_from: new Date("2026-08-01"), effective_to: later, reviewed_by: "owner", reviewed_at: new Date("2026-08-01") });
  await db.collection("rep_identity_links").insertMany([{ ...link("retired", "retired"), agent_id: retiredAgent }, link("proposed", "proposed"), link("conflict", "reviewed"), link("conflict", "reviewed")]);
  const storedRun = { _id: run, subject_key: subject, contact_number_id: number, conversation_id: conversation, outreach_record_id: outreach, job_id: job };
  const foreignOutreach = id();
  await db.collection("outreach_records").insertOne({ _id: foreignOutreach, revision: 1, subject: { kind: "lead", model: "CallLead", id: foreignLead }, primary_contact_number_id: foreignNumber, state: "open" });
  const scope = await loadReadScope(storedRun);
  const sharedLeadId = id(), collisionNumber = id();
  await db.collection("contact_numbers").insertOne({ _id: collisionNumber, revision: 1, e164: "+12025550188" });
  for (const collection of ["form_leads", "call_leads"]) await db.collection(collection).insertOne({ _id: sharedLeadId, normalized_phone_number: "2025550188", name: "Synthetic same-ID Lead", domain_revision: 1 });
  const collisionScope = await loadReadScope({ _id: id(), subject_key: `number:${collisionNumber}`, contact_number_id: collisionNumber });
  const olderCall = id();
  const originalCall = await db.collection("call_interactions").findOne({ _id: call });
  await db.collection("call_interactions").insertOne({ ...originalCall!, _id: olderCall, started_at: new Date(+at - 1000), parties: [] });
  const before = async () => Object.fromEntries(await Promise.all(["contact_numbers", "call_leads", "form_leads", "booked_leads", "cancelled_leads", "outreach_records", "outreach_followups", "sales_intelligence_owner_instructions", "sales_intelligence_contact_restrictions", "call_interactions", "lead_conversations", "rep_identity_links", "intelligence_evidence_snapshots", "sales_intelligence_jobs"].map(async name => [name, JSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray())])));
  const baseline = await before();
  await t.test("relevant candidates paginate; arbitrary Lead/Booking IDs never authorize reads", async () => {
    const page = await readLeads(scope, { limit: 1 });
    assert.equal(page.records.length, 1); assert.equal(page.complete, false); assert.ok(page.next_cursor);
    const next = await readLeads(scope, { limit: 1, cursor: page.next_cursor! });
    assert.equal(next.complete, true);
    assert.deepEqual(new Set([...page.records, ...next.records].map(r => r.record_id)), new Set([String(lead), String(candidate)]));
    await assert.rejects(readLeads(scope, { model: "CallLead", id: String(foreignLead), limit: 1 }), /RUN_SCOPE_DENIED/);
    const bookings = await readBookings(scope, { limit: 10 });
    assert.deepEqual(bookings.records.map(r => r.record_id), [String(booking)]);
    await assert.rejects(readBookings(scope, { id: String(foreignBooking), limit: 1 }), /RUN_SCOPE_DENIED/);
    await assert.rejects(loadReadScope({ ...storedRun, contact_number_id: foreignNumber }), /RUN_SCOPE_DENIED/);
  });
  await t.test("immutable pinned transcript pages retain missing ranges and null timing", async () => {
    const page = await readIntelligenceEvidence(scope, { tool: "get_call_transcript", args: { conversation_id: String(conversation), limit: 2 } });
    assert.equal(page.transcript?.source_snapshot_id, String(snapshot));
    assert.equal(page.transcript?.transcript_version, "csi-transcript-v1:pinned");
    assert.equal(page.transcript?.segments[0].start_ms, null);
    assert.equal(page.transcript?.segments[0].speaker, "unknown");
    assert.equal(page.page.complete, false); assert.deepEqual(page.page.missing_ranges, ["segments_after:2"]);
    const next = await readIntelligenceEvidence(scope, { tool: "get_call_transcript", args: { conversation_id: String(conversation), limit: 2, cursor: page.page.next_cursor! } });
    assert.deepEqual(next.transcript?.segments.map(s => s.sid), [3]);
    assert.deepEqual(next.page.missing_ranges, ["segments_before:2"]);
    assert.equal(next.page.next_cursor, null); assert.equal(next.page.complete, false);
    await assert.rejects(readIntelligenceEvidence(scope, { tool: "get_call_transcript", args: { conversation_id: String(conversation), limit: 2, transcript_version: "csi-transcript-v1:newer" } }), /RUN_SCOPE_DENIED/);
    const missing = await readIntelligenceEvidence({ ...scope, transcript_snapshot_id: undefined }, { tool: "get_call_transcript", args: { conversation_id: String(conversation), limit: 2, transcript_version: "csi-transcript-v1:missing" } });
    assert.equal(missing.page.complete, false); assert.deepEqual(missing.page.missing_ranges, ["transcript_unavailable"]);
  });
  await t.test("merged Lead pagination retains equal ObjectIds in different collections", async () => {
    const first = await readLeads(collisionScope, { limit: 1 });
    assert.equal(first.complete, false); assert.equal(first.records[0].fields.model, "CallLead");
    const second = await readLeads(collisionScope, { limit: 1, cursor: first.next_cursor! });
    assert.equal(second.complete, true); assert.equal(second.records[0].fields.model, "FormLead");
    assert.equal(first.records[0].record_id, second.records[0].record_id);
    const together = await readLeads(collisionScope, { limit: 2 });
    assert.deepEqual([...first.records, ...second.records], together.records);
    await assert.rejects(readLeads({ ...collisionScope, run_id: String(id()) }, { limit: 1, cursor: first.next_cursor! }), /INVALID_INPUT/);
    const singleModel = await readLeads(collisionScope, { model: "FormLead", limit: 1 });
    assert.equal(singleModel.complete, true); assert.equal(singleModel.records[0].fields.model, "FormLead");
  });
  await t.test("cancellations use scoped Booking and surviving Lead snapshots with pagination", async () => {
    const page = await readCancellations(scope, { limit: 1 });
    assert.equal(page.complete, false); assert.ok(page.next_cursor);
    const next = await readCancellations(scope, { limit: 1, cursor: page.next_cursor! });
    assert.deepEqual(new Set([...page.records, ...next.records].map(r => r.record_id)), new Set([String(cancellation), String(snapshotCancellation)]));
    assert.equal(next.complete, true);
    await assert.rejects(readCancellations(scope, { id: String(unrelatedCancellation), limit: 1 }), /RUN_SCOPE_DENIED/);
  });
  await t.test("historical reviewed retirement resolves; proposals/conflicts/unknown fail closed", async () => {
    const evidence = await readIntelligenceEvidence(scope, { tool: "get_rep_identity", args: { interaction_id: String(call) } });
    const byExtension = new Map(evidence.page.records.map(r => [r.fields.extension_id, r.fields]));
    assert.equal(byExtension.get("retired")?.status, "reviewed"); assert.equal(byExtension.get("retired")?.agent_id, String(retiredAgent));
    assert.equal(byExtension.get("proposed")?.status, "proposed_only"); assert.equal(byExtension.get("proposed")?.agent_id, null);
    assert.equal(byExtension.get("conflict")?.status, "conflicting"); assert.equal(byExtension.get("unknown")?.status, "unknown");
    assert.deepEqual(evidence.speaker_refs, [`agent:${retiredAgent}`]);
    await assert.rejects(readIntelligenceEvidence(scope, { tool: "get_rep_identity", args: { interaction_id: String(id()) } }), /RUN_SCOPE_DENIED/);
  });
  await t.test("Owner precedence and restriction context are scoped and redacted", async () => {
    const evidence = await readIntelligenceEvidence(scope, { tool: "get_intelligence_context", args: {} });
    assert.deepEqual(evidence.instructions, [{ id: String(instruction), revision: 2 }]);
    assert.deepEqual(evidence.allowed_followup_ids, [String(followup)]);
    assert.equal(evidence.page.records.find(r => r.record_id === String(restriction))?.fields.instruction_field, "restriction");
    assert.equal(evidence.page.records.find(r => r.record_id === String(followup))?.fields.description, "Synthetic cvv [REDACTED:CVV]");
  });
  await t.test("conversation runs admit only persisted same-number Outreach and its Owner instructions", async () => {
    const conversationRun = { ...storedRun, _id: id(), subject_key: `conversation:${conversation}` };
    const conversationScope = await loadReadScope(conversationRun);
    const evidence = await readIntelligenceEvidence(conversationScope, { tool: "get_intelligence_context", args: {} });
    assert.deepEqual(evidence.instructions, [{ id: String(instruction), revision: 2 }]);
    assert.deepEqual(evidence.allowed_followup_ids, [String(followup)]);
    assert(evidence.page.records.some(r => r.record_type === "outreach" && r.record_id === String(outreach)));
    await assert.rejects(loadReadScope({ ...conversationRun, outreach_record_id: foreignOutreach }), /RUN_SCOPE_DENIED/);
    await assert.rejects(loadReadScope({ ...storedRun, subject_key: `number:${number}` }), /RUN_SCOPE_DENIED/);
  });
  await t.test("official activity timeline projects canonical scoped records without refresh", async () => {
    const evidence = await readIntelligenceEvidence(scope, { tool: "list_number_activity", args: { limit: 1 } });
    assert.equal(evidence.page.complete, false);
    assert.equal(evidence.page.records[0]?.record_id, String(call));
    assert.equal(evidence.page.records[0]?.revision, "2");
    assert.equal(evidence.page.records[0]?.record_type, "interaction");
    const next = await readIntelligenceEvidence(scope, { tool: "list_number_activity", args: { limit: 1, cursor: evidence.page.next_cursor! } });
    assert.equal(next.page.records[0]?.record_id, String(olderCall)); assert.equal(next.page.complete, true);
    await assert.rejects(readIntelligenceEvidence({ ...scope, run_id: String(id()) }, { tool: "list_number_activity", args: { limit: 1, cursor: evidence.page.next_cursor! } }), /INVALID_INPUT/);
  });
  assert.deepEqual(await before(), baseline, "all read paths leave domain, job and original transcript evidence byte-identical");
});
