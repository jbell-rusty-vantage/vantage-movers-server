import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose, { type ClientSession } from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import {
  GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES,
  getGranotBookingReconciliationCaseModel,
} from "../../models/GranotBookingReconciliationCase";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import {
  createGranotBookingReconciliation,
  createMongoBookingReconciliationStore,
  type BookingReconciliationCurrentContext,
  type BookingReconciliationPersistenceStore,
  type PreparedBookingReconciliationDecision,
} from "./bookingReconciliation";

const ids = new Set<string>();
const jobs = new Set<string>();

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
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
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  for (const index of GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES) {
    await getGranotBookingReconciliationCaseModel().collection.createIndex(index.key, {
      name: index.name,
      ...("unique" in index ? { unique: true } : {}),
      ...("partialFilterExpression" in index
        ? { partialFilterExpression: index.partialFilterExpression }
        : {}),
    });
  }
  return true;
}

after(async () => {
  if (mongoose.connection.readyState === 1) {
    await getGranotBookingReconciliationCaseModel().deleteMany({ normalized_job_no: { $in: [...jobs] } });
    const objectIds = [...ids].map((id) => new mongoose.Types.ObjectId(id));
    await getSynchronizationDecisionModel().collection.deleteMany({ observation_id: { $in: objectIds } });
    await getGranotObservationModel().collection.deleteMany({ _id: { $in: objectIds } });
    await getGranotObservationReceiptModel().collection.deleteMany({ _id: { $in: objectIds } });
  }
  await mongoose.disconnect().catch(() => undefined);
});

function prepared(
  observationId: mongoose.Types.ObjectId,
  receiptId: mongoose.Types.ObjectId,
  decidedAt: Date,
  sourceId?: mongoose.Types.ObjectId,
): PreparedBookingReconciliationDecision {
  return {
    receipt_id: receiptId,
    observation_id: observationId,
    attempt: 1,
    execution_mode: "live",
    outcome: "already_current",
    reason_code: "desired_state_already_current",
    ...(sourceId ? {
      source_policy: {
        granot_crm_source_id: sourceId,
        disposition: "referral_booking",
        policy_version: "unit28-referral-v1",
      },
    } : {}),
    candidates: [],
    evaluated_gates: [{ gate: "global_effect_flag", allowed: true }],
    effects: [],
    decided_at: decidedAt,
  };
}

async function seedEvidence(
  job: string,
  capturedAt: Date,
  suggestedLeadId?: mongoose.Types.ObjectId,
  referral = false,
): Promise<{
  observationId: mongoose.Types.ObjectId;
  receiptId: mongoose.Types.ObjectId;
  decisionId: mongoose.Types.ObjectId;
  sourceId?: mongoose.Types.ObjectId;
}> {
  jobs.add(job);
  const observationId = new mongoose.Types.ObjectId();
  const receiptId = new mongoose.Types.ObjectId();
  const decisionId = new mongoose.Types.ObjectId();
  const sourceId = referral ? new mongoose.Types.ObjectId() : undefined;
  ids.add(String(observationId));
  ids.add(String(receiptId));
  await getGranotObservationReceiptModel().collection.insertOne({
    _id: receiptId,
    observation_channel: "webhook",
    captured_at: capturedAt,
    processing: { match_attempt: 1 },
  });
  await getGranotObservationModel().collection.insertOne({
    _id: observationId,
    receipt_id: receiptId,
    captured_at: capturedAt,
    identity: { normalized_job_no: job, job_no_raw: job },
    priority: { valid: false },
    booking_action: { normalized: "booked" },
    synthetic_lead_id: suggestedLeadId,
    synthetic_referral: referral,
    synthetic_source_id: sourceId,
  });
  return { observationId, receiptId, decisionId, sourceId };
}

