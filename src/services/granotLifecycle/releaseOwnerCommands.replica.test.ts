import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { toObjectId } from "../../utils/objectId";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo, withTransaction } from "../../db";
import { preserveCaseEvidence } from "./caseEvidence";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getGranotReleaseReconciliationCaseModel } from "../../models/GranotReleaseReconciliationCase";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { Merchant } from "../../models/Merchant";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { confirmCancellation, noAction, updateExistingBooking } from "./releaseOwnerCommands";

const seeded = new Set<string>();
const jobPrefix = `U27-${Date.now().toString(36).toUpperCase()}`;
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
    const ids = [...seeded].map((value) => toObjectId(value));
    await Promise.all([
      getGranotReleaseReconciliationCaseModel().deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      BookedLead.deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      CancelledLead.deleteMany({ _id: { $in: ids } }),
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
      SheetSyncJob.deleteMany({ entity_id: { $in: [...seeded] } }),
    ]);
  }
  await mongoose.disconnect().catch(() => undefined);
});

function id() {
  const value = new mongoose.Types.ObjectId();
  seeded.add(String(value));
  return value;
}

async function seedReleaseCase() {
  const receiptId = id();
  const observationId = id();
  const decisionId = id();
  const caseId = id();
  const leadId = id();
  const bookingId = id();
  const linkId = id();
  const companyId = id();
  const granularityId = id();
  const sourceId = id();
  const agentId = id();
  const merchantId = id();
  const now = new Date("2026-08-19T15:00:00.000Z");
  const jobRaw = `${jobPrefix}-${caseId.toHexString().slice(-6).toUpperCase()}`;
  const job = normalizeJobNo(jobRaw)!;
  const companySlug = `u27-${companyId.toHexString().slice(-8)}`;
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
    source_label_raw: "U27 Synthetic CRM",
    normalized_source_label: `u27-synthetic-${sourceId.toHexString().slice(-6)}`,
    granot_crm_source_id: sourceId,
    identity: { normalized_job_no: job, job_no_raw: jobRaw },
    priority: { valid: false },
    booking_action: { normalized: "release" },
  });
  await mongoose.connection.collection("synchronization_decisions").insertOne({
    _id: decisionId,
    receipt_id: receiptId,
    observation_id: observationId,
    attempt: 1,
    outcome: "linked",
    reason_code: "release_case_opened",
    decided_at: now,
  });
  await getLeadSourceCompanyModel().collection.insertOne({
    _id: companyId,
    company_slug: companySlug,
    name: "U27 Synthetic Source",
    owner_label: "U27 Synthetic Source",
    active: true,
    granularities: [],
    created_from: "unit27-test",
  });
  await getLeadSourceGranularityModel().collection.insertOne({
    _id: granularityId,
    source_company: companyId,
    granularity_key: `u27-form-${granularityId.toHexString().slice(-6)}`,
    channel: "form",
    owner_label: "U27 Synthetic Form",
    crm_label: "U27 Synthetic Form",
    active: true,
    cpl: 17,
    created_from: "unit27-test",
  });
  await getGranotCrmSourceModel().collection.insertOne({
    _id: sourceId,
    source: "U27 Synthetic CRM",
    crm_origin: `unit27-${sourceId.toHexString()}`,
    workspace_slug: `unit27-${sourceId.toHexString()}`,
    normalized_granot_label: `u27-synthetic-${sourceId.toHexString().slice(-6)}`,
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lead_source_company: companyId,
    lifecycle_routes: [],
    lifecycle_policy_version: "unit27-test",
  });
  await getFormLeadModel().collection.insertOne({
    _id: leadId,
    name: "U27 Synthetic Customer",
    timestamp: now,
    local: "local",
    source_company: companySlug,
    lead_source_company: companyId,
    source_granularity_id: granularityId,
    source_granularity_key: "u27-form",
    ingestion_origin: "wordpress_form",
    cpl: 17,
    duplicate: false,
    bad_lead: null,
    booked: bookingId,
    domain_revision: 0,
  });
  await Agent.collection.insertOne({
    _id: agentId,
    name: "U27 Synthetic Agent",
    normalized_name: `u27-agent-${agentId.toHexString()}`,
    active: true,
    role: "agent",
    created_from: "unit27-test",
  });
  await Merchant.collection.insertOne({
    _id: merchantId,
    name: "U27 Synthetic Merchant",
    normalized_name: `u27-merchant-${merchantId.toHexString()}`,
    active: true,
    created_from: "unit27-test",
  });
  await BookedLead.collection.insertOne({
    _id: bookingId,
    timestamp: now,
    book_date: now,
    job_no: jobRaw,
    normalized_job_no: job,
    createdAt: now,
    lead_ref: leadId,
    lead_model: "FormLead",
    customer_name: "U27 Synthetic Customer",
    agent_allocations: [{ agent: agentId, agent_name_snapshot: "U27 Synthetic Agent", binder_amount: 100 }],
    total_binder_amount: 100,
    deposit_amount: 100,
    merchant: "U27 Synthetic Merchant",
    source: companySlug,
    is_referral_booking: false,
    is_leadless_booking: false,
    over_2000: false,
    over_4000: false,
    domain_revision: 0,
  });
  await getGranotRecordLinkModel().collection.insertOne({
    _id: linkId,
    provider: "granot",
    normalized_job_no: job,
    job_no_snapshot: jobRaw,
    state: "active",
    lead_ref: { model: "FormLead", id: leadId },
    booking_ref: bookingId,
    source_scope: { lead_source_company: companyId, source_granularity_id: granularityId },
    disputed: false,
    established_by_decision_id: decisionId,
    established_at: now,
    last_observation_id: observationId,
    last_observed_at: now,
    domain_revision: 0,
  });
  await getGranotReleaseReconciliationCaseModel().collection.insertOne({
    _id: caseId,
    normalized_job_no: job,
    job_no_snapshot: jobRaw,
    action_kind: "release",
    sequence_number: 1,
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    source_scope: {
      granot_crm_source_id: sourceId,
      lead_source_company: companyId,
      source_granularity_id: granularityId,
    },
    record_link_id: linkId,
    deterministic_booking_id: bookingId,
    booking_revision_at_open: 0,
    evidence: [{ observation_id: observationId, decision_id: decisionId, captured_at: now, action: "release" }],
    observed_context: {},
    opened_at: now,
    last_evidence_at: now,
  });
  return { caseId, bookingId, leadId, receiptId, observationId, decisionId, agentId, merchantId, job };
}

