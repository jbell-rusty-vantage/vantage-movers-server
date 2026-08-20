import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { Merchant } from "../../models/Merchant";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { planJobWrites } from "../sheetSync/drainer/jobPlanner";
import { createReferralBooking } from "./referralBooking";
import { noAction, updateExistingBooking } from "./bookingOwnerCommands";
import {
  getGranotLifecycleCaseDetail,
  listGranotLifecycleCaseCandidates,
  listGranotLifecycleCases,
} from "./projections";

const seeded = new Set<string>();
const jobPrefix = `U28-${Date.now().toString(36).toUpperCase()}`;
const normalizedJobPrefix = normalizeJobNo(jobPrefix)!;

async function replicaReady(t: { skip: (reason: string) => void }) {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello?.setName) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  if (mongoose.connection.readyState === 1) {
    const ids = [...seeded].map((value) => new mongoose.Types.ObjectId(value));
    const bookingIds = (await BookedLead.find({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } })
      .select({ _id: 1 }).lean().exec()).map((row) => String(row._id));
    await Promise.all([
      getGranotBookingReconciliationCaseModel().deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      BookedLead.deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      getGranotRecordLinkModel().collection.deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      Agent.deleteMany({ _id: { $in: ids } }),
      Merchant.deleteMany({ _id: { $in: ids } }),
      getGranotCrmSourceModel().deleteMany({ _id: { $in: ids } }),
      getGranotObservationModel().collection.deleteMany({ _id: { $in: ids } }),
      getGranotObservationReceiptModel().collection.deleteMany({ _id: { $in: ids } }),
      mongoose.connection.collection("synchronization_decisions").deleteMany({ _id: { $in: ids } }),
      DomainCommandExecution.deleteMany({ "provenance.case_id": { $in: [...seeded] } }),
      getEntityChangeModel().collection.deleteMany({ "provenance.case_id": { $in: ids } }),
      SheetSyncJob.deleteMany({ entity_id: { $in: [...seeded, ...bookingIds] } }),
    ]);
  }
  await mongoose.disconnect().catch(() => undefined);
});

function id() {
  const value = new mongoose.Types.ObjectId();
  seeded.add(String(value));
  return value;
}

async function seed() {
  const receiptId = id();
  const observationId = id();
  const decisionId = id();
  const caseId = id();
  const sourceId = id();
  const agentId = id();
  const merchantId = id();
  let activation = await getGranotLifecycleActivationModel().collection.findOne({ key: "granot_lifecycle" });
  if (!activation) {
    await getGranotLifecycleActivationModel().collection.insertOne({
      key: "granot_lifecycle",
      activated_at: new Date("2026-01-01T00:00:00.000Z"),
      activated_by: {
        actor_type: "system",
        actor_id: "unit28-replica",
        actor_label: "Unit 28 replica",
        actor_role: "system",
        request_id: "unit28-replica-activation",
        origin: "reporting_projection",
      },
      reason: "Unit 28 disposable replica activation fixture.",
      processor_version: "unit28-test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    activation = await getGranotLifecycleActivationModel().collection.findOne({ key: "granot_lifecycle" });
  }
  const now = new Date(Math.max(
    new Date("2026-08-19T13:00:00.000Z").getTime(),
    new Date(activation!.activated_at as Date).getTime() + 60_000,
  ));
  const jobRaw = `${jobPrefix}-${caseId.toHexString().slice(-6).toUpperCase()}`;
  const job = normalizeJobNo(jobRaw)!;
  await getGranotObservationReceiptModel().collection.insertOne({
    _id: receiptId,
    observation_channel: "granot_webhook",
    captured_at: now,
    processing: { state: "completed", match_attempt: 1 },
  });
  await getGranotObservationModel().collection.insertOne({
    _id: observationId,
    receipt_id: receiptId,
    captured_at: now,
    identity: { normalized_job_no: job, job_no_raw: jobRaw },
    contact: { display_name: "U28 Accepted Referral Customer" },
    priority: { valid: false },
    booking_action: { normalized: "booked" },
    financial: { estimate: 9999.99, payment: 111.11, balance: 8888.88 },
  });
  await mongoose.connection.collection("synchronization_decisions").insertOne({
    _id: decisionId,
    observation_id: observationId,
    attempt: 1,
    execution_mode: "live",
    outcome: "linked",
    reason_code: "booking_case_opened",
    source_policy: {
      granot_crm_source_id: sourceId,
      disposition: "referral_booking",
      policy_version: "unit28-referral-v1",
    },
    candidates: [],
    evaluated_gates: [],
    effects: [],
    decided_at: now,
  });
  await getGranotCrmSourceModel().collection.insertOne({
    _id: sourceId,
    source: "Referral",
    granot_label: "Referral",
    crm_origin: `unit28-${sourceId}`,
    workspace_slug: `unit28-${sourceId}`,
    normalized_granot_label: `unit28-referral-${sourceId.toHexString().slice(-6)}`,
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "referral_booking",
    lead_created_policy: "observation_only",
    lead_source_company: null,
    lifecycle_routes: [],
    lifecycle_policy_version: "unit28-referral-v1",
  });
  await Agent.collection.insertOne({
    _id: agentId,
    name: "U28 Synthetic Agent",
    normalized_name: `u28-agent-${agentId}`,
    active: true,
    role: "agent",
    created_from: "unit28-test",
  });
  await Merchant.collection.insertOne({
    _id: merchantId,
    name: "U28 Synthetic Merchant",
    normalized_name: `u28-merchant-${merchantId}`,
    active: true,
    created_from: "unit28-test",
  });
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: caseId,
    normalized_job_no: job,
    job_no_snapshot: jobRaw,
    action_kind: "booked",
    sequence_number: 1,
    mode: "create_referral_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    evidence: [{ observation_id: observationId, decision_id: decisionId, captured_at: now, action: "booked" }],
    observed_context: { estimate: "9999.99", payment: "111.11", balance: "8888.88" },
    opened_at: now,
    last_evidence_at: now,
  });
  return { receiptId, observationId, decisionId, caseId, sourceId, agentId, merchantId, job, jobRaw };
}

