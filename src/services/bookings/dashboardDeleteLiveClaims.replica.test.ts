import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
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
import { toObjectId, newObjectIdHex } from "../../utils/objectId";
import { normalizeJobNo } from "./bookingIdentity";
import { deleteBookedLead } from "./bookedLead.service";
import { deleteCancelledLead } from "../cancellations/cancelledLead.service";
import { createVantageApiSecretActor } from "../domainCommands/existingWriteContext";
import { runExistingDeleteBookedLead } from "../domainCommands/existingWrites";
import type { CanonicalCommandContext } from "../domainCommands/types";
import { confirmBooking } from "../granotLifecycle/bookingConfirmation";
import { BOOKING_LEAD_MIRROR_ACTOR_ID } from "../domainCommands/leadChangeEmission";

const seeded = new Set<string>();
const jobPrefix = `DLC${Date.now().toString(36).toUpperCase()}`;
const normalizedJobPrefix = normalizeJobNo(jobPrefix)!;
const previousSheetSyncMode = process.env.SHEET_SYNC_MODE;
let sheetSyncClaimed = false;

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
  if (!sheetSyncClaimed) {
    process.env.SHEET_SYNC_MODE = "queued";
    sheetSyncClaimed = true;
  }
  return true;
}

after(async () => {
  if (sheetSyncClaimed) {
    if (previousSheetSyncMode === undefined) delete process.env.SHEET_SYNC_MODE;
    else process.env.SHEET_SYNC_MODE = previousSheetSyncMode;
  }
  if (mongoose.connection.readyState === 1) {
    const ids = [...seeded].map((value) => toObjectId(value));
    await Promise.all([
      getGranotBookingReconciliationCaseModel().deleteMany({
        normalized_job_no: { $regex: `^${normalizedJobPrefix}` },
      }),
      BookedLead.deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      CancelledLead.deleteMany({ job_no: { $regex: `^${jobPrefix}` } }),
      getGranotRecordLinkModel().collection.deleteMany({
        normalized_job_no: { $regex: `^${normalizedJobPrefix}` },
      }),
      getFormLeadModel().deleteMany({ _id: { $in: ids } }),
      Agent.deleteMany({ _id: { $in: ids } }),
      Merchant.deleteMany({ _id: { $in: ids } }),
      getGranotCrmSourceModel().deleteMany({ _id: { $in: ids } }),
      getLeadSourceCompanyModel().deleteMany({ _id: { $in: ids } }),
      getLeadSourceGranularityModel().deleteMany({ _id: { $in: ids } }),
      getGranotObservationModel().collection.deleteMany({ _id: { $in: ids } }),
      getGranotObservationReceiptModel().collection.deleteMany({ _id: { $in: ids } }),
      mongoose.connection.collection("synchronization_decisions").deleteMany({ _id: { $in: ids } }),
      DomainCommandExecution.deleteMany({ idempotency_key: { $regex: "^dlc-" } }),
      getEntityChangeModel().collection.deleteMany({
        "provenance.request_id": { $regex: "^dlc-" },
      }),
    ]);
  }
  await mongoose.disconnect().catch(() => undefined);
});

function id() {
  const value = toObjectId(newObjectIdHex());
  seeded.add(String(value));
  return value;
}

let jobSeq = 0;
function nextJob() {
  jobSeq += 1;
  const raw = `${jobPrefix}-${jobSeq}`;
  return { raw, normalized: normalizeJobNo(raw)! };
}

async function formLead(extra: Record<string, unknown> = {}) {
  const leadId = id();
  const companyId = id();
  const granularityId = id();
  await getFormLeadModel().collection.insertOne({
    _id: leadId,
    name: "DLC Synthetic Customer",
    timestamp: new Date("2026-09-28T12:00:00.000Z"),
    pickup_zip: "33435",
    destination_zip: "33435",
    phone_number: `555${String(leadId).slice(-7)}`,
    local: "local",
    source_company: "dlc-source",
    lead_source_company: companyId,
    source_granularity_id: granularityId,
    ingestion_origin: "wordpress_form",
    cpl: 0,
    post_to_granot: true,
    duplicate: false,
    bad_lead: null,
    domain_revision: 0,
    ...extra,
  });
  return { leadId, companyId, granularityId };
}

