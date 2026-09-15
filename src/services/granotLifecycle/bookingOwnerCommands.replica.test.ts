import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { toObjectId } from "../../utils/objectId";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
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
import { GRANOT_LIFECYCLE_ERROR_CODES, GranotLifecycleError } from "./errors";
import { confirmCancellation, noAction, updateExistingBooking } from "./bookingOwnerCommands";

const seeded = new Set<string>();
const jobPrefix = `R9-${Date.now().toString(36).toUpperCase()}`;
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
    const bookingIds = (await BookedLead.find({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } })
      .select({ _id: 1 }).lean().exec()).map((row) => row._id);
    await Promise.all([
      getGranotBookingReconciliationCaseModel().deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      BookedLead.deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      CancelledLead.deleteMany({ $or: [{ _id: { $in: ids } }, { booked_lead: { $in: bookingIds } }] }),
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
      SheetSyncJob.deleteMany({ entity_id: { $in: [...seeded, ...bookingIds.map(String)] } }),
    ]);
  }
  await mongoose.disconnect().catch(() => undefined);
});

function id() {
  const value = new mongoose.Types.ObjectId();
  seeded.add(String(value));
  return value;
}

async function seedBookingCase(options: {
  mode: "review_existing_booking" | "create_missing_booking";
  latestAction: "release" | "booked";
  includeBooking?: boolean;
}) {
  const includeBooking = options.includeBooking ?? options.mode === "review_existing_booking";
  const receiptId = id();
  const bookedObservationId = id();
  const releaseObservationId = id();
  const bookedDecisionId = id();
  const releaseDecisionId = id();
  const caseId = id();
  const leadId = id();
  const bookingId = id();
  const linkId = id();
  const companyId = id();
  const granularityId = id();
  const sourceId = id();
  const agentId = id();
  const merchantId = id();
  const bookedAt = new Date("2026-08-19T14:00:00.000Z");
  const releaseAt = new Date("2026-08-19T15:00:00.000Z");
  const latestAt = options.latestAction === "release" ? releaseAt : bookedAt;
  const jobRaw = `${jobPrefix}-${caseId.toHexString().slice(-6).toUpperCase()}`;
  const job = normalizeJobNo(jobRaw)!;
  const companySlug = `r9-${companyId.toHexString().slice(-8)}`;
  await getGranotObservationReceiptModel().collection.insertOne({
    _id: receiptId,
    observation_channel: "granot_webhook",
    captured_at: bookedAt,
    processing: { state: "completed", match_attempt: 1 },
  });
  await getGranotObservationModel().collection.insertOne({
    _id: bookedObservationId,
    receipt_id: receiptId,
    captured_at: bookedAt,
    source_label_raw: "R9 Synthetic CRM",
    normalized_source_label: `r9-synthetic-${sourceId.toHexString().slice(-6)}`,
    granot_crm_source_id: sourceId,
    identity: { normalized_job_no: job, job_no_raw: jobRaw },
    priority: { valid: false },
    booking_action: { normalized: "booked" },
  });
  await mongoose.connection.collection("synchronization_decisions").insertOne({
    _id: bookedDecisionId,
    receipt_id: receiptId,
    observation_id: bookedObservationId,
    attempt: 1,
    outcome: "linked",
    reason_code: "booking_case_opened",
    decided_at: bookedAt,
  });
  if (options.latestAction === "release") {
    const releaseReceiptId = id();
    await getGranotObservationReceiptModel().collection.insertOne({
      _id: releaseReceiptId,
      observation_channel: "granot_webhook",
      captured_at: releaseAt,
      processing: { state: "completed", match_attempt: 1 },
    });
    await getGranotObservationModel().collection.insertOne({
      _id: releaseObservationId,
      receipt_id: releaseReceiptId,
      captured_at: releaseAt,
      source_label_raw: "R9 Synthetic CRM",
      normalized_source_label: `r9-synthetic-${sourceId.toHexString().slice(-6)}`,
      granot_crm_source_id: sourceId,
      identity: { normalized_job_no: job, job_no_raw: jobRaw },
      priority: { valid: false },
      booking_action: { normalized: "release" },
    });
    await mongoose.connection.collection("synchronization_decisions").insertOne({
      _id: releaseDecisionId,
      receipt_id: releaseReceiptId,
      observation_id: releaseObservationId,
      attempt: 1,
      outcome: "linked",
      reason_code: "booking_case_refreshed",
      decided_at: releaseAt,
    });
  }
  await getLeadSourceCompanyModel().collection.insertOne({
    _id: companyId,
    company_slug: companySlug,
    name: "R9 Synthetic Source",
    owner_label: "R9 Synthetic Source",
    active: true,
    granularities: [],
    created_from: "unit-r9-test",
  });
  await getLeadSourceGranularityModel().collection.insertOne({
    _id: granularityId,
    source_company: companyId,
    granularity_key: `r9-form-${granularityId.toHexString().slice(-6)}`,
    channel: "form",
    owner_label: "R9 Synthetic Form",
    crm_label: "R9 Synthetic Form",
    active: true,
    cpl: 17,
    created_from: "unit-r9-test",
  });
  await getGranotCrmSourceModel().collection.insertOne({
    _id: sourceId,
    source: "R9 Synthetic CRM",
    crm_origin: `unit-r9-${sourceId.toHexString()}`,
    workspace_slug: `unit-r9-${sourceId.toHexString()}`,
    normalized_granot_label: `r9-synthetic-${sourceId.toHexString().slice(-6)}`,
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lead_source_company: companyId,
    lifecycle_routes: [],
    lifecycle_policy_version: "unit-r9-test",
  });
  if (includeBooking) {
    await getFormLeadModel().collection.insertOne({
      _id: leadId,
      name: "R9 Synthetic Customer",
      timestamp: bookedAt,
      local: "local",
      source_company: companySlug,
      lead_source_company: companyId,
      source_granularity_id: granularityId,
      source_granularity_key: "r9-form",
      ingestion_origin: "wordpress_form",
      cpl: 17,
      duplicate: false,
      bad_lead: null,
      booked: bookingId,
      domain_revision: 0,
    });
    await BookedLead.collection.insertOne({
      _id: bookingId,
      timestamp: bookedAt,
      book_date: bookedAt,
      job_no: jobRaw,
      normalized_job_no: job,
      lead_ref: leadId,
      lead_model: "FormLead",
      customer_name: "R9 Synthetic Customer",
      agent_allocations: [{ agent: agentId, agent_name_snapshot: "R9 Synthetic Agent", binder_amount: 100 }],
      total_binder_amount: 100,
      deposit_amount: 100,
      merchant: "R9 Synthetic Merchant",
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
      established_by_decision_id: bookedDecisionId,
      established_at: bookedAt,
      last_observation_id: options.latestAction === "release" ? releaseObservationId : bookedObservationId,
      last_observed_at: latestAt,
      domain_revision: 0,
    });
  }
  await Agent.collection.insertOne({
    _id: agentId,
    name: "R9 Synthetic Agent",
    normalized_name: `r9-agent-${agentId.toHexString()}`,
    active: true,
    role: "agent",
    created_from: "unit-r9-test",
  });
  await Merchant.collection.insertOne({
    _id: merchantId,
    name: "R9 Synthetic Merchant",
    normalized_name: `r9-merchant-${merchantId.toHexString()}`,
    active: true,
    created_from: "unit-r9-test",
  });
  const evidence = options.latestAction === "release"
    ? [
      { observation_id: bookedObservationId, decision_id: bookedDecisionId, captured_at: bookedAt, action: "booked" },
      { observation_id: releaseObservationId, decision_id: releaseDecisionId, captured_at: releaseAt, action: "release" },
    ]
    : [
      { observation_id: bookedObservationId, decision_id: bookedDecisionId, captured_at: bookedAt, action: "booked" },
    ];
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: caseId,
    normalized_job_no: job,
    job_no_snapshot: jobRaw,
    action_kind: "booked",
    sequence_number: 1,
    mode: options.mode,
    state: "open",
    case_revision: 1,
    evidence_revision: evidence.length,
    source_scope: {
      granot_crm_source_id: sourceId,
      lead_source_company: companyId,
      source_granularity_id: granularityId,
    },
    ...(includeBooking
      ? { record_link_id: linkId, deterministic_booking_id: bookingId, booking_revision_at_open: 0 }
      : {}),
    evidence,
    observed_context: {},
    opened_at: bookedAt,
    last_evidence_at: latestAt,
  });
  return {
    caseId,
    bookingId,
    leadId,
    receiptId,
    bookedObservationId,
    releaseObservationId,
    bookedDecisionId,
    releaseDecisionId,
    agentId,
    merchantId,
    job,
  };
}

