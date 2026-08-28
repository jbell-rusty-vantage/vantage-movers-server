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
import { noAction, updateExistingBooking } from "./bookingOwnerCommands";

const seeded = new Set<string>();
const jobPrefix = `U24-${Date.now().toString(36).toUpperCase()}`;
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
      primary_agent_id: String(fixture.agentId),
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
  assert.equal(first.booking_ref!.domain_revision, 1);
  assert.equal(first.record_link_ref!.domain_revision, 1);
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 1);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 3);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: first.booking_ref!.id }), 1);
  const afterLead = await getFormLeadModel().findById(fixture.leadId).lean().exec();
  assert.equal(String(afterLead?.booked), first.booking_ref!.id);
  assert.equal(afterLead?.domain_revision, 1);
  assert.equal(afterLead?.source_company, before?.source_company);
  assert.equal(String(afterLead?.lead_source_company), String(before?.lead_source_company));
  assert.equal(String(afterLead?.source_granularity_id), String(before?.source_granularity_id));
  assert.equal(afterLead?.ingestion_origin, before?.ingestion_origin);
  assert.equal(afterLead?.cpl, before?.cpl);
  const booking = await BookedLead.findById(first.booking_ref!.id).lean().exec();
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
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: first.booking_ref!.id }), 1);

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
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: first.booking_ref!.id }), 1);

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
        primary_agent_id: String(fixture.agentId),
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
      primary_agent_id: String(fixture.agentId),
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

async function createReviewCase(fixture: Awaited<ReturnType<typeof seed>>, bookingId: string, linkId: string, sequence = 2) {
  const original = await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  const caseId = id();
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: caseId,
    normalized_job_no: fixture.job,
    job_no_snapshot: original!.job_no_snapshot,
    action_kind: "booked",
    sequence_number: sequence,
    mode: "review_existing_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    source_scope: original!.source_scope,
    record_link_id: toObjectId(linkId),
    deterministic_booking_id: toObjectId(bookingId),
    evidence: original!.evidence,
    observed_context: {},
    opened_at: new Date(`2026-08-19T12:0${sequence}:00.000Z`),
    last_evidence_at: new Date(`2026-08-19T12:0${sequence}:00.000Z`),
  });
  return caseId;
}

function toObjectId(value: string) { return new mongoose.Types.ObjectId(value); }