function replicaStore(): BookingReconciliationPersistenceStore {
  const base = createMongoBookingReconciliationStore();
  return {
    ...base,
    async loadCurrentContext(observationId: string, session: ClientSession) {
      const row = await getGranotObservationModel().collection.findOne(
        { _id: new mongoose.Types.ObjectId(observationId) },
        { session },
      );
      if (!row) throw new Error("Synthetic replica Observation not found");
      const context: BookingReconciliationCurrentContext = {
        observation_id: String(row._id),
        receipt_id: String(row.receipt_id),
        captured_at: new Date(row.captured_at as Date),
        normalized_job_no: String(row.identity.normalized_job_no),
        job_no_snapshot: String(row.identity.job_no_raw),
        priority: { valid: false },
        booking_action: "booked",
        lifecycle_disposition: row.synthetic_referral ? "referral_booking" : "source_scoped_lead",
        reviewed_source_policy: row.synthetic_referral
          ? {
              granot_crm_source_id: String(row.synthetic_source_id),
              disposition: "referral_booking",
              policy_version: "unit28-referral-v1",
            }
          : undefined,
        identity: row.synthetic_lead_id
          ? {
              outcome: "linked",
              reason_code: "record_link_confirmed",
              match_method: "form_ref_no_exact",
              target: { model: "FormLead", id: String(row.synthetic_lead_id) },
              candidates: [{
                target: { model: "FormLead", id: String(row.synthetic_lead_id) },
                reason_codes: ["form_ref_no_exact"],
              }],
              target_eligibility: "full",
            }
          : {
              outcome: "ambiguous",
              reason_code: "multiple_eligible_matches",
              candidates: [],
            },
      };
      return context;
    },
  };
}

async function reconcile(
  evidence: Awaited<ReturnType<typeof seedEvidence>>,
  store = replicaStore(),
) {
  return createGranotBookingReconciliation({
    prepared: prepared(evidence.observationId, evidence.receiptId, new Date(), evidence.sourceId),
    store,
  }).reconcileObservation({
    observation_id: String(evidence.observationId),
    decision_id: String(evidence.decisionId),
  });
}

test("[AC-28][AC-32] replica simultaneous Referral evidence opens one lead-free case and preserves Decision source policy", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = `U28-REFERRAL-RACE-${Date.now().toString(36).toUpperCase()}`;
  const first = await seedEvidence(job, new Date("2026-08-19T15:00:00.000Z"), undefined, true);
  const second = await seedEvidence(job, new Date("2026-08-19T15:01:00.000Z"), undefined, true);
  const results = await Promise.all([reconcile(first), reconcile(second)]);
  assert.equal(results.filter((row) => row.kind === "opened").length, 1);
  assert.equal(results.filter((row) => row.kind === "refreshed").length, 1);
  const row = await getGranotBookingReconciliationCaseModel().findOne({ normalized_job_no: job }).lean();
  assert.equal(row?.mode, "create_referral_booking");
  assert.equal(row?.source_scope, undefined);
  assert.equal(row?.suggested_lead, undefined);
  assert.equal(row?.evidence.length, 2);
  const decisions = await getSynchronizationDecisionModel().find({
    observation_id: { $in: [first.observationId, second.observationId] },
  }).lean();
  assert.deepEqual(
    decisions.map((decision) => decision.source_policy?.disposition),
    ["referral_booking", "referral_booking"],
  );
});