const owner = {
  actor_type: "owner" as const,
  actor_id: "unit27-owner",
  actor_label: "unit27-owner@example.invalid",
  actor_role: "owner" as const,
  request_id: "unit27-owner-request",
  origin: "vantage_admin" as const,
};

test("[AC-21][AC-25][AC-26][AC-32] Confirm Cancellation writes one complete causal chain", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedReleaseCase();
  await withTransaction(session => preserveCaseEvidence(fixture.observationId, fixture.decisionId, session));
  await getGranotObservationModel().collection.deleteOne({ _id: fixture.observationId });
  await getGranotObservationReceiptModel().collection.deleteOne({ _id: fixture.receiptId });
  await mongoose.connection.collection("synchronization_decisions").deleteOne({ _id: fixture.decisionId });
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, release_commands_enabled: true };
  const command = {
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    expected_booking_revision: 0,
    official_cancellation_details: {
      cancel_date: "2026-08-19",
      refund_amount: 75.25,
      reason: "Synthetic Owner-confirmed cancellation",
      notes: "Synthetic private note must not enter Change values.",
      cancelled_by: "Synthetic Owner",
    },
    idempotency_key: `unit27-cancel-${fixture.caseId}`,
    owner,
  };
  const result = await confirmCancellation(command, { flags });
  assert.equal(result.outcome, "cancellation_created");
  assert.equal(result.replayed, false);
  assert.equal(result.booking_ref.domain_revision, 1);
  assert.equal(result.cancellation_ref?.domain_revision, 1);
  const [booking, cancellation, lead, caseRow, changes, outbox] = await Promise.all([
    BookedLead.findById(fixture.bookingId).lean().exec(),
    CancelledLead.findById(result.cancellation_ref!.id).lean().exec(),
    getFormLeadModel().findById(fixture.leadId).lean().exec(),
    getGranotReleaseReconciliationCaseModel().findById(fixture.caseId).lean().exec(),
    getEntityChangeModel().find({ "provenance.case_id": fixture.caseId }).lean().exec(),
    SheetSyncJob.find({ entity_id: result.cancellation_ref!.id }).lean().exec(),
  ]);
  assert.equal(String(booking?.cancelled), result.cancellation_ref?.id);
  assert.equal(String(lead?.cancelled), result.cancellation_ref?.id);
  assert.equal(cancellation?.refund_amount, 75.25);
  assert.equal(String(cancellation?.booked_lead), String(fixture.bookingId));
  assert.equal(cancellation?.lead_ref_snapshot?.model, "FormLead");
  assert.equal(String(cancellation?.lead_ref_snapshot?.id), String(fixture.leadId));
  assert.equal(cancellation?.job_no_snapshot, booking?.job_no);
  assert.equal(cancellation?.normalized_job_no_snapshot, fixture.job);
  assert.deepEqual(cancellation?.booking_created_at_snapshot, booking?.createdAt);
  assert.equal(cancellation?.agent, "U27 Synthetic Agent");
  assert.equal(cancellation?.merchant, "U27 Synthetic Merchant");
  assert.equal(cancellation?.source, booking?.source);
  assert.equal(cancellation?.customer_name, "U27 Synthetic Customer");
  assert.equal(cancellation?.cancel_date.toISOString().slice(0, 10), "2026-08-19");
  assert.equal(caseRow?.resolution?.outcome, "cancellation_created");
  assert.equal(caseRow?.case_revision, 2);
  assert.equal(caseRow?.evidence_revision, 1);
  assert.equal(changes.length, 3);
  for (const change of changes) {
    assert.equal(String(change.provenance.receipt_id), String(fixture.receiptId));
    assert.equal(String(change.provenance.observation_id), String(fixture.observationId));
    assert.equal(String(change.provenance.decision_id), String(fixture.decisionId));
    assert.equal(String(change.provenance.case_id), String(fixture.caseId));
    assert.equal(String(change.command_execution_id), result.command_execution_id);
    assert.doesNotMatch(JSON.stringify(change.fields), /Synthetic private note/);
  }
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0]?.resource, "cancellation_chain");
  const replay = await confirmCancellation(command, { flags });
  assert.equal(replay.replayed, true);
  assert.equal(replay.command_execution_id, result.command_execution_id);
  assert.equal(replay.cancellation_ref?.id, result.cancellation_ref?.id);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 1);

  await assert.rejects(confirmCancellation({
    ...command,
    official_cancellation_details: { ...command.official_cancellation_details, refund_amount: 999 },
  }, { flags }), (error: unknown) =>
    (error as { code?: string }).code === "DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT");

  const nextCaseId = await createNextReleaseCase(fixture, 2);
  const satisfied = await confirmCancellation({
    ...command,
    case_id: String(nextCaseId),
    official_cancellation_details: { cancel_date: "2026-08-20", refund_amount: 999 },
    idempotency_key: `unit27-already-next-${nextCaseId}`,
  }, { flags });
  assert.equal(satisfied.outcome, "already_satisfied");
  assert.equal(satisfied.cancellation_ref?.id, result.cancellation_ref?.id);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": nextCaseId }), 0);
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 1);
  const persisted = await CancelledLead.findById(result.cancellation_ref!.id).lean().exec();
  assert.equal(persisted?.refund_amount, 75.25);
  assert.equal(persisted?.cancel_date.toISOString().slice(0, 10), "2026-08-19");
  assert.equal(persisted?.domain_revision, 1);
  assert.equal(await CancelledLead.countDocuments({ booked_lead: fixture.bookingId }), 1);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 3);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: result.cancellation_ref!.id }), 1);
});