test("[AC-20][AC-21][AC-24][AC-32] replica update fully replaces official fields with one causal chain", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true };
  const owner = { actor_type: "owner" as const, actor_id: "unit25-owner", actor_label: "unit25-owner@example.invalid", actor_role: "owner" as const, request_id: `unit25-${fixture.caseId}`, origin: "vantage_admin" as const };
  const created = await confirmBooking({
    case_id: String(fixture.caseId), expected_case_revision: 1,
    selected_lead: { lead_model: "FormLead", lead_id: String(fixture.leadId) },
    official_booking_details: {
      book_date: "2026-08-20",
      primary_agent_id: String(fixture.agentId),
      total_binder_amount: 10, deposit_amount: 100, merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `unit25-prereq-${fixture.caseId}`, owner,
  }, { flags });
  const reviewCaseId = await createReviewCase(fixture, created.booking_ref!.id, created.record_link_ref!.id);
  const before = await BookedLead.findById(created.booking_ref!.id).lean().exec();
  const leadBefore = await getFormLeadModel().findById(fixture.leadId).lean().exec();
  const command = {
    case_id: String(reviewCaseId), expected_case_revision: 1, expected_booking_revision: 1,
    official_booking_details: {
      book_date: "2026-09-01",
      primary_agent_id: String(fixture.agentId),
      total_binder_amount: 125.25, deposit_amount: 2500.5, merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `unit25-update-${reviewCaseId}`, owner,
  };
  const result = await updateExistingBooking(command, { flags });
  assert.equal(result.outcome, "booking_updated");
  assert.equal(result.booking_ref?.domain_revision, 2);
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
  const afterBooking = await BookedLead.findById(created.booking_ref!.id).lean().exec();
  const afterLead = await getFormLeadModel().findById(fixture.leadId).lean().exec();
  assert.equal(afterBooking?.book_date.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(afterBooking?.total_binder_amount, 125.25);
  assert.equal(afterBooking?.deposit_amount, 2500.5);
  assert.equal(afterBooking?.domain_revision, 2);
  assert.equal(afterLead?.domain_revision, 2);
  assert.equal(afterLead?.over_2000, true);
  assert.equal(String(afterBooking?.lead_ref), String(before?.lead_ref));
  assert.equal(afterBooking?.lead_model, before?.lead_model);
  assert.equal(afterBooking?.job_no, before?.job_no);
  assert.equal(afterBooking?.source, before?.source);
  assert.equal(afterBooking?.customer_name, before?.customer_name);
  assert.equal(String(afterLead?.lead_source_company), String(leadBefore?.lead_source_company));
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(reviewCaseId) }), 1);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": reviewCaseId }), 2);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: created.booking_ref!.id }), 1);
  assert.equal((await SheetSyncJob.findOne({ entity_id: created.booking_ref!.id }).lean().exec())?.operation, "booked_lead.update");

  const replay = await updateExistingBooking(command, { flags });
  assert.equal(replay.replayed, true);
  assert.equal(replay.command_execution_id, result.command_execution_id);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": reviewCaseId }), 2);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: created.booking_ref!.id }), 1);

  const satisfiedCaseId = await createReviewCase(fixture, created.booking_ref!.id, created.record_link_ref!.id, 3);
  const satisfied = await updateExistingBooking({
    ...command,
    case_id: String(satisfiedCaseId),
    expected_booking_revision: 2,
    idempotency_key: `unit25-satisfied-${satisfiedCaseId}`,
  }, { flags });
  assert.equal(satisfied.outcome, "already_satisfied");
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": satisfiedCaseId }), 0);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: created.booking_ref!.id }), 1);
});

test("[AC-20][AC-21][AC-32] replica No Action resolves only case and Command with exact replay", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true };
  const command = {
    case_id: String(fixture.caseId), expected_case_revision: 1,
    reason_code: "other" as const, reason_text: "Synthetic owner review only.",
    idempotency_key: `unit25-no-action-${fixture.caseId}`,
    owner: { actor_type: "owner" as const, actor_id: "unit25-owner", actor_label: "unit25-owner@example.invalid", actor_role: "owner" as const, request_id: `unit25-no-action-${fixture.caseId}`, origin: "vantage_admin" as const },
  };
  const before = {
    bookings: await BookedLead.countDocuments({ normalized_job_no: fixture.job }),
    leads: await getFormLeadModel().countDocuments({ _id: fixture.leadId }),
    links: await getGranotRecordLinkModel().countDocuments({ normalized_job_no: fixture.job }),
    changes: await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }),
    outbox: await SheetSyncJob.countDocuments({ entity_id: { $in: [String(fixture.caseId), String(fixture.leadId)] } }),
  };
  const result = await noAction(command, { flags });
  assert.equal(result.outcome, "no_action");
  assert.equal(result.booking_ref, undefined);
  const row = await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  assert.equal(row?.case_revision, 2);
  assert.equal(row?.evidence_revision, 1);
  assert.equal(row?.resolution?.reason_code, "other");
  assert.equal(row?.resolution?.reason_text, "Synthetic owner review only.");
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 1);
  assert.deepEqual({
    bookings: await BookedLead.countDocuments({ normalized_job_no: fixture.job }),
    leads: await getFormLeadModel().countDocuments({ _id: fixture.leadId }),
    links: await getGranotRecordLinkModel().countDocuments({ normalized_job_no: fixture.job }),
    changes: await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }),
    outbox: await SheetSyncJob.countDocuments({ entity_id: { $in: [String(fixture.caseId), String(fixture.leadId)] } }),
  }, before);
  const replay = await noAction(command, { flags });
  assert.equal(replay.replayed, true);
  assert.equal(replay.command_execution_id, result.command_execution_id);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.case_revision, 2);
});

