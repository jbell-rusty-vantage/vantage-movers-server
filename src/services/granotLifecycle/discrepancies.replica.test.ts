import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotBookingDiscrepancyModel, GRANOT_BOOKING_DISCREPANCY_INDEXES } from "../../models/GranotBookingDiscrepancy";
import { getGranotReleaseDiscrepancyModel, GRANOT_RELEASE_DISCREPANCY_INDEXES } from "../../models/GranotReleaseDiscrepancy";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { correctGranotRecordLink, reEvaluateGranotDiscrepancy, resolveGranotDiscrepancyNoAction } from "./discrepancyOwnerCommands";

const ids = new Set<string>();
const prefix = `U29-${Date.now().toString(36).toUpperCase()}`;
const normalizedPrefix = prefix.replace(/[^A-Z0-9]/g, "");
const owner = { actor_type: "owner" as const, actor_id: "unit29-owner", actor_label: "unit29-owner@example.invalid", actor_role: "owner" as const, request_id: `unit29-${prefix}`, origin: "vantage_admin" as const };
const id = () => { const value = new mongoose.Types.ObjectId(); ids.add(String(value)); return value; };

async function ready(t: { skip(reason: string): void }) {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") { t.skip("Replica proof is opt-in."); return false; }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) { t.skip("Replica proof requires testvantagemovers."); return false; }
  await connectMongo();
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello?.setName) { t.skip("Mongo is not a replica set."); return false; }
  const collection = getGranotBookingDiscrepancyModel().collection;
  for (const index of GRANOT_BOOKING_DISCREPANCY_INDEXES) {
    await collection.createIndex(index.key, { name: index.name, ...("unique" in index ? { unique: true } : {}), ...("partialFilterExpression" in index ? { partialFilterExpression: index.partialFilterExpression } : {}) });
  }
  for (const index of GRANOT_RELEASE_DISCREPANCY_INDEXES) {
    await getGranotReleaseDiscrepancyModel().collection.createIndex(index.key, { name: index.name, ...("unique" in index ? { unique: true } : {}), ...("partialFilterExpression" in index ? { partialFilterExpression: index.partialFilterExpression } : {}) });
  }
  return true;
}

async function seedDiscrepancy(input: { job: string; reason?: string; linkId?: mongoose.Types.ObjectId; leadId?: mongoose.Types.ObjectId }) {
  const receiptId = id(), observationId = id(), decisionId = id(), discrepancyId = id();
  const now = new Date("2026-08-19T15:00:00.000Z");
  await getGranotObservationReceiptModel().collection.insertOne({ _id: receiptId, observation_channel: "granot_webhook", captured_at: now, processing: { state: "completed", match_attempt: 1 } });
  await getGranotObservationModel().collection.insertOne({ _id: observationId, receipt_id: receiptId, captured_at: now, identity: { normalized_job_no: input.job, job_no_raw: input.job }, contact: {}, agent_identity: {}, provider_context: {}, priority: { valid: false }, booking_action: { normalized: "booked" } });
  await mongoose.connection.collection("synchronization_decisions").insertOne({ _id: decisionId, receipt_id: receiptId, observation_id: observationId, attempt: 1, outcome: "conflict", reason_code: "booking_discrepancy_opened", decided_at: now });
  await getGranotBookingDiscrepancyModel().collection.insertOne({ _id: discrepancyId, normalized_job_no: input.job, discrepancy_kind: "booking", reason_code: input.reason ?? "booked_record_link_conflict", reason_fingerprint: discrepancyId.toHexString().padEnd(64, "f"), state: "open", ...(input.linkId ? { record_link_id: input.linkId } : {}), ...(input.leadId ? { lead_ref: { model: "FormLead", id: input.leadId } } : {}), evidence: [{ observation_id: observationId, decision_id: decisionId, captured_at: now, action: "booked" }], evidence_revision: 1, revision: 1, opened_at: now, last_evidence_at: now });
  return { receiptId, observationId, decisionId, discrepancyId };
}

after(async () => {
  if (mongoose.connection.readyState === 1) {
    const objectIds = [...ids].map((value) => new mongoose.Types.ObjectId(value));
    await Promise.all([
      getGranotBookingDiscrepancyModel().collection.deleteMany({ $or: [{ _id: { $in: objectIds } }, { normalized_job_no: { $regex: `^${normalizedPrefix}` } }] }),
      getGranotRecordLinkModel().collection.deleteMany({ normalized_job_no: { $regex: `^${normalizedPrefix}` } }),
      BookedLead.collection.deleteMany({ normalized_job_no: { $regex: `^${normalizedPrefix}` } }),
      getFormLeadModel().collection.deleteMany({ _id: { $in: objectIds } }),
      getGranotObservationModel().collection.deleteMany({ _id: { $in: objectIds } }),
      getGranotObservationReceiptModel().collection.deleteMany({ _id: { $in: objectIds } }),
      mongoose.connection.collection("synchronization_decisions").deleteMany({ _id: { $in: objectIds } }),
      DomainCommandExecution.deleteMany({ "provenance.discrepancy_id": { $in: objectIds } }),
      getEntityChangeModel().collection.deleteMany({ "provenance.discrepancy_id": { $in: objectIds } }),
    ]);
  }
  await mongoose.disconnect().catch(() => undefined);
});

