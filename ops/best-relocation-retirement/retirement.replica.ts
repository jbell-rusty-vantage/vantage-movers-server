import assert from "node:assert/strict";
import mongoose from "mongoose";

async function main() {
  // Fixed local-only target. Never load .env or accept a production URI.
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = `testvantagemovers_retirementproof${process.pid}`;
  const database = process.env.TEST_MONGO_DATABASE_NAME;
  await mongoose.connect("mongodb://127.0.0.1:27119/?replicaSet=callReportingProof", { dbName: database });
  const { ExternalDataConnection } = await import("../../src/models/ExternalDataConnection.js");
  const { IngestionRun } = await import("../../src/models/IngestionRun.js");
  const { SheetSyncLease } = await import("../../src/models/SheetSyncLease.js");
  const { getLeadSourceCompanyModel } = await import("../../src/models/LeadSourceCompany.js");
  const { getLeadSourceGranularityModel } = await import("../../src/models/LeadSourceGranularity.js");
  const { getGranotCrmSourceModel } = await import("../../src/models/GranotCrmSource.js");
  const { BEST_RELOCATION_RETIRED_LABELS } = await import("../../src/models/bestRelocationRetirement.js");
  const { retireBestRelocationConnectionAndSources } = await import("../../src/services/ingestion/retireBestRelocation.js");
  const { assertFinalReconciliationWriteInTransaction } = await import("../../src/services/ingestion/finalReconciliationFence.js");
  const { resolveSourcePolicy } = await import("../../src/services/granotLifecycle/sourcePolicy.js");
  const { MongoLeaseStore, createBestRelocationIngestionActor } = await import("../../src/services/durableWork/index.js");
  const { typeOwnerContext } = { typeOwnerContext: { actor_type: "owner", actor_id: "synthetic-owner", actor_label: "Synthetic Owner", actor_role: "owner", request_id: "retirement-proof", origin: "vantage_admin" } as const };
  const db = mongoose.connection.db;
  assert.ok(db);
  assert.equal(mongoose.connection.host, "127.0.0.1");
  assert.match(database, /^testvantagemovers_retirementproof\d+$/);
  try {
    await SheetSyncLease.init();
    const company = await getLeadSourceCompanyModel().create({ company_slug: "best_relocation_leads", name: "Synthetic Best", owner_label: "Synthetic Best", active: true });
    const other = await getLeadSourceCompanyModel().create({ company_slug: "synthetic_other", name: "Other", owner_label: "Other", active: true });
    const feed = await getLeadSourceGranularityModel().create({ source_company: company._id, granularity_key: "synthetic_form", channel: "form", owner_label: "Form", crm_label: "Form", active: true });
    const Source = getGranotCrmSourceModel();
    // Raw fixture deliberately recreates old pre-retirement policy and null SMS state.
    const sourceRows = [...BEST_RELOCATION_RETIRED_LABELS, "renamed best historical forms"].map((label, index) => ({
      _id: new mongoose.Types.ObjectId(), crm_origin: "https://synthetic.invalid", workspace_slug: `best-${index}`,
      granot_label: label, normalized_granot_label: label, enabled: true, source_company: "best_relocation_leads",
      lifecycle_enabled: true, lifecycle_disposition: "source_scoped_lead", lead_created_policy: "create_if_missing",
      lead_source_company: company._id, lifecycle_policy_version: "old/v1", outbound_sms: index === 0 ? null : { enabled: true },
      lifecycle_routes: [{ route_key: "form", lead_model: "FormLead", move_type: "any", source_granularity_id: feed._id }],
    }));
    const unrelated = { ...sourceRows[0]!, _id: new mongoose.Types.ObjectId(), workspace_slug: "other", granot_label: "other forms", normalized_granot_label: "other forms", source_company: "synthetic_other", lead_source_company: other._id };
    await Source.collection.insertMany([...sourceRows, unrelated]);
    const sourceIds = sourceRows.map((row) => String(row._id));
    const connection = await ExternalDataConnection.create({ key: "best_relocation", provider: "google_sheets",
      workbook_env_keys: { leads: "archive", booked: "archive" }, application_enabled: true, next_due_at: new Date(), created_actor: typeOwnerContext, updated_actor: typeOwnerContext });
    const statuses = ["queued", "inspecting", "planning", "awaiting_approval", "applying", "failed"] as const;
    const runs = [];
    for (const status of statuses) {
      runs.push(await IngestionRun.create({ adapter_key: "best_relocation", schema_version: 2, trigger: "manual", status,
        connection_id: connection._id, cutoff: new Date("2026-04-30T04:00:00Z"), timezone: "America/New_York", actor: createBestRelocationIngestionActor("proof"), initiator: typeOwnerContext,
        checkpoint: { version: 1, phase: "apply", cursor: { action_index: 2 }, completed_units: 2, updated_at: new Date() } }));
    }
    const applying = runs.find((row) => row.status === "applying")!;
    const input = { company_id: String(company._id), source_ids: sourceIds, final_run_id: "synthetic-final-run", actor: typeOwnerContext };
    await assert.rejects(retireBestRelocationConnectionAndSources({ ...input, source_ids: sourceIds.slice(1) }), /inventory changed/);
    assert.equal((await ExternalDataConnection.findById(connection._id).lean())?.retired_at, null);
    const store = new MongoLeaseStore(SheetSyncLease);
    const token = await store.acquire({ scope: "ingestion:best_relocation:apply", owner: "synthetic-final", ttl_ms: 60_000, now: new Date() });
    assert.ok(token);
    await assert.rejects(retireBestRelocationConnectionAndSources(input), /holds the lease/);
    const context = { command_id: "proof", idempotency_key: "proof", payload_checksum: "a".repeat(64), actor: createBestRelocationIngestionActor("proof"), initiator: typeOwnerContext,
      provenance: { origin: "external_sheet_ingestion" as const, run_id: String(applying._id), source_receipt_id: String(new mongoose.Types.ObjectId()), source_connection_key: "best_relocation" } };
    async function probe(name: string, commandContext = context) {
      const session = await mongoose.startSession();
      try { await session.withTransaction(async () => { await db!.collection("retirement_fence_probes").insertOne({ name }, { session }); await assertFinalReconciliationWriteInTransaction(commandContext, session); }); }
      finally { await session.endSession(); }
    }
    await assert.rejects(probe("no-approval"), /run_not_applying/);
    assert.equal(await db.collection("retirement_fence_probes").countDocuments(), 0);
    await IngestionRun.updateOne({ _id: applying._id }, { $set: { approval: { final_reconciliation: true }, lease_owner: token.owner, lease_epoch: token.epoch } });
    await probe("valid");
    await ExternalDataConnection.updateOne({ _id: connection._id }, { $set: { retired_at: new Date() } });
    await assert.rejects(probe("retired-connection"), /connection_retired/);
    await ExternalDataConnection.updateOne({ _id: connection._id }, { $set: { retired_at: null } });
    await IngestionRun.updateOne({ _id: applying._id }, { $set: { lease_epoch: token.epoch + 1 } });
    await assert.rejects(probe("stale-epoch"), /lease_lost/);
    assert.equal(await db.collection("retirement_fence_probes").countDocuments(), 1);
    await store.release({ token, now: new Date() });
    await IngestionRun.updateOne({ _id: applying._id }, { $set: { leased_until: new Date(Date.now() + 30_000) } });
    await assert.rejects(retireBestRelocationConnectionAndSources(input), /still reports a live lease/);
    await IngestionRun.updateOne({ _id: applying._id }, { $set: { leased_until: null } });
    await db.collection("booked_leads").insertOne({ synthetic: true, job_no: "KEEP" });
    const shutdown = await retireBestRelocationConnectionAndSources({ ...input, final_run_id: "synthetic-shutdown", reconciliation_status: "deferred" });
    assert.equal(shutdown.cancelled_runs, statuses.length);
    const heldConnection = await ExternalDataConnection.findById(connection._id).lean();
    assert.equal(heldConnection?.retired_at, null); assert.equal(heldConnection?.retirement_final_run_id, null);
    assert.equal(heldConnection?.retirement_shutdown_run_id, "synthetic-shutdown"); assert.ok(heldConnection?.retirement_shutdown_at);
    assert.equal(heldConnection?.retirement_ingestion_deferred, true); assert.equal(heldConnection?.retirement_reconciliation_status, "pending_owner_review");
    assert.equal(heldConnection?.application_enabled, false); assert.equal(heldConnection?.next_due_at, null);
    assert.equal((await getLeadSourceCompanyModel().findById(company._id).lean())?.active, true);
    assert.equal((await retireBestRelocationConnectionAndSources({ ...input, final_run_id: "synthetic-shutdown-repeat", reconciliation_status: "deferred" })).cancelled_runs, 0);
    const futureLease = await store.acquire({ scope: "ingestion:best_relocation:apply", owner: "synthetic-future-final", ttl_ms: 60_000, now: new Date() });
    assert.ok(futureLease);
    const future = await IngestionRun.create({ adapter_key: "best_relocation", schema_version: 2, trigger: "manual", status: "applying", connection_id: connection._id,
      cutoff: new Date("2026-04-30T04:00:00Z"), timezone: "America/New_York", actor: createBestRelocationIngestionActor("future-proof"), initiator: typeOwnerContext,
      plan_checksum: "a".repeat(64), approval: { final_reconciliation: true }, lease_owner: futureLease.owner, lease_epoch: futureLease.epoch });
    const futureContext = { ...context, provenance: { ...context.provenance, run_id: String(future._id) } };
    await assert.rejects(probe("old-approval-held", futureContext), /deferred_pending_owner_review/);
    await IngestionRun.updateOne({ _id: future._id }, { $set: { "approval.owner_released_deferred_ingestion_checksum": "a".repeat(64) } });
    await probe("future-exact-owner-release", futureContext);
    assert.equal((await ExternalDataConnection.findById(connection._id).lean())?.retirement_ingestion_deferred, true);
    await IngestionRun.updateOne({ _id: future._id }, { $set: { status: "completed", lease_owner: null, leased_until: null } });
    await store.release({ token: futureLease, now: new Date() });
    const retired = await retireBestRelocationConnectionAndSources(input);
    assert.equal(retired.cancelled_runs, 0);
    const saved = await ExternalDataConnection.findById(connection._id).lean();
    assert.ok(saved?.retired_at); assert.equal(saved.application_enabled, false); assert.equal(saved.next_due_at, null);
    assert.equal(saved.retirement_reconciliation_status, "incomplete"); assert.match(saved.retirement_reason ?? "", /incomplete/);
    assert.equal(saved.retirement_ingestion_deferred, false);
    await assert.rejects(retireBestRelocationConnectionAndSources({ ...input, reconciliation_status: "deferred" }), /cannot be reopened/);
    const sources = await Source.find({ _id: { $in: sourceIds } }).lean();
    assert.equal(sources.length, sourceIds.length);
    for (const source of sources) { assert.equal(source.lead_created_policy, "link_only"); assert.ok(source.granot_creation_retired_at); assert.equal(source.outbound_sms?.enabled, false); }
    assert.equal((await Source.findById(unrelated._id).lean())?.lead_created_policy, "create_if_missing");
    assert.equal(await db.collection("booked_leads").countDocuments(), 1);
    assert.equal(await IngestionRun.countDocuments({ status: "skipped", "checkpoint.completed_units": 2 }), statuses.length);
    await Source.collection.updateOne({ _id: sourceRows[6]!._id }, { $set: { lead_created_policy: "create_if_missing", normalized_granot_label: "renamed-again", granot_label: "renamed-again" } });
    const stale = await resolveSourcePolicy({ source_label: "renamed-again" });
    assert.ok(stale.ok); assert.equal(stale.snapshot.lead_created_policy, "link_only");
    // Supply a throwing sender: the retired queued message must stop before provider credentials/send.
    process.env.LEAD_MESSAGING_MODE = "inline";
    process.env.LEAD_MESSAGING_ALLOW_TEST_MODE = "true";
    const { getLeadMessageModel } = await import("../../src/models/LeadMessage.js");
    const { dispatchPersistedLeadMessage } = await import("../../src/services/leadMessaging/leadMessaging.service.js");
    const message = await getLeadMessageModel().create({ purpose: "granot_lead_created_confirmation", origin: "granot_lead_created",
      granot_crm_source: sourceRows[0]!._id, lead_source_company: company._id, lead_ref: { model: "FormLead", id: new mongoose.Types.ObjectId() },
      message_key: "synthetic", template_version: 1, to: "+15555550123", from: "+15555550999", body: "Synthetic never sent", dispatch_mode: "queued", status: "queued" });
    let providerCalls = 0;
    const messageResult = await dispatchPersistedLeadMessage(String(message._id), async () => { providerCalls++; throw new Error("provider must never be called"); });
    assert.equal(messageResult.status, "skipped"); assert.equal(providerCalls, 0);
    assert.equal((await getLeadMessageModel().findById(message._id).lean())?.skip_reason, "best_relocation_retired");
    const second = await retireBestRelocationConnectionAndSources(input);
    assert.equal(second.cancelled_runs, 0); assert.equal(await Source.countDocuments(), sourceIds.length + 1);
    console.log(JSON.stringify({ ok: true, database, assertions: ["complete variant inventory", "active worker lease refusal", "old live checkpoint refusal", "null SMS compatibility", "transaction rollback on missing approval/stale epoch/retired connection", "deferred shutdown leaves company active and final-run reference empty", "manual hold rejects old approval and permits only exact Owner checksum release", "no automatic hold clearing or retired connection reopening", "durable company/source policy fence", "historical Booking preserved", "incomplete status retained", "queued confirmation never sent", "repeat cutover no extra runs/sources"] }));
  } finally {
    // This process owns only its isolated local synthetic database.
    assert.equal(mongoose.connection.host, "127.0.0.1"); assert.equal(mongoose.connection.name, database);
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
}
main().catch(async (error) => { console.error(error); await mongoose.disconnect(); process.exitCode = 1; });
