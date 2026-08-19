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
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { Merchant } from "../../models/Merchant";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { confirmBooking } from "./bookingConfirmation";

const seeded = new Set<string>();
const jobPrefix = `U24-${Date.now().toString(36).toUpperCase()}`;
const normalizedJobPrefix = normalizeJobNo(jobPrefix)!;

async function replicaReady(t: { skip: (reason: string) => void }) {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
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
    const ids = [...seeded].map((id) => new mongoose.Types.ObjectId(id));
    const bookingIds = (await BookedLead.find({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } })
      .select({ _id: 1 }).lean().exec()).map((row) => String(row._id));
    await Promise.all([
      getGranotBookingReconciliationCaseModel().deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      BookedLead.deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      getGranotRecordLinkModel().collection.deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      getFormLeadModel().deleteMany({ _id: { $in: ids } }),
      Agent.deleteMany({ _id: { $in: ids } }),
      Merchant.deleteMany({ _id: { $in: ids } }),
      getGranotCrmSourceModel().deleteMany({ _id: { $in: ids } }),
      getLeadSourceCompanyModel().deleteMany({ _id: { $in: ids } }),
      getLeadSourceGranularityModel().deleteMany({ _id: { $in: ids } }),
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
  const leadId = id();
  const companyId = id();
  const granularityId = id();
  const sourceId = id();
  const agentId = id();
  const merchantId = id();
  const jobRaw = `${jobPrefix}-${caseId.toHexString().slice(-6).toUpperCase()}`;
  const job = normalizeJobNo(jobRaw)!;
  const now = new Date("2026-08-19T12:00:00.000Z");
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
    priority: { valid: false },
    booking_action: { normalized: "booked" },
  });
  await mongoose.connection.collection("synchronization_decisions").insertOne({
    _id: decisionId,
    receipt_id: receiptId,
    observation_id: observationId,
    attempt: 1,
    outcome: "linked",
    reason_code: "booking_case_opened",
    decided_at: now,
  });
  await getLeadSourceCompanyModel().collection.insertOne({
    _id: companyId,
    company_slug: `u24-${companyId.toHexString().slice(-8)}`,
    name: "U24 Synthetic Source",
    owner_label: "U24 Synthetic Source",
    active: true,
    granularities: [],
    created_from: "unit24-test",
  });
  await getLeadSourceGranularityModel().collection.insertOne({
    _id: granularityId,
    source_company: companyId,
    granularity_key: `u24-form-${granularityId.toHexString().slice(-6)}`,
    channel: "form",
    owner_label: "U24 Synthetic Form",
    crm_label: "U24 Synthetic Form",
    active: true,
    cpl: 17,
    created_from: "unit24-test",
  });
  await getGranotCrmSourceModel().collection.insertOne({
    _id: sourceId,
    source: "U24 Synthetic CRM",
    crm_origin: `unit24-${sourceId.toHexString()}`,
    workspace_slug: `unit24-${sourceId.toHexString()}`,
    normalized_granot_label: `u24-synthetic-${sourceId.toHexString().slice(-6)}`,
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lead_source_company: companyId,
    lifecycle_routes: [],
    lifecycle_policy_version: "unit24-test",
  });
  await getFormLeadModel().collection.insertOne({
    _id: leadId,
    name: "U24 Synthetic Customer",
    timestamp: now,
    local: "local",
    source_company: "u24-original-source",
    lead_source_company: companyId,
    source_granularity_id: granularityId,
    source_granularity_key: "u24-form",
    ingestion_origin: "wordpress_form",
    cpl: 17,
    duplicate: false,
    bad_lead: null,
    domain_revision: 0,
  });
  await Agent.collection.insertOne({
    _id: agentId,
    name: "U24 Synthetic Agent",
    normalized_name: `u24-agent-${agentId.toHexString()}`,
    active: true,
    role: "agent",
    created_from: "unit24-test",
  });
  await Merchant.collection.insertOne({
    _id: merchantId,
    name: "U24 Synthetic Merchant",
    normalized_name: `u24-merchant-${merchantId.toHexString()}`,
    active: true,
    created_from: "unit24-test",
  });
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: caseId,
    normalized_job_no: job,
    job_no_snapshot: jobRaw,
    action_kind: "booked",
    sequence_number: 1,
    mode: "create_missing_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    source_scope: {
      granot_crm_source_id: sourceId,
      lead_source_company: companyId,
      source_granularity_id: granularityId,
    },
    evidence: [{ observation_id: observationId, decision_id: decisionId, captured_at: now, action: "booked" }],
    observed_context: { estimate: "9999.99", payment: "111.11", balance: "8888.88" },
    opened_at: now,
    last_evidence_at: now,
  });
  return { caseId, leadId, agentId, merchantId, decisionId, job };
}