test("[AC-18][AC-20][AC-32][AC-36] replica races converge, replay dedupes, and resolved rows advance max+1", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = `U22-RACE-${Date.now().toString(36).toUpperCase()}`;
  const first = await seedEvidence(job, new Date("2026-08-18T12:00:00.000Z"));
  const second = await seedEvidence(job, new Date("2026-08-18T12:01:00.000Z"));
  const results = await Promise.all([reconcile(first), reconcile(second)]);
  assert.equal(results.filter((row) => row.kind === "opened").length, 1);
  assert.equal(results.filter((row) => row.kind === "refreshed").length, 1);

  const Case = getGranotBookingReconciliationCaseModel();
  let rows = await Case.find({ normalized_job_no: job }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.evidence.length, 2);
  assert.equal(rows[0]!.evidence_revision, 2);
  assert.equal(rows[0]!.case_revision, 1);
  assert.equal(await getSynchronizationDecisionModel().countDocuments({ observation_id: { $in: [first.observationId, second.observationId] } }), 2);

  const replay = await reconcile(first);
  assert.equal(replay.kind, "refreshed");
  rows = await Case.find({ normalized_job_no: job }).lean();
  assert.equal(rows[0]!.evidence.length, 2);
  assert.equal(rows[0]!.evidence_revision, 2);

  const resolutionId = new mongoose.Types.ObjectId();
  const resolved = await Case.updateOne(
    { _id: rows[0]!._id, state: "open" },
    {
      $set: {
        state: "resolved",
        resolved_at: new Date(),
        resolution: {
          outcome: "no_action",
          command_execution_id: resolutionId,
          actor: {
            actor_type: "system",
            actor_id: "unit-22-replica",
            actor_label: "Unit 22 replica",
            actor_role: "system",
            request_id: String(resolutionId),
            origin: "granot_lifecycle",
          },
          reason_code: "duplicate_granot_action",
          resolved_at: new Date(),
        },
      },
      $inc: { case_revision: 1 },
    },
    { runValidators: true },
  );
  assert.equal(resolved.modifiedCount, 1);

  const third = await seedEvidence(job, new Date("2026-08-18T12:02:00.000Z"));
  const fourth = await seedEvidence(job, new Date("2026-08-18T12:03:00.000Z"));
  await Promise.all([reconcile(third), reconcile(fourth)]);
  rows = await Case.find({ normalized_job_no: job }).sort({ sequence_number: 1 }).lean();
  assert.deepEqual(rows.map((row) => row.sequence_number), [1, 2]);
  assert.deepEqual(rows.map((row) => row.state), ["resolved", "open"]);
  assert.equal(rows[1]!.evidence.length, 2);
});

test("[AC-20] replica candidate refresh splits owner and evidence revisions", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = `U22-REVISION-${Date.now().toString(36).toUpperCase()}`;
  const firstLead = new mongoose.Types.ObjectId();
  const secondLead = new mongoose.Types.ObjectId();
  const first = await seedEvidence(job, new Date("2026-08-18T14:00:00.000Z"), firstLead);
  await reconcile(first);
  const second = await seedEvidence(job, new Date("2026-08-18T14:01:00.000Z"), secondLead);
  await reconcile(second);
  let row = await getGranotBookingReconciliationCaseModel().findOne({ normalized_job_no: job }).lean();
  assert.equal(row?.case_revision, 2);
  assert.equal(row?.evidence_revision, 2);
  assert.equal(String(row?.suggested_lead?.lead_ref.id), String(secondLead));

  const third = await seedEvidence(job, new Date("2026-08-18T14:02:00.000Z"), secondLead);
  await reconcile(third);
  row = await getGranotBookingReconciliationCaseModel().findOne({ normalized_job_no: job }).lean();
  assert.equal(row?.case_revision, 2);
  assert.equal(row?.evidence_revision, 3);
});

test("[AC-20][AC-32] replica transaction rolls back case create, refresh, and Decision failures", async (t) => {
  if (!(await replicaReady(t))) return;
  const Case = getGranotBookingReconciliationCaseModel();
  const createJob = `U22-ROLLBACK-CREATE-${Date.now().toString(36).toUpperCase()}`;
  const createEvidence = await seedEvidence(createJob, new Date());
  const createStore = replicaStore();
  createStore.insertDecision = async () => { throw new Error("injected decision failure"); };
  await assert.rejects(reconcile(createEvidence, createStore), /injected decision failure/);
  assert.equal(await Case.countDocuments({ normalized_job_no: createJob }), 0);
  assert.equal(await getSynchronizationDecisionModel().countDocuments({ observation_id: createEvidence.observationId }), 0);

  const refreshJob = `U22-ROLLBACK-REFRESH-${Date.now().toString(36).toUpperCase()}`;
  const first = await seedEvidence(refreshJob, new Date("2026-08-18T13:00:00.000Z"));
  await reconcile(first);
  const second = await seedEvidence(refreshJob, new Date("2026-08-18T13:01:00.000Z"));
  const refreshStore = replicaStore();
  refreshStore.insertDecision = async () => { throw new Error("injected refresh decision failure"); };
  await assert.rejects(reconcile(second, refreshStore), /injected refresh decision failure/);
  const row = await Case.findOne({ normalized_job_no: refreshJob }).lean();
  assert.equal(row?.evidence.length, 1);
  assert.equal(row?.evidence_revision, 1);
  assert.equal(await getSynchronizationDecisionModel().countDocuments({ observation_id: second.observationId }), 0);
});