async function bookingFor(
  leadId: mongoose.Types.ObjectId,
  job: { raw: string },
  extra: Record<string, unknown> = {},
) {
  const booking = await new BookedLead({
    book_date: new Date("2026-09-28T00:00:00.000Z"),
    job_no: job.raw,
    lead_ref: leadId,
    lead_model: "FormLead",
    customer_name: "DLC Synthetic Customer",
    agent_allocations: [
      {
        agent: id(),
        agent_name_snapshot: "DLC Agent",
        binder_amount: 100,
      },
    ],
    total_binder_amount: 100,
    deposit_amount: 50,
    merchant: "DLC Merchant",
    source: "dlc-source",
    local: "local",
    is_referral_booking: false,
    is_leadless_booking: false,
    domain_revision: 0,
    ...extra,
  }).save();
  await getFormLeadModel().collection.updateOne(
    { _id: leadId },
    { $set: { booked: booking._id } },
  );
  return booking;
}

async function recordLink(input: {
  job: { raw: string; normalized: string };
  bookingId: mongoose.Types.ObjectId;
  leadId?: mongoose.Types.ObjectId;
  companyId?: mongoose.Types.ObjectId;
  granularityId?: mongoose.Types.ObjectId;
  state?: "active" | "superseded";
  domainRevision?: number;
}) {
  const linkId = id();
  const observationId = id();
  const decisionId = id();
  await getGranotRecordLinkModel().collection.insertOne({
    _id: linkId,
    provider: "granot",
    normalized_job_no: input.job.normalized,
    job_no_snapshot: input.job.raw,
    state: input.state ?? "active",
    ...(input.leadId
      ? { lead_ref: { model: "FormLead", id: input.leadId } }
      : {}),
    booking_ref: input.bookingId,
    ...(input.companyId && input.granularityId
      ? {
          source_scope: {
            lead_source_company: input.companyId,
            source_granularity_id: input.granularityId,
          },
        }
      : {}),
    disputed: false,
    established_by_decision_id: decisionId,
    established_at: new Date("2026-09-28T12:00:00.000Z"),
    last_observation_id: observationId,
    last_observed_at: new Date("2026-09-28T12:00:00.000Z"),
    domain_revision: input.domainRevision ?? 2,
    ...(input.state === "superseded" ? { superseded_by: id() } : {}),
  });
  return { linkId, observationId };
}

async function bookingCase(input: {
  job: { raw: string; normalized: string };
  bookingId: mongoose.Types.ObjectId;
  linkId?: mongoose.Types.ObjectId;
  state: "open" | "resolved";
  sequence: number;
  caseRevision?: number;
}) {
  const caseId = id();
  const observationId = id();
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: caseId,
    normalized_job_no: input.job.normalized,
    job_no_snapshot: input.job.raw,
    action_kind: "booked",
    sequence_number: input.sequence,
    mode: "create_missing_booking",
    state: input.state,
    case_revision: input.caseRevision ?? 4,
    evidence_revision: 1,
    evidence: [
      {
        observation_id: observationId,
        decision_id: id(),
        captured_at: new Date("2026-09-28T12:00:00.000Z"),
        action: "booked",
      },
    ],
    observed_context: {},
    opened_at: new Date("2026-09-28T12:00:00.000Z"),
    last_evidence_at: new Date("2026-09-28T12:00:00.000Z"),
    deterministic_booking_id: input.bookingId,
    ...(input.linkId ? { record_link_id: input.linkId } : {}),
    ...(input.state === "resolved"
      ? {
          resolved_at: new Date("2026-09-28T13:00:00.000Z"),
          resolution: {
            outcome: "booking_created",
            resolved_at: new Date("2026-09-28T13:00:00.000Z"),
            entity_ref: { model: "BookedLead", id: String(input.bookingId) },
          },
        }
      : {}),
  });
  return { caseId, observationId };
}

