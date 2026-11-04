import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getFormLeadModel } from "../../src/models/FormLead";
import { EntityChange } from "../../src/models/EntityChange";
import { DomainCommandExecution } from "../../src/models/DomainCommandExecution";
import { SheetSyncJob } from "../../src/models/SheetSyncJob";
import { SheetSyncLease } from "../../src/models/SheetSyncLease";
import { ExternalDataConnection } from "../../src/models/ExternalDataConnection";
import type { LeaseToken } from "../../src/services/durableWork/types";
import { persistRingCentralFinalCallLogResult } from "../../src/services/domainCommands/ringcentralFinalResult";
import { reconcileExternalSheetReview, reviewPayloadChecksum, type ReconcileReviewInput } from "../../src/services/domainCommands/externalSheetReview";
import { BEST_RELOCATION_TRACKER_ID } from "../../src/services/leads/externalSheetReview";
import { billableCallLeadExpression, billableCallLeadFilter, getCallLeadReportingDecision } from "../../src/services/leads/callLeadReportingDisposition";
import { preloadCanonicalAdoption } from "./sourcePlanCache";
import type { BestRelocationApplicationPlan } from "../../src/services/bestRelocationSheetIngest/applicationPlan";
import { updateCallLeadSchema, updateFormLeadSchema } from "../../src/validation/v1.validation";
import { repairCallFormFillForReporting } from "../../src/services/domainCommands/callFormFillBackfill";
import { planCallBackfill, verifyCallBackfill } from "./callBackfill";

// Opt-in proof can touch only this disposable local replica, never Atlas.
const enabled = process.env.GRANOT_LIFECYCLE_REPLICA_TESTS === "true" &&
  process.env.TEST_MODE === "true" && /^mongodb:\/\/127\.0\.0\.1:27119\//.test(process.env.MONGO_URI ?? "");
const prefix = `call-reporting-proof-${Date.now()}`;
const start = new Date("2026-11-01T06:30:00Z");
const observedAt = new Date("2026-11-03T12:00:00Z");
const lease: LeaseToken = { scope: "ingestion:best_relocation:apply", owner: prefix, epoch: 1, leased_until: new Date(Date.now() + 600_000) };

before(async () => {
  if (!enabled) return;
  await connectMongo();
  assert.match(mongoose.connection.name, /^testvantagemovers_[a-z0-9]+$/i);
  assert.equal(process.env.SHEET_SYNC_MODE, "queued");
  assert.equal((await mongoose.connection.db!.admin().command({ hello: 1 })).setName, "callReportingProof");
  await Promise.all([getCallLeadModel(), getFormLeadModel(), EntityChange, DomainCommandExecution, SheetSyncJob, SheetSyncLease, ExternalDataConnection].map(async Model => {
    try { await Model.createCollection(); } catch (error: any) { if (error.code !== 48) throw error; }
  }));
  await DomainCommandExecution.createIndexes();
  await EntityChange.createIndexes();
  await getCallLeadModel().collection.createIndex({ timestamp: 1, receiver_agent: 1 }, { name: "call_lead_overview_timestamp_receiver" });
  await getCallLeadModel().collection.createIndex({ source_granularity_id: 1 }, { name: "source_granularity_id_1" });
  await SheetSyncLease.updateOne({ scope: lease.scope }, { $set: { lease_owner: lease.owner, lease_epoch: lease.epoch, leased_until: lease.leased_until } }, { upsert: true });
  await ExternalDataConnection.collection.updateOne({ key: "best_relocation" }, { $set: { retired_at: null } }, { upsert: true });
});
after(async () => { if (enabled) await mongoose.disconnect(); });