const owner = {
  actor_type: "owner" as const,
  actor_id: "unit-r9-owner",
  actor_label: "unit-r9-owner@example.invalid",
  actor_role: "owner" as const,
  request_id: "unit-r9-owner-request",
  origin: "vantage_admin" as const,
};

function cancelCommand(caseId: mongoose.Types.ObjectId, suffix: string) {
  return {
    case_id: String(caseId),
    expected_case_revision: 1,
    expected_booking_revision: 0,
    official_cancellation_details: {
      cancel_date: "2026-08-19",
      refund_amount: 75.25,
      reason: "Synthetic Owner-confirmed cancellation",
      notes: "Synthetic private note must not enter Change values.",
      cancelled_by: "Synthetic Owner",
    },
    idempotency_key: `unit-r9-cancel-${suffix}-${caseId}`,
    owner,
  };
}

const rrfFlags = {
  ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
  booking_commands_enabled: true,
  referral_booking_enabled: true,
};

const rrfPolicyVersion = "unit-rrf-referral-v1";

async function ensureLifecycleActivation() {
  let activation = await getGranotLifecycleActivationModel().collection.findOne({ key: "granot_lifecycle" });
  if (!activation) {
    await getGranotLifecycleActivationModel().collection.insertOne({
      key: "granot_lifecycle",
      activated_at: new Date("2026-01-01T00:00:00.000Z"),
      activated_by: {
        actor_type: "system",
        actor_id: "unit-rrf-replica",
        actor_label: "RRF replica",
        actor_role: "system",
        request_id: "unit-rrf-replica-activation",
        origin: "reporting_projection",
      },
      reason: "RRF-01 disposable replica activation fixture.",
      processor_version: "unit-rrf-test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    activation = await getGranotLifecycleActivationModel().collection.findOne({ key: "granot_lifecycle" });
  }
  return activation!;
}

async function insertEvidenceRow(input: {
  action: "release" | "booked";
  capturedAt: Date;
  job: string;
  jobRaw: string;
  sourceId: mongoose.Types.ObjectId;
  includeSourcePolicy: boolean;
  identityJob?: string;
}) {
  const receiptId = id();
  const observationId = id();
  const decisionId = id();
  await getGranotObservationReceiptModel().collection.insertOne({
    _id: receiptId,
    observation_channel: "granot_webhook",
    captured_at: input.capturedAt,
    processing: { state: "completed", match_attempt: 1 },
  });
  await getGranotObservationModel().collection.insertOne({
    _id: observationId,
    receipt_id: receiptId,
    captured_at: input.capturedAt,
    source_label_raw: "Referral",
    normalized_source_label: `rrf-referral-${input.sourceId.toHexString().slice(-6)}`,
    granot_crm_source_id: input.sourceId,
    identity: { normalized_job_no: input.identityJob ?? input.job, job_no_raw: input.jobRaw },
    contact: { display_name: "RRF Referral Customer" },
    priority: { valid: false },
    booking_action: { normalized: input.action },
  });
  await mongoose.connection.collection("synchronization_decisions").insertOne({
    _id: decisionId,
    receipt_id: receiptId,
    observation_id: observationId,
    attempt: 1,
    execution_mode: "live",
    outcome: "linked",
    reason_code: input.includeSourcePolicy ? "booking_case_opened" : "booking_case_refreshed",
    decided_at: input.capturedAt,
    ...(input.includeSourcePolicy
      ? {
        source_policy: {
          granot_crm_source_id: input.sourceId,
          disposition: "referral_booking",
          policy_version: rrfPolicyVersion,
        },
      }
      : {}),
  });
  return { receiptId, observationId, decisionId, captured_at: input.capturedAt, action: input.action };
}

async function seedReferralReviewCase(options: {
  latestAction: "booked" | "release";
  sourceEnabled?: boolean;
  jobMismatch?: boolean;
  preActivation?: boolean;
}) {
  const caseId = id();
  const bookingId = id();
  const linkId = id();
  const sourceId = id();
  const agentId = id();
  const merchantId = id();
  const activation = await ensureLifecycleActivation();
  const activatedAt = new Date(activation.activated_at as Date).getTime();
  const firstCaptured = options.preActivation
    ? new Date(activatedAt - 60_000)
    : new Date(Math.max(new Date("2026-08-19T14:00:00.000Z").getTime(), activatedAt + 60_000));
  const bookedCaptured = new Date(firstCaptured.getTime() + 60_000);
  const laterReleaseCaptured = new Date(bookedCaptured.getTime() + 60_000);
  const jobRaw = `${jobPrefix}-${caseId.toHexString().slice(-6).toUpperCase()}`;
  const job = normalizeJobNo(jobRaw)!;
  const first = await insertEvidenceRow({
    action: "release",
    capturedAt: firstCaptured,
    job,
    jobRaw,
    sourceId,
    includeSourcePolicy: true,
    identityJob: options.jobMismatch ? `${job}X` : job,
  });
  const booked = await insertEvidenceRow({
    action: "booked",
    capturedAt: bookedCaptured,
    job,
    jobRaw,
    sourceId,
    includeSourcePolicy: false,
  });
  const laterRelease = options.latestAction === "release"
    ? await insertEvidenceRow({
      action: "release",
      capturedAt: laterReleaseCaptured,
      job,
      jobRaw,
      sourceId,
      includeSourcePolicy: false,
    })
    : null;
  const evidence = laterRelease
    ? [
      { observation_id: first.observationId, decision_id: first.decisionId, captured_at: first.captured_at, action: "release" },
      { observation_id: booked.observationId, decision_id: booked.decisionId, captured_at: booked.captured_at, action: "booked" },
      { observation_id: laterRelease.observationId, decision_id: laterRelease.decisionId, captured_at: laterRelease.captured_at, action: "release" },
    ]
    : [
      { observation_id: first.observationId, decision_id: first.decisionId, captured_at: first.captured_at, action: "release" },
      { observation_id: booked.observationId, decision_id: booked.decisionId, captured_at: booked.captured_at, action: "booked" },
    ];
  const lastEvidenceAt = evidence[evidence.length - 1]!.captured_at;
  await getGranotCrmSourceModel().collection.insertOne({
    _id: sourceId,
    source: "Referral",
    granot_label: "Referral",
    crm_origin: `unit-rrf-${sourceId}`,
    workspace_slug: `unit-rrf-${sourceId}`,
    normalized_granot_label: `unit-rrf-referral-${sourceId.toHexString().slice(-6)}`,
    enabled: options.sourceEnabled ?? true,
    lifecycle_enabled: true,
    lifecycle_disposition: "referral_booking",
    lead_created_policy: "observation_only",
    lead_source_company: null,
    lifecycle_routes: [],
    lifecycle_policy_version: rrfPolicyVersion,
  });
  await Agent.collection.insertOne({
    _id: agentId,
    name: "RRF Synthetic Agent",
    normalized_name: `rrf-agent-${agentId}`,
    active: true,
    role: "agent",
    created_from: "unit-rrf-test",
  });
  await Merchant.collection.insertOne({
    _id: merchantId,
    name: "RRF Synthetic Merchant",
    normalized_name: `rrf-merchant-${merchantId}`,
    active: true,
    created_from: "unit-rrf-test",
  });
  await BookedLead.collection.insertOne({
    _id: bookingId,
    timestamp: firstCaptured,
    book_date: firstCaptured,
    job_no: jobRaw,
    normalized_job_no: job,
    customer_name: "RRF Referral Customer",
    agent_allocations: [{ agent: agentId, agent_name_snapshot: "RRF Synthetic Agent", binder_amount: 100 }],
    total_binder_amount: 100,
    deposit_amount: 100,
    merchant: "RRF Synthetic Merchant",
    source: "referral",
    is_referral_booking: true,
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
    booking_ref: bookingId,
    disputed: false,
    established_by_decision_id: first.decisionId,
    established_at: firstCaptured,
    last_observation_id: evidence[evidence.length - 1]!.observation_id,
    last_observed_at: lastEvidenceAt,
    domain_revision: 0,
  });
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: caseId,
    normalized_job_no: job,
    job_no_snapshot: jobRaw,
    action_kind: "booked",
    sequence_number: 1,
    mode: "review_existing_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: evidence.length,
    record_link_id: linkId,
    deterministic_booking_id: bookingId,
    booking_revision_at_open: 0,
    evidence,
    observed_context: {},
    opened_at: firstCaptured,
    last_evidence_at: lastEvidenceAt,
  });
  return {
    caseId,
    bookingId,
    sourceId,
    agentId,
    merchantId,
    job,
    evidenceRevision: evidence.length,
  };
}