function command(fixture: Awaited<ReturnType<typeof seed>>, suffix = "create") {
  return {
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    official_booking_details: {
      book_date: "2026-08-20",
      agent_allocations: [{ agent_id: String(fixture.agentId), binder_amount: 125.25 }],
      total_binder_amount: 125.25,
      deposit_amount: 2500.5,
      merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `unit28-${suffix}-${fixture.caseId}`,
    owner: {
      actor_type: "owner" as const,
      actor_id: "unit28-owner",
      actor_label: "unit28-owner@example.invalid",
      actor_role: "owner" as const,
      request_id: `unit28-${suffix}-${fixture.caseId}`,
      origin: "vantage_admin" as const,
    },
  };
}

const flags = {
  ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
  booking_commands_enabled: true,
  referral_booking_enabled: true,
};

test("[AC-28][AC-32] replica Referral creation is exact, lead-free, atomic, and replay-safe", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  const first = await createReferralBooking(command(fixture), { flags });
  assert.equal(first.outcome, "referral_booking_created");
  assert.equal(first.replayed, false);
  assert.equal(first.decision_id, String(fixture.decisionId));
  assert.equal(first.booking_ref?.domain_revision, 1);
  assert.equal(first.record_link_ref?.domain_revision, 1);
  const booking = await BookedLead.findById(first.booking_ref!.id).lean().exec();
  assert.equal(booking?.job_no, fixture.jobRaw);
  assert.equal(booking?.customer_name, "U28 Accepted Referral Customer");
  assert.equal(booking?.source, "referral");
  assert.equal(booking?.is_referral_booking, true);
  assert.equal(booking?.is_leadless_booking, false);
  assert.equal(booking?.lead_ref, undefined);
  assert.equal(booking?.lead_model, undefined);
  assert.equal(booking?.deposit_amount, 2500.5);
  assert.equal(booking?.total_binder_amount, 125.25);
  assert.notEqual(booking?.deposit_amount, 111.11);
  const link = await getGranotRecordLinkModel().findById(first.record_link_ref!.id).lean().exec();
  assert.equal(String(link?.booking_ref), first.booking_ref!.id);
  assert.equal(link?.lead_ref, undefined);
  assert.equal(link?.source_scope, undefined);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 2);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: first.booking_ref!.id, operation: "referral_booking.create" }), 1);
  const sheetJob = await SheetSyncJob.findOne({
    entity_id: first.booking_ref!.id,
    operation: "referral_booking.create",
  }).lean().exec();
  assert.ok(sheetJob);
  const sheetPlans = await planJobWrites(sheetJob!);
  assert.deepEqual(
    sheetPlans.flatMap((plan) => plan.writes.map((write) => write.target)),
    ["master_booked"],
  );
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 1);
  const detail = await getGranotLifecycleCaseDetail(String(fixture.caseId));
  const filtered = await listGranotLifecycleCases({
    kind: "booking",
    state: "resolved",
    source_id: String(fixture.sourceId),
    sort: "last_evidence_at",
    order: "desc",
    limit: 25,
  });
  assert.deepEqual(detail?.source, { id: String(fixture.sourceId), label: "Referral" });
  assert.equal(detail?.contacts.accepted_granot?.name, "U•••");
  assert.ok(filtered.items.some((row) => row.case_id === String(fixture.caseId) && row.source?.label === "Referral"));

  const replay = await createReferralBooking(command(fixture), { flags });
  assert.equal(replay.replayed, true);
  assert.equal(replay.command_execution_id, first.command_execution_id);
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 2);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: first.booking_ref!.id }), 1);

  await assert.rejects(
    createReferralBooking({
      ...command(fixture),
      official_booking_details: { ...command(fixture).official_booking_details, deposit_amount: 2500.51 },
    }, { flags }),
    (error: unknown) => (error as { code?: string }).code === "DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT",
  );
});