async function createCall(suffix: string) {
  return getCallLeadModel().create({ source_company: "best_relocation_leads", phone_number: "+15550001111",
    timestamp: start, cpl: 100, ingestion_origin: "ringcentral",
    ringcentral: { telephony_session_id: `${prefix}-${suffix}`, ingestion_source: "webhook",
      qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 150 },
  });
}
function observation(session: string, result = "Missed", answered = false) {
  return { telephonySessionId: session, callLogId: `parent-${session}`, startTime: start,
    finalCallLogResult: { result, answered, callLogId: `parent-${session}`, observedAt },
  };
}
async function counts(id: string) {
  return {
    changes: await EntityChange.countDocuments({ "entity.id": id }),
    commands: await DomainCommandExecution.countDocuments({ "entity_refs.id": id }),
    outbox: await SheetSyncJob.countDocuments({ entity_id: id }),
  };
}
function reviewInput(model: "FormLead" | "CallLead", id: string, suffix: string): ReconcileReviewInput {
  const input = {
    lead_model: model, lead_id: id, expected_revision: 0,
    execution: { lease },
    cell: { source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: model === "CallLead" ? 1191420872 : 0,
      source_tab: model === "CallLead" ? "Calls" : "Forms", stable_source_row_id: `${prefix}-${suffix}`,
      source_content_hash: "a".repeat(64), raw_value: model === "CallLead" ? "Form Fill" : "Duplicate Form" },
  } as Omit<ReconcileReviewInput, "context">;
  const owner = { actor_type: "owner", actor_id: "synthetic-owner", actor_label: "Synthetic Owner", actor_role: "owner", request_id: `${prefix}-${suffix}`, origin: "vantage_admin" } as const;
  const actor = { actor_type: "system", actor_id: "best-relocation-ingestion", actor_label: "Synthetic ingestion", actor_role: "system", request_id: `${prefix}-${suffix}`, origin: "external_sheet_ingestion" } as const;
  return { ...input, context: { command_id: new mongoose.Types.ObjectId().toHexString(), idempotency_key: `${prefix}-${suffix}`,
    payload_checksum: reviewPayloadChecksum(input), actor, initiator: owner,
    provenance: { origin: "external_sheet_ingestion", run_id: prefix, source_receipt_id: `${prefix}-${suffix}`, source_connection_key: "best_relocation" },
  } };
}

test("replica: final result revision/change/command/outbox commit, replay no-op, parent correction retains qualification", { skip: !enabled }, async () => {
  const lead = await createCall("final");
  const id = lead._id.toString(), session = lead.ringcentral!.telephony_session_id!;
  await persistRingCentralFinalCallLogResult(observation(session), id);
  const saved = await getCallLeadModel().findById(id).lean();
  assert.equal(saved?.domain_revision, 1);
  assert.equal(saved?.ringcentral?.final_result, "Missed");
  assert.equal(saved?.ringcentral?.start_time?.toISOString(), start.toISOString());
  assert.equal(saved?.ringcentral?.final_result_call_log_id, saved?.ringcentral?.call_log_id);
  assert.equal(getCallLeadReportingDecision(saved).disposition, "bad_call_leads");
  assert.deepEqual(await counts(id), { changes: 1, commands: 1, outbox: 1 });
  await persistRingCentralFinalCallLogResult(observation(session), id);
  assert.deepEqual(await counts(id), { changes: 1, commands: 1, outbox: 1 });
  const correction = observation(session, "Missed", true);
  correction.finalCallLogResult!.observedAt = new Date(observedAt.getTime() + 1000);
  await persistRingCentralFinalCallLogResult(correction, id);
  const corrected = await getCallLeadModel().findById(id).lean();
  assert.equal(corrected?.domain_revision, 2);
  assert.equal(corrected?.ringcentral?.qualification_reason, "call_log_inbound_target_answered_over_120s");
  assert.equal(corrected?.ringcentral?.ingestion_source, "webhook");
  assert.ok(getCallLeadReportingDecision(corrected).reason_codes.includes("conflicting_final_result"));
  assert.deepEqual(await counts(id), { changes: 2, commands: 2, outbox: 1 });
  const change = await EntityChange.findOne({ "entity.id": id, revision_after: 2 }).lean();
  assert.ok(change?.fields.some(field => field.path === "ringcentral.final_result_answered" && field.after === true));
});

test("replica: final-result outbox failure rolls back metadata, revision, EntityChange and command", { skip: !enabled }, async () => {
  const lead = await createCall("result-rollback"), id = lead._id.toString();
  const failure = mock.method(SheetSyncJob as any, "findOneAndUpdate", () => { throw new Error("synthetic outbox rollback"); });
  try {
    await assert.rejects(persistRingCentralFinalCallLogResult(observation(lead.ringcentral!.telephony_session_id!), id), /synthetic outbox rollback/);
  } finally { failure.mock.restore(); }
  const saved = await getCallLeadModel().findById(id).lean();
  assert.equal(saved?.domain_revision, 0);
  assert.equal(saved?.ringcentral?.final_result, undefined);
  assert.deepEqual(await counts(id), { changes: 0, commands: 0, outbox: 0 });
});

