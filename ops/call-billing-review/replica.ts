import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock } from "node:test";
import mongoose from "mongoose";

async function main() {
  const database = `testvantagemovers_callreview${process.pid}`;
  Object.assign(process.env, { TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27119/?replicaSet=callReportingProof", SHEET_SYNC_MODE: "queued" });
  await import("../test-setup.js");
  const { logger } = await import("../../src/logger.js");
  for (const level of ["info", "warn", "error"] as const) mock.method(logger, level, () => {});
  mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    assert.match(String(input), /^https:\/\/api\.zippopotam\.us\/us\/(10001|94105)$/);
    return new Response(JSON.stringify({ places: [{ "state abbreviation": String(input).endsWith("10001") ? "NY" : "CA" }] }));
  });
  const { connectMongo } = await import("../../src/db.js");
  const { getCallLeadModel } = await import("../../src/models/CallLead.js");
  const { getFormLeadModel } = await import("../../src/models/FormLead.js");
  const { getFormFillWorkModel } = await import("../../src/models/FormFillWork.js");
  const { getLeadSourceCompanyModel } = await import("../../src/models/LeadSourceCompany.js");
  const { getLeadSourceGranularityModel } = await import("../../src/models/LeadSourceGranularity.js");
  const { EntityChange } = await import("../../src/models/EntityChange.js");
  const { SheetSyncJob } = await import("../../src/models/SheetSyncJob.js");
  const { DomainCommandExecution } = await import("../../src/models/DomainCommandExecution.js");
  const { createFormLead, updateSourceOwnedLead } = await import("../../src/services/domainCommands/leads.js");
  const { beginRingCentralCallLeadIngestion } = await import("../../src/services/leads/callLead.service.js");
  const { beginFormLeadIngestion } = await import("../../src/services/leads/formLead.service.js");
  const { drainFormFillWork } = await import("../../src/services/leads/drainFormFillWork.js");
  const { scheduleFormFillWork } = await import("../../src/services/leads/formFillWork.js");
  const { hasFormFillForCallLead } = await import("../../src/services/leads/duplicateLead.service.js");
  const { getCallLeadReportingDecision, billableCallLeadFilter, billableCallLeadExpression } = await import("../../src/services/leads/callLeadReportingDisposition.js");
  const { persistRingCentralFinalCallLogResult } = await import("../../src/services/domainCommands/ringcentralFinalResult.js");
  const { planExpectedSheetTabs } = await import("../../src/services/googleSheets/expectedSheetTabs.js");
  const { mirrorFormLeadToCallSibling } = await import("../../src/services/granotLifecycle/callLeadFormSibling.js");
  const { toDeskLeadFacts } = await import("../../src/services/salesOutreach/subjects/leadFacts.js");
  const { evaluateDeskEligibility } = await import("../../src/services/salesOutreach/subjects/eligibility.js");
  const { mongoDeskSubjectStore } = await import("../../src/services/salesOutreach/subjects/store.js");
  const { BookedLead } = await import("../../src/models/BookedLead.js");
  const { CancelledLead } = await import("../../src/models/CancelledLead.js");
  const { planJobWrites } = await import("../../src/services/sheetSync/drainer/jobPlanner.js");
  await connectMongo();
  assert.equal(mongoose.connection.host, "127.0.0.1");
  assert.equal(mongoose.connection.name, database);
  assert.equal((await mongoose.connection.db!.admin().command({ hello: 1 })).setName, "callReportingProof");
  try {
    const Calls = getCallLeadModel(), Forms = getFormLeadModel(), Work = getFormFillWorkModel();
    for (const Model of [Calls, Forms, Work, EntityChange, SheetSyncJob, DomainCommandExecution]) {
      await Model.createCollection(); await Model.createIndexes();
    }
    const company = await getLeadSourceCompanyModel().create({ company_slug: "main_site", name: "Synthetic", owner_label: "Synthetic", active: true });
    const feed = await getLeadSourceGranularityModel().create({ source_company: company._id, granularity_key: "proof_form",
      channel: "form", owner_label: "Synthetic Forms", crm_label: "Synthetic Forms", active: true });
    company.default_form_granularity = feed._id; company.default_form_granularity_key = "proof_form"; await company.save();
    const phone = "5550123001", otherCompany = new mongoose.Types.ObjectId();
    const qualified = { ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_elapsed_at_least_120s",
      duration_seconds: 150, call_log_id: "proof" };
    const callRow = (n: number, number = phone) => ({ _id: new mongoose.Types.ObjectId(), source_company: "main_site",
      lead_source_company: company._id, source_granularity_id: new mongoose.Types.ObjectId(),
      phone_number: number, normalized_phone_number: number, timestamp: new Date(Date.now() - n * 86_400_000),
      createdAt: new Date(Date.now() - n * 86_400_000), cpl: 50, domain_revision: 0,
      duplicate: false, form_fill: false, ringcentral: { ...qualified, call_log_id: `proof-${n}` } });
    const rows = Array.from({ length: 61 }, (_, i) => callRow(i));
    const foreign = { ...callRow(99), lead_source_company: otherCompany };
    const legacy = { ...callRow(98), lead_source_company: null };
    await Calls.collection.insertMany([...rows, foreign, legacy] as never);
    const owner = { actor_type: "owner", actor_id: "synthetic-owner", actor_label: "Synthetic", actor_role: "owner", request_id: "call-review", origin: "vantage_admin" } as const;
    const context = { command_id: new mongoose.Types.ObjectId().toHexString(), idempotency_key: "proof:form",
      payload_checksum: createHash("sha256").update("proof:form").digest("hex"), actor: owner, initiator: owner,
      provenance: { origin: "vantage_admin" as const, run_id: null, source_receipt_id: null, source_connection_key: null } };
    const formData = (number: string) => ({ source_company: "main_site", name: "Synthetic", phone_number: number,
      pickup_zip: "10001", destination_zip: "94105", move_size: "Studio" as const, ref_no: `proof-${number}`, post_to_granot: false, crm_company_label: "Synthetic Forms" });
    await createFormLead({ data: formData(phone), context });
    assert.equal(await Calls.countDocuments({ form_fill: true }), 25, "bounded immediate transaction");
    assert.equal(getCallLeadReportingDecision(await Calls.collection.findOne({ _id: rows[60]!._id })).billable, true,
      "an older otherwise billable Call remains beyond the immediate page");
    await drainFormFillWork(1);
    assert.equal(await Calls.countDocuments({ form_fill: true }), 50);
    assert.equal(await Work.countDocuments(), 1, "interrupted tick retains cursor");
    await drainFormFillWork();
    assert.equal(await Calls.countDocuments({ form_fill: true }), 62, "all same-company and legacy Calls converge");
    assert.equal((await Calls.findById(foreign._id))?.form_fill, false, "canonical conflict cannot match legacy slug");
    const changes = await EntityChange.countDocuments({ command_name: "markCallLeadFormFill" });
    assert.equal(changes, 62);
    assert.equal(await SheetSyncJob.countDocuments({ entity_model: "CallLead" }), 62);
    await createFormLead({ data: formData(phone), context }); await drainFormFillWork();
    assert.equal(await EntityChange.countDocuments({ command_name: "markCallLeadFormFill" }), changes);
    assert.equal(await Work.countDocuments(), 0);
    for (const row of await Calls.collection.find({ form_fill: true }).toArray()) {
      assert.equal(getCallLeadReportingDecision(row).billable, false);
      assert.equal(planExpectedSheetTabs("CallLead", row).expected[0]?.tabName, "Duplicate Calls");
    }
    // The sieve admits arbitrary leading digits. Exact matches behind a full page must still be found.
    const sievePhone = "5550123002";
    await Forms.collection.insertMany([...Array.from({ length: 101 }, () => ({ _id: new mongoose.Types.ObjectId(),
      source_company: "main_site", lead_source_company: company._id, phone_number: `44${sievePhone}`, duplicate: false })),
      { _id: new mongoose.Types.ObjectId(), source_company: "main_site", lead_source_company: company._id, phone_number: sievePhone, duplicate: false }] as never);
    assert.equal(await hasFormFillForCallLead({ sourceCompany: "main_site", leadSourceCompany: company._id }, sievePhone), true);
    assert.equal(await hasFormFillForCallLead({ sourceCompany: "main_site", leadSourceCompany: otherCompany }, sievePhone), false);
    // Establish both transaction snapshots before either inserts its counterpart.
    const racePhone = "5550123003", a = await mongoose.startSession(), b = await mongoose.startSession();
    a.startTransaction(); b.startTransaction();
    try {
      await Calls.findOne({ phone_number: racePhone }).session(a);
      await Forms.findOne({ phone_number: racePhone }).session(b);
      const pending = await beginRingCentralCallLeadIngestion({ source_company: "main_site", phone_number: racePhone, duplicate: false,
        source_resolution: { route_id: new mongoose.Types.ObjectId().toHexString(), assignment_id: new mongoose.Types.ObjectId().toHexString(),
          normalized_target_number: "5550100999", company_id: String(company._id), company_slug: "main_site",
          granularity_id: new mongoose.Types.ObjectId().toHexString(), granularity_key: "proof_call", company_label_snapshot: "Synthetic",
          granularity_label_snapshot: "Calls", crm_label_snapshot: "Calls" },
        ringcentral: { ...qualified, ingestion_source: "call_log_sync", telephony_session_id: "race-session", call_log_id: "race-log",
          route_id: new mongoose.Types.ObjectId().toHexString(), route_assignment_id: new mongoose.Types.ObjectId().toHexString(), target_phone_number: "5550100999" } }, { session: b, now: new Date() });
      await beginFormLeadIngestion(formData(racePhone), { session: a, now: new Date(), ingestion_origin: "wordpress_form" });
      await a.commitTransaction(); await b.commitTransaction();
      assert.equal((await Calls.findById(pending.lead._id))?.form_fill, false, "race reproduced before durable follow-up");
      await Promise.all([drainFormFillWork(), drainFormFillWork()]);
      assert.equal((await Calls.findById(pending.lead._id))?.form_fill, true);
      assert.equal(await EntityChange.countDocuments({ "entity.id": String(pending.lead._id), command_name: "markCallLeadFormFill" }), 1);
    } finally { await a.endSession(); await b.endSession(); }
    const abort = await mongoose.startSession();
    await assert.rejects(abort.withTransaction(async () => { await scheduleFormFillWork("CallLead", String(foreign._id), abort); throw new Error("interrupt"); }), /interrupt/);
    await abort.endSession(); assert.equal(await Work.countDocuments(), 0);
    const correctedCall = callRow(199, "5550123005");
    await Calls.collection.insertOne(correctedCall as never);
    const form = await Forms.findOne({ phone_number: phone });
    assert.ok(form);
    await updateSourceOwnedLead({ lead_model: "FormLead", lead_id: String(form._id), patch: { phone_number: correctedCall.phone_number },
      context: { ...context, command_id: new mongoose.Types.ObjectId().toHexString(), idempotency_key: "proof:phone-correction",
        payload_checksum: createHash("sha256").update("proof:phone-correction").digest("hex") } });
    assert.ok(await Work.exists({ model: "FormLead", lead_id: String(form._id) }), "real correction schedules convergence");
    const failOutbox = mock.method(SheetSyncJob, "findOneAndUpdate", () => { throw new Error("synthetic outbox interruption"); });
    const failed = await drainFormFillWork(1); failOutbox.mock.restore();
    assert.equal(failed.deferred, 1);
    assert.equal((await Calls.findById(correctedCall._id))?.form_fill, false, "outbox fault rolls back classification");
    assert.equal(await EntityChange.countDocuments({ "entity.id": String(correctedCall._id) }), 0);
    assert.equal(await Work.countDocuments(), 1, "failed task stays durable");
    await Work.updateMany({}, { $set: { due_at: new Date(0) } });
    await drainFormFillWork();
    assert.equal((await Calls.findById(correctedCall._id))?.form_fill, true);
    assert.equal(await EntityChange.countDocuments({ "entity.id": String(correctedCall._id) }), 1);
    assert.equal(await Calls.countDocuments({ _id: { $in: rows.map(row => row._id) }, form_fill: true }), 61,
      "phone correction never clears saved historical Form Fill automatically");
    // Watermark updates are canonical, atomic and do not churn semantic effects.
    const resultRow = { ...callRow(200, "5550123004"), ringcentral: { ...qualified, call_log_id: "ordered-log", telephony_session_id: "ordered-session",
      start_time: new Date("2026-11-04T08:00:00Z"), final_result: "Missed", final_result_answered: false,
      final_result_call_log_id: "ordered-log", final_result_observed_at: new Date("2026-11-04T08:05:00Z") } };
    await Calls.collection.insertOne(resultRow as never);
    const observation = (time: string, result: string, answered: boolean) => ({ telephonySessionId: "ordered-session", callLogId: "ordered-log",
      startTime: resultRow.ringcentral.start_time, finalCallLogResult: { result, answered, callLogId: "ordered-log", observedAt: new Date(`2026-11-04T${time}Z`) } });
    const effects = await EntityChange.countDocuments(), outbox = await SheetSyncJob.countDocuments();
    await persistRingCentralFinalCallLogResult(observation("08:07:00", "Missed", false));
    await persistRingCentralFinalCallLogResult(observation("08:06:00", "Accepted", true));
    assert.equal((await Calls.findById(resultRow._id))?.ringcentral?.final_result, "Missed");
    assert.equal(await EntityChange.countDocuments(), effects); assert.equal(await SheetSyncJob.countDocuments(), outbox);
    assert.equal((await Calls.findById(resultRow._id))?.domain_revision, 0);
    await persistRingCentralFinalCallLogResult(observation("08:08:00", "Accepted", true));
    assert.equal((await Calls.findById(resultRow._id))?.domain_revision, 1);
    assert.equal(await EntityChange.countDocuments(), effects + 1);
    await Promise.all([
      persistRingCentralFinalCallLogResult(observation("08:09:00", "Accepted", true)),
      persistRingCentralFinalCallLogResult(observation("08:10:00", "Missed", false)),
    ]);
    const newest = await Calls.findById(resultRow._id);
    assert.equal(newest?.ringcentral?.final_result, "Missed");
    assert.equal(newest?.ringcentral?.final_result_observed_at?.toISOString(), "2026-11-04T08:10:00.000Z");
    const all = await Calls.collection.find({}).toArray();
    const expected = all.filter(row => getCallLeadReportingDecision(row).billable).map(row => String(row._id)).sort();
    assert.deepEqual((await Calls.collection.find(billableCallLeadFilter()).toArray()).map(row => String(row._id)).sort(), expected);
    assert.deepEqual((await Calls.collection.aggregate([{ $project: { billable: billableCallLeadExpression() } }]).toArray()).filter(row => row.billable).map(row => String(row._id)).sort(), expected);
    const pairPhone = "5550123006", pairCall = { ...callRow(300, pairPhone), createdAt: new Date(), form_fill: true };
    const pairForm = { _id: new mongoose.Types.ObjectId(), source_company: "main_site", lead_source_company: company._id,
      phone_number: pairPhone, normalized_phone_number: pairPhone, createdAt: new Date(), duplicate: false,
      job_no: "P999876543", normalized_job_no: "P999876543", granot_priority: "1", receiver_agent: new mongoose.Types.ObjectId(),
      receiver_agent_name_snapshot: "Synthetic Rep", receiver_agent_source: "granot_username_match", domain_revision: 0 };
    const foreignPair = { ...callRow(301, pairPhone), lead_source_company: otherCompany, createdAt: new Date() };
    await Calls.collection.insertMany([pairCall, foreignPair] as never); await Forms.collection.insertOne(pairForm as never);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: toDeskLeadFacts("CallLead", pairCall) }), { outcome: "excluded", reason: "job_number_pending" });
    assert.equal(evaluateDeskEligibility({ kind: "lead", facts: toDeskLeadFacts("FormLead", { ...pairForm, job_no: null, normalized_job_no: null }) }).outcome, "eligible");
    const mirror = await mirrorFormLeadToCallSibling(String(pairForm._id), { kind: "owner_backfill", run_id: "synthetic-review" });
    assert.equal(mirror.outcome, "updated");
    const paired = await Calls.collection.findOne({ _id: pairCall._id }); assert.ok(paired);
    assert.equal(String(paired.receiver_agent), String(pairForm.receiver_agent)); assert.equal(paired.granot_priority, "1");
    assert.equal(String(paired.granot_form_sibling.form_lead_id), String(pairForm._id));
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: toDeskLeadFacts("CallLead", paired) }), { outcome: "excluded", reason: "form_lead_holds_job" });
    assert.equal((await mongoDeskSubjectStore.jobNumberLeadCounts([pairForm.job_no], null)).get(pairForm.job_no), 1);
    assert.equal((await Calls.collection.findOne({ _id: foreignPair._id }))?.granot_form_sibling, undefined);
    await mirrorFormLeadToCallSibling(String(pairForm._id), { kind: "owner_backfill", run_id: "synthetic-review" });
    assert.deepEqual(await Calls.collection.findOne({ _id: pairCall._id }), paired, "sibling replay retains identity/receiver/attribution");
    // Reporting-bad does not create the Desk's authoritative bad_lead closure.
    assert.equal(getCallLeadReportingDecision(resultRow).disposition, "bad_call_leads");
    assert.equal(evaluateDeskEligibility({ kind: "lead", facts: toDeskLeadFacts("CallLead", { ...resultRow, job_no: "P123" }) }).outcome, "eligible");
    const unsupported = { ...callRow(400), ringcentral: null, booked: new mongoose.Types.ObjectId(), cancelled: new mongoose.Types.ObjectId() };
    await Calls.collection.insertOne(unsupported as never);
    await BookedLead.collection.insertOne({ _id: unsupported.booked, lead_ref: unsupported._id, lead_model: "CallLead", source: "main_site",
      timestamp: new Date(), book_date: new Date(), merchant: "Synthetic", job_no: "P12345", total_binder_amount: 100, deposit_amount: 50, cancelled: unsupported.cancelled } as never);
    await CancelledLead.collection.insertOne({ _id: unsupported.cancelled, booked_lead: unsupported.booked, timestamp: new Date(), refund_amount: 50 } as never);
    process.env.TEST_MASTER_LEADS_SHEET_ID = "synthetic-master"; process.env.TEST_MASTER_BOOKED_SHEET_ID = "synthetic-booked";
    const job = (resource: "booking_chain" | "cancellation_chain" | "source_lead", id: string) => new SheetSyncJob({ resource, operation: "proof", entity_model: "CallLead", entity_id: id });
    assert.equal(getCallLeadReportingDecision(unsupported).disposition, "excluded");
    assert.deepEqual(await planJobWrites(job("source_lead", String(unsupported._id))), []);
    const bookingPlans = await planJobWrites(job("booking_chain", String(unsupported.booked)));
    const cancellationPlans = await planJobWrites(job("cancellation_chain", String(unsupported.cancelled)));
    assert.ok(bookingPlans.flatMap(plan => plan.writes).some(write => write.tabName === "Booked Deals" && write.op === "upsert"));
    assert.ok(cancellationPlans.flatMap(plan => plan.writes).some(write => write.tabName === "Cancelled Deals" && write.op === "upsert"));
    console.log("PASS: real Form command/correction; 62-Call bounded continuation/replay; canonical isolation/legacy fallback; 101 sieve false positives; concurrent arrival/drains; rollback; outbox failure/retry; no blanket clearing; ordered canonical evidence; persisted billing/tab parity");
    console.log("PASS: persisted Granot sibling receiver/priority/replay; single Desk job holder; foreign-company isolation; jobless Form/Call semantics; overnight reporting versus Desk; unsupported Call with official Booking/Cancellation plans");
  } finally { await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect(); mock.restoreAll(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