function deleteContext(bookingId: string, cascade: boolean): CanonicalCommandContext {
  const requestId = `dlc-${bookingId}-${cascade ? "cascade" : "plain"}`;
  const actor = createVantageApiSecretActor(requestId);
  return {
    command_id: newObjectIdHex(),
    idempotency_key: `dlc-${bookingId}-${cascade ? "cascade" : "plain"}`,
    payload_checksum: "cd".repeat(32),
    actor,
    initiator: actor,
    provenance: {
      origin: "vantage_admin",
      run_id: null,
      source_receipt_id: null,
      source_connection_key: null,
    },
  };
}

async function deleteBooking(bookingId: string, cascade = false) {
  const context = deleteContext(bookingId, cascade);
  await runExistingDeleteBookedLead({ booking_id: bookingId, cascade, context });
  return context.actor.request_id;
}

async function linkChangesFor(requestId: string) {
  return getEntityChangeModel()
    .find({
      command_name: "deleteBookedLead",
      "entity.model": "GranotRecordLink",
      "provenance.request_id": requestId,
    })
    .lean()
    .exec();
}

test("[AC-DLC-01] Booking delete drops the live booking_ref and keeps the Lead", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = nextJob();
  const lead = await formLead();
  const booking = await bookingFor(lead.leadId, job);
  const link = await recordLink({
    job,
    bookingId: booking._id,
    leadId: lead.leadId,
    companyId: lead.companyId,
    granularityId: lead.granularityId,
    domainRevision: 2,
  });
  await deleteBooking(String(booking._id));

  assert.equal(await BookedLead.countDocuments({ _id: booking._id }), 0);
  const surviving = await getFormLeadModel().findById(lead.leadId).lean().exec();
  assert.ok(surviving);
  assert.equal(surviving?.booked ?? null, null);
  const stored = await getGranotRecordLinkModel().findById(link.linkId).lean().exec();
  assert.equal(stored?.state, "active");
  assert.equal(String(stored?.lead_ref?.id), String(lead.leadId));
  assert.equal(stored?.lead_ref?.model, "FormLead");
  assert.equal(stored?.booking_ref ?? null, null);
  assert.equal(stored?.domain_revision, 3);
  assert.equal(String(stored?.last_observation_id), String(link.observationId));
});

test("[AC-DLC-02] Booking delete writes one Record Link change with booking_ref absent", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = nextJob();
  const lead = await formLead();
  const booking = await bookingFor(lead.leadId, job);
  const link = await recordLink({ job, bookingId: booking._id, leadId: lead.leadId });
  const requestId = await deleteBooking(String(booking._id));
  const changes = await linkChangesFor(requestId);
  assert.equal(changes.length, 1);
  const field = changes[0]?.fields.find((row) => row.path === "booking_ref");
  assert.ok(field);
  assert.equal(field?.after, undefined);
  assert.equal(changes[0]?.revision_after, Number(changes[0]?.revision_before) + 1);

  const otherJob = nextJob();
  const otherLead = await formLead();
  const otherBooking = await bookingFor(otherLead.leadId, otherJob);
  const otherLink = await recordLink({
    job: otherJob,
    bookingId: otherBooking._id,
    leadId: otherLead.leadId,
  });
  await deleteBookedLead(String(otherBooking._id), false);
  const compatibility = await getEntityChangeModel()
    .find({
      command_name: "deleteBookedLead",
      "entity.model": "GranotRecordLink",
      "entity.id": String(otherLink.linkId),
    })
    .lean()
    .exec();
  assert.equal(compatibility.length, 1);
  assert.equal(compatibility[0]?.provenance.actor.actor_id, BOOKING_LEAD_MIRROR_ACTOR_ID);
  assert.equal(
    compatibility[0]?.fields.find((row) => row.path === "booking_ref")?.after,
    undefined,
  );
});