test("replica: external Call and booked duplicate Form reviews commit and replay without repeat mutation", { skip: !enabled }, async () => {
  const call = await createCall("review");
  const form = await getFormLeadModel().create({ source_company: "best_relocation_leads", name: "Synthetic", phone_number: "+15550001111", pickup_zip: "10001", destination_zip: "20001", local: "long_distance", timestamp: start, duplicate: true, booked: new mongoose.Types.ObjectId(), cpl: 0 });
  for (const [model, lead] of [["CallLead", call], ["FormLead", form]] as const) {
    const id = lead._id.toString(), input = reviewInput(model, id, `review-${model}`);
    const result = await reconcileExternalSheetReview(input);
    assert.equal(result.status, "applied");
    assert.equal((await reconcileExternalSheetReview(input)).status, "already_applied");
    assert.deepEqual(await counts(id), { changes: 1, commands: 1, outbox: 1 });
    const saved = model === "CallLead" ? await getCallLeadModel().findById(id).lean() : await getFormLeadModel().findById(id).lean();
    assert.equal(saved?.domain_revision, 1);
    assert.equal(saved?.external_sheet_review?.kind, model === "CallLead" ? "duplicate_call" : "bad_form");
    if (model === "CallLead") assert.equal(getCallLeadReportingDecision(saved).disposition, "duplicate_calls");
    else { assert.equal(saved?.duplicate, true); assert.ok(saved?.booked); }
    const parsed = (model === "CallLead" ? updateCallLeadSchema : updateFormLeadSchema).safeParse({ name: "Updated", external_sheet_review: saved?.external_sheet_review });
    assert.ok(!parsed.success || !("external_sheet_review" in parsed.data));
    await assert.rejects(reconcileExternalSheetReview({ ...input, context: { ...input.context, payload_checksum: "b".repeat(64) } }), /invalid_review_command_context/);
  }
});

test("replica: external review outbox failure rolls back review, revision and durable audit", { skip: !enabled }, async () => {
  const lead = await createCall("review-rollback"), id = lead._id.toString();
  const failure = mock.method(SheetSyncJob as any, "findOneAndUpdate", () => { throw new Error("synthetic review rollback"); });
  try { await assert.rejects(reconcileExternalSheetReview(reviewInput("CallLead", id, "review-rollback")), /synthetic review rollback/); }
  finally { failure.mock.restore(); }
  const saved = await getCallLeadModel().findById(id).lean();
  assert.equal(saved?.domain_revision, 0);
  assert.equal(saved?.external_sheet_review, undefined);
  assert.deepEqual(await counts(id), { changes: 0, commands: 0, outbox: 0 });
});

test("replica: stale lease and retired ingestion connection fence new review mutations", { skip: !enabled }, async () => {
  const lead = await createCall("review-fences"), id = lead._id.toString();
  const input = reviewInput("CallLead", id, "review-fences");
  await assert.rejects(reconcileExternalSheetReview({ ...input, execution: { lease: { ...lease, epoch: lease.epoch + 1 } } }));
  assert.deepEqual(await counts(id), { changes: 0, commands: 0, outbox: 0 });
  await ExternalDataConnection.updateOne({ key: "best_relocation" }, { $set: { retired_at: new Date() } });
  try { await assert.rejects(reconcileExternalSheetReview(input)); }
  finally { await ExternalDataConnection.updateOne({ key: "best_relocation" }, { $set: { retired_at: null } }); }
  assert.equal((await getCallLeadModel().findById(id).lean())?.external_sheet_review, undefined);
  assert.deepEqual(await counts(id), { changes: 0, commands: 0, outbox: 0 });
});