function rrfNoActionCommand(caseId: mongoose.Types.ObjectId, suffix: string) {
  return {
    case_id: String(caseId),
    expected_case_revision: 1,
    reason_code: "booking_still_valid" as const,
    idempotency_key: `unit-rrf-no-action-${suffix}-${caseId}`,
    owner,
  };
}

function rrfUpdateCommand(
  fixture: { caseId: mongoose.Types.ObjectId; agentId: mongoose.Types.ObjectId; merchantId: mongoose.Types.ObjectId },
  suffix: string,
) {
  return {
    case_id: String(fixture.caseId),
    expected_case_revision: 1,
    expected_booking_revision: 0,
    official_booking_details: {
      book_date: "2026-09-01",
      primary_agent_id: String(fixture.agentId),
      total_binder_amount: 150,
      deposit_amount: 3000,
      merchant_id: String(fixture.merchantId),
    },
    idempotency_key: `unit-rrf-update-${suffix}-${fixture.caseId}`,
    owner,
  };
}

test("[AC-R9] Confirm Cancellation succeeds only for AC-R3 posture and replays", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedBookingCase({ mode: "review_existing_booking", latestAction: "release" });
  const flags = {
    ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
    booking_commands_enabled: true,
    release_commands_enabled: false,
    release_cases_enabled: false,
  };
  const command = cancelCommand(fixture.caseId, "ok");
  const result = await confirmCancellation(command, { flags });
  assert.equal(result.outcome, "cancellation_created");
  assert.equal(result.replayed, false);
  assert.equal(result.booking_ref?.domain_revision, 1);
  assert.equal(result.cancellation_ref?.domain_revision, 1);
  const [booking, cancellation, lead, caseRow] = await Promise.all([
    BookedLead.findById(fixture.bookingId).lean().exec(),
    CancelledLead.findById(result.cancellation_ref!.id).lean().exec(),
    getFormLeadModel().findById(fixture.leadId).lean().exec(),
    getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec(),
  ]);
  assert.equal(String(booking?.cancelled), result.cancellation_ref?.id);
  assert.equal(String(lead?.cancelled), result.cancellation_ref?.id);
  assert.equal(cancellation?.refund_amount, 75.25);
  assert.equal(cancellation?.cancel_date.toISOString().slice(0, 10), "2026-08-19");
  assert.equal(caseRow?.state, "resolved");
  assert.equal(caseRow?.resolution?.outcome, "cancellation_created");
  assert.equal(caseRow?.case_revision, 2);
  assert.equal(caseRow?.evidence_revision, 2);
  const replay = await confirmCancellation(command, { flags });
  assert.equal(replay.replayed, true);
  assert.equal(replay.outcome, "cancellation_created");
  assert.equal(replay.command_execution_id, result.command_execution_id);
  assert.equal(await CancelledLead.countDocuments({ booked_lead: fixture.bookingId }), 1);
});