test("[AC-DLC-03] Booking delete with no active link writes no Record Link change", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = nextJob();
  const lead = await formLead();
  const booking = await bookingFor(lead.leadId, job);
  const requestId = await deleteBooking(String(booking._id));
  assert.equal(await BookedLead.countDocuments({ _id: booking._id }), 0);
  assert.equal((await linkChangesFor(requestId)).length, 0);
  assert.ok(await getFormLeadModel().findById(lead.leadId).lean().exec());
});

test("[AC-DLC-04] an active link for a different Booking stays unchanged", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = nextJob();
  const otherJob = nextJob();
  const lead = await formLead();
  const booking = await bookingFor(lead.leadId, job);
  const other = await bookingFor(lead.leadId, otherJob);
  const link = await recordLink({
    job: otherJob,
    bookingId: other._id,
    leadId: lead.leadId,
    domainRevision: 6,
  });
  const before = await getGranotRecordLinkModel().findById(link.linkId).lean().exec();
  await deleteBooking(String(booking._id));
  const after = await getGranotRecordLinkModel().findById(link.linkId).lean().exec();
  assert.equal(String(after?.booking_ref), String(before?.booking_ref));
  assert.equal(after?.domain_revision, 6);
  assert.equal(after?.state, "active");
});

test("[AC-DLC-05] a superseded link that still stores this Booking id stays unchanged", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = nextJob();
  const lead = await formLead();
  const booking = await bookingFor(lead.leadId, job);
  const link = await recordLink({
    job,
    bookingId: booking._id,
    leadId: lead.leadId,
    state: "superseded",
    domainRevision: 7,
  });
  await deleteBooking(String(booking._id));
  const stored = await getGranotRecordLinkModel().findById(link.linkId).lean().exec();
  assert.equal(stored?.state, "superseded");
  assert.equal(String(stored?.booking_ref), String(booking._id));
  assert.equal(stored?.domain_revision, 7);
});

test("[AC-DLC-06] an open booking case loses deterministic_booking_id and stays open", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = nextJob();
  const lead = await formLead();
  const booking = await bookingFor(lead.leadId, job);
  const link = await recordLink({ job, bookingId: booking._id, leadId: lead.leadId });
  const opened = await bookingCase({
    job,
    bookingId: booking._id,
    linkId: link.linkId,
    state: "open",
    sequence: 1,
    caseRevision: 4,
  });
  await deleteBooking(String(booking._id));
  const stored = await getGranotBookingReconciliationCaseModel().findById(opened.caseId).lean().exec();
  assert.equal(stored?.state, "open");
  assert.equal(stored?.deterministic_booking_id ?? null, null);
  assert.equal(stored?.case_revision, 5);
  assert.equal(String(stored?.record_link_id), String(link.linkId));
  assert.equal(String(stored?.evidence[0]?.observation_id), String(opened.observationId));
});

test("[AC-DLC-07] a resolved booking case keeps its booking history", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = nextJob();
  const lead = await formLead();
  const booking = await bookingFor(lead.leadId, job);
  const resolved = await bookingCase({
    job,
    bookingId: booking._id,
    state: "resolved",
    sequence: 1,
    caseRevision: 2,
  });
  await deleteBooking(String(booking._id));
  const stored = await getGranotBookingReconciliationCaseModel().findById(resolved.caseId).lean().exec();
  assert.equal(stored?.state, "resolved");
  assert.equal(String(stored?.deterministic_booking_id), String(booking._id));
  assert.equal(stored?.resolution?.entity_ref.model, "BookedLead");
  assert.equal(stored?.resolution?.entity_ref.id, String(booking._id));
  assert.equal(stored?.case_revision, 2);
});