test("replica: owner Form Fill repair uses real eligible Form proof, durable replay, and atomic outbox rollback", { skip: !enabled }, async () => {
  await getFormLeadModel().create({ source_company: "best_relocation_leads", name: "Synthetic eligible Form", phone_number: "+15550001111", pickup_zip: "10001", destination_zip: "20001", local: "long_distance", timestamp: start, duplicate: false, cpl: 100 });
  const context = (suffix: string) => {
    const input = reviewInput("CallLead", new mongoose.Types.ObjectId().toHexString(), suffix);
    return { ...input.context, actor: input.context.initiator,
      provenance: { origin: "vantage_admin" as const, run_id: null, source_receipt_id: null, source_connection_key: null },
    };
  };
  const lead = await createCall("form-fill"), id = lead._id.toString();
  const input = { lead_id: id, expected_revision: 0, context: context("form-fill") };
  await repairCallFormFillForReporting(input);
  assert.equal((await repairCallFormFillForReporting(input)).status, "already_applied");
  const saved = await getCallLeadModel().findById(id).lean();
  assert.equal(saved?.domain_revision, 1);
  assert.equal(saved?.form_fill, true);
  assert.equal(saved?.duplicate, false);
  assert.deepEqual(await counts(id), { changes: 1, commands: 1, outbox: 1 });
  const other = await createCall("form-fill-rollback"), otherId = other._id.toString();
  const failure = mock.method(SheetSyncJob as any, "findOneAndUpdate", () => { throw new Error("synthetic Form Fill rollback"); });
  try { await assert.rejects(repairCallFormFillForReporting({ lead_id: otherId, expected_revision: 0, context: context("form-fill-rollback") }), /synthetic Form Fill rollback/); }
  finally { failure.mock.restore(); }
  assert.equal((await getCallLeadModel().findById(otherId).lean())?.form_fill, false);
  assert.deepEqual(await counts(otherId), { changes: 0, commands: 0, outbox: 0 });
});

test("replica: default timestamp-index pages include ordinary, far-boundary, and missing timestamp arrivals", { skip: !enabled }, async () => {
  const boundary = await createCall("boundary-scan"), missing = await createCall("missing-timestamp-scan");
  await getCallLeadModel().collection.updateOne({ _id: boundary._id }, { $set: { timestamp: new Date("2026-10-01T01:30:00Z"), "ringcentral.start_time": start } });
  await getCallLeadModel().collection.updateOne({ _id: missing._id }, { $unset: { timestamp: "" }, $set: { "ringcentral.start_time": start } });
  const plan = await planCallBackfill({ through: observedAt.toISOString(), deploymentId: "local-proof", pageSize: 1 }, {
    hasEligibleForm: async () => false, liveRate: async () => 100,
    providerAccount: async () => { throw new Error("provider deliberately unavailable"); },
  });
  for (const lead of [boundary, missing]) {
    assert.ok(plan.items.some(item => item.lead_id === lead._id.toString()));
    assert.ok(plan.timestamp_discrepancies.some(item => item.lead_id === lead._id.toString() && item.outside_widened_range));
  }
  assert.equal(plan.query_evidence?.primary_index, "call_lead_overview_timestamp_receiver");
  assert.equal(plan.query_evidence?.boundary_index, "source_granularity_id_1");
  assert.ok(plan.query_evidence?.explain_samples.length);
  assert.equal(plan.query_evidence?.max_time_ms, 10_000);
  const late = await createCall("coverage-late-arrival");
  await getCallLeadModel().collection.updateOne({ _id: late._id }, { $set: { "ringcentral.start_time": start } });
  const verification = await verifyCallBackfill(plan, { readMembership: async () => ({ calls: 0, duplicate_calls: 0, bad_call_leads: 0 }) }, {
    providerAccount: async () => { throw new Error("coverage verification must not read provider"); },
    providerRecords: async () => { throw new Error("coverage verification must not read provider"); },
  });
  assert.equal(verification.complete, false);
  assert.ok(verification.mismatches.some(item => item.lead_id === String(late._id) && item.reason === "coverage_candidate_missing_from_plan"));
});