test("[AC-R9] create-missing + latest Release writes no Cancellation", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedBookingCase({
    mode: "create_missing_booking",
    latestAction: "release",
    includeBooking: false,
  });
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true };
  await assert.rejects(
    confirmCancellation(cancelCommand(fixture.caseId, "missing"), { flags }),
    (error: unknown) =>
      error instanceof GranotLifecycleError &&
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.CASE_REVISION_CONFLICT &&
      error.statusCode === 409,
  );
  assert.equal(await CancelledLead.countDocuments({ booked_lead: fixture.bookingId }), 0);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open");
  assert.equal(await DomainCommandExecution.countDocuments({ "provenance.case_id": String(fixture.caseId) }), 0);
});

test("[AC-R9] latest Booked on review mode is GRANOT_CASE_REVISION_CONFLICT and writes no Cancellation", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedBookingCase({ mode: "review_existing_booking", latestAction: "booked" });
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true };
  await assert.rejects(
    confirmCancellation(cancelCommand(fixture.caseId, "booked"), { flags }),
    (error: unknown) =>
      error instanceof GranotLifecycleError &&
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.CASE_REVISION_CONFLICT &&
      error.statusCode === 409,
  );
  assert.equal(await CancelledLead.countDocuments({ booked_lead: fixture.bookingId }), 0);
  assert.equal((await BookedLead.findById(fixture.bookingId).lean().exec())?.cancelled, undefined);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open");
});