test("[AC-24][AC-32] replica update rolls back atomically after every persisted write boundary", async (t) => {
  if (!(await replicaReady(t))) return;
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true };
  for (const failure of ["booking", "lead", "changes", "case", "outbox"] as const) {
    const fixture = await seed();
    const owner = { actor_type: "owner" as const, actor_id: "unit25-owner", actor_label: "unit25-owner@example.invalid", actor_role: "owner" as const, request_id: `unit25-rollback-${failure}-${fixture.caseId}`, origin: "vantage_admin" as const };
    const created = await confirmBooking({
      case_id: String(fixture.caseId), expected_case_revision: 1,
      selected_lead: { lead_model: "FormLead", lead_id: String(fixture.leadId) },
      official_booking_details: { book_date: "2026-08-20", primary_agent_id: String(fixture.agentId), total_binder_amount: 10, deposit_amount: 10, merchant_id: String(fixture.merchantId) },
      idempotency_key: `unit25-rollback-prereq-${failure}-${fixture.caseId}`, owner,
    }, { flags });
    const caseId = await createReviewCase(fixture, created.booking_ref!.id, created.record_link_ref!.id);
    const beforeBooking = await BookedLead.findById(created.booking_ref!.id).lean().exec();
    const beforeLead = await getFormLeadModel().findById(fixture.leadId).lean().exec();
    const beforeOutbox = await SheetSyncJob.findOne({ entity_id: created.booking_ref!.id }).lean().exec();
    await assert.rejects(updateExistingBooking({
      case_id: String(caseId), expected_case_revision: 1, expected_booking_revision: 1,
      official_booking_details: { book_date: "2026-09-02", primary_agent_id: String(fixture.agentId), total_binder_amount: 12, deposit_amount: 2501, merchant_id: String(fixture.merchantId) },
      idempotency_key: `unit25-rollback-${failure}-${caseId}`, owner,
    }, { flags, test_fail_after: failure }), new RegExp(`UNIT25_INJECTED_FAILURE_AFTER_${failure.toUpperCase()}`));
    const [afterBooking, afterLead, afterCase, afterOutbox] = await Promise.all([
      BookedLead.findById(created.booking_ref!.id).lean().exec(),
      getFormLeadModel().findById(fixture.leadId).lean().exec(),
      getGranotBookingReconciliationCaseModel().findById(caseId).lean().exec(),
      SheetSyncJob.findOne({ entity_id: created.booking_ref!.id }).lean().exec(),
    ]);
    assert.equal(afterBooking?.book_date.toISOString(), beforeBooking?.book_date.toISOString());
    assert.equal(afterBooking?.domain_revision, 1);
    assert.equal(afterLead?.domain_revision, beforeLead?.domain_revision);
    assert.equal(afterLead?.over_2000, beforeLead?.over_2000);
    assert.equal(afterCase?.state, "open");
    assert.equal(afterCase?.case_revision, 1);
    assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(caseId) }), 0);
    assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": caseId }), 0);
    assert.equal(afterOutbox?.operation, beforeOutbox?.operation);
  }
  const noActionFixture = await seed();
  await assert.rejects(noAction({
    case_id: String(noActionFixture.caseId), expected_case_revision: 1,
    idempotency_key: `unit25-no-action-rollback-${noActionFixture.caseId}`,
    owner: { actor_type: "owner", actor_id: "unit25-owner", actor_label: "unit25-owner@example.invalid", actor_role: "owner", request_id: `unit25-no-action-rollback-${noActionFixture.caseId}`, origin: "vantage_admin" },
  }, { flags, test_fail_after_case: true }), /UNIT25_INJECTED_NO_ACTION_FAILURE_AFTER_CASE/);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(noActionFixture.caseId).lean().exec())?.state, "open");
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(noActionFixture.caseId) }), 0);
});