test("[AC-28] already-satisfied Referral evidence resolves without a second Booking", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  const first = await createReferralBooking(command(fixture), { flags });
  const original = await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  const secondCaseId = id();
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: secondCaseId,
    normalized_job_no: fixture.job,
    job_no_snapshot: fixture.jobRaw,
    action_kind: "booked",
    sequence_number: 2,
    mode: "create_referral_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    evidence: original!.evidence,
    observed_context: {},
    opened_at: new Date("2026-08-19T13:01:00.000Z"),
    last_evidence_at: new Date("2026-08-19T13:01:00.000Z"),
  });
  const result = await createReferralBooking({
    ...command(fixture, "satisfied"),
    case_id: String(secondCaseId),
  }, { flags });
  assert.equal(result.outcome, "already_satisfied");
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": secondCaseId }), 0);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: first.booking_ref!.id }), 1);
});

test("[AC-28] existing Referral Booking supports official update and case-only No Action without a Lead", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  const created = await createReferralBooking(command(fixture), { flags });
  const original = await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  const reviewCaseId = id();
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: reviewCaseId,
    normalized_job_no: fixture.job,
    job_no_snapshot: fixture.jobRaw,
    action_kind: "booked",
    sequence_number: 2,
    mode: "review_existing_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    record_link_id: new mongoose.Types.ObjectId(created.record_link_ref!.id),
    deterministic_booking_id: new mongoose.Types.ObjectId(created.booking_ref!.id),
    evidence: original!.evidence,
    observed_context: {},
    opened_at: new Date("2026-08-19T13:02:00.000Z"),
    last_evidence_at: new Date("2026-08-19T13:02:00.000Z"),
  });
  const candidates = await listGranotLifecycleCaseCandidates(String(reviewCaseId), {
    scope: "source",
    limit: 25,
  });
  assert.deepEqual(candidates, { items: [], next_cursor: null });
  const updated = await updateExistingBooking({
    case_id: String(reviewCaseId),
    expected_case_revision: 1,
    expected_booking_revision: 1,
    official_booking_details: {
      book_date: "2026-09-01",
      agent_allocations: [{ agent_id: String(fixture.agentId), binder_amount: 150 }],
      total_binder_amount: 150,
      deposit_amount: 3000,
      merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `unit28-update-${reviewCaseId}`,
    owner: command(fixture).owner,
  }, { flags });
  assert.equal(updated.outcome, "booking_updated");
  assert.equal(updated.booking_ref?.domain_revision, 2);
  const booking = await BookedLead.findById(created.booking_ref!.id).lean().exec();
  assert.equal(booking?.deposit_amount, 3000);
  assert.equal(booking?.lead_ref, undefined);
  assert.equal(booking?.lead_model, undefined);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": reviewCaseId }), 1);

  const noActionFixture = await seed();
  const noActionResult = await noAction({
    case_id: String(noActionFixture.caseId),
    expected_case_revision: 1,
    reason_code: "duplicate_granot_action",
    idempotency_key: `unit28-no-action-${noActionFixture.caseId}`,
    owner: command(noActionFixture).owner,
  }, { flags });
  assert.equal(noActionResult.outcome, "no_action");
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: noActionFixture.job }), 0);
  assert.equal(await getGranotRecordLinkModel().countDocuments({ normalized_job_no: noActionFixture.job }), 0);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": noActionFixture.caseId }), 0);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: String(noActionFixture.caseId) }), 0);
});