async function createNextReleaseCase(
  fixture: Awaited<ReturnType<typeof seedReleaseCase>>,
  sequence: number,
) {
  const original = await getGranotReleaseReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  const caseId = id();
  await getGranotReleaseReconciliationCaseModel().collection.insertOne({
    _id: caseId,
    normalized_job_no: fixture.job,
    job_no_snapshot: original!.job_no_snapshot,
    action_kind: "release",
    sequence_number: sequence,
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    ...(original!.source_scope ? { source_scope: original!.source_scope } : {}),
    ...(original!.record_link_id ? { record_link_id: original!.record_link_id } : {}),
    deterministic_booking_id: fixture.bookingId,
    booking_revision_at_open: Number((await BookedLead.findById(fixture.bookingId).lean().exec())?.domain_revision ?? 0),
    evidence: original!.evidence,
    observed_context: {},
    opened_at: new Date(`2026-08-19T15:0${sequence}:00.000Z`),
    last_evidence_at: new Date(`2026-08-19T15:0${sequence}:00.000Z`),
  });
  return caseId;
}

test("[AC-25][AC-32] verified Referral Booking cancels without fabricating a Lead mirror", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedReleaseCase();
  const caseRow = await getGranotReleaseReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  await Promise.all([
    getGranotCrmSourceModel().collection.updateOne(
      { _id: caseRow!.source_scope!.granot_crm_source_id },
      { $set: { lifecycle_disposition: "referral_booking" }, $unset: { lead_source_company: "" } },
    ),
    BookedLead.collection.updateOne(
      { _id: fixture.bookingId },
      {
        $set: { is_referral_booking: true, is_leadless_booking: false },
        $unset: { lead_ref: "", lead_model: "" },
      },
    ),
    getGranotRecordLinkModel().collection.updateOne(
      { _id: caseRow!.record_link_id },
      { $unset: { lead_ref: "", source_scope: "" } },
    ),
    getGranotReleaseReconciliationCaseModel().collection.updateOne(
      { _id: fixture.caseId },
      { $unset: { source_scope: "" } },
    ),
  ]);
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, release_commands_enabled: true };
  const result = await confirmCancellation({
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    expected_booking_revision: 0,
    official_cancellation_details: { cancel_date: "2026-08-19", refund_amount: 0 },
    idempotency_key: `unit27-referral-${fixture.caseId}`,
    owner,
  }, { flags });
  assert.equal(result.outcome, "cancellation_created");
  assert.equal(result.entity_refs.some((ref) => ref.model === "FormLead" || ref.model === "CallLead"), false);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 2);
  const lead = await getFormLeadModel().findById(fixture.leadId).lean().exec();
  assert.equal(lead?.cancelled, undefined);
});