test("[AC-21] replica update versus No Action has one case-revision winner", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true };
  const owner = { actor_type: "owner" as const, actor_id: "unit25-owner", actor_label: "unit25-owner@example.invalid", actor_role: "owner" as const, request_id: `unit25-race-${fixture.caseId}`, origin: "vantage_admin" as const };
  const created = await confirmBooking({
    case_id: String(fixture.caseId), expected_case_revision: 1,
    selected_lead: { lead_model: "FormLead", lead_id: String(fixture.leadId) },
    official_booking_details: { book_date: "2026-08-20", primary_agent_id: String(fixture.agentId), total_binder_amount: 10, deposit_amount: 10, merchant_id: String(fixture.merchantId) },
    idempotency_key: `unit25-race-prereq-${fixture.caseId}`, owner,
  }, { flags });
  const caseId = await createReviewCase(fixture, created.booking_ref!.id, created.record_link_ref!.id);
  const results = await Promise.allSettled([
    updateExistingBooking({
      case_id: String(caseId), expected_case_revision: 1, expected_booking_revision: 1,
      official_booking_details: { book_date: "2026-08-21", primary_agent_id: String(fixture.agentId), total_binder_amount: 11, deposit_amount: 11, merchant_id: String(fixture.merchantId) },
      idempotency_key: `unit25-race-update-${caseId}`, owner,
    }, { flags }),
    noAction({ case_id: String(caseId), expected_case_revision: 1, idempotency_key: `unit25-race-no-action-${caseId}`, owner }, { flags }),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(results.filter((row) => row.status === "rejected").length, 1);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(caseId) }), 1);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(caseId).lean().exec())?.case_revision, 2);
});

async function stampSuggestion(
  caseId: mongoose.Types.ObjectId,
  leadId: mongoose.Types.ObjectId,
  confidence: "high" | "medium",
  match_method: string,
) {
  await getGranotBookingReconciliationCaseModel().collection.updateOne(
    { _id: caseId },
    {
      $set: {
        suggested_lead: {
          lead_ref: { model: "FormLead", id: leadId },
          confidence,
          match_method,
          reason_codes: [match_method],
        },
      },
    },
  );
}

function confirmOwner(caseId: mongoose.Types.ObjectId, suffix: string) {
  return {
    actor_type: "owner" as const,
    actor_id: "unit-bila02-owner",
    actor_label: "unit-bila02-owner@example.invalid",
    actor_role: "owner" as const,
    request_id: `unit-bila02-${suffix}-${caseId}`,
    origin: "vantage_admin" as const,
  };
}

test("Confirm omit selected_lead with unique high suggestion attaches and queues booking_chain", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  await stampSuggestion(fixture.caseId, fixture.leadId, "high", "form_ref_no_exact");
  const result = await confirmBooking({
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    official_booking_details: {
      book_date: "2026-08-20",
      primary_agent_id: String(fixture.agentId),
      total_binder_amount: 10,
      deposit_amount: 20,
      merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `bila02-high-auto-${fixture.caseId}`,
    owner: confirmOwner(fixture.caseId, "high-auto"),
  }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } });
  assert.equal(result.outcome, "booking_created");
  assert.equal(result.is_leadless_booking, false);
  const booking = await BookedLead.findById(result.booking_ref!.id).lean().exec();
  assert.equal(booking?.is_leadless_booking, false);
  assert.equal(String(booking?.lead_ref), String(fixture.leadId));
  const job = await SheetSyncJob.findOne({ entity_id: result.booking_ref!.id }).lean().exec();
  assert.equal(job?.resource, "booking_chain");
  assert.equal(job?.operation, "booked_lead.create");
});

test("Confirm omit selected_lead with medium-only suggestion creates a Leadless Booking", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  await stampSuggestion(fixture.caseId, fixture.leadId, "medium", "source_scoped_contact");
  const result = await confirmBooking({
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    official_booking_details: {
      book_date: "2026-08-20",
      primary_agent_id: String(fixture.agentId),
      total_binder_amount: 10,
      deposit_amount: 20,
      merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `bila02-medium-leadless-${fixture.caseId}`,
    owner: confirmOwner(fixture.caseId, "medium-leadless"),
  }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } });
  assert.equal(result.outcome, "booking_created");
  assert.equal(result.is_leadless_booking, true);
  assert.match(result.owner_notice ?? "", /No stored lead was attached/);
  const booking = await BookedLead.findById(result.booking_ref!.id).lean().exec();
  assert.equal(booking?.is_leadless_booking, true);
  assert.equal(booking?.lead_ref, undefined);
  assert.equal(booking?.is_referral_booking, false);
  const lead = await getFormLeadModel().findById(fixture.leadId).lean().exec();
  assert.equal(lead?.booked, undefined);
  const job = await SheetSyncJob.findOne({ entity_id: result.booking_ref!.id }).lean().exec();
  assert.equal(job?.resource, "booked_lead");
  assert.equal(job?.operation, "granot_booking.create_leadless");
});