test("[AC-R9] booking commands disabled is POLICY_BLOCKED even when release command flags are true", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedBookingCase({ mode: "review_existing_booking", latestAction: "release" });
  const flags = {
    ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
    booking_commands_enabled: false,
    release_commands_enabled: true,
    release_cases_enabled: true,
  };
  await assert.rejects(
    confirmCancellation(cancelCommand(fixture.caseId, "disabled"), { flags }),
    (error: unknown) =>
      error instanceof GranotLifecycleError &&
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.POLICY_BLOCKED &&
      error.statusCode === 422,
  );
  assert.equal(await CancelledLead.countDocuments({ booked_lead: fixture.bookingId }), 0);
  assert.equal((await BookedLead.findById(fixture.bookingId).lean().exec())?.cancelled, undefined);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open");
});

test("[AC-RRF-01][AC-RRF-06] Release-first Referral review No Action closes the case only", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedReferralReviewCase({ latestAction: "booked" });
  const before = await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  assert.equal(before?.case_revision, 1);
  assert.ok((before?.evidence_revision ?? 0) > 1);
  assert.equal(fixture.evidenceRevision, before?.evidence_revision);
  const result = await noAction(rrfNoActionCommand(fixture.caseId, "ok"), { flags: rrfFlags });
  assert.equal(result.outcome, "no_action");
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
  assert.equal(await getEntityChangeModel().countDocuments({ "provenance.case_id": fixture.caseId }), 0);
  assert.equal(await SheetSyncJob.countDocuments({
    entity_id: { $in: [String(fixture.caseId), String(fixture.bookingId)] },
  }), 0);
  const afterCase = await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  assert.equal(afterCase?.state, "resolved");
  assert.equal(afterCase?.resolution?.outcome, "no_action");
  assert.equal(afterCase?.case_revision, 2);
  assert.equal(afterCase?.evidence_revision, before?.evidence_revision);
});