test("Confirm Granot Cancellation succeeds on a Granot official Leadless Booking without a Lead mirror", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedReleaseCase();
  await Promise.all([
    BookedLead.collection.updateOne(
      { _id: fixture.bookingId },
      {
        $set: { is_leadless_booking: true, is_referral_booking: false },
        $unset: { lead_ref: "", lead_model: "" },
      },
    ),
    getGranotRecordLinkModel().collection.updateOne(
      { _id: (await getGranotReleaseReconciliationCaseModel().findById(fixture.caseId).lean().exec())!.record_link_id },
      { $unset: { lead_ref: "" } },
    ),
  ]);
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, release_commands_enabled: true };
  const result = await confirmCancellation({
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    expected_booking_revision: 0,
    official_cancellation_details: { cancel_date: "2026-08-19", refund_amount: 0 },
    idempotency_key: `bila02-leadless-cancel-${fixture.caseId}`,
    owner,
  }, { flags });
  assert.equal(result.outcome, "cancellation_created");
  assert.equal(result.entity_refs.some((ref) => ref.model === "FormLead" || ref.model === "CallLead"), false);
  const lead = await getFormLeadModel().findById(fixture.leadId).lean().exec();
  assert.equal(lead?.cancelled, undefined);
});

test("[AC-21] all pairwise Release commands have exactly one case-revision winner", async (t) => {
  if (!(await replicaReady(t))) return;
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, release_commands_enabled: true };
  for (const pair of ["cancel-cancel", "cancel-update", "cancel-no-action", "update-no-action"] as const) {
    const fixture = await seedReleaseCase();
    const cancellation = (suffix: string) => confirmCancellation({
      case_id: String(fixture.caseId), expected_case_revision: 1, expected_booking_revision: 0,
      official_cancellation_details: { cancel_date: "2026-08-19", refund_amount: 10 },
      idempotency_key: `unit27-race-cancel-${pair}-${suffix}-${fixture.caseId}`, owner,
    }, { flags });
    const update = () => updateExistingBooking({
      case_id: String(fixture.caseId), expected_case_revision: 1, expected_booking_revision: 0,
      official_booking_details: {
        book_date: "2026-08-21",
        primary_agent_id: String(fixture.agentId),
        total_binder_amount: 11, deposit_amount: 11, merchant_id: String(fixture.merchantId),
      },
      idempotency_key: `unit27-race-update-${pair}-${fixture.caseId}`, owner,
    }, { flags });
    const resolve = () => noAction({
      case_id: String(fixture.caseId), expected_case_revision: 1,
      idempotency_key: `unit27-race-no-action-${pair}-${fixture.caseId}`, owner,
    }, { flags });
    const calls = pair === "cancel-cancel" ? [cancellation("a"), cancellation("b")] :
      pair === "cancel-update" ? [cancellation("a"), update()] :
        pair === "cancel-no-action" ? [cancellation("a"), resolve()] : [update(), resolve()];
    const results = await Promise.allSettled(calls);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, pair);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1, pair);
    assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 1, pair);
    assert.equal((await getGranotReleaseReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.case_revision, 2, pair);
    assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1, pair);
  }
});