test("Confirm Owner-selected medium attaches that Lead", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  await stampSuggestion(fixture.caseId, fixture.leadId, "medium", "source_scoped_contact");
  const result = await confirmBooking({
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    selected_lead: { lead_model: "FormLead", lead_id: String(fixture.leadId) },
    official_booking_details: {
      book_date: "2026-08-20",
      primary_agent_id: String(fixture.agentId),
      total_binder_amount: 10,
      deposit_amount: 20,
      merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `bila02-owner-medium-${fixture.caseId}`,
    owner: confirmOwner(fixture.caseId, "owner-medium"),
  }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } });
  assert.equal(result.outcome, "booking_created");
  assert.equal(result.is_leadless_booking, false);
  const booking = await BookedLead.findById(result.booking_ref!.id).lean().exec();
  assert.equal(String(booking?.lead_ref), String(fixture.leadId));
});

test("Confirm lost claim fails closed and does not fall through to Leadless", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  await stampSuggestion(fixture.caseId, fixture.leadId, "high", "form_ref_no_exact");
  await getFormLeadModel().collection.updateOne(
    { _id: fixture.leadId },
    { $set: { booked: new mongoose.Types.ObjectId() } },
  );
  await assert.rejects(
    confirmBooking({
      case_id: String(fixture.caseId),
      expected_case_revision: 1,
      official_booking_details: {
        book_date: "2026-08-20",
        primary_agent_id: String(fixture.agentId),
        total_binder_amount: 10,
        deposit_amount: 20,
        merchant_id: String(fixture.merchantId),
      },
      idempotency_key: `bila02-lost-claim-${fixture.caseId}`,
      owner: confirmOwner(fixture.caseId, "lost-claim"),
    }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } }),
    (error: unknown) => (error as { code?: string }).code === "GRANOT_IDENTITY_CONFLICT",
  );
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 0);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open");
});

test("Update Existing Booking on a Granot Leadless Booking writes official fields and Master Booked only", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seed();
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true };
  const owner = confirmOwner(fixture.caseId, "leadless-update");
  const created = await confirmBooking({
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    official_booking_details: {
      book_date: "2026-08-20",
      primary_agent_id: String(fixture.agentId),
      total_binder_amount: 10,
      deposit_amount: 20,
      merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `bila02-leadless-prereq-${fixture.caseId}`,
    owner,
  }, { flags });
  assert.equal(created.is_leadless_booking, true);
  const reviewCaseId = await createReviewCase(fixture, created.booking_ref!.id, created.record_link_ref!.id);
  const result = await updateExistingBooking({
    case_id: String(reviewCaseId),
    expected_case_revision: 1,
    expected_booking_revision: created.booking_ref!.domain_revision,
    official_booking_details: {
      book_date: "2026-09-01",
      primary_agent_id: String(fixture.agentId),
      total_binder_amount: 30,
      deposit_amount: 40,
      merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `bila02-leadless-update-${reviewCaseId}`,
    owner,
  }, { flags });
  assert.equal(result.outcome, "booking_updated");
  const after = await BookedLead.findById(created.booking_ref!.id).lean().exec();
  assert.equal(after?.is_leadless_booking, true);
  assert.equal(after?.lead_ref, undefined);
  assert.equal(after?.book_date.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(after?.total_binder_amount, 30);
  const jobs = await SheetSyncJob.find({ entity_id: created.booking_ref!.id }).lean().exec();
  assert.equal(jobs.some((job) => job.resource === "booking_chain"), false);
  assert.ok(jobs.some((job) => job.resource === "booked_lead" && job.operation === "booked_lead.update"));
});
