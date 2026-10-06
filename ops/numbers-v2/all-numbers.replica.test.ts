import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { CSI_MODEL_REGISTRY } from "../../src/models/salesIntelligence/registry";
import { ENTITY_CHANGE_INDEXES } from "../../src/models/EntityChange";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { applyInteractionObservation } from "../../src/services/numberActivity/persistInteraction";
import { inboundConnectedCallLog, outboundMissedCallLog, syntheticDirectory, voicemailCallLog, SYNTHETIC_ACCOUNT_ID } from "../../src/services/numberActivity/fixtures";
import { commandNumberLead, listAllNumbers, readNumberDetail, searchLeadsForLink } from "../../src/services/numberActivity/allNumbers";
import { drainLeadLinkJobs, scanLeadChangesForLeadLinks } from "../../src/services/numberActivity/leadLinkJobs";
import { commandAccountAgent, readAccounts } from "../../src/services/salesIntelligence/repIdentity/accounts";
import { csiOperatorActor, CsiError } from "../../src/services/salesIntelligence/auth";
import { allNumbersQuerySchema } from "../../src/validation/v1/allNumbers";
import { runNumbersV2Migration } from "./migrate";
import { runNumbersV2Cleanup } from "./cleanup";
import { runMintLeadNumbers } from "./mint-lead-numbers";

/**
 * All Numbers v2 replica proof on the csi01 loopback replica (all-numbers CONTRACT §2–§5, phase A):
 * the migration's dry run writes nothing and its apply seeds Owner pins and exclusions from the retained
 * attachments, recomputes links and summaries, stamps every number and is idempotent; capture keeps the
 * summary current and nominates the link job; the Lead-change scan mints a Form Lead's number and
 * reverts a pin when a newer Lead arrives; the reads and the Owner's pin/unlink follow §4; Accounts
 * connects, changes and disconnects through reviewed links; a Call Lead older than every call gets its
 * number from its own lead-link job (no Form Lead flag needed) and from the mint script (olr C2b).
 */
const oid = () => new mongoose.Types.ObjectId();
const at = (iso: string) => new Date(iso);