test("[AC-RRF-02] Release-first Referral review Update keeps one Booking", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedReferralReviewCase({ latestAction: "booked" });
  const result = await updateExistingBooking(rrfUpdateCommand(fixture, "ok"), { flags: rrfFlags });
  assert.equal(result.outcome, "booking_updated");
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
  const booking = await BookedLead.findById(fixture.bookingId).lean().exec();
  assert.equal(booking?.deposit_amount, 3000);
  assert.equal(booking?.is_referral_booking, true);
  assert.equal(booking?.lead_ref, undefined);
  assert.equal(booking?.lead_model, undefined);
  assert.equal(await SheetSyncJob.countDocuments({ entity_id: String(fixture.bookingId) }), 1);
  assert.equal(
    (await SheetSyncJob.findOne({ entity_id: String(fixture.bookingId) }).lean().exec())?.operation,
    "referral_booking.update",
  );
});

test("[AC-RRF-03] Release-first review latest Booked Cancel is GRANOT_CASE_REVISION_CONFLICT", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedReferralReviewCase({ latestAction: "booked" });
  await assert.rejects(
    confirmCancellation(cancelCommand(fixture.caseId, "rrf-booked"), { flags: rrfFlags }),
    (error: unknown) =>
      error instanceof GranotLifecycleError &&
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.CASE_REVISION_CONFLICT &&
      error.statusCode === 409,
  );
  assert.equal(await CancelledLead.countDocuments({ booked_lead: fixture.bookingId }), 0);
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open");
});