test("[AC-36] partial unique index allows one open fingerprint and a resolved history row", async (t) => {
  if (!await ready(t)) return;
  const job = `${prefix}-UNIQUE`, fingerprint = "a".repeat(64), now = new Date();
  const base = { normalized_job_no: job, discrepancy_kind: "booking" as const, reason_code: "booked_record_link_conflict", reason_fingerprint: fingerprint, evidence: [{ observation_id: id(), decision_id: id(), captured_at: now, action: "booked" as const }], evidence_revision: 1, revision: 1, opened_at: now, last_evidence_at: now };
  const results = await Promise.allSettled([
    getGranotBookingDiscrepancyModel().create({ ...base, _id: id(), state: "open" }),
    getGranotBookingDiscrepancyModel().create({ ...base, _id: id(), state: "open" }),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(await getGranotBookingDiscrepancyModel().countDocuments({ normalized_job_no: job, state: "open" }), 1);
  await getGranotBookingDiscrepancyModel().create({ ...base, _id: id(), state: "resolved", resolution: { outcome: "no_action", command_execution_id: id(), actor: owner, resolved_at: now } });
  assert.equal(await getGranotBookingDiscrepancyModel().countDocuments({ normalized_job_no: job }), 2);
});

test("[AC-35][AC-36] No Action is exactly replayable and a revision race has one winner with zero Changes/Sheets", async (t) => {
  if (!await ready(t)) return;
  const seeded = await seedDiscrepancy({ job: `${prefix}-NOACTION` });
  const before = { changes: await getEntityChangeModel().countDocuments(), sheets: await SheetSyncJob.countDocuments() };
  const input = { discrepancy_id: String(seeded.discrepancyId), expected_revision: 1, reason_code: "other" as const, reason_text: "Synthetic owner review", idempotency_key: `unit29-noaction-${seeded.discrepancyId}`, owner };
  const first = await resolveGranotDiscrepancyNoAction(input);
  const replay = await resolveGranotDiscrepancyNoAction(input);
  assert.equal(first.revision, 2); assert.equal(replay.replayed, true); assert.equal(replay.command_execution_id, first.command_execution_id);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.discrepancy_id": String(seeded.discrepancyId) }), 1);
  assert.deepEqual({ changes: await getEntityChangeModel().countDocuments(), sheets: await SheetSyncJob.countDocuments() }, before);

  const race = await seedDiscrepancy({ job: `${prefix}-RACE` });
  const contenders = await Promise.allSettled(["a", "b"].map((suffix) => resolveGranotDiscrepancyNoAction({ ...input, discrepancy_id: String(race.discrepancyId), idempotency_key: `unit29-race-${suffix}-${race.discrepancyId}` })));
  assert.equal(contenders.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal((await getGranotBookingDiscrepancyModel().findById(race.discrepancyId).lean())?.revision, 2);
});

test("[AC-26][AC-36] re-evaluation leaves an unchanged current conflict open and exactly replays", async (t) => {
  if (!await ready(t)) return;
  const job = normalizeJobNo(`${prefix}-REEVALUATE`)!, bookingId = id();
  await BookedLead.collection.insertOne({ _id: bookingId, job_no: job, normalized_job_no: job, cancelled: true, domain_revision: 0 });
  const seeded = await seedDiscrepancy({ job, reason: "booked_after_official_cancellation" });
  const input = { discrepancy_id: String(seeded.discrepancyId), expected_revision: 1, idempotency_key: `unit29-reevaluate-${seeded.discrepancyId}`, owner };
  const first = await reEvaluateGranotDiscrepancy(input);
  const replay = await reEvaluateGranotDiscrepancy(input);
  assert.equal(first.outcome, "still_conflicting"); assert.equal(first.state, "open"); assert.equal(first.revision, 1);
  assert.equal(replay.replayed, true); assert.equal(replay.command_execution_id, first.command_execution_id);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.discrepancy_id": seeded.discrepancyId }), 0);
});

test("[AC-23][AC-35] correction atomically preserves the old link and Lead scope with two Changes and zero official/Sheet effects", async (t) => {
  if (!await ready(t)) return;
  const job = normalizeJobNo(`${prefix}-CORRECT`)! , oldLinkId = id(), oldLeadId = id(), newLeadId = id(), companyId = id(), granularityId = id(), decisionId = id(), observationId = id(), now = new Date("2026-08-19T15:00:00.000Z");
  await getFormLeadModel().collection.insertOne({ _id: newLeadId, normalized_job_no: job, lead_source_company: companyId, source_granularity_id: granularityId, duplicate: false, bad_lead: false });
  await getGranotRecordLinkModel().create({ _id: oldLinkId, provider: "granot", normalized_job_no: job, job_no_snapshot: job, state: "active", lead_ref: { model: "FormLead", id: oldLeadId }, source_scope: { lead_source_company: companyId, source_granularity_id: granularityId }, disputed: true, dispute_reason: "synthetic", established_by_decision_id: decisionId, established_at: now, last_observation_id: observationId, last_observed_at: now, domain_revision: 0 });
  const discrepancy = await seedDiscrepancy({ job, linkId: oldLinkId, leadId: oldLeadId });
  const before = { bookings: await BookedLead.countDocuments(), cancellations: await CancelledLead.countDocuments(), sheets: await SheetSyncJob.countDocuments(), changes: await getEntityChangeModel().countDocuments() };
  const result = await correctGranotRecordLink({ discrepancy_id: String(discrepancy.discrepancyId), expected_revision: 1, expected_link_revision: 0, selected_lead: { lead_model: "FormLead", lead_id: String(newLeadId) }, reason_text: "Owner selected the verified synthetic Lead", idempotency_key: `unit29-correct-${discrepancy.discrepancyId}`, owner });
  const old = await getGranotRecordLinkModel().findById(oldLinkId).lean();
  const replacement = await getGranotRecordLinkModel().findById(result.replacement_record_link_id).lean();
  const lead = await getFormLeadModel().findById(newLeadId).lean();
  assert.equal(old?.state, "superseded"); assert.equal(String(old?.superseded_by), result.replacement_record_link_id);
  assert.equal(old?.domain_revision, 1); assert.equal(replacement?.domain_revision, 1);
  assert.equal(replacement?.state, "active"); assert.equal(String(replacement?.lead_ref?.id), String(newLeadId));
  assert.equal(String(lead?.lead_source_company), String(companyId)); assert.equal(String(lead?.source_granularity_id), String(granularityId));
  assert.equal(await getEntityChangeModel().countDocuments(), before.changes + 2);
  assert.deepEqual({ bookings: await BookedLead.countDocuments(), cancellations: await CancelledLead.countDocuments(), sheets: await SheetSyncJob.countDocuments() }, { bookings: before.bookings, cancellations: before.cancellations, sheets: before.sheets });
});

test("[AC-23][AC-36] correction failure after Change writes rolls back link, discrepancy, Command, and Changes", async (t) => {
  if (!await ready(t)) return;
  const job = normalizeJobNo(`${prefix}-ROLLBACK`)! , oldLinkId = id(), oldLeadId = id(), newLeadId = id(), companyId = id(), granularityId = id(), decisionId = id(), observationId = id(), now = new Date("2026-08-19T15:00:00.000Z");
  await getFormLeadModel().collection.insertOne({ _id: newLeadId, normalized_job_no: job, lead_source_company: companyId, source_granularity_id: granularityId, duplicate: false, bad_lead: false });
  await getGranotRecordLinkModel().create({ _id: oldLinkId, provider: "granot", normalized_job_no: job, job_no_snapshot: job, state: "active", lead_ref: { model: "FormLead", id: oldLeadId }, source_scope: { lead_source_company: companyId, source_granularity_id: granularityId }, disputed: true, established_by_decision_id: decisionId, established_at: now, last_observation_id: observationId, last_observed_at: now, domain_revision: 0 });
  const discrepancy = await seedDiscrepancy({ job, linkId: oldLinkId, leadId: oldLeadId });
  const beforeChanges = await getEntityChangeModel().countDocuments();
  await assert.rejects(() => correctGranotRecordLink({ discrepancy_id: String(discrepancy.discrepancyId), expected_revision: 1, expected_link_revision: 0, selected_lead: { lead_model: "FormLead", lead_id: String(newLeadId) }, reason_text: "Owner reviewed synthetic rollback correction", idempotency_key: `unit29-rollback-${discrepancy.discrepancyId}`, owner }, { test_fail_after: "changes" }), /Synthetic correction rollback/);
  const [old, row] = await Promise.all([getGranotRecordLinkModel().findById(oldLinkId).lean(), getGranotBookingDiscrepancyModel().findById(discrepancy.discrepancyId).lean()]);
  assert.equal(old?.state, "active"); assert.equal(old?.domain_revision, 0); assert.equal(old?.superseded_by, undefined);
  assert.equal(row?.state, "open"); assert.equal(row?.revision, 1);
  assert.equal(await getGranotRecordLinkModel().countDocuments({ normalized_job_no: job }), 1);
  assert.equal(await getEntityChangeModel().countDocuments(), beforeChanges);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.discrepancy_id": String(discrepancy.discrepancyId) }), 0);
});
