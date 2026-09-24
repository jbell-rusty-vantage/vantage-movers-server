/**
 * S6-AGENT replica proofs (assignment addendum §3, C3/C4/C5/C13; reconciliation §5 for the S10-3 script), on the
 * csi01 replica in a disposable `testvantagemovers_t3dra<hex>` database, with the production flags on
 * (ATTENTION_EVOLUTION, CASE_FILE, PROGRESS_PLAN, LEAD_PROGRESS, OUTREACH_ENSURE) plus RECEIVER_LATEST_WINS and
 * RECEIVER_ASSIGNMENT. No paid job consumer runs: model-stage job rows are only counted and must stay at zero.
 *
 * The chain is the real one: a Granot observation through `processGranotObservation` (live, Lead writes on) →
 * `synchronizeLeadFromGranot` writes `receiver_agent` → its `EntityChange` → the Outreach scan
 * (`runOutreachEnsureOnce`: the change cursor nominates `outreach-lead`, the drain runs `ensureLead`) → `crm_receiver`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../src/config/domain/granotLifecycle";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { Agent } from "../../src/models/Agent";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getRepIdentityLinkModel } from "../../src/models/RepIdentityLink";
import type { GranotObservationDocument } from "../../src/models/GranotObservation";
import { getGranotObservationModel } from "../../src/models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../src/models/GranotObservationReceipt";
import { getSynchronizationDecisionModel } from "../../src/models/SynchronizationDecision";
import { normalizeJobNo } from "../../src/services/bookings/bookingIdentity";
import { createMongoLeadIdentityStore, resolveAgentAssertion, type LeadIdentityResult } from "../../src/services/granotLifecycle/identity";
import { processGranotObservation } from "../../src/services/granotLifecycle/processor";
import type { SourcePolicyStore } from "../../src/services/granotLifecycle/sourcePolicy";
import { applyInteractionObservation } from "../../src/services/numberActivity/persistInteraction";
import { callLogRecord, SYNTHETIC_ACCOUNT_ID, SYNTHETIC_COMPANY_DID, SYNTHETIC_USER_EXTENSION, syntheticDirectory } from "../../src/services/numberActivity/fixtures";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { drainOutreachEnsureJobs, runOutreachEnsureOnce } from "../../src/services/salesIntelligence/outreach/worker";
import { commandOutreach } from "../../src/services/salesIntelligence/followups/commands";
import { readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { readOutreachTimeline } from "../../src/services/salesIntelligence/outreach/timelineRead";
import { newReceiverBackfillManifest, receiverBackfillReport, runReceiverBackfill, type ReceiverBackfillManifest } from "../backfill-receiver-agent.lib";
import type { CsiCommand } from "../../src/validation/v1/salesIntelligence";

const ET = (local: string) => new Date(`${local}:00-04:00`);
const MON_09 = ET("2026-09-21T09:00"), MON_12 = ET("2026-09-21T12:00"), TUE_10 = ET("2026-09-22T10:00"), WED_10 = ET("2026-09-23T10:00"), THU_10 = ET("2026-09-24T10:00");
const WRITE_METHODS = /^(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|bulkWrite|createIndex|drop|rename|save|create)/i;
const COMPANY_ID = "64a000000000000000000001", FORM_GRANULARITY_ID = "64a000000000000000000002", CALL_GRANULARITY_ID = "64a000000000000000000003";

test("S6-AGENT receiver_agent replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 900_000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t3dra[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  for (const flag of ["LEAD_PROGRESS", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "OUTREACH_ENSURE", "RECEIVER_LATEST_WINS", "RECEIVER_ASSIGNMENT"])
    assert.equal(process.env[`SALES_INTELLIGENCE_${flag}`], "true", flag);
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel(), Jobs = getSalesIntelligenceJobModel(), Changes = getEntityChangeModel();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/outreach/commands", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "t3dra-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
    "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request);
  const command = (target: unknown, body: CsiCommand) => commandOutreach({ actor, target_id: String(target), command: body, idempotency_key: String(oid()) });

  // Agents: three Granot usernames and one reviewed RingCentral extension (Blake).
  const agent = async (name: string, username: string) => {
    const _id = oid();
    await Agent.create({ _id, name, normalized_name: name.toLowerCase(), active: true, role: "agent", created_from: "test", granot_identity: { username, verified: false } });
    return _id;
  };
  const AVERY = await agent("Avery Stone", "AREP"), BLAKE = await agent("Blake Moss", "BREP"), CASEY = await agent("Casey Lin", "CREP");
  await getRepIdentityLinkModel().create({ agent_id: BLAKE, agent_name_snapshot: "Blake Moss", rc_account_id: SYNTHETIC_ACCOUNT_ID, rc_extension_id: SYNTHETIC_USER_EXTENSION.id,
    rc_extension_number: SYNTHETIC_USER_EXTENSION.number, rc_extension_name_snapshot: "Blake Moss", role_kind: "sales_rep", status: "reviewed", proposal_basis: "exact_full_name",
    effective_from: new Date("2025-01-01T00:00:00Z"), reviewed_by: "owner@example.test", reviewed_at: new Date("2025-01-02T00:00:00Z"), history: [{ at: new Date(), by: "owner@example.test", change: "reviewed" }] });

  type Model = "FormLead" | "CallLead";
  type Ref = { model: Model; id: string; _id: mongoose.Types.ObjectId; job: { raw: string; normalized: string } };
  let serial = 0;
  const leads = (model: Model) => (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection;
  async function lead(model: Model = "FormLead", extra: Record<string, unknown> = {}): Promise<Ref> {
    const _id = oid(), n = ++serial, raw = `ra-job-${n}-${String(_id).slice(-6)}`;
    await leads(model).insertOne({ _id, timestamp: MON_09, createdAt: MON_09, updatedAt: MON_09, name: `Synthetic Receiver ${n}`, phone_number: `20255588${String(n).padStart(2, "0")}`,
      normalized_phone_number: `20255588${String(n).padStart(2, "0")}`, quoted: false, granot_priority: "0", domain_revision: 0, source_company: "synthetic",
      pickup_zip: "10001", destination_zip: "10002", pickup_state: "NY", delivery_state: "NY", local: "local", move_size: "Studio", ingestion_origin: "wordpress_form",
      job_no: raw, normalized_job_no: normalizeJobNo(raw), ...extra } as never);
    return { model, id: String(_id), _id, job: { raw, normalized: normalizeJobNo(raw)! } };
  }
  const ensure = (ref: Ref, at: Date, numberId?: string) =>
    withTransaction(s => ensureLead({ model: ref.model, id: ref.id }, workerContext(s, String(oid()), at), numberId));
  const record = (ref: Ref) => Records.findOne({ "subject.model": ref.model, "subject.id": ref._id }).lean().orFail();
  const leadRow = (ref: Ref) => leads(ref.model).findOne({ _id: ref._id }) as Promise<Record<string, unknown> & { receiver_agent?: unknown; receiver_agent_source?: string }>;
  const modelJobs = async () => ({
    number_refresh: await Jobs.countDocuments({ stage: "number_refresh", dedupe_key: { $not: /^csi:owner-outreach:/ } }), analysis: await Jobs.countDocuments({ stage: { $in: ["analysis", "application"] } }),
    move_assessment: await Jobs.countDocuments({ stage: "move_assessment" }), transcription: await Jobs.countDocuments({ stage: "transcription" }) });
  const zero = await modelJobs();

  // The live Granot processor, as the lifecycle suites drive it, with the real Agent resolution.
  const store: SourcePolicyStore = {
    // One reviewed source per Lead model (a source with both a Form and a Call route is a policy conflict).
    async findByNormalizedLabel(label: string) {
      const call = label === "synthetic calls";
      return [{ id: call ? "64a000000000000000000011" : "64a000000000000000000010", enabled: true, lifecycle_enabled: true, lifecycle_disposition: "source_scoped_lead", lead_created_policy: "link_only",
        lead_source_company: COMPANY_ID, lifecycle_routes: [call ? { route_key: "call_any", lead_model: "CallLead", move_type: "any", source_granularity_id: CALL_GRANULARITY_ID }
          : { route_key: "form_any", lead_model: "FormLead", move_type: "any", source_granularity_id: FORM_GRANULARITY_ID }],
        lifecycle_policy_version: "granot-lifecycle-source-policy-v1", normalized_granot_label: label }];
    },
    async findCompany(id: string) { return { id, active: true }; },
    async findGranularity(id: string) { return { id, source_company_id: COMPANY_ID, active: true, channel: id === CALL_GRANULARITY_ID ? "call" : "form" }; },
  } as SourcePolicyStore;
  async function granot(ref: Ref, capturedAt: Date, agentIdentity: { user_raw?: string; rep_raw?: string }, priority = "3") {
    const observation = { _id: oid(), receipt_id: oid(), schema_version: 1, kind: "lead_snapshot", normalization_result: "valid", route_event_class: "priority_updated",
      captured_at: capturedAt, source_label_raw: "Synthetic", normalized_source_label: ref.model === "CallLead" ? "synthetic calls" : "synthetic forms", identity: { job_no_raw: ref.job.raw, normalized_job_no: ref.job.normalized },
      contact: {}, move: { origin: { state: "NY", zip: "10001" }, destination: { state: "NY", zip: "10002" } }, priority: { valid: true, canonical: priority },
      booking_action: {}, display_money: {}, agent_identity: agentIdentity, provider_context: {}, issues: [], createdAt: capturedAt, updatedAt: capturedAt } as unknown as GranotObservationDocument;
    await getGranotObservationModel().collection.insertOne(observation as never);
    await getGranotObservationReceiptModel().create({ _id: observation.receipt_id, source_system: "granot", observation_channel: "granot_webhook", captured_at: capturedAt,
      route_event_class: "priority_updated", authentication_method: "header_secret", evidence_version: 2, payload_kind: "object", headers: { "content-type": "application/json" },
      payload: { event_type: "priority_updated", priority }, payload_sha256: String(observation._id).padEnd(64, "a"),
      processing: { state: "pending", technical_attempts: 0, match_attempt: 0, next_attempt_at: capturedAt, manual_requeue_count: 0 }, provider: "granot" });
    const assertion = await resolveAgentAssertion(agentIdentity, createMongoLeadIdentityStore());
    const identity: LeadIdentityResult = { outcome: "linked", reason_code: "record_link_confirmed", match_method: ref.model === "FormLead" ? "form_ref_no_exact" : "call_job_no_exact",
      target: { model: ref.model, id: ref.id }, target_eligibility: "full", candidates: [{ target: { model: ref.model, id: ref.id }, reason_codes: ["form_ref_no_exact"] }],
      agent_assertion: assertion.agent_assertion, ...(assertion.agent && assertion.agent_assertion === "single" ? { agent: assertion.agent } : {}) };
    return processGranotObservation({ receipt_id: String(observation.receipt_id) }, {
      now: () => new Date(+capturedAt + 60_000), flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, shadow_mode: false, lead_writes_enabled: true }, sourcePolicyStore: store,
      loadReceipt: async () => ({ _id: observation.receipt_id, observation_channel: "granot_webhook", captured_at: capturedAt, processing: { match_attempt: 0 } }) as never,
      upsertObservation: async () => observation, loadActivation: async () => ({ activated_at: new Date("2026-08-01T00:00:00Z") }), resolveIdentity: async () => identity });
  }
  /** The Outreach scan (change cursor + repair sweep), then drain every claimable `outreach_ensure` job it queued. */
  const scan = async () => {
    const result = await runOutreachEnsureOnce(); assert.equal(result.skipped, false, JSON.stringify(result));
    for (let i = 0; i < 50; i++) if ((await drainOutreachEnsureJobs(100, { deadline: Date.now() + 120_000 })).outcomes.at(-1) !== "completed") break;
    return result;
  };

  // A Contact Number with one call, and a call on it answered by the reviewed extension (the Call Lead's creating call).
  const directory = syntheticDirectory();
  async function numberWithAnsweredCall(customer: string, sessionId: string, extensions: string[]) {
    const company = { phoneNumber: SYNTHETIC_COMPANY_DID, name: SYNTHETIC_USER_EXTENSION.name, extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number };
    await applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", proof_ref: `call_log:cl-${sessionId}`,
      record: callLogRecord({ id: `cl-${sessionId}`, telephonySessionId: `seed-${sessionId}`, direction: "Outbound", result: "No Answer", startTime: MON_09, duration: 30,
        from: company, to: { phoneNumber: customer } }) as never }, { now: () => new Date(+MON_09 + 120_000), directory, resolveRoute: () => null });
    const number = await getContactNumberModel().findOne({ e164: customer }).orFail().lean();
    const base = await getCallInteractionModel().findOne({ contact_number_id: number._id }).lean();
    const { _id: _ignored, ...rest } = base!;
    await getCallInteractionModel().collection.insertOne({ ...rest, _id: oid(), telephony_session_id: sessionId, call_log_id: null, call_log_ids: [], direction: "Inbound",
      started_at: new Date(+MON_09 + 60_000), provider_connected: true, terminal: true,
      parties: [{ role: "external", direction: "Inbound", e164: customer, connected: true },
        ...extensions.map(id => ({ role: "user", direction: "Inbound", extension_id: id, extension_number: id === SYNTHETIC_USER_EXTENSION.id ? SYNTHETIC_USER_EXTENSION.number : "999", connected: true }))] } as never);
    return String(number._id);
  }

  await t.test("C3 + C4 chain: Granot observation → Lead write → EntityChange → Outreach scan → crm_receiver", async () => {
    const f = await lead("FormLead", { receiver_agent: AVERY, receiver_agent_name_snapshot: "Avery Stone", receiver_agent_source: "extension_crm_username_match",
      receiver_agent_source_value: "AREP", receiver_agent_set_at: MON_09 });
    await ensure(f, MON_09);
    let r = await record(f);
    assert.equal(r.assignment?.origin, "crm_receiver"); assert.equal(String(r.responsible_agent_id), String(AVERY)); assert.equal(r.assignment?.receiver_source, "extension_crm_username_match");
    // Open follow-ups: a rep promise (keeps its promiser), an inherited one and an unassigned one (follow the record).
    const promise = await Actions.create({ outreach_record_id: r._id, commitment_key: `ra:${oid()}`, kind: "call", description: "Promised callback", origin: "rep_promise", requested_by: "rep",
      responsible_agent_id: CASEY, promised_by_agent_id: CASEY, assignment: { origin: "rep_promise", assigned_at: MON_09 },
      date_resolution: { precision: "unresolved", timezone: "America/New_York", anchor: MON_09, policy_version: "csi-policy-v1" } });
    const inherited = await Actions.create({ outreach_record_id: r._id, commitment_key: `ra:${oid()}`, kind: "call", description: "Customer asked for a call", origin: "customer_request", requested_by: "customer",
      responsible_agent_id: AVERY, assignment: { origin: "inherited_outreach", assigned_at: MON_09 },
      date_resolution: { precision: "unresolved", timezone: "America/New_York", anchor: MON_09, policy_version: "csi-policy-v1" } });
    const unassigned = await Actions.create({ outreach_record_id: r._id, commitment_key: `ra:${oid()}`, kind: "call", description: "Return missed call", origin: "system_default", requested_by: "customer",
      date_resolution: { precision: "unresolved", timezone: "America/New_York", anchor: MON_09, policy_version: "csi-policy-v1" } });

    const result = await granot(f, TUE_10, { rep_raw: "brep" });
    assert.equal(result.outcome, "applied", JSON.stringify(await getSynchronizationDecisionModel().findById(result.decision_id).select({ outcome: 1, reason_code: 1 }).lean()));
    let l = await leadRow(f);
    assert.equal(String(l.receiver_agent), String(BLAKE)); assert.equal(l.receiver_agent_source, "granot_username_match"); assert.equal(l.receiver_agent_name_snapshot, "Blake Moss");
    const change = await Changes.findOne({ "entity.model": "FormLead", "entity.id": f.id, changed_paths: "receiver_agent" }).sort({ applied_at: -1 }).lean().orFail();
    assert.equal(change.provenance?.source_system, "granot");
    const receiverField = change.fields.find(field => field.path === "receiver_agent")!;
    assert.equal(String(receiverField.before), String(AVERY)); assert.equal(String(receiverField.after), String(BLAKE));

    await scan();
    r = await record(f);
    assert.equal(String(r.responsible_agent_id), String(BLAKE)); assert.equal(r.assignment?.origin, "crm_receiver");
    assert.equal(r.assignment?.receiver_source, "granot_username_match"); assert.equal(String(r.assignment?.evidence_id), String(change._id), "evidence = the receiver EntityChange");
    assert.equal(String((await Actions.findById(promise._id).lean())?.responsible_agent_id), String(CASEY), "C4: the promiser keeps the promise");
    assert.equal(String((await Actions.findById(inherited._id).lean())?.responsible_agent_id), String(BLAKE), "inherited follows the record");
    const u = await Actions.findById(unassigned._id).lean();
    assert.equal(String(u?.responsible_agent_id), String(BLAKE)); assert.equal(u?.assignment?.origin, "inherited_outreach");

    // Detail: Assigned rep and Receiver agent side by side (E26).
    const detail = await readOutreach(String(r._id));
    assert.equal(detail?.data.outreach.assignment.origin, "crm_receiver"); assert.equal(detail?.data.outreach.assignment.agent?.name, "Blake Moss");
    assert.deepEqual({ ...detail?.data.outreach.receiver_agent, set_at: null }, { agent: { id: String(BLAKE), name: "Blake Moss" }, source: "granot_username_match", set_at: null });
    assert.ok(detail?.data.outreach.receiver_agent?.set_at);
    // Timeline: Rep changed in Granot: Avery Stone → Blake Moss (timed by the paired observation).
    const timeline = await readOutreachTimeline(String(r._id), { kinds: ["receiver_agent_changed"] });
    const event = timeline?.data.items.find(e => e.kind === "receiver_agent_changed");
    assert.equal(event?.title, "Rep changed in Granot: Avery Stone → Blake Moss");
    assert.equal(event?.happened_at, TUE_10.toISOString()); assert.equal(event?.group, "lead_updates");

    // C3: a late older observation never replaces the newer rep.
    const late = await granot(f, MON_12, { rep_raw: "crep" });
    assert.equal(late.outcome, "stale");
    assert.equal(String((await leadRow(f)).receiver_agent), String(BLAKE));
    // C3: user ≠ rep changes nothing (the Priority still applies).
    await granot(f, WED_10, { user_raw: "arep", rep_raw: "crep" }, "4");
    l = await leadRow(f);
    assert.equal(String(l.receiver_agent), String(BLAKE)); assert.equal(l.granot_priority, "4");
    await scan();
    assert.equal(String((await record(f)).responsible_agent_id), String(BLAKE));
    assert.deepEqual(await modelJobs(), zero, "zero model/paid jobs through the chain");
  });

  await t.test("C3: a manual receiver is protected; C13: the Owner's assign writes only the record and survives a Granot rep change", async () => {
    const manual = await lead("FormLead", { receiver_agent: AVERY, receiver_agent_name_snapshot: "Avery Stone", receiver_agent_source: "manual", receiver_agent_set_at: MON_09 });
    await granot(manual, TUE_10, { rep_raw: "brep" });
    const m = await leadRow(manual);
    assert.equal(String(m.receiver_agent), String(AVERY)); assert.equal(m.receiver_agent_source, "manual");

    const f = await lead("FormLead");
    await granot(f, TUE_10, { rep_raw: "arep" });
    await scan();
    let r = await record(f);
    assert.equal(String(r.responsible_agent_id), String(AVERY)); assert.equal(r.assignment?.origin, "crm_receiver");
    const changesBefore = await Changes.countDocuments({ "entity.id": f.id });
    await command(r._id, { command: "assign", expected_revision: r.revision, responsible_agent_id: String(CASEY) } as CsiCommand);
    r = await record(f);
    assert.equal(String(r.responsible_agent_id), String(CASEY)); assert.equal(r.assignment?.origin, "owner");
    const l = await leadRow(f);
    assert.equal(String(l.receiver_agent), String(AVERY), "C13: assign never writes receiver_agent");
    assert.equal(await Changes.countDocuments({ "entity.id": f.id }), changesBefore, "no Lead change");
    await granot(f, WED_10, { rep_raw: "brep" });
    assert.equal(String((await leadRow(f)).receiver_agent), String(BLAKE), "the Granot rep change updates receiver_agent");
    await scan();
    r = await record(f);
    assert.equal(String(r.responsible_agent_id), String(CASEY)); assert.equal(r.assignment?.origin, "owner", "…but not the Owner assignment");
    const detail = await readOutreach(String(r._id));
    assert.equal(detail?.data.outreach.assignment.agent?.name, "Casey Lin"); assert.equal(detail?.data.outreach.receiver_agent?.agent.name, "Blake Moss");
  });

  await t.test("E5: a Call Lead gets ringcentral_answered from the one reviewed rep who answered its creating call; Granot later replaces it", async () => {
    const c = await lead("CallLead", { ingestion_origin: "ringcentral", ringcentral: { telephony_session_id: "rc-answered-1" } });
    const numberId = await numberWithAnsweredCall("+12025559001", "rc-answered-1", [SYNTHETIC_USER_EXTENSION.id]);
    await ensure(c, MON_12, numberId);
    let l = await leadRow(c);
    assert.equal(String(l.receiver_agent), String(BLAKE)); assert.equal(l.receiver_agent_source, "ringcentral_answered");
    const change = await Changes.findOne({ "entity.id": c.id, changed_paths: "receiver_agent" }).lean().orFail();
    assert.equal(change.provenance?.source_system, "ringcentral");
    let r = await record(c);
    assert.equal(r.assignment?.origin, "crm_receiver"); assert.equal(r.assignment?.receiver_source, "ringcentral_answered");
    // Idempotent: a second ensure writes nothing.
    const revision = r.revision;
    await ensure(c, TUE_10, numberId);
    assert.equal((await record(c)).revision, revision);
    assert.equal(await Changes.countDocuments({ "entity.id": c.id, changed_paths: "receiver_agent" }), 1);
    // Granot replaces the weakest source whatever its time.
    await granot(c, MON_12, { rep_raw: "arep" });
    l = await leadRow(c);
    assert.equal(String(l.receiver_agent), String(AVERY)); assert.equal(l.receiver_agent_source, "granot_username_match");
    await scan();
    r = await record(c);
    assert.equal(String(r.responsible_agent_id), String(AVERY)); assert.equal(r.assignment?.receiver_source, "granot_username_match");
    // Two connected extensions (one unreviewed): no single reviewed rep, nothing written.
    const two = await lead("CallLead", { ingestion_origin: "ringcentral", ringcentral: { telephony_session_id: "rc-answered-2" } });
    const numberTwo = await numberWithAnsweredCall("+12025559002", "rc-answered-2", [SYNTHETIC_USER_EXTENSION.id, "ext-unreviewed"]);
    await ensure(two, MON_12, numberTwo);
    assert.equal((await leadRow(two)).receiver_agent ?? null, null);
    assert.deepEqual(await modelJobs(), zero);
  });

  await t.test("flag off: ensureLead leaves the assignment and the Lead as before", async () => {
    process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT = "false";
    try {
      const f = await lead("FormLead", { receiver_agent: AVERY, receiver_agent_name_snapshot: "Avery Stone", receiver_agent_source: "granot_username_match", receiver_agent_set_at: MON_09 });
      await ensure(f, MON_09);
      const r = await record(f);
      assert.equal(r.responsible_agent_id ?? null, null); assert.equal(r.assignment ?? null, null);
      const c = await lead("CallLead", { ingestion_origin: "ringcentral", ringcentral: { telephony_session_id: "rc-answered-3" } });
      await ensure(c, MON_12, await numberWithAnsweredCall("+12025559003", "rc-answered-3", [SYNTHETIC_USER_EXTENSION.id]));
      assert.equal((await leadRow(c)).receiver_agent ?? null, null, "no ringcentral_answered fill");
      assert.equal((await readOutreach(String(r._id)))?.data.outreach.receiver_agent, undefined, "the detail field is absent");
    } finally { process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT = "true"; }
  });

  await t.test("C5: backfill dry run is write-free, apply sets, a second apply changes nothing", async () => {
    // Accepted Granot evidence, as the lifecycle leaves it: an observation and a live Decision targeting the Lead.
    async function accepted(ref: Ref, capturedAt: Date, agentIdentity: { user_raw?: string; rep_raw?: string }, valid = true) {
      const _id = oid();
      await getGranotObservationModel().collection.insertOne({ _id, receipt_id: oid(), captured_at: capturedAt, priority: { valid, canonical: valid ? "3" : undefined },
        agent_identity: agentIdentity, kind: "lead_snapshot", normalization_result: "valid", route_event_class: "priority_updated" } as never);
      await getSynchronizationDecisionModel().collection.insertOne({ _id: oid(), observation_id: _id, attempt: 1, execution_mode: "live", outcome: "applied", reason_code: "lead_state_changed",
        target: { model: ref.model, id: ref.id }, decided_at: capturedAt } as never);
    }
    const recent = new Date(Date.now() - 5 * 86_400_000), old = new Date(Date.now() - 200 * 86_400_000);
    const setLead = await lead("FormLead", { timestamp: recent }); await accepted(setLead, TUE_10, { rep_raw: "brep" });
    const changed = await lead("FormLead", { timestamp: recent, receiver_agent: AVERY, receiver_agent_name_snapshot: "Avery Stone", receiver_agent_source: "extension_selected", receiver_agent_set_at: MON_09 });
    await accepted(changed, MON_09, { rep_raw: "arep" }); await accepted(changed, TUE_10, { user_raw: "brep" });
    const kept = await lead("FormLead", { timestamp: recent, receiver_agent: AVERY, receiver_agent_name_snapshot: "Avery Stone", receiver_agent_source: "best_relocation_sheet", receiver_agent_set_at: WED_10 });
    await accepted(kept, TUE_10, { rep_raw: "brep" });
    const manual = await lead("FormLead", { timestamp: recent, receiver_agent: AVERY, receiver_agent_name_snapshot: "Avery Stone", receiver_agent_source: "manual", receiver_agent_set_at: MON_09 });
    await accepted(manual, TUE_10, { rep_raw: "brep" });
    const conflicting = await lead("FormLead", { timestamp: recent }); await accepted(conflicting, TUE_10, { user_raw: "arep", rep_raw: "brep" });
    const ambiguous = await lead("FormLead", { timestamp: recent }); await accepted(ambiguous, TUE_10, { rep_raw: "nobody" });
    const invalid = await lead("FormLead", { timestamp: recent }); await accepted(invalid, TUE_10, { rep_raw: "brep" }, false);
    const none = await lead("FormLead", { timestamp: recent });
    const unchanged = await lead("FormLead", { timestamp: recent, receiver_agent: BLAKE, receiver_agent_name_snapshot: "Blake Moss", receiver_agent_source: "granot_username_match", receiver_agent_set_at: TUE_10 });
    await accepted(unchanged, TUE_10, { rep_raw: "brep" });
    const outside = await lead("FormLead", { timestamp: old }); await accepted(outside, TUE_10, { rep_raw: "brep" });
    // A Call Lead with a record and an answered creating call, recorded before RECEIVER_ASSIGNMENT was on (flag off).
    const call = await lead("CallLead", { timestamp: recent, ingestion_origin: "ringcentral", ringcentral: { telephony_session_id: "rc-backfill-1" } });
    process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT = "false";
    try { await ensure(call, MON_12, await numberWithAnsweredCall("+12025559004", "rc-backfill-1", [SYNTHETIC_USER_EXTENSION.id])); }
    finally { process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT = "true"; }
    // An old Lead WITH an Outreach record is in the cohort through its record.
    const oldWithRecord = await lead("FormLead", { timestamp: old }); await accepted(oldWithRecord, TUE_10, { rep_raw: "crep" });
    process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT = "false";
    try { await ensure(oldWithRecord, MON_09); } finally { process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT = "true"; }

    const jsonl: string[] = [];
    const seams = { now: () => THU_10, save: async () => undefined, log: async (event: string, f: Record<string, unknown> = {}) => { jsonl.push(JSON.stringify({ event, ...f })); } };
    // The planned entry (a Lead with a record also has a `skip` entry in the recent phase).
    const byLead = (manifestLines: string[], ref: Ref) => manifestLines.map(line => JSON.parse(line) as Record<string, unknown>)
      .filter(e => e.event === "candidate" && e.lead_id === ref.id && !e.skip).at(-1);
    const jobsBefore = await Jobs.countDocuments({});

    const ops: string[] = [];
    mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
    const hashBefore = await db.command({ dbHash: 1 });
    const dry = await runReceiverBackfill({ apply: false, page: 3 }, newReceiverBackfillManifest(getMongoDatabaseName(), false, new Date()), seams);
    mongoose.set("debug", false);
    const hashAfter = await db.command({ dbHash: 1 });
    const writes = ops.filter(op => WRITE_METHODS.test(op.split(".").at(-1)!));
    assert.deepEqual(writes, [], `dry run issued only reads (${ops.length} ops)`);
    assert.equal(hashAfter.md5, hashBefore.md5, "dbHash identical before/after the dry run");
    console.log(JSON.stringify({ s10_3_dry_run: dry.counts, ops: ops.length }));
    const bucket = (ref: Ref) => byLead(jsonl, ref)?.bucket;
    assert.equal(bucket(setLead), "set"); assert.equal(bucket(changed), "changed"); assert.equal(bucket(kept), "kept_newer_rep"); assert.equal(bucket(manual), "skipped_manual");
    assert.equal(bucket(conflicting), "conflicting"); assert.equal(bucket(ambiguous), "ambiguous_username"); assert.equal(bucket(invalid), "no_evidence"); assert.equal(bucket(none), "no_evidence");
    assert.equal(bucket(unchanged), "unchanged"); assert.equal(bucket(outside), undefined, "outside the cohort"); assert.equal(bucket(oldWithRecord), "set", "old Lead with a record");
    assert.equal(byLead(jsonl, call)?.evidence, "ringcentral_answered"); assert.equal(bucket(call), "set");
    assert.equal(byLead(jsonl, call)?.responsible_change, "would_change"); assert.equal(byLead(jsonl, oldWithRecord)?.responsible_change, "would_change");
    assert.ok((dry.counts["outreach:would_change"] ?? 0) >= 2);
    for (const b of ["set", "changed", "unchanged", "skipped_manual", "kept_newer_rep", "conflicting", "ambiguous_username", "no_evidence"]) assert.ok(receiverBackfillReport(dry, "replica", {}).includes(`| ${b} |`), b);
    const reportDir = process.env.T3D_RA_REPORT_DIR;
    const header = `> Replica proof (\`test-si-receiver-agent.ts\`): ${ops.length} Mongo ops, ${writes.length} write commands; dbHash ${hashBefore.md5} before = ${hashAfter.md5} after.\n\n`;
    if (reportDir) writeFileSync(`${reportDir}/S10-3-replica.md`, header + receiverBackfillReport(dry, "replica", { RECEIVER_LATEST_WINS: true, RECEIVER_ASSIGNMENT: true, OUTREACH_ENSURE: true }));

    jsonl.length = 0;
    const applied: ReceiverBackfillManifest = await runReceiverBackfill({ apply: true, page: 3 }, newReceiverBackfillManifest(getMongoDatabaseName(), true, new Date()), seams);
    console.log(JSON.stringify({ s10_3_apply: applied.counts }));
    assert.equal(String((await leadRow(setLead)).receiver_agent), String(BLAKE)); assert.equal((await leadRow(setLead)).receiver_agent_source, "granot_username_match");
    assert.equal(String((await leadRow(changed)).receiver_agent), String(BLAKE), "the newest resolving observation wins");
    assert.equal(String((await leadRow(kept)).receiver_agent), String(AVERY)); assert.equal(String((await leadRow(manual)).receiver_agent), String(AVERY));
    assert.equal((await leadRow(conflicting)).receiver_agent ?? null, null); assert.equal((await leadRow(outside)).receiver_agent ?? null, null);
    assert.equal(String((await leadRow(call)).receiver_agent), String(BLAKE)); assert.equal((await leadRow(call)).receiver_agent_source, "ringcentral_answered");
    const backfilled = await Changes.findOne({ "entity.id": setLead.id, changed_paths: "receiver_agent" }).lean().orFail();
    assert.equal(backfilled.provenance?.source_system, "granot"); assert.ok(backfilled.provenance?.observation_id, "paired with its observation");
    assert.equal(await Jobs.countDocuments({}), jobsBefore, "the backfill created no Sales Intelligence job");
    // Granot: setLead, changed, oldWithRecord. RingCentral: this Call Lead and the flag-off subtest's (ensured while the flag was off).
    assert.equal(applied.counts["written:granot_username_match"], 3); assert.equal(applied.counts["written:ringcentral_answered"], 2);
    if (reportDir) writeFileSync(`${reportDir}/S10-3-replica-apply.md`, receiverBackfillReport(applied, "replica", { RECEIVER_LATEST_WINS: true, RECEIVER_ASSIGNMENT: true, OUTREACH_ENSURE: true }));

    // Second apply (before the scan, whose repair sweep creates records and so widens the cohort): zero changes, nothing written.
    const reHashBefore = await db.command({ dbHash: 1 });
    const again = await runReceiverBackfill({ apply: true, page: 3 }, newReceiverBackfillManifest(getMongoDatabaseName(), true, new Date()), seams);
    const reHashAfter = await db.command({ dbHash: 1 });
    console.log(JSON.stringify({ s10_3_reapply: again.counts }));
    assert.equal(reHashAfter.md5, reHashBefore.md5, "re-apply writes nothing");
    assert.equal(again.counts["written:granot_username_match"], undefined); assert.equal(again.counts["written:ringcentral_answered"], undefined);
    assert.equal((again.counts["granot:set"] ?? 0) + (again.counts["granot:changed"] ?? 0) + (again.counts["ringcentral_answered:set"] ?? 0), 0);

    // The Outreach scan turns the backfilled changes into crm_receiver, with zero paid jobs.
    await scan();
    assert.equal((await record(call)).assignment?.origin, "crm_receiver"); assert.equal(String((await record(oldWithRecord)).responsible_agent_id), String(CASEY));
    assert.deepEqual(await modelJobs(), zero, "zero model/paid jobs after the scan");

    // Resume: a manifest cut after the first page continues where it stopped (compared with a full dry run now:
    // the scan's repair sweep gave the old out-of-cohort Lead a record, so the cohort grew by one).
    const full = await runReceiverBackfill({ apply: false, page: 3 }, newReceiverBackfillManifest(getMongoDatabaseName(), false, new Date()), seams);
    assert.equal(full.processed, dry.processed + 1);
    const partial = newReceiverBackfillManifest(getMongoDatabaseName(), false, new Date());
    await runReceiverBackfill({ apply: false, page: 3, limit: 3 }, partial, seams);
    assert.equal(partial.processed, 3); assert.equal(partial.finished_at, null);
    await runReceiverBackfill({ apply: false, page: 3 }, partial, seams);
    assert.equal(partial.processed, full.processed, "resumed to the end over the same cohort"); assert.ok(partial.finished_at);
  });
});
