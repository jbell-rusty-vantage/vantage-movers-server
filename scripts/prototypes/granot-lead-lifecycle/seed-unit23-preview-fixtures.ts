/**
 * Seeds redacted Unit 23 Owner-review fixtures into testvantagemovers only.
 *
 * TEST_MODE=true must be set before process start so Mongo targets the test
 * database. Cleanup is scoped to the U23P job prefix and fixture source label.
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../src/config/domain/runtime";
import { connectMongo } from "../../../src/db";
import {
  getGranotLifecycleCaseDetail,
  listGranotLifecycleCaseCandidates,
  listGranotLifecycleCases,
  projectGranotJob,
} from "../../../src/services/granotLifecycle/projections";

const JOB_PREFIX = "U23P";
const SOURCE_LABEL = "U23 Preview Synthetic Source";
const ADMIN_PREVIEW_ORIGIN = "https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app";

const COLLECTIONS = [
  "form_leads",
  "booked_leads",
  "cancelled_leads",
  "granot_crm_sources",
  "granot_observations",
  "granot_record_links",
  "granot_booking_reconciliation_cases",
  "booking_lead_reconciliation_cases",
  "synchronization_decisions",
] as const;

function oid(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

function job(suffix: string): string {
  return `${JOB_PREFIX}${suffix}`;
}

async function assertTestDatabase(): Promise<void> {
  if (process.env.TEST_MODE !== "true") {
    throw new Error("Refusing to seed: TEST_MODE must be true before process start.");
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    throw new Error(`Refusing to seed: database is ${getMongoDatabaseName()}, not testvantagemovers.`);
  }
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
    throw new Error(
      `Refusing to seed: connected database is ${mongoose.connection.db?.databaseName}.`,
    );
  }
}

async function cleanup(): Promise<number> {
  const db = mongoose.connection.db!;
  const jobFilter = { $regex: `^${JOB_PREFIX}` };
  const previewObservations = await db.collection("granot_observations")
    .find({ "identity.normalized_job_no": jobFilter }, { projection: { _id: 1 } })
    .toArray();
  const observationIds = previewObservations.map((row) => row._id);
  const counts = await Promise.all([
    db.collection("form_leads").deleteMany({ normalized_job_no: jobFilter }),
    db.collection("booked_leads").deleteMany({ normalized_job_no: jobFilter }),
    db.collection("cancelled_leads").deleteMany({ job_no: jobFilter }),
    db.collection("granot_crm_sources").deleteMany({ granot_label: SOURCE_LABEL }),
    db.collection("granot_observations").deleteMany({ "identity.normalized_job_no": jobFilter }),
    db.collection("granot_record_links").deleteMany({ normalized_job_no: jobFilter }),
    db.collection("granot_booking_reconciliation_cases").deleteMany({ normalized_job_no: jobFilter }),
    db.collection("booking_lead_reconciliation_cases").deleteMany({
      "submission.normalized_job_no": jobFilter,
    }),
    observationIds.length
      ? db.collection("synchronization_decisions").deleteMany({ observation_id: { $in: observationIds } })
      : Promise.resolve({ deletedCount: 0 }),
  ]);
  void COLLECTIONS;
  return counts.reduce((sum, result) => sum + result.deletedCount, 0);
}

async function insert(
  collection: string,
  document: Record<string, unknown>,
): Promise<void> {
  await mongoose.connection.db!.collection(collection).insertOne(document);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function seed(): Promise<Record<string, string>> {
  const sourceId = oid();
  const companyId = oid();
  const granularityId = oid();
  const sourceScope = {
    granot_crm_source_id: sourceId,
    lead_source_company: companyId,
    source_granularity_id: granularityId,
  };

  await insert("granot_crm_sources", {
    _id: sourceId,
    granot_label: SOURCE_LABEL,
    lead_source_company: companyId,
    source_granularity_id: granularityId,
    active: true,
  });

  const createMissing = await seedCreateMissing(sourceScope);
  const reviewExisting = await seedReviewExisting(sourceScope);
  const sequences = await seedResolvedThenLaterSequence(sourceScope);
  const ambiguous = await seedAmbiguous(sourceScope);
  const noCase = await seedPriorityFiveExistingBookingNoCase(sourceScope);
  const delegated = await seedMissingLeadDelegation(sourceScope);
  const coexistence = await seedBookedAndReleaseObservations(sourceScope);

  return {
    create_missing_case: createMissing,
    review_existing_case: reviewExisting,
    later_sequence_case: sequences,
    ambiguous_case: ambiguous,
    priority5_existing_booking_job: noCase,
    missing_lead_delegation_case: delegated,
    booked_release_coexistence_job: coexistence,
  };
}

async function seedCreateMissing(sourceScope: {
  granot_crm_source_id: mongoose.Types.ObjectId;
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
}): Promise<string> {
  const jobNo = job("CREATE1");
  const leadId = oid();
  const badId = oid();
  const duplicateId = oid();
  const observationId = oid();
  const receiptId = oid();
  const decisionId = oid();
  const linkId = oid();
  const caseId = oid();
  const capturedAt = hoursAgo(1);

  await insert("form_leads", {
    _id: leadId,
    name: "Synthetic Create Missing",
    phone_number: "0000004321",
    email: "u23p-create@example.invalid",
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_source_company: sourceScope.lead_source_company,
    source_granularity_id: sourceScope.source_granularity_id,
    source_company_label_snapshot: "Synthetic Preview Company",
    source_granularity_label_snapshot: "Synthetic Preview Granularity",
    duplicate: false,
    bad_lead: null,
  });
  await insert("form_leads", {
    _id: badId,
    name: "Synthetic Bad Lead",
    phone_number: "0000004999",
    email: "u23p-bad@example.invalid",
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_source_company: sourceScope.lead_source_company,
    source_granularity_id: sourceScope.source_granularity_id,
    duplicate: false,
    bad_lead: { reason: "test_bad" },
  });
  await insert("form_leads", {
    _id: duplicateId,
    name: "Synthetic Duplicate Lead",
    phone_number: "0000004888",
    email: "u23p-dup@example.invalid",
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_source_company: sourceScope.lead_source_company,
    source_granularity_id: sourceScope.source_granularity_id,
    duplicate: true,
    bad_lead: null,
  });
  await insertObservationDecision({
    observationId,
    receiptId,
    decisionId,
    jobNo,
    capturedAt,
    priority: "5",
    action: "booked",
  });
  await insert("granot_record_links", {
    _id: linkId,
    provider: "granot",
    normalized_job_no: jobNo,
    job_no_snapshot: jobNo,
    state: "active",
    lead_ref: { model: "FormLead", id: leadId },
    source_scope: {
      lead_source_company: sourceScope.lead_source_company,
      source_granularity_id: sourceScope.source_granularity_id,
    },
    disputed: false,
    established_by_decision_id: decisionId,
    established_at: capturedAt,
    last_observation_id: observationId,
    last_observed_at: capturedAt,
    domain_revision: 1,
  });
  await insertCase({
    caseId,
    jobNo,
    sourceScope,
    recordLinkId: linkId,
    mode: "create_missing_booking",
    state: "open",
    sequence: 1,
    evidenceRevision: 1,
    evidence: [{ observation_id: observationId, decision_id: decisionId, captured_at: capturedAt, action: "booked" }],
    suggested: {
      lead_ref: { model: "FormLead", id: leadId },
      confidence: "high",
      match_method: "form_ref_no_exact",
      reason_codes: ["form_ref_no_exact"],
    },
    contact: { name: "Synthetic Create Missing", phone_number: "0000004321" },
    openedAt: capturedAt,
    lastEvidenceAt: capturedAt,
  });
  return String(caseId);
}

async function seedReviewExisting(sourceScope: {
  granot_crm_source_id: mongoose.Types.ObjectId;
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
}): Promise<string> {
  const jobNo = job("REVIEW1");
  const leadId = oid();
  const bookingId = oid();
  const cancellationId = oid();
  const observationId = oid();
  const receiptId = oid();
  const decisionId = oid();
  const linkId = oid();
  const caseId = oid();
  const capturedAt = hoursAgo(2);

  await insert("form_leads", {
    _id: leadId,
    name: "Synthetic Review Existing",
    phone_number: "0000004333",
    email: "u23p-review@example.invalid",
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_source_company: sourceScope.lead_source_company,
    source_granularity_id: sourceScope.source_granularity_id,
    duplicate: false,
    bad_lead: null,
  });
  await insert("booked_leads", {
    _id: bookingId,
    timestamp: capturedAt,
    book_date: new Date("2026-08-10T00:00:00.000Z"),
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_ref: leadId,
    lead_model: "FormLead",
    customer_name: "Synthetic Review Existing",
    agent_allocations: [{
      agent: oid(),
      agent_name_snapshot: "Synthetic Agent",
      binder_amount: 625,
    }],
    total_binder_amount: 625,
    deposit_amount: 200,
    merchant: "Synthetic Merchant",
    source: "Synthetic Source",
    is_referral_booking: false,
    is_leadless_booking: false,
    domain_revision: 1,
  });
  await insert("cancelled_leads", {
    _id: cancellationId,
    timestamp: capturedAt,
    booked_lead: bookingId,
    job_no: jobNo,
    cancel_date: new Date("2026-08-12T00:00:00.000Z"),
    reason: "synthetic_review",
    refund_amount: 0,
    domain_revision: 1,
  });
  await insertObservationDecision({
    observationId,
    receiptId,
    decisionId,
    jobNo,
    capturedAt,
    priority: "5",
    action: "booked",
  });
  await insert("granot_record_links", {
    _id: linkId,
    provider: "granot",
    normalized_job_no: jobNo,
    job_no_snapshot: jobNo,
    state: "active",
    lead_ref: { model: "FormLead", id: leadId },
    booking_ref: bookingId,
    source_scope: {
      lead_source_company: sourceScope.lead_source_company,
      source_granularity_id: sourceScope.source_granularity_id,
    },
    disputed: false,
    established_by_decision_id: decisionId,
    established_at: capturedAt,
    last_observation_id: observationId,
    last_observed_at: capturedAt,
    domain_revision: 1,
  });
  await insertCase({
    caseId,
    jobNo,
    sourceScope,
    recordLinkId: linkId,
    bookingId,
    mode: "review_existing_booking",
    state: "open",
    sequence: 1,
    evidenceRevision: 1,
    evidence: [{ observation_id: observationId, decision_id: decisionId, captured_at: capturedAt, action: "booked" }],
    suggested: {
      lead_ref: { model: "FormLead", id: leadId },
      confidence: "medium",
      match_method: "source_scope_contact",
      reason_codes: ["source_scope_contact"],
    },
    contact: { name: "Synthetic Review Existing", phone_number: "0000004333" },
    openedAt: capturedAt,
    lastEvidenceAt: capturedAt,
  });
  return String(caseId);
}

async function seedResolvedThenLaterSequence(sourceScope: {
  granot_crm_source_id: mongoose.Types.ObjectId;
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
}): Promise<string> {
  const jobNo = job("SEQ001");
  const leadId = oid();
  const firstObservation = oid();
  const firstReceipt = oid();
  const firstDecision = oid();
  const refreshObservation = oid();
  const refreshReceipt = oid();
  const refreshDecision = oid();
  const laterObservation = oid();
  const laterReceipt = oid();
  const laterDecision = oid();
  const resolvedCaseId = oid();
  const laterCaseId = oid();
  const openedAt = hoursAgo(8);
  const refreshAt = hoursAgo(7);
  const laterAt = hoursAgo(3);
  const resolvedAt = hoursAgo(6);

  await insert("form_leads", {
    _id: leadId,
    name: "Synthetic Sequence Lead",
    phone_number: "0000004444",
    email: "u23p-seq@example.invalid",
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_source_company: sourceScope.lead_source_company,
    source_granularity_id: sourceScope.source_granularity_id,
    duplicate: false,
    bad_lead: null,
  });
  await insertObservationDecision({
    observationId: firstObservation,
    receiptId: firstReceipt,
    decisionId: firstDecision,
    jobNo,
    capturedAt: openedAt,
    priority: "5",
    action: "booked",
  });
  await insertObservationDecision({
    observationId: refreshObservation,
    receiptId: refreshReceipt,
    decisionId: refreshDecision,
    jobNo,
    capturedAt: refreshAt,
    priority: "5",
    action: "booked",
  });
  await insertObservationDecision({
    observationId: laterObservation,
    receiptId: laterReceipt,
    decisionId: laterDecision,
    jobNo,
    capturedAt: laterAt,
    priority: "5",
    action: "booked",
  });
  await insertCase({
    caseId: resolvedCaseId,
    jobNo,
    sourceScope,
    mode: "create_missing_booking",
    state: "resolved",
    sequence: 1,
    caseRevision: 2,
    evidenceRevision: 2,
    evidence: [
      { observation_id: firstObservation, decision_id: firstDecision, captured_at: openedAt, action: "booked" },
      { observation_id: refreshObservation, decision_id: refreshDecision, captured_at: refreshAt, action: "booked" },
    ],
    suggested: {
      lead_ref: { model: "FormLead", id: leadId },
      confidence: "high",
      match_method: "form_ref_no_exact",
      reason_codes: ["form_ref_no_exact"],
    },
    contact: { name: "Synthetic Sequence Lead", phone_number: "0000004444" },
    openedAt,
    lastEvidenceAt: refreshAt,
    resolvedAt,
  });
  await insertCase({
    caseId: laterCaseId,
    jobNo,
    sourceScope,
    mode: "create_missing_booking",
    state: "open",
    sequence: 2,
    evidenceRevision: 1,
    evidence: [{
      observation_id: laterObservation,
      decision_id: laterDecision,
      captured_at: laterAt,
      action: "booked",
    }],
    suggested: {
      lead_ref: { model: "FormLead", id: leadId },
      confidence: "high",
      match_method: "form_ref_no_exact",
      reason_codes: ["form_ref_no_exact"],
    },
    contact: { name: "Synthetic Sequence Lead", phone_number: "0000004444" },
    openedAt: laterAt,
    lastEvidenceAt: laterAt,
  });
  return String(laterCaseId);
}

async function seedAmbiguous(sourceScope: {
  granot_crm_source_id: mongoose.Types.ObjectId;
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
}): Promise<string> {
  const jobNo = job("AMBIG1");
  const firstLead = oid();
  const secondLead = oid();
  const observationId = oid();
  const receiptId = oid();
  const decisionId = oid();
  const caseId = oid();
  const capturedAt = hoursAgo(4);

  await insert("form_leads", {
    _id: firstLead,
    name: "Synthetic Ambiguous One",
    phone_number: "0000004555",
    email: "u23p-ambig-one@example.invalid",
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_source_company: sourceScope.lead_source_company,
    source_granularity_id: sourceScope.source_granularity_id,
    duplicate: false,
    bad_lead: null,
  });
  await insert("form_leads", {
    _id: secondLead,
    name: "Synthetic Ambiguous Two",
    phone_number: "0000004666",
    email: "u23p-ambig-two@example.invalid",
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_source_company: sourceScope.lead_source_company,
    source_granularity_id: sourceScope.source_granularity_id,
    duplicate: false,
    bad_lead: null,
  });
  await insertObservationDecision({
    observationId,
    receiptId,
    decisionId,
    jobNo,
    capturedAt,
    priority: "5",
    action: "booked",
  });
  await insertCase({
    caseId,
    jobNo,
    sourceScope,
    mode: "create_missing_booking",
    state: "open",
    sequence: 1,
    evidenceRevision: 1,
    evidence: [{ observation_id: observationId, decision_id: decisionId, captured_at: capturedAt, action: "booked" }],
    contact: { name: "Synthetic Ambiguous", phone_number: "0000004555" },
    openedAt: capturedAt,
    lastEvidenceAt: capturedAt,
  });
  return String(caseId);
}

async function seedPriorityFiveExistingBookingNoCase(sourceScope: {
  granot_crm_source_id: mongoose.Types.ObjectId;
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
}): Promise<string> {
  const jobNo = job("NOCASE1");
  const leadId = oid();
  const bookingId = oid();
  const observationId = oid();
  const receiptId = oid();
  const decisionId = oid();
  const capturedAt = hoursAgo(5);

  await insert("form_leads", {
    _id: leadId,
    name: "Synthetic Priority Existing",
    phone_number: "0000004777",
    email: "u23p-nocase@example.invalid",
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_source_company: sourceScope.lead_source_company,
    source_granularity_id: sourceScope.source_granularity_id,
    duplicate: false,
    bad_lead: null,
  });
  await insert("booked_leads", {
    _id: bookingId,
    timestamp: capturedAt,
    book_date: new Date("2026-08-01T00:00:00.000Z"),
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_ref: leadId,
    lead_model: "FormLead",
    customer_name: "Synthetic Priority Existing",
    agent_allocations: [{
      agent: oid(),
      agent_name_snapshot: "Synthetic Agent",
      binder_amount: 100,
    }],
    total_binder_amount: 100,
    deposit_amount: 0,
    merchant: "Synthetic Merchant",
    source: "Synthetic Source",
    is_referral_booking: false,
    is_leadless_booking: false,
    domain_revision: 1,
  });
  await insertObservationDecision({
    observationId,
    receiptId,
    decisionId,
    jobNo,
    capturedAt,
    priority: "5",
    action: undefined,
  });
  void sourceScope;
  return jobNo;
}

async function seedMissingLeadDelegation(sourceScope: {
  granot_crm_source_id: mongoose.Types.ObjectId;
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
}): Promise<string> {
  const jobNo = job("DELEG1");
  const bookingId = oid();
  const employeeCaseId = oid();
  const observationId = oid();
  const receiptId = oid();
  const decisionId = oid();
  const caseId = oid();
  const capturedAt = hoursAgo(4.5);

  await insert("booked_leads", {
    _id: bookingId,
    timestamp: capturedAt,
    book_date: new Date("2026-08-09T00:00:00.000Z"),
    job_no: jobNo,
    normalized_job_no: jobNo,
    customer_name: "Synthetic Leadless Booking",
    agent_allocations: [{
      agent: oid(),
      agent_name_snapshot: "Synthetic Agent",
      binder_amount: 50,
    }],
    total_binder_amount: 50,
    deposit_amount: 0,
    merchant: "Synthetic Merchant",
    source: "Synthetic Source",
    is_referral_booking: false,
    is_leadless_booking: true,
    domain_revision: 1,
  });
  await insert("booking_lead_reconciliation_cases", {
    _id: employeeCaseId,
    booking: bookingId,
    origin: "employee_booking",
    status: "pending",
    reason: "no_match",
    submission: {
      submission_id: "u23p-deleg-1",
      lead_name: "Synthetic Leadless Booking",
      phone_number: "0000004111",
      normalized_phone_number: "0000004111",
      job_no: jobNo,
      normalized_job_no: jobNo,
      binder_amount: 50,
      deposit_amount: 0,
      merchant: "Synthetic Merchant",
      agent: "Synthetic Agent",
      book_date: capturedAt,
      source_assignment: {
        lead_source_company: sourceScope.lead_source_company,
        source_granularity_id: sourceScope.source_granularity_id,
        source_granularity_key: "u23p-preview",
        source_company: "synthetic",
        source_company_label_snapshot: "Synthetic Preview Company",
        source_granularity_label_snapshot: "Synthetic Preview Granularity",
        crm_source_label_snapshot: SOURCE_LABEL,
        channel: "form",
      },
    },
    latest_candidates: [],
    match_attempts: [],
    retry: { attempt_count: 0 },
    resolution_history: [],
    revision: 0,
  });
  await insertObservationDecision({
    observationId,
    receiptId,
    decisionId,
    jobNo,
    capturedAt,
    priority: "1",
    action: "booked",
  });
  await insertCase({
    caseId,
    jobNo,
    sourceScope,
    bookingId,
    mode: "review_existing_booking",
    state: "open",
    sequence: 1,
    evidenceRevision: 1,
    evidence: [{ observation_id: observationId, decision_id: decisionId, captured_at: capturedAt, action: "booked" }],
    contact: { name: "Synthetic Leadless Booking", phone_number: "0000004111" },
    openedAt: capturedAt,
    lastEvidenceAt: capturedAt,
  });
  return String(caseId);
}

async function seedBookedAndReleaseObservations(sourceScope: {
  granot_crm_source_id: mongoose.Types.ObjectId;
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
}): Promise<string> {
  const jobNo = job("BOTH01");
  const leadId = oid();
  const bookedObservation = oid();
  const bookedReceipt = oid();
  const bookedDecision = oid();
  const releaseObservation = oid();
  const releaseReceipt = oid();
  const releaseDecision = oid();
  const caseId = oid();
  const bookedAt = hoursAgo(0.75);
  const releaseAt = hoursAgo(0.5);

  await insert("form_leads", {
    _id: leadId,
    name: "Synthetic Coexistence Lead",
    phone_number: "0000004222",
    email: "u23p-both@example.invalid",
    job_no: jobNo,
    normalized_job_no: jobNo,
    lead_source_company: sourceScope.lead_source_company,
    source_granularity_id: sourceScope.source_granularity_id,
    duplicate: false,
    bad_lead: null,
  });
  await insertObservationDecision({
    observationId: bookedObservation,
    receiptId: bookedReceipt,
    decisionId: bookedDecision,
    jobNo,
    capturedAt: bookedAt,
    priority: "5",
    action: "booked",
  });
  await insertObservationDecision({
    observationId: releaseObservation,
    receiptId: releaseReceipt,
    decisionId: releaseDecision,
    jobNo,
    capturedAt: releaseAt,
    priority: "8",
    action: "release",
  });
  await insertCase({
    caseId,
    jobNo,
    sourceScope,
    mode: "create_missing_booking",
    state: "open",
    sequence: 1,
    evidenceRevision: 2,
    evidence: [
      { observation_id: bookedObservation, decision_id: bookedDecision, captured_at: bookedAt, action: "booked" },
      { observation_id: releaseObservation, decision_id: releaseDecision, captured_at: releaseAt, action: "release" },
    ],
    suggested: {
      lead_ref: { model: "FormLead", id: leadId },
      confidence: "high",
      match_method: "form_ref_no_exact",
      reason_codes: ["form_ref_no_exact"],
    },
    contact: { name: "Synthetic Coexistence Lead", phone_number: "0000004222" },
    openedAt: bookedAt,
    lastEvidenceAt: releaseAt,
  });
  return jobNo;
}

async function insertObservationDecision(input: {
  observationId: mongoose.Types.ObjectId;
  receiptId: mongoose.Types.ObjectId;
  decisionId: mongoose.Types.ObjectId;
  jobNo: string;
  capturedAt: Date;
  priority: string;
  action?: "booked" | "release";
}): Promise<void> {
  await insert("granot_observations", {
    _id: input.observationId,
    receipt_id: input.receiptId,
    captured_at: input.capturedAt,
    normalization_result: "valid",
    issues: [],
    identity: { normalized_job_no: input.jobNo, job_no_raw: input.jobNo },
    priority: { valid: true, canonical: input.priority },
    agent_identity: { user_raw: "SYNTHAGENT" },
    ...(input.action ? { booking_action: { normalized: input.action } } : {}),
  });
  await insert("synchronization_decisions", {
    _id: input.decisionId,
    receipt_id: input.receiptId,
    observation_id: input.observationId,
    attempt: 1,
    execution_mode: "shadow",
    outcome: "already_current",
    reason_code: "desired_state_already_current",
    candidates: [],
    evaluated_gates: [],
    effects: [],
    decided_at: input.capturedAt,
  });
}

async function insertCase(input: {
  caseId: mongoose.Types.ObjectId;
  jobNo: string;
  sourceScope: {
    granot_crm_source_id: mongoose.Types.ObjectId;
    lead_source_company: mongoose.Types.ObjectId;
    source_granularity_id: mongoose.Types.ObjectId;
  };
  recordLinkId?: mongoose.Types.ObjectId;
  bookingId?: mongoose.Types.ObjectId;
  mode: "create_missing_booking" | "review_existing_booking";
  state: "open" | "resolved";
  sequence: number;
  caseRevision?: number;
  evidenceRevision: number;
  evidence: Array<{
    observation_id: mongoose.Types.ObjectId;
    decision_id: mongoose.Types.ObjectId;
    captured_at: Date;
    action: "booked" | "release" | "priority_5";
  }>;
  suggested?: {
    lead_ref: { model: "FormLead"; id: mongoose.Types.ObjectId };
    confidence: "high" | "medium";
    match_method: string;
    reason_codes: string[];
  };
  contact: { name: string; phone_number: string };
  openedAt: Date;
  lastEvidenceAt: Date;
  resolvedAt?: Date;
}): Promise<void> {
  await insert("granot_booking_reconciliation_cases", {
    _id: input.caseId,
    normalized_job_no: input.jobNo,
    job_no_snapshot: input.jobNo,
    action_kind: "booked",
    sequence_number: input.sequence,
    mode: input.mode,
    state: input.state,
    case_revision: input.caseRevision ?? 1,
    evidence_revision: input.evidenceRevision,
    source_scope: input.sourceScope,
    record_link_id: input.recordLinkId,
    deterministic_booking_id: input.bookingId,
    evidence: input.evidence,
    observed_context: {
      contact: input.contact,
      estimate: "1200",
      payment: "200",
      balance: "1000",
      granot_priority: "5",
    },
    suggested_lead: input.suggested,
    opened_at: input.openedAt,
    last_evidence_at: input.lastEvidenceAt,
    resolved_at: input.resolvedAt,
    createdAt: input.openedAt,
    updatedAt: input.lastEvidenceAt,
  });
}

function caseHref(caseId: string): string {
  return `${ADMIN_PREVIEW_ORIGIN}/ingestion/granot/lifecycle/cases/${caseId}`;
}

function jobHref(jobNo: string): string {
  return `${ADMIN_PREVIEW_ORIGIN}/ingestion/granot/lifecycle/jobs/${encodeURIComponent(jobNo)}`;
}

async function verify(ids: Record<string, string>): Promise<void> {
  const queue = await listGranotLifecycleCases({
    kind: "booking",
    state: "open",
    sort: "last_evidence_at",
    order: "desc",
    limit: 25,
  });
  const createMissing = await getGranotLifecycleCaseDetail(ids.create_missing_case);
  const candidates = await listGranotLifecycleCaseCandidates(ids.create_missing_case, {
    scope: "source",
    lead_model: "FormLead",
    limit: 25,
  });
  const coexistence = await projectGranotJob(ids.booked_release_coexistence_job, { limit: 100 });
  const noCaseQueue = await listGranotLifecycleCases({
    kind: "booking",
    normalized_job_no: ids.priority5_existing_booking_job,
    sort: "last_evidence_at",
    order: "desc",
    limit: 25,
  });

  if (!queue.items.some((item) => item.case_id === ids.create_missing_case)) {
    throw new Error("Create-missing case is missing from the default open queue.");
  }
  if (createMissing?.mode !== "create_missing_booking") {
    throw new Error("Create-missing detail did not project the expected mode.");
  }
  if (createMissing?.observed_context.section_label !== "Granot evidence — not official Vantage values") {
    throw new Error("Exact Granot evidence label is missing from detail.");
  }
  const candidateIds = new Set((candidates?.items ?? []).map((item) => item.lead_ref.id));
  if (candidates?.items.some((item) => /bad|duplicate/i.test(item.masked_contact_label))) {
    throw new Error("Candidate browser exposed a bad or duplicate label.");
  }
  if (candidateIds.size === 0) {
    throw new Error("Candidate browser returned no eligible source-scope leads.");
  }
  if (noCaseQueue.items.length !== 0) {
    throw new Error("Priority-5 existing Booking unexpectedly opened a review case.");
  }
  const actions = coexistence.items.filter((item) => item.type === "booking_action").map((item) => {
    return item.type === "booking_action" ? item.data.action : "";
  });
  if (!actions.includes("booked") || !actions.includes("release")) {
    throw new Error("Coexistence job did not project both Booked and Release actions.");
  }
}

async function main(): Promise<void> {
  const shouldCleanupOnly = process.argv.includes("--cleanup");
  await assertTestDatabase();
  const removed = await cleanup();
  if (shouldCleanupOnly) {
    console.log(JSON.stringify({ ok: true, cleaned: removed }, null, 2));
    return;
  }
  const ids = await seed();
  await verify(ids);
  console.log(JSON.stringify({
    ok: true,
    database: "testvantagemovers",
    cleaned_before_seed: removed,
    queue: `${ADMIN_PREVIEW_ORIGIN}/ingestion/granot/lifecycle`,
    cases: {
      create_missing: caseHref(ids.create_missing_case),
      review_existing: caseHref(ids.review_existing_case),
      later_sequence: caseHref(ids.later_sequence_case),
      ambiguous: caseHref(ids.ambiguous_case),
      missing_lead_delegation: caseHref(ids.missing_lead_delegation_case),
    },
    jobs: {
      priority5_existing_booking_no_case: jobHref(ids.priority5_existing_booking_job),
      booked_and_release_coexistence: jobHref(ids.booked_release_coexistence_job),
    },
    ids,
  }, null, 2));
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