test("[AC-RRF-03] Release-first review latest Release Cancel creates Cancellation without a Lead", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedReferralReviewCase({ latestAction: "release" });
  const result = await confirmCancellation(cancelCommand(fixture.caseId, "rrf-release"), { flags: rrfFlags });
  assert.equal(result.outcome, "cancellation_created");
  const [booking, cancellation] = await Promise.all([
    BookedLead.findById(fixture.bookingId).lean().exec(),
    CancelledLead.findById(result.cancellation_ref!.id).lean().exec(),
  ]);
  assert.equal(booking?.lead_ref, undefined);
  assert.equal(booking?.lead_model, undefined);
  assert.equal(cancellation?.lead_ref, undefined);
  assert.equal(cancellation?.lead_model, undefined);
  assert.equal(String(booking?.cancelled), result.cancellation_ref?.id);
});

test("[AC-RRF-05] Release-first Referral review dead Registry is GRANOT_POLICY_BLOCKED", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedReferralReviewCase({ latestAction: "booked", sourceEnabled: false });
  await assert.rejects(
    noAction(rrfNoActionCommand(fixture.caseId, "dead-policy"), { flags: rrfFlags }),
    (error: unknown) =>
      error instanceof GranotLifecycleError &&
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.POLICY_BLOCKED &&
      error.statusCode === 422,
  );
  assert.equal((await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec())?.state, "open");
  assert.equal(await BookedLead.countDocuments({ normalized_job_no: fixture.job }), 1);
});

test("[AC-RRF-01] Release-first Referral review job mismatch or pre-activation is GRANOT_IDENTITY_CONFLICT", async (t) => {
  if (!(await replicaReady(t))) return;
  const mismatched = await seedReferralReviewCase({ latestAction: "booked", jobMismatch: true });
  await assert.rejects(
    noAction(rrfNoActionCommand(mismatched.caseId, "job-mismatch"), { flags: rrfFlags }),
    (error: unknown) =>
      error instanceof GranotLifecycleError &&
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.IDENTITY_CONFLICT &&
      error.statusCode === 409,
  );
  const preActivation = await seedReferralReviewCase({ latestAction: "booked", preActivation: true });
  await assert.rejects(
    noAction(rrfNoActionCommand(preActivation.caseId, "pre-activation"), { flags: rrfFlags }),
    (error: unknown) =>
      error instanceof GranotLifecycleError &&
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.IDENTITY_CONFLICT &&
      error.statusCode === 409,
  );
});