test("replica: persisted BSON and corrupt ISO-string evidence agree between object and Mongo billing policy", { skip: !enabled }, async () => {
  const review = {
    kind: "bad_call", reason_code: "external_bad_call", raw_value: "Synthetic invalid moving request", normalized_value: "synthetic invalid moving request",
    source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: 1191420872, source_tab: "Calls",
    stable_source_row_id: `${prefix}-parity`, source_content_hash: "a".repeat(64), policy_version: "best-relocation-retirement-v1",
    ingestion_run_id: prefix, source_row_receipt_id: `${prefix}-receipt`, applied_at: observedAt,
  };
  const metadata = {
    telephony_session_id: `${prefix}-parity`, call_log_id: `${prefix}-parent`, ingestion_source: "webhook",
    qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 150,
    start_time: start, final_result: " Missed ", final_result_observed_at: observedAt,
    final_result_call_log_id: `${prefix}-parent`, final_result_answered: false,
  };
  const variants = [
    { name: "bson_overnight_missed", rc: {}, billable: false },
    { name: "bson_answered_conflict", rc: { final_result_answered: true }, billable: true },
    { name: "busy", rc: { final_result: "Busy" }, billable: true },
    { name: "iso_arrival_corruption", rc: { start_time: start.toISOString() }, billable: true },
    { name: "iso_observation_corruption", rc: { final_result_observed_at: observedAt.toISOString() }, billable: true },
    { name: "identity_conflict", rc: { final_result_call_log_id: "another-call" }, billable: true },
    { name: "bson_external_review", rc: { final_result: "Completed" }, review, billable: false },
    { name: "iso_external_review_corruption", rc: { final_result: "Completed" }, review: { ...review, applied_at: observedAt.toISOString() }, billable: true },
    { name: "wrong_review_reason", rc: { final_result: "Completed" }, review: { ...review, reason_code: "external_duplicate_call" }, billable: true },
    { name: "valid_external_form_fill", rc: { final_result: "Completed" }, review: { ...review, kind: "duplicate_call", reason_code: "external_form_fill", raw_value: "Form Fill", normalized_value: "form fill" }, billable: false },
    { name: "oversize_astral_review", rc: { final_result: "Completed" }, review: { ...review, raw_value: "\u{1f600}".repeat(2500) }, billable: true },
    { name: "oversize_review", rc: { final_result: "Completed" }, review: { ...review, raw_value: "x".repeat(4001) }, billable: true },
    { name: "other_source_review", rc: { final_result: "Completed" }, review: { ...review, source_workbook_id: "other-workbook" }, billable: true },
    { name: "historical_missing_result", rc: { final_result: null }, billable: true },
  ];
  const rows = variants.map(variant => ({ _id: new mongoose.Types.ObjectId(), proof: variant.name,
    source_company: "best_relocation_leads", phone_number: "+15550009999", timestamp: start,
    ringcentral: { ...metadata, ...variant.rc }, ...(variant.review ? { external_sheet_review: variant.review } : {}),
  }));
  const collection = mongoose.connection.db!.collection("call_leads");
  await collection.insertMany(rows);
  const ids = rows.map(row => row._id);
  const actual = new Set((await collection.find({ $and: [{ _id: { $in: ids } }, billableCallLeadFilter()] }).toArray()).map(row => String(row._id)));
  const expressionRows = await collection.aggregate([{ $match: { _id: { $in: ids } } }, { $project: { billable: billableCallLeadExpression() } }]).toArray();
  const expressionDecisions = new Map(expressionRows.map(row => [String(row._id), row.billable]));
  const persisted = await collection.find({ _id: { $in: ids } }).toArray();
  for (const [index, variant] of variants.entries()) {
    const row = persisted.find(row => String(row._id) === String(ids[index]))!;
    const decision = getCallLeadReportingDecision(row);
    assert.equal(decision.billable, variant.billable, variant.name);
    assert.equal(actual.has(String(row._id)), decision.billable, variant.name);
    assert.equal(expressionDecisions.get(String(row._id)), decision.billable, `${variant.name}: expression`);
  }
});

test("replica: 250 source Form candidates preload in six bounded queries and reuse the read cache", { skip: !enabled }, async () => {
  const Model = getFormLeadModel();
  await Model.create({ source_company: "best_relocation_leads", name: "Synthetic batch", phone_number: "+15553000000", pickup_zip: "10001", destination_zip: "20001", local: "long_distance", timestamp: new Date("2026-05-01T16:00:00Z"), ref_no: `${prefix}-batch-0`, cpl: 0 });
  const plan = { actions: Array.from({ length: 250 }, (_, index) => ({ command: "create_form_lead", command_payload: { ref_no: `${prefix}-batch-${index}`, name: "Synthetic batch", phone_number: `+1${5553000000 + index}`, timestamp: "2026-05-01T16:00:00Z" } })) } as unknown as BestRelocationApplicationPlan;
  let queries = 0;
  const original = Model.find.bind(Model);
  const instrument = mock.method(Model as any, "find", (filter: any) => { queries++; return original(filter); });
  try {
    const store = await preloadCanonicalAdoption(plan, []);
    assert.equal(queries, 6);
    for (let index = 0; index < 250; index++) await store.findFormLeadsByIdentity([`${prefix}-batch-${index}`]);
    assert.equal(queries, 6);
    assert.equal((await store.findFormLeadsByIdentity([`${prefix}-batch-0`])).length, 1);
  } finally { instrument.mock.restore(); }
});