test("[AC-DLC-08] Confirm after Booking delete is not rejected for a ghost booking_ref", async (t) => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedConfirm();
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true };
  const owner = {
    actor_type: "owner" as const,
    actor_id: "dlc-owner",
    actor_label: "dlc-owner@example.invalid",
    actor_role: "owner" as const,
    request_id: `dlc-confirm-${fixture.caseId}`,
    origin: "vantage_admin" as const,
  };
  const first = await confirmBooking(
    {
      case_id: String(fixture.caseId),
      expected_case_revision: 1,
      selected_lead: { lead_model: "FormLead", lead_id: String(fixture.leadId) },
      official_booking_details: {
        book_date: "2026-08-20",
        primary_agent_id: String(fixture.agentId),
        total_binder_amount: 125.25,
        deposit_amount: 2500.5,
        merchant_id: String(fixture.merchantId),
      },
      idempotency_key: `dlc-confirm-${fixture.caseId}`,
      owner,
    },
    { flags },
  );
  assert.equal(first.outcome, "booking_created");
  await deleteBooking(first.booking_ref!.id);

  const original = await getGranotBookingReconciliationCaseModel().findById(fixture.caseId).lean().exec();
  const nextCaseId = id();
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: nextCaseId,
    normalized_job_no: fixture.job,
    job_no_snapshot: original!.job_no_snapshot,
    action_kind: "booked",
    sequence_number: 2,
    mode: "create_missing_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    source_scope: original!.source_scope,
    evidence: original!.evidence,
    observed_context: {},
    opened_at: new Date("2026-09-28T15:00:00.000Z"),
    last_evidence_at: new Date("2026-09-28T15:00:00.000Z"),
  });
  const second = await confirmBooking(
    {
      case_id: String(nextCaseId),
      expected_case_revision: 1,
      selected_lead: { lead_model: "FormLead", lead_id: String(fixture.leadId) },
      official_booking_details: {
        book_date: "2026-08-21",
        primary_agent_id: String(fixture.agentId),
        total_binder_amount: 125.25,
        deposit_amount: 100,
        merchant_id: String(fixture.merchantId),
      },
      idempotency_key: `dlc-reconfirm-${nextCaseId}`,
      owner: { ...owner, request_id: `dlc-reconfirm-${nextCaseId}` },
    },
    { flags },
  );
  assert.equal(second.outcome, "booking_created");
  assert.notEqual(second.booking_ref!.id, first.booking_ref!.id);
});

test("[AC-DLC-09] Cancellation delete keeps the Lead and the surviving Booking link", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = nextJob();
  const lead = await formLead();
  const booking = await bookingFor(lead.leadId, job);
  const cancellation = await new CancelledLead({
    booked_lead: booking._id,
    lead_ref: lead.leadId,
    lead_model: "FormLead",
    cancel_date: new Date("2026-09-28T00:00:00.000Z"),
    refund_amount: 10,
    job_no: job.raw,
    domain_revision: 0,
  }).save();
  await BookedLead.updateOne({ _id: booking._id }, { $set: { cancelled: cancellation._id } });
  await getFormLeadModel().collection.updateOne(
    { _id: lead.leadId },
    { $set: { cancelled: cancellation._id, booked: booking._id } },
  );
  const link = await recordLink({
    job,
    bookingId: booking._id,
    leadId: lead.leadId,
    domainRevision: 4,
  });
  await deleteCancelledLead(String(cancellation._id));

  assert.equal(await CancelledLead.countDocuments({ _id: cancellation._id }), 0);
  const survivingBooking = await BookedLead.findById(booking._id).lean().exec();
  assert.ok(survivingBooking);
  assert.equal(survivingBooking?.cancelled ?? null, null);
  const survivingLead = await getFormLeadModel().findById(lead.leadId).lean().exec();
  assert.ok(survivingLead);
  assert.equal(survivingLead?.cancelled ?? null, null);
  assert.equal(String(survivingLead?.booked), String(booking._id));
  const stored = await getGranotRecordLinkModel().findById(link.linkId).lean().exec();
  assert.equal(String(stored?.booking_ref), String(booking._id));
  assert.equal(stored?.domain_revision, 4);
  assert.equal(
    await getEntityChangeModel().countDocuments({
      "entity.model": "GranotRecordLink",
      "entity.id": String(link.linkId),
    }),
    0,
  );
});