test("[AC-21][AC-22][AC-23][AC-32] replica confirm is atomic, replay-safe, exact, and source-preserving", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  const body = {
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    selected_lead: { lead_model: "FormLead" as const, lead_id: String(fixture.leadId) },
    official_booking_details: {
      book_date: "2026-08-20",
      agent_allocations: [{ agent_id: String(fixture.agentId), binder_amount: 125.25 }],
      total_binder_amount: 125.25,
      deposit_amount: 2500.5,
      merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `unit24-${fixture.caseId}`,
    owner: {
      actor_type: "owner" as const,
      actor_id: "unit24-owner",
      actor_label: "unit24-owner@example.invalid",
      actor_role: "owner" as const,
      request_id: `unit24-${fixture.caseId}`,
      origin: "vantage_admin" as const,
    },
  };
  const before = await getFormLeadModel().findById(fixture.leadId).lean().exec();
  const first = await confirmBooking(body, {
    flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true },
  });
  assert.equal(first.outcome, "booking_created");
  assert.equal(first.replayed, false);
  assert.equal(first.decision_id, String(fixture.decisionId));
  assert.equal(first.booking_ref.domain_revision, 1);
  assert.equal(first.record_link_ref.domain_revision, 1);
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 1);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 3);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: first.booking_ref.id }), 1);
  const afterLead = await getFormLeadModel().findById(fixture.leadId).lean().exec();
  assert.equal(String(afterLead?.booked), first.booking_ref.id);
  assert.equal(afterLead?.domain_revision, 1);
  assert.equal(afterLead?.source_company, before?.source_company);
  assert.equal(String(afterLead?.lead_source_company), String(before?.lead_source_company));
  assert.equal(String(afterLead?.source_granularity_id), String(before?.source_granularity_id));
  assert.equal(afterLead?.ingestion_origin, before?.ingestion_origin);
  assert.equal(afterLead?.cpl, before?.cpl);
  const booking = await BookedLead.findById(first.booking_ref.id).lean().exec();
  assert.equal(booking?.deposit_amount, 2500.5);
  assert.equal(booking?.total_binder_amount, 125.25);
  assert.equal(booking?.customer_name, "U24 Synthetic Customer");
  assert.notEqual(booking?.deposit_amount, 111.11);

  const replay = await confirmBooking(body, {
    flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true },
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.command_execution_id, first.command_execution_id);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 3);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: first.booking_ref.id }), 1);

  const originalCase = await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  const alreadyCaseId = id();
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: alreadyCaseId,
    normalized_job_no: fixture.job,
    job_no_snapshot: originalCase!.job_no_snapshot,
    action_kind: "booked",
    sequence_number: 2,
    mode: "create_missing_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    source_scope: originalCase!.source_scope,
    evidence: originalCase!.evidence,
    observed_context: {},
    opened_at: new Date("2026-08-19T12:01:00.000Z"),
    last_evidence_at: new Date("2026-08-19T12:01:00.000Z"),
  });
  const already = await confirmBooking({
    ...body,
    case_id: String(alreadyCaseId),
    idempotency_key: `unit24-already-${alreadyCaseId}`,
  }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } });
  assert.equal(already.outcome, "already_satisfied");
  assert.equal(already.replayed, false);
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": alreadyCaseId }), 0);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: first.booking_ref.id }), 1);

  await assert.rejects(
    confirmBooking({ ...body, official_booking_details: { ...body.official_booking_details, deposit_amount: 2500.51 } }, {
      flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true },
    }),
    (error: unknown) => (error as { code?: string }).code === "DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT",
  );
});

test("[AC-22][AC-23] inactive catalog failure leaves the whole effect set invisible", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  await Agent.updateOne({ _id: fixture.agentId }, { $set: { active: false } });
  await assert.rejects(
    confirmBooking({
      case_id: String(fixture.caseId), expected_case_revision: 1,
      selected_lead: { lead_model: "FormLead", lead_id: String(fixture.leadId) },
      official_booking_details: {
        book_date: "2026-08-20",
        agent_allocations: [{ agent_id: String(fixture.agentId), binder_amount: 10 }],
        total_binder_amount: 10, deposit_amount: 5, merchant_id: String(fixture.merchantId),
      },
      idempotency_key: `unit24-inactive-${fixture.caseId}`,
      owner: { actor_type: "owner", actor_id: "unit24-owner", actor_label: "unit24-owner@example.invalid", actor_role: "owner", request_id: `unit24-inactive-${fixture.caseId}`, origin: "vantage_admin" },
    }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } }),
    (error: unknown) => (error as { code?: string }).code === "GRANOT_VALIDATION_FAILED",
  );
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 0);
  assert.equal(await getGranotRecordLinkModel().countDocuments({ normalized_job_no: fixture.job }), 0);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 0);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 0);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open");
});

test("[AC-21] simultaneous confirms produce one winner and no duplicate effects", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  const command = (suffix: string) => confirmBooking({
    case_id: String(fixture.caseId), expected_case_revision: 1,
    selected_lead: { lead_model: "FormLead" as const, lead_id: String(fixture.leadId) },
    official_booking_details: {
      book_date: "2026-08-21",
      agent_allocations: [{ agent_id: String(fixture.agentId), binder_amount: 20 }],
      total_binder_amount: 20, deposit_amount: 10, merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `unit24-race-${suffix}-${fixture.caseId}`,
    owner: { actor_type: "owner" as const, actor_id: "unit24-owner", actor_label: "unit24-owner@example.invalid", actor_role: "owner" as const, request_id: `unit24-race-${suffix}`, origin: "vantage_admin" as const },
  }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } });
  const results = await Promise.allSettled([command("a"), command("b")]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(results.filter((row) => row.status === "rejected").length, 1);
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
  assert.equal(await getGranotRecordLinkModel().countDocuments({ normalized_job_no: fixture.job, state: "active" }), 1);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 1);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 3);
});