test("[AC-32] Cancellation, update, and No Action roll back after every write boundary", async (t) => {
  if (!(await replicaReady(t))) return;
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, release_commands_enabled: true };
  for (const failure of ["booking", "cancellation", "lead", "changes", "case", "outbox"] as const) {
    const fixture = await seedReleaseCase();
    await assert.rejects(confirmCancellation({
      case_id: String(fixture.caseId), expected_case_revision: 1, expected_booking_revision: 0,
      official_cancellation_details: { cancel_date: "2026-08-19", refund_amount: 10 },
      idempotency_key: `unit27-rollback-cancel-${failure}-${fixture.caseId}`, owner,
    }, { flags, test_fail_after: failure }), new RegExp(`UNIT27_INJECTED_FAILURE_AFTER_${failure.toUpperCase()}`));
    assert.equal((await BookedLead.findById(fixture.bookingId).lean().exec())?.cancelled, undefined, failure);
    assert.equal((await getFormLeadModel().findById(fixture.leadId).lean().exec())?.cancelled, undefined, failure);
    assert.equal(await CancelledLead.countDocuments({ booked_lead: fixture.bookingId }), 0, failure);
    assert.equal((await getGranotReleaseReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open", failure);
    assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 0, failure);
    assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 0, failure);
  }
  for (const failure of ["booking", "lead", "changes", "case", "outbox"] as const) {
    const fixture = await seedReleaseCase();
    const before = await BookedLead.findById(fixture.bookingId).lean().exec();
    await assert.rejects(updateExistingBooking({
      case_id: String(fixture.caseId), expected_case_revision: 1, expected_booking_revision: 0,
      official_booking_details: {
        book_date: "2026-09-01",
        primary_agent_id: String(fixture.agentId),
        total_binder_amount: 12, deposit_amount: 2501, merchant_id: String(fixture.merchantId),
      },
      idempotency_key: `unit27-rollback-update-${failure}-${fixture.caseId}`, owner,
    }, { flags, test_fail_after: failure }), new RegExp(`UNIT27_INJECTED_FAILURE_AFTER_${failure.toUpperCase()}`));
    const afterBooking = await BookedLead.findById(fixture.bookingId).lean().exec();
    assert.equal(afterBooking?.book_date.toISOString(), before?.book_date.toISOString(), failure);
    assert.equal(afterBooking?.domain_revision, 0, failure);
    assert.equal((await getGranotReleaseReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open", failure);
    assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 0, failure);
    assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 0, failure);
  }
  const fixture = await seedReleaseCase();
  await assert.rejects(noAction({
    case_id: String(fixture.caseId), expected_case_revision: 1,
    idempotency_key: `unit27-rollback-no-action-${fixture.caseId}`, owner,
  }, { flags, test_fail_after_case: true }), /UNIT27_INJECTED_NO_ACTION_FAILURE_AFTER_CASE/);
  assert.equal((await getGranotReleaseReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open");
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 0);
});