test("[AC-DLC-10] cascade Booking delete removes the Cancellation and still releases the link", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = nextJob();
  const lead = await formLead();
  const booking = await bookingFor(lead.leadId, job, {});
  const cancellation = await new CancelledLead({
    booked_lead: booking._id,
    lead_ref: lead.leadId,
    lead_model: "FormLead",
    cancel_date: new Date("2026-09-28T00:00:00.000Z"),
    refund_amount: 10,
    job_no: job.raw,
    domain_revision: 0,
  }).save();
  await BookedLead.updateOne({ _id: booking._id }, { $set: { cancelled: cancellation._id } });
  const link = await recordLink({
    job,
    bookingId: booking._id,
    leadId: lead.leadId,
    domainRevision: 2,
  });
  await deleteBooking(String(booking._id), true);

  assert.equal(await CancelledLead.countDocuments({ _id: cancellation._id }), 0);
  assert.equal(await BookedLead.countDocuments({ _id: booking._id }), 0);
  const surviving = await getFormLeadModel().findById(lead.leadId).lean().exec();
  assert.ok(surviving);
  assert.equal(surviving?.booked ?? null, null);
  const stored = await getGranotRecordLinkModel().findById(link.linkId).lean().exec();
  assert.equal(stored?.state, "active");
  assert.equal(String(stored?.lead_ref?.id), String(lead.leadId));
  assert.equal(stored?.booking_ref ?? null, null);
  assert.equal(stored?.domain_revision, 3);
});

async function seedConfirm() {
  const receiptId = id();
  const observationId = id();
  const decisionId = id();
  const caseId = id();
  const companyId = id();
  const granularityId = id();
  const sourceId = id();
  const agentId = id();
  const merchantId = id();
  const lead = await formLead({
    lead_source_company: companyId,
    source_granularity_id: granularityId,
    source_company: "dlc-original-source",
    cpl: 17,
  });
  const jobRaw = `${jobPrefix}-${String(caseId).slice(-6).toUpperCase()}`;
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
    company_slug: `dlc-${String(companyId).slice(-8)}`,
    name: "DLC Synthetic Source",
    owner_label: "DLC Synthetic Source",
    active: true,
    granularities: [],
    created_from: "dlc-test",
  });
  await getLeadSourceGranularityModel().collection.insertOne({
    _id: granularityId,
    source_company: companyId,
    granularity_key: `dlc-form-${String(granularityId).slice(-6)}`,
    channel: "form",
    owner_label: "DLC Synthetic Form",
    crm_label: "DLC Synthetic Form",
    active: true,
    cpl: 17,
    created_from: "dlc-test",
  });
  await getGranotCrmSourceModel().collection.insertOne({
    _id: sourceId,
    source: "DLC Synthetic CRM",
    crm_origin: `dlc-${String(sourceId)}`,
    workspace_slug: `dlc-${String(sourceId)}`,
    normalized_granot_label: `dlc-synthetic-${String(sourceId).slice(-6)}`,
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lead_source_company: companyId,
    lifecycle_routes: [],
    lifecycle_policy_version: "dlc-test",
  });
  await Agent.collection.insertOne({
    _id: agentId,
    name: "DLC Synthetic Agent",
    normalized_name: `dlc-agent-${String(agentId)}`,
    active: true,
    role: "agent",
    created_from: "dlc-test",
  });
  await Merchant.collection.insertOne({
    _id: merchantId,
    name: "DLC Synthetic Merchant",
    normalized_name: `dlc-merchant-${String(merchantId)}`,
    active: true,
    created_from: "dlc-test",
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
  return { caseId, leadId: lead.leadId, agentId, merchantId, job };
}
