import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import { hasQualifiedRingCentralCall, qualifiedCallLeadFilter } from "./callLeadQualification";
import { planJobWrites } from "../sheetSync/drainer/jobPlanner";
import { getCallLeadModel } from "../../models/CallLead";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { validateGranotCrmSourceSemantics } from "../../models/granotCrmSourceSemantics";
import { aggregateSourcePerformance } from "../reporting/query/canonicalReporting";

const historical = { call_log_id: "provider-log", ingestion_source: "call_log_sync", duration_seconds: 120, qualification_reason: "call_log_inbound_target_answered_over_120s" };
const current = { ...historical, ingestion_source: "webhook", qualification_reason: "call_log_inbound_target_elapsed_at_least_120s" };
const samples = [
  [true, historical], [true, current], [false, null], [false, {}],
  ...[119.999, "120", NaN, Infinity, [150]].map((v) => [false, { ...current, duration_seconds: v }]),
  [false, { ...current, call_log_id: "  " }], [false, { ...current, call_log_id: ["identity"] }],
  [false, { ...current, qualification_reason: "outbound" }], [false, { ...current, ingestion_source: "manual" }],
] as const;

test("Registry refuses a Call route configured to create missing leads", () => {
  const result = validateGranotCrmSourceSemantics({
    lifecycle_disposition: "source_scoped_lead", lifecycle_enabled: true, lead_created_policy: "create_if_missing",
    lifecycle_routes: [{ lead_model: "CallLead", move_type: "any", route_key: "calls", source_granularity_id: "feed" }],
  } as Parameters<typeof validateGranotCrmSourceSemantics>[0]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /Only RingCentral/);
});

test("saved qualification accepts current and historical evidence and rejects malformed records", () => {
  for (const [expected, metadata] of samples) assert.equal(hasQualifiedRingCentralCall(metadata), expected);
});

test("an unsupported linked Call contributes no lead spend but keeps the booking revenue", () => {
  const totals = aggregateSourcePerformance([
    { _id: "manual", leadType: "call", cpl: 100, cpl_resolution_status: "resolved" },
    { _id: "legacy", leadType: "call", ingestion_origin: "legacy_unknown", ringcentral: historical, cpl: 75, cpl_resolution_status: "resolved" },
    { _id: "adopted", leadType: "call", ingestion_origin: "granot_lead_created", ringcentral: current, cpl: 60, cpl_resolution_status: "resolved" },
  ], [{ _id: "booking", lead_ref: "manual", total_binder_amount: 1000, deposit_amount: 200 }], new Map());
  assert.equal(totals.resolved_cpl_spend, 135);
  assert.equal(totals.total_binder, 1000);
  assert.equal(totals.total_deposit, 200);
});

test("loopback Mongo: billing filter agrees with the in-memory gate and linked projections preserve bookings/cancellations", {
  skip: process.env.RUN_CALL_BILLING_LOCAL_TEST !== "1",
}, async () => {
  process.env.MASTER_LEADS_SHEET_ID = "test-leads";
  process.env.MASTER_BOOKED_SHEET_ID = "test-booked";
  // This port is reserved for a disposable mongo:7 container. Never use the application URI.
  await mongoose.connect("mongodb://127.0.0.1:27469", { dbName: getMongoDatabaseName(), serverSelectionTimeoutMS: 10000 });
  const CallLead = getCallLeadModel();
  const ids = samples.map(() => new mongoose.Types.ObjectId());
  const bookingId = new mongoose.Types.ObjectId(), cancellationId = new mongoose.Types.ObjectId();
  const timestamp = new Date();
  try {
    await CallLead.collection.insertMany(samples.map(([, ringcentral], i) => ({ _id: ids[i], ringcentral, timestamp, source_company: "tbm_leads" })) as never);
    const matched = await CallLead.find({ _id: { $in: ids }, ...qualifiedCallLeadFilter() }).distinct("_id");
    assert.deepEqual(matched.map(String).sort(), ids.filter((_, i) => samples[i][0]).map(String).sort());
    await BookedLead.collection.insertOne({ _id: bookingId, lead_model: "CallLead", lead_ref: ids[2], book_date: timestamp, source: "tbm_leads", timestamp } as never);
    await CancelledLead.collection.insertOne({ _id: cancellationId, booked_lead: bookingId, timestamp } as never);
    const targets = async (resource: string, entity_id: mongoose.Types.ObjectId) =>
      (await planJobWrites({ _id: new mongoose.Types.ObjectId(), resource, entity_model: "CallLead", entity_id: String(entity_id) } as never))
        .flatMap((plan) => plan.writes.filter((write) => write.op === "upsert").map((write) => write.target));
    assert.deepEqual(await targets("source_lead", ids[2]), []);
    assert.deepEqual(await targets("source_lead", ids[0]), ["master_calls"]);
    assert.deepEqual(await targets("booking_chain", bookingId), ["master_booked"]);
    assert.deepEqual(await targets("cancellation_chain", cancellationId), ["master_booked", "master_cancelled"]);
  } finally {
    await Promise.all([CallLead.collection.deleteMany({ _id: { $in: ids } }), BookedLead.collection.deleteOne({ _id: bookingId }), CancelledLead.collection.deleteOne({ _id: cancellationId })]);
    await mongoose.disconnect();
  }
});