test("All Numbers v2: migration, capture summary, lead link, reads, Owner commands and Accounts", {
  skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000,
}, async (t) => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.equal(getMongoDatabaseName(), "testvantagemovers_allnumbers");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  await db.dropDatabase();
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the All Numbers replica proof"); });
  for (const entry of CSI_MODEL_REGISTRY) {
    const collection = String(entry.model().collection.collectionName);
    for (const { key, ...options } of entry.indexes as ReadonlyArray<{ key: Record<string, 1 | -1>; name: string; unique?: boolean; partialFilterExpression?: Record<string, unknown> }>)
      if (!["contact_number_waiting", "contact_number_lead", "contact_number_other_leads"].includes(options.name)) await db.collection(collection).createIndex(key, options);
  }
  for (const { key, ...options } of ENTITY_CHANGE_INDEXES as unknown as ReadonlyArray<{ key: Record<string, 1 | -1>; name: string }>)
    await db.collection("entity_changes").createIndex(key, options);

  // ── Seed ──────────────────────────────────────────────────────────────
  const [L1, L2, L3, L4, L5, L6, L7, L8] = Array.from({ length: 8 }, oid);
  const agentDana = oid(), agentEli = oid();
  await db.collection("form_leads").insertMany([
    { _id: L1, name: "Ann One", job_no: "J-1", timestamp: at("2026-09-01T12:00:00Z"), normalized_phone_number: "5550100301", receiver_agent: agentDana, receiver_agent_name_snapshot: "Dana Rep" },
    { _id: L3, name: "Dup Three", job_no: "J-3", timestamp: at("2026-09-09T12:00:00Z"), normalized_phone_number: "5550100301", duplicate: true },
    { _id: L4, name: "Bad Four", job_no: "J-4", timestamp: at("2026-09-09T12:00:00Z"), normalized_phone_number: "5550100301", bad_lead: "spam" },
    { _id: L5, name: "Eve Five", job_no: "J-5", timestamp: at("2026-09-05T12:00:00Z"), normalized_phone_number: "5550100302" },
    { _id: L6, name: "Fay Six", job_no: "J-6", timestamp: at("2026-09-10T12:00:00Z"), normalized_phone_number: "5550100302", booked: oid() },
    { _id: L7, name: "Gil Seven", job_no: "J-7", timestamp: at("2026-09-02T12:00:00Z"), normalized_phone_number: "5550100303" },
    { _id: L8, name: "Hal Eight", job_no: "J-8", timestamp: at("2026-09-04T12:00:00Z"), normalized_phone_number: "5550100303" },
  ]);
  await db.collection("call_leads").insertOne({ _id: L2, name: "Bo Two", job_no: "J-2", timestamp: at("2026-09-03T12:00:00Z"),
    ringcentral: { telephony_session_id: "s-legacy-2", original_caller: { normalized_phone_number: "5550100301" } }, cancelled: oid() });
  const legacy = (n: number, extra: Record<string, unknown> = {}) => ({ _id: oid(), revision: 1, e164: `+1555010030${n}`, national_ten: `555010030${n}`,
    digits_reversed: `${n}0300105551`, country: "US", kind: "external", classification: "unknown", contact_eligibility: { state: "allowed" },
    provider_names: [`Caller ${n}`], search_terms: [`caller ${n}`], first_observed_at: at("2026-09-01T00:00:00Z"), last_activity_at: at(`2026-09-1${n}T00:00:00Z`),
    rollups: { interactions_total: 0, inbound_total: 0, outbound_total: 0, human_conversations_total: 0, last_inbound_at: null, last_outbound_at: null,
      last_human_conversation_at: null, attached_lead_count: 0, candidate_lead_count: 0, recordings_total: 0 }, purged_at: null, ...extra });
  const N1 = legacy(1), N2 = legacy(2), N3 = legacy(3), N4 = legacy(4), N5 = legacy(5, { purged_at: at("2026-09-20T00:00:00Z") });
  await db.collection("contact_numbers").insertMany([N1, N2, N3, N4, N5]);
  const edge = (numberId: unknown, model: string, id: unknown, state: string, certainty: string, decided: Date | null) => ({ _id: oid(), contact_number_id: numberId,
    lead_ref: { model, id }, state, certainty, revision: 1, evidence: [], history: [], lead_snapshot: { name: "Edge Snapshot", job_no: "E-1" }, decided_at: decided, decided_by: decided ? "owner-1" : null });
  await db.collection("number_lead_attachments").insertMany([
    edge(N2._id, "FormLead", L5, "attached", "owner_confirmed", at("2026-09-08T00:00:00Z")),
    edge(N3._id, "FormLead", L7, "attached", "owner_confirmed", at("2026-09-06T00:00:00Z")),
    edge(N3._id, "FormLead", L8, "rejected", "rejected", at("2026-09-06T00:00:00Z")),
  ]);
  const call = (numberId: unknown, iso: string, direction: string, extra: Record<string, unknown> = {}) => ({ _id: oid(), provider: "ringcentral",
    provider_account_id: SYNTHETIC_ACCOUNT_ID, contact_number_id: numberId, merged_into_id: null, purged_at: null, direction, provider_result: "Missed",
    provider_connected: false, contact_type: "unknown", duration_seconds: 0, terminal: true, call_log_state: "settled", started_at: at(iso),
    company_e164: "+15550100101", parties: [{ role: "external", connected: false }, { role: "user", connected: false, extension_id: "e101" }],
    legs: [], recordings: [], sources: ["call_log"], projection_revision: 1, telephony_session_id: `s-${String(oid())}`, ...extra });
  await db.collection("call_interactions").insertMany([
    call(N1._id, "2026-09-11T10:00:00Z", "Inbound", { provider_result: "Call connected", provider_connected: true, duration_seconds: 120,
      parties: [{ role: "user", connected: true, extension_id: "e101" }], recordings: [{ provider_recording_id: "r1" }], telephony_session_id: "s-legacy-2" }),
    call(N1._id, "2026-09-11T11:00:00Z", "Inbound"),
    call(N1._id, "2026-09-11T12:00:00Z", "Outbound", { provider_result: "No Answer" }),
    call(N1._id, "2026-09-11T13:00:00Z", "Inbound", { provider_result: "Voicemail", contact_type: "voicemail" }),
    call(N1._id, "2026-09-11T14:00:00Z", "Inbound"),
    call(N4._id, "2026-09-14T09:00:00Z", "Inbound", { provider_result: "Call connected", provider_connected: true }),
    call(N4._id, "2026-09-14T10:00:00Z", "Inbound", { call_log_state: "provisional", terminal: false }),
    call(N4._id, "2026-09-14T11:00:00Z", "Internal"),
  ]);
  await db.collection("agents").insertMany([
    { _id: agentDana, name: "Dana Rep", normalized_name: "dana rep", active: true, role: "agent", created_from: "test", name_aliases: [] },
    { _id: agentEli, name: "Eli Service", normalized_name: "eli service", active: true, role: "agent", created_from: "test", name_aliases: [] },
  ]);
  await db.collection("rep_identity_links").insertMany([
    { _id: oid(), revision: 1, agent_id: agentDana, agent_name_snapshot: "Dana Rep", rc_account_id: SYNTHETIC_ACCOUNT_ID, rc_extension_id: "e101",
      role_kind: "sales_rep", status: "reviewed", effective_from: at("2026-09-01T00:00:00Z"), effective_to: null, reviewed_at: at("2026-09-01T00:00:00Z"),
      reviewed_by: "owner", rc_direct_numbers: [], nudge_channels_allowed: ["team_messaging"], history: [], rc_team_messaging_person_id: "77" },
    { _id: oid(), revision: 1, agent_id: agentEli, agent_name_snapshot: "Eli Service", rc_account_id: SYNTHETIC_ACCOUNT_ID, rc_extension_id: "e404",
      role_kind: "service", status: "reviewed", effective_from: at("2026-09-01T00:00:00Z"), effective_to: null, reviewed_at: at("2026-09-01T00:00:00Z"),
      reviewed_by: "owner", rc_direct_numbers: ["+15550100404"], nudge_channels_allowed: [], history: [] },
  ]);
  await db.collection("ringcentral_directory_snapshots").insertOne({ _id: oid(), provider_account_id: SYNTHETIC_ACCOUNT_ID, taken_at: at("2026-10-01T05:20:00Z"),
    digest: "d1", counts: { extensions: 3, users: 3 }, company_numbers: [], queues: [], extensions: [
      { id: "e101", extension_number: "101", type: "User", name: "Dana Rep", status: "Enabled", direct_numbers: ["+15550100111"], sms_sender_numbers: [] },
      { id: "e102", extension_number: "102", type: "User", name: "Eli Service", status: "Enabled", direct_numbers: [], sms_sender_numbers: ["+15550100122"] },
      { id: "e103", extension_number: "103", type: "User", name: "Zed Nobody", status: "Disabled", direct_numbers: [], sms_sender_numbers: [] },
    ] });

  // ── Migration: dry run writes nothing ─────────────────────────────────
  const quiet = () => undefined;
  const dry = await runNumbersV2Migration(["--target=testvantagemovers_allnumbers"], quiet);
  assert.equal(dry.mode, "dry_run");
  assert.equal(dry.counts.scanned, 4, "the purged number is skipped");
  assert.equal(dry.counts.owner_pins_seeded, 2);
  assert.equal(dry.counts.owner_pins_reverted, 1, "N2: a Lead received after the decision ends the pin");
  assert.equal(dry.counts.owner_pins_kept, 1);
  assert.deepEqual(dry.indexes.create.sort(), ["contact_number_lead", "contact_number_other_leads", "contact_number_waiting"]);
  assert.equal(await db.collection("contact_numbers").countDocuments({ summary_version: 1 }), 0, "dry run stamps nothing");
  assert.equal(await db.collection("contact_numbers").countDocuments({ lead_link: { $exists: true } }), 0, "dry run links nothing");

  // ── Migration: apply ──────────────────────────────────────────────────
  const applied = await runNumbersV2Migration(["--target=testvantagemovers_allnumbers", "--apply"], quiet);
  assert.equal(applied.counts.stamped, 4);
  assert.equal(applied.unstamped_after, 0, "every non-purged number is stamped");
  assert.equal(applied.failures_total, 0, JSON.stringify(applied.failures));
  const indexNames = (await db.collection("contact_numbers").indexes()).map((i) => i.name);
  for (const name of ["contact_number_waiting", "contact_number_lead", "contact_number_other_leads"]) assert.ok(indexNames.includes(name), name);
  const read = async (id: unknown) => (await db.collection("contact_numbers").findOne({ _id: id as mongoose.Types.ObjectId }))!;
  const n1 = await read(N1._id);
  assert.deepEqual(n1.calls, { inbound: 4, outbound: 1, missed: 3 });
  assert.equal(n1.last_call.result, "missed");
  assert.equal(+n1.waiting_since, +at("2026-09-11T13:00:00Z"), "earliest missed/voicemail inbound after the latest handled (the outbound)");
  assert.equal(String(n1.lead.id), String(L2), "newest candidate: the Call Lead found by phone and by its telephony session");
  assert.equal(n1.lead.state, "cancelled");
  assert.deepEqual(n1.other_leads.map((l: { id: unknown }) => String(l.id)), [String(L1)], "Duplicates and Bad Leads are never candidates");
  assert.equal(n1.lead_link.source, "automatic");
  assert.ok(n1.search_terms.includes("bo two") && n1.search_terms.includes("j-1") && n1.search_terms.includes("caller 1"));
  const n2 = await read(N2._id);
  assert.equal(String(n2.lead.id), String(L6));
  assert.equal(n2.lead.state, "booked");
  assert.equal(n2.lead_link.source, "automatic");
  const n3 = await read(N3._id);
  assert.equal(String(n3.lead.id), String(L7), "the Owner pin holds: no candidate received after its decision");
  assert.equal(n3.lead_link.source, "owner");
  assert.deepEqual(n3.lead_link.excluded.map((e: { id: unknown }) => String(e.id)), [String(L8)]);
  assert.deepEqual(n3.other_leads, [], "an excluded Lead is never listed");
  const n4 = await read(N4._id);
  assert.deepEqual(n4.calls, { inbound: 1, outbound: 0, missed: 0 }, "provisional and internal calls never count");
  assert.equal(n4.waiting_since, null);
  assert.equal(n4.lead, null);
  const again = await runNumbersV2Migration(["--target=testvantagemovers_allnumbers", "--apply", "--all"], quiet);
  assert.equal(again.counts.scanned, 4);
  assert.equal(again.counts.link_changed, 0, "a second pass changes no link");
  assert.equal(again.counts.summary_changed, 0, "a second pass changes no summary");
  assert.equal((await read(N3._id)).lead_link.source, "owner", "a rerun keeps the pin");

  // ── Capture keeps the summary current and nominates the link job ─────
  const Jobs = getSalesIntelligenceJobModel();
  const L9 = oid();
  await db.collection("form_leads").insertOne({ _id: L9, name: "Ivy Nine", job_no: "J-9", timestamp: at("2026-09-16T12:00:00Z"), normalized_phone_number: "5550100200" });
  const capture = { now: () => at("2026-09-18T14:00:00Z"), directory: syntheticDirectory(), resolveRoute: () => null, settleHorizonMinutes: 240 };
  const voicemail = await applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", record: voicemailCallLog("s-v2-voicemail"), proof_ref: "proof-1" }, capture);
  assert.ok(voicemail.contact_number_created && voicemail.contact_number_id);
  let customer = await read(new mongoose.Types.ObjectId(voicemail.contact_number_id!));
  assert.equal(customer.summary_version, 1, "a number born under v2 is stamped");
  assert.deepEqual(customer.calls, { inbound: 1, outbound: 0, missed: 1 });
  assert.equal(customer.last_call.result, "voicemail");
  assert.ok(customer.waiting_since);
  assert.equal(await Jobs.countDocuments({ stage: "lead_link", subject_key: `lead-link:number:${voicemail.contact_number_id}` }), 1);
  await applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", record: inboundConnectedCallLog("s-v2-answered", { startTime: at("2026-09-17T14:10:00Z") }),
    proof_ref: "proof-2" }, capture);
  customer = await read(customer._id);
  assert.deepEqual(customer.calls, { inbound: 2, outbound: 0, missed: 1 });
  assert.equal(customer.waiting_since, null, "an answered inbound call handles the wait");
  assert.equal(customer.last_call.result, "answered");
  const drained = await drainLeadLinkJobs(20, 30_000);
  assert.ok((drained.outcomes.completed ?? 0) >= 1, JSON.stringify(drained));
  customer = await read(customer._id);
  assert.equal(String(customer.lead?.id), String(L9), "the link job finds the Form Lead on that phone");
  const outbound = await applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", record: outboundMissedCallLog("s-v2-out"), proof_ref: "proof-3" }, capture);
  assert.ok(outbound.contact_number_id);
  const outNumber = await read(new mongoose.Types.ObjectId(outbound.contact_number_id!));
  assert.deepEqual(outNumber.calls, { inbound: 0, outbound: 1, missed: 0 }, "an unanswered outbound call is never missed");
  assert.equal(outNumber.last_call.result, "missed");
  assert.equal(outNumber.waiting_since, null);

  // ── Lead-change scan: a newer Lead ends a pin; a Form Lead mints its number ──
  await scanLeadChangesForLeadLinks(new Date(Date.now() - 60_000));
  const L10 = oid(), L11 = oid();
  await db.collection("form_leads").insertMany([
    { _id: L10, name: "Jo Ten", job_no: "J-10", timestamp: new Date(), normalized_phone_number: "5550100303" },
    { _id: L11, name: "Kim Eleven", job_no: "J-11", timestamp: new Date(), normalized_phone_number: "5550100399" },
  ]);
  const change = (lead: mongoose.Types.ObjectId) => ({ _id: oid(), entity: { model: "FormLead", id: String(lead) }, command_execution_id: oid(),
    command_name: "synthetic", provenance: {}, changed_paths: ["name", "normalized_phone_number"], fields: [], revision_before: 0, revision_after: 1, applied_at: new Date() });
  await db.collection("entity_changes").insertMany([change(L10), change(L11)]);
  const scan = await scanLeadChangesForLeadLinks();
  assert.equal(scan.nominated, 2);
  await drainLeadLinkJobs(20, 30_000);
  const n3After = await read(N3._id);
  assert.equal(String(n3After.lead.id), String(L10), "a Lead received after the pin reverts the link to automatic");
  assert.equal(n3After.lead_link.source, "automatic");
  assert.deepEqual(n3After.other_leads.map((l: { id: unknown }) => String(l.id)), [String(L7)]);
  const minted = await db.collection("contact_numbers").findOne({ e164: "+15550100399" });
  assert.ok(minted, "the Form Lead's phone became a Contact Number");
  assert.equal(minted.created_via, "form_lead");
  assert.equal(String(minted.lead.id), String(L11));

  // ── Reads (§4.1, §4.2, §4.4) ──────────────────────────────────────────
  // Raw inserts skip the model's normalizers: give every seeded Lead the normalized Job Number search reads.
  for (const collection of ["form_leads", "call_leads"])
    await db.collection(collection).updateMany({}, [{ $set: { normalized_job_no: { $replaceAll: { input: "$job_no", find: "-", replacement: " " } } } }]);
  const all = await listAllNumbers(allNumbersQuerySchema.parse({ limit: 3 }));
  assert.equal(all.data.counts.all, 7);
  assert.equal(all.data.items.length, 3);
  assert.ok(all.data.cursor);
  const rest = await listAllNumbers(allNumbersQuerySchema.parse({ limit: 10, cursor: all.data.cursor! }));
  assert.equal(all.data.items.length + rest.data.items.length, 7, "keyset pages cover every non-purged number once");
  const waiting = await listAllNumbers(allNumbersQuerySchema.parse({ view: "waiting" }));
  assert.deepEqual(waiting.data.items.map((row) => row.id), [String(N1._id)], "only numbers still waiting, longest first");
  assert.equal(waiting.data.counts.waiting, 1);
  const row1 = waiting.data.items[0]!;
  assert.equal(row1.display, "(555) 010-0301");
  assert.equal(row1.caller_name, "Caller 1");
  assert.equal(row1.lead?.name, "Bo Two");
  assert.equal(row1.lead?.state, "cancelled");
  assert.equal(row1.last_call?.agent_name, "Dana Rep", "the reviewed link at the call time names the Agent");
  const byName = await listAllNumbers(allNumbersQuerySchema.parse({ q: "Gil" }));
  assert.deepEqual(byName.data.items.map((row) => row.id), [String(N3._id)], "q matches a Lead name through the search terms");
  const byDigits = await listAllNumbers(allNumbersQuerySchema.parse({ q: "0302" }));
  assert.deepEqual(byDigits.data.items.map((row) => row.id), [String(N2._id)]);
  await assert.rejects(() => listAllNumbers(allNumbersQuerySchema.parse({ view: "waiting", cursor: all.data.cursor! })),
    (error: unknown) => error instanceof CsiError && error.code === "CURSOR_EXPIRED");
  const detail = await readNumberDetail(String(N1._id));
  assert.ok(detail);
  assert.equal(detail.data.calls.length, 5);
  assert.equal(detail.data.calls[0]!.result, "missed");
  assert.equal(detail.data.calls.at(-1)!.recordings, 1);
  assert.equal(detail.data.calls.at(-1)!.our_number, "(555) 010-0101");
  assert.equal(detail.data.more_calls, false);
  assert.equal(detail.data.other_leads[0]!.name, "Ann One");
  assert.equal(detail.data.other_leads[0]!.rep_name, "Dana Rep");
  const search = await searchLeadsForLink("J-");
  assert.ok(search.data.items.every((item) => item.name !== "Dup Three"), "duplicates are excluded");
  assert.equal(search.data.items[0]!.name, "Kim Eleven", "newest first");
  const byPhone = await searchLeadsForLink("(555) 010-0302");
  assert.deepEqual(byPhone.data.items.map((item) => item.name).sort(), ["Eve Five", "Fay Six"]);
  assert.equal(byPhone.data.items[0]!.phone, "(555) 010-0302");

  // ── Owner commands (§4.3) ─────────────────────────────────────────────
  const owner = csiOperatorActor("all-numbers-proof");
  const before = await read(N1._id);
  await assert.rejects(() => commandNumberLead({ actor: owner, number_id: String(N1._id), body: { revision: before.revision - 1, lead: { model: "FormLead", id: String(L5) } } }),
    (error: unknown) => error instanceof CsiError && error.code === "REVISION_CONFLICT");
  await assert.rejects(() => commandNumberLead({ actor: owner, number_id: String(N1._id), body: { revision: before.revision, lead: { model: "FormLead", id: String(L3) } } }),
    (error: unknown) => error instanceof CsiError && error.code === "INVALID_INPUT", "a Duplicate cannot be pinned");
  const pinned = await commandNumberLead({ actor: owner, number_id: String(N1._id), body: { revision: before.revision, lead: { model: "FormLead", id: String(L5) } } });
  assert.ok(pinned?.changed);
  let n1Now = await read(N1._id);
  assert.equal(String(n1Now.lead.id), String(L5), "any non-duplicate Lead can be pinned, not only a candidate");
  assert.equal(n1Now.lead_link.source, "owner");
  assert.deepEqual(n1Now.other_leads.map((l: { id: unknown }) => String(l.id)), [String(L2), String(L1)]);
  const replay = await commandNumberLead({ actor: owner, number_id: String(N1._id), body: { revision: before.revision, lead: { model: "FormLead", id: String(L5) } } });
  assert.deepEqual(replay, pinned, "an identical retry replays the committed result");
  const unlinked = await commandNumberLead({ actor: owner, number_id: String(N1._id), body: { revision: n1Now.revision, lead: null, unlink: { model: "FormLead", id: String(L5) } } });
  assert.ok(unlinked?.changed);
  n1Now = await read(N1._id);
  assert.equal(String(n1Now.lead.id), String(L2), "unlinking the pinned Lead returns to the newest candidate");
  assert.equal(n1Now.lead_link.source, "automatic");
  assert.ok(n1Now.lead_link.excluded.some((e: { id: unknown }) => String(e.id) === String(L5)));
  const second = await commandNumberLead({ actor: owner, number_id: String(N1._id), body: { revision: n1Now.revision, lead: null, unlink: { model: "CallLead", id: String(L2) } } });
  assert.ok(second?.changed);
  n1Now = await read(N1._id);
  assert.equal(String(n1Now.lead.id), String(L1), "the next candidate takes over");
  const excluded = await readNumberDetail(String(N1._id));
  assert.deepEqual(excluded!.data.excluded_leads.map((lead) => lead.id).sort(), [String(L2), String(L5)].sort());
  assert.equal(await db.collection("sales_intelligence_audit_events").countDocuments({ event_kind: { $in: ["number_lead_pinned", "number_lead_unlinked"] } }), 3);

  // ── Accounts (§4.5–§4.6) ──────────────────────────────────────────────
  const accounts = await readAccounts();
  assert.equal(accounts.directory_at, "2026-10-01T05:20:00.000Z");
  const byExtension = new Map(accounts.accounts.map((a) => [a.extension_id, a]));
  assert.deepEqual(byExtension.get("e101")!.agent, { id: String(agentDana), name: "Dana Rep" });
  assert.equal(byExtension.get("e101")!.role, "sales_rep");
  assert.equal(byExtension.get("e101")!.rc_account_id, SYNTHETIC_ACCOUNT_ID);
  assert.deepEqual(byExtension.get("e101")!.direct_numbers, ["(555) 010-0111"]);
  assert.equal(byExtension.get("e102")!.agent, null);
  assert.deepEqual(byExtension.get("e102")!.suggestion, { agent_id: String(agentEli), agent_name: "Eli Service" }, "exact full name");
  assert.equal(byExtension.get("e103")!.suggestion, null);
  assert.equal(byExtension.get("e404")!.in_directory, false, "a linked extension missing from the directory is flagged");
  assert.deepEqual(accounts.agents.map((a) => a.name), ["Dana Rep", "Eli Service"]);
  const connected = await commandAccountAgent({ actor: owner, extension_id: "e102", body: { agent_id: String(agentEli), role: "service" } });
  assert.equal(connected?.agent?.name, "Eli Service");
  assert.equal(connected?.role, "service");
  const e102 = await db.collection("rep_identity_links").findOne({ rc_extension_id: "e102", effective_to: null });
  assert.equal(e102!.status, "reviewed");
  assert.equal(e102!.rc_sms_sender_number, "+15550100122", "the SMS sender comes from the directory");
  const changed = await commandAccountAgent({ actor: owner, extension_id: "e101", body: { agent_id: String(agentEli), link_revision: byExtension.get("e101")!.link_revision! } });
  assert.equal(changed?.agent?.name, "Eli Service");
  assert.equal(changed?.role, "sales_rep", "the role defaults to the current one");
  const e101 = await db.collection("rep_identity_links").find({ rc_extension_id: "e101" }).sort({ effective_from: 1 }).toArray();
  assert.equal(e101.length, 2);
  assert.equal(e101[0]!.status, "retired");
  assert.ok(e101[0]!.reviewed_at, "the retired link keeps its review, so earlier calls keep their Agent");
  assert.equal(e101[1]!.rc_team_messaging_person_id, "77", "the successor keeps the extension's chat id");
  assert.equal(+e101[0]!.effective_to, +e101[1]!.effective_from);
  await assert.rejects(() => commandAccountAgent({ actor: owner, extension_id: "e101", body: { agent_id: null, link_revision: 99 } }),
    (error: unknown) => error instanceof CsiError && error.code === "REVISION_CONFLICT");
  const disconnected = await commandAccountAgent({ actor: owner, extension_id: "e101", body: { agent_id: null } });
  assert.equal(disconnected?.agent, null);
  assert.equal(await db.collection("rep_identity_links").countDocuments({ rc_extension_id: "e101", effective_to: null }), 0);
  const stillNamed = await readNumberDetail(String(N1._id));
  assert.equal(stillNamed!.data.calls.at(-1)!.agent_name, "Dana Rep", "a call keeps the Agent of its time after the change");

  // ── Phase B cleanup: dry run writes nothing; apply unsets the retired fields, drops their indexes and the attachments ──
  await db.collection("contact_numbers").createIndex({ kind: 1, last_activity_at: -1, _id: -1 }, { name: "contact_number_kind_activity" });
  const cleanupDry = await runNumbersV2Cleanup(["--target=testvantagemovers_allnumbers"], quiet) as { plan: Record<string, unknown> };
  assert.equal(cleanupDry.plan.numbers_with_retired_fields, 5, "the five seeded legacy rows, the purged one included");
  assert.deepEqual(cleanupDry.plan.indexes_to_drop, ["contact_number_kind_activity"]);
  assert.equal(cleanupDry.plan.attachments, 3);
  assert.equal(await db.collection("contact_numbers").countDocuments({ kind: { $exists: true } }), 5, "dry run unsets nothing");
  const cleaned = await runNumbersV2Cleanup(["--target=testvantagemovers_allnumbers", "--apply"], quiet) as { after: Record<string, unknown> };
  assert.equal(cleaned.after.numbers_with_retired_fields, 0);
  assert.equal(await db.collection("contact_numbers").countDocuments({ $or: [{ rollups: { $exists: true } }, { contact_eligibility: { $exists: true } }, { classification: { $exists: true } }] }), 0);
  assert.equal((await db.listCollections({ name: "number_lead_attachments" }).toArray()).length, 0);
  assert.ok(!(await db.collection("contact_numbers").indexes()).some((index) => index.name === "contact_number_kind_activity"));
  const again2 = await runNumbersV2Cleanup(["--target=testvantagemovers_allnumbers", "--apply"], quiet) as { applied: Record<string, unknown> };
  assert.deepEqual(again2.applied, { indexes_dropped: [], numbers_unset: 0, attachments_dropped: false }, "a second cleanup finds nothing");
  const afterCleanup = await listAllNumbers(allNumbersQuerySchema.parse({}));
  assert.equal(afterCleanup.data.counts.all, 7, "reads work on cleaned rows");
  const rerun = await runNumbersV2Migration(["--target=testvantagemovers_allnumbers", "--apply", "--all"], quiet);
  assert.equal(rerun.failures_total, 0, "the migration still runs after the cleanup (nothing left to seed)");

  // ── olr C2b: Call Lead numbers ─────────────────────────────────────────
  // Call Lead minting never depends on the Form Lead flag.
  const formLeadFlag = process.env.SALES_INTELLIGENCE_FORM_LEAD_NUMBERS;
  process.env.SALES_INTELLIGENCE_FORM_LEAD_NUMBERS = "false";
  t.after(() => { process.env.SALES_INTELLIGENCE_FORM_LEAD_NUMBERS = formLeadFlag; });
  // The script: a Call Lead received before capture began (its phone was never called) and a Duplicate on that phone.
  const L12 = oid(), L13 = oid();
  await db.collection("call_leads").insertMany([
    { _id: L12, name: "Lu Twelve", job_no: "J-12", timestamp: at("2026-07-27T12:00:00Z"), normalized_phone_number: "5550100388" },
    { _id: L13, name: "Mo Thirteen", job_no: "J-13", timestamp: at("2026-07-28T12:00:00Z"), normalized_phone_number: "5550100388", duplicate: true },
  ]);
  const mintDry = await runMintLeadNumbers(["--target=testvantagemovers_allnumbers", "--scope=all"], quiet);
  assert.deepEqual([mintDry.mode, mintDry.leads_checked, mintDry.numbers_to_create, mintDry.numbers_reused], ["dry_run", 2, 1, 1],
    "L12 needs a number; L2's original caller already has N1; the Duplicate is never a candidate");
  assert.equal(await db.collection("contact_numbers").countDocuments({ e164: "+15550100388" }), 0, "the dry run writes nothing");
  type MintRun = { numbers_to_create: number; applied: { numbers_created: number; links_changed: number; failures: Record<string, number> };
    after: { numbers_to_create: number } };
  const mintApply = await runMintLeadNumbers(["--target=testvantagemovers_allnumbers", "--scope=all", "--apply"], quiet) as unknown as MintRun;
  assert.deepEqual(mintApply.applied.failures, {});
  assert.deepEqual([mintApply.applied.numbers_created, mintApply.applied.links_changed, mintApply.after.numbers_to_create], [1, 1, 0]);
  const lu = await db.collection("contact_numbers").findOne({ e164: "+15550100388" });
  assert.ok(lu);
  assert.equal(lu.created_via, "call_lead");
  assert.equal(String(lu.lead.id), String(L12), "the script links the minted number to its Call Lead");
  assert.equal(lu.lead.model, "CallLead");
  assert.deepEqual(lu.other_leads, [], "the Duplicate stays out");
  assert.deepEqual(lu.calls, { inbound: 0, outbound: 0, missed: 0 });
  assert.equal(lu.summary_version, 1);
  assert.ok(lu.search_terms.includes("lu twelve") && lu.search_terms.includes("j-12"));
  const luRow = await listAllNumbers(allNumbersQuerySchema.parse({ q: "0388" }));
  assert.deepEqual(luRow.data.items.map((row) => [row.id, row.source]), [[String(lu._id), "call"]], "served as source call: the admin enum is unchanged");
  assert.equal(await db.collection("sales_intelligence_audit_events").countDocuments({ event_kind: "contact_number_created_from_lead", "current.lead_model": "CallLead" }), 1);
  const mintAgain = await runMintLeadNumbers(["--target=testvantagemovers_allnumbers", "--scope=all", "--apply"], quiet) as unknown as MintRun;
  assert.deepEqual([mintAgain.numbers_to_create, mintAgain.applied.numbers_created, mintAgain.applied.links_changed], [0, 0, 0], "a rerun writes nothing");
  // The lead-link job: a new Call Lead's own job mints and links its number.
  const L14 = oid();
  await db.collection("call_leads").insertOne({ _id: L14, name: "Ned Fourteen", job_no: "J-14", timestamp: new Date(), normalized_phone_number: "5550100377" });
  await db.collection("entity_changes").insertOne({ ...change(L14), entity: { model: "CallLead", id: String(L14) } });
  assert.ok((await scanLeadChangesForLeadLinks()).nominated >= 1);
  await drainLeadLinkJobs(20, 30_000);
  const ned = await db.collection("contact_numbers").findOne({ e164: "+15550100377" });
  assert.ok(ned, "the Call Lead's job minted its number with the Form Lead flag off");
  assert.equal(ned.created_via, "call_lead");
  assert.equal(String(ned.lead.id), String(L14), "and linked it in the same job");
});