test("[AC-28][AC-32] competing Owners converge and policy drift fails closed", async (t) => {
  if (!(await replicaReady(t))) return;
  const race = await seed();
  const results = await Promise.allSettled([
    createReferralBooking(command(race, "race-a"), { flags }),
    createReferralBooking(command(race, "race-b"), { flags }),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(results.filter((row) => row.status === "rejected").length, 1);
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: race.job }), 1);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(race.caseId) }), 1);

  const mixed = await seed();
  const mixedResults = await Promise.allSettled([
    createReferralBooking(command(mixed, "mixed-create"), { flags }),
    noAction({
      case_id: String(mixed.caseId),
      expected_case_revision: 1,
      reason_code: "duplicate_granot_action",
      idempotency_key: `unit28-mixed-no-action-${mixed.caseId}`,
      owner: command(mixed).owner,
    }, { flags }),
  ]);
  assert.equal(mixedResults.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(mixedResults.filter((row) => row.status === "rejected").length, 1);
  assert.ok((await BookedLead.countDocuments({ normalized_job_no: mixed.job })) <= 1);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(mixed.caseId) }), 1);

  const drift = await seed();
  await getGranotCrmSourceModel().updateOne({ _id: drift.sourceId }, { $set: { enabled: false } });
  await assert.rejects(
    createReferralBooking(command(drift, "policy-drift"), { flags }),
    (error: unknown) => (error as { code?: string }).code === "GRANOT_POLICY_BLOCKED",
  );
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: drift.job }), 0);
  assert.equal(await getGranotRecordLinkModel().countDocuments({ normalized_job_no: drift.job }), 0);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(drift.caseId) }), 0);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(drift.caseId).lean().exec())?.state, "open");

  const conflict = await seed();
  const conflictingLinkId = id();
  await getGranotRecordLinkModel().collection.insertOne({
    _id: conflictingLinkId,
    provider: "granot",
    normalized_job_no: conflict.job,
    job_no_snapshot: conflict.jobRaw,
    state: "active",
    lead_ref: { model: "FormLead", id: id() },
    disputed: false,
    established_by_decision_id: conflict.decisionId,
    established_at: new Date(),
    last_observation_id: conflict.observationId,
    last_observed_at: new Date(),
    domain_revision: 0,
  });
  await assert.rejects(
    createReferralBooking(command(conflict, "link-conflict"), { flags }),
    (error: unknown) => (error as { code?: string }).code === "GRANOT_IDENTITY_CONFLICT",
  );
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: conflict.job }), 0);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(conflict.caseId) }), 0);
});

test("[AC-28][AC-32] Referral creation rolls back after every persisted boundary", async (t) => {
  if (!(await replicaReady(t))) return;
  for (const failure of ["booking", "link", "changes", "case", "outbox"] as const) {
    const fixture = await seed();
    await assert.rejects(
      createReferralBooking(command(fixture, `rollback-${failure}`), { flags, test_fail_after: failure }),
      new RegExp(`UNIT28_INJECTED_FAILURE_AFTER_${failure.toUpperCase()}`),
    );
    assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 0);
    assert.equal(await getGranotRecordLinkModel().countDocuments({ normalized_job_no: fixture.job }), 0);
    assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 0);
    assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 0);
    assert.equal((await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open");
  }
});
