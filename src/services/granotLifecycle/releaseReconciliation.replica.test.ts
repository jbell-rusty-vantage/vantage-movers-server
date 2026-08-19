import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose, { type ClientSession } from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import {
  GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES,
  getGranotReleaseReconciliationCaseModel,
} from "../../models/GranotReleaseReconciliationCase";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import {
  createGranotReleaseReconciliation,
  createMongoReleaseReconciliationStore,
  type PreparedReleaseReconciliationDecision,
  type ReleaseReconciliationCurrentContext,
  type ReleaseReconciliationPersistenceStore,
} from "./releaseReconciliation";
import {
  getGranotLifecycleCaseDetail,
  listGranotLifecycleCaseCandidates,
  listGranotLifecycleCases,
  projectGranotJob,
} from "./projections";

const jobs = new Set<string>();
const evidenceIds = new Set<string>();

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
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
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  for (const index of GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES) {
    await getGranotReleaseReconciliationCaseModel().collection.createIndex(index.key, {
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
    await getGranotReleaseReconciliationCaseModel().deleteMany({ normalized_job_no: { $in: [...jobs] } });
    await getGranotBookingReconciliationCaseModel().deleteMany({ normalized_job_no: { $in: [...jobs] } });
    const ids = [...evidenceIds].map((id) => new mongoose.Types.ObjectId(id));
    await getSynchronizationDecisionModel().collection.deleteMany({ observation_id: { $in: ids } });
    await getGranotObservationModel().collection.deleteMany({ _id: { $in: ids } });
    await getGranotObservationReceiptModel().collection.deleteMany({ _id: { $in: ids } });
  }
  await mongoose.disconnect().catch(() => undefined);
});

function prepared(observationId: mongoose.Types.ObjectId, receiptId: mongoose.Types.ObjectId): PreparedReleaseReconciliationDecision {
  return {
    receipt_id: receiptId,
    observation_id: observationId,
    attempt: 1,
    execution_mode: "live",
    outcome: "already_current",
    reason_code: "desired_state_already_current",
    candidates: [],
    evaluated_gates: [{ gate: "global_effect_flag", allowed: true }],
    effects: [],
    decided_at: new Date(),
  };
}

async function seedEvidence(job: string, capturedAt: Date): Promise<{
  observationId: mongoose.Types.ObjectId;
  receiptId: mongoose.Types.ObjectId;
  decisionId: mongoose.Types.ObjectId;
}> {
  jobs.add(job);
  const observationId = new mongoose.Types.ObjectId();
  const receiptId = new mongoose.Types.ObjectId();
  evidenceIds.add(String(observationId));
  evidenceIds.add(String(receiptId));
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
    booking_action: { normalized: "release" },
  });
  return { observationId, receiptId, decisionId: new mongoose.Types.ObjectId() };
}

function replicaStore(bookingId: mongoose.Types.ObjectId, bookingRevision: () => number): ReleaseReconciliationPersistenceStore {
  const base = createMongoReleaseReconciliationStore();
  return {
    ...base,
    async loadCurrentContext(observationId: string, session: ClientSession) {
      const row = await getGranotObservationModel().collection.findOne(
        { _id: new mongoose.Types.ObjectId(observationId) },
        { session },
      );
      if (!row) throw new Error("Synthetic Release replica Observation not found");
      const context: ReleaseReconciliationCurrentContext = {
        observation_id: String(row._id),
        receipt_id: String(row.receipt_id),
        captured_at: new Date(row.captured_at as Date),
        normalized_job_no: String(row.identity.normalized_job_no),
        job_no_snapshot: String(row.identity.job_no_raw),
        booking_action: "release",
        identity: {
          outcome: "linked",
          reason_code: "record_link_confirmed",
          match_method: "form_ref_no_exact",
          target: { model: "FormLead", id: String(new mongoose.Types.ObjectId()) },
          candidates: [],
          target_eligibility: "full",
        },
        booking: {
          id: String(bookingId),
          domain_revision: bookingRevision(),
          has_lead: false,
          officially_cancelled: false,
        },
      };
      return context;
    },
  };
}

async function reconcile(
  evidence: Awaited<ReturnType<typeof seedEvidence>>,
  store: ReleaseReconciliationPersistenceStore,
) {
  return createGranotReleaseReconciliation({
    prepared: prepared(evidence.observationId, evidence.receiptId),
    store,
  }).reconcileObservation({
    observation_id: String(evidence.observationId),
    decision_id: String(evidence.decisionId),
  });
}

test("[AC-25][AC-32][AC-36] Release races converge, replay dedupes, and resolved rows advance max+1", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = `U26-RACE-${Date.now().toString(36).toUpperCase()}`;
  const bookingId = new mongoose.Types.ObjectId();
  const store = replicaStore(bookingId, () => 7);
  const first = await seedEvidence(job, new Date("2026-08-19T12:00:00.000Z"));
  const second = await seedEvidence(job, new Date("2026-08-19T12:01:00.000Z"));
  const results = await Promise.all([reconcile(first, store), reconcile(second, store)]);
  assert.equal(results.filter((row) => row.kind === "opened").length, 1);
  assert.equal(results.filter((row) => row.kind === "refreshed").length, 1);

  const Case = getGranotReleaseReconciliationCaseModel();
  let rows = await Case.find({ normalized_job_no: job }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.evidence.length, 2);
  assert.equal(rows[0]!.evidence_revision, 2);
  assert.equal(rows[0]!.case_revision, 1);
  assert.equal(String(rows[0]!.deterministic_booking_id), String(bookingId));
  assert.equal(rows[0]!.booking_revision_at_open, 7);

  await reconcile(first, store);
  rows = await Case.find({ normalized_job_no: job }).lean();
  assert.equal(rows[0]!.evidence.length, 2);
  assert.equal(rows[0]!.evidence_revision, 2);

  const resolutionId = new mongoose.Types.ObjectId();
  const resolvedAt = new Date();
  const resolved = await Case.updateOne(
    { _id: rows[0]!._id, state: "open" },
    {
      $set: {
        state: "resolved",
        resolved_at: resolvedAt,
        resolution: {
          outcome: "no_action",
          command_execution_id: resolutionId,
          actor: {
            actor_type: "system",
            actor_id: "unit-26-replica",
            actor_label: "Unit 26 replica",
            actor_role: "system",
            request_id: String(resolutionId),
            origin: "granot_lifecycle",
          },
          reason_code: "duplicate_granot_action",
          resolved_at: resolvedAt,
        },
      },
      $inc: { case_revision: 1 },
    },
    { runValidators: true },
  );
  assert.equal(resolved.modifiedCount, 1);
  const third = await seedEvidence(job, new Date("2026-08-19T12:02:00.000Z"));
  await reconcile(third, store);
  rows = await Case.find({ normalized_job_no: job }).sort({ sequence_number: 1 }).lean();
  assert.deepEqual(rows.map((row) => row.sequence_number), [1, 2]);
});

test("[AC-25][AC-31][AC-32] refresh splits revisions and Decision failure rolls back create and refresh", async (t) => {
  if (!(await replicaReady(t))) return;
  const bookingId = new mongoose.Types.ObjectId();
  let revision = 1;
  const store = replicaStore(bookingId, () => revision);
  const job = `U26-REV-${Date.now().toString(36).toUpperCase()}`;
  const first = await seedEvidence(job, new Date("2026-08-19T13:00:00.000Z"));
  await reconcile(first, store);
  revision = 2;
  const second = await seedEvidence(job, new Date("2026-08-19T13:01:00.000Z"));
  await reconcile(second, store);
  let row = await getGranotReleaseReconciliationCaseModel().findOne({ normalized_job_no: job }).lean();
  assert.equal(row?.booking_revision_at_open, 1);
  assert.equal(row?.case_revision, 2);
  assert.equal(row?.evidence_revision, 2);

  const createJob = `U26-ROLLBACK-CREATE-${Date.now().toString(36).toUpperCase()}`;
  const createEvidence = await seedEvidence(createJob, new Date());
  const createStore = replicaStore(new mongoose.Types.ObjectId(), () => 1);
  createStore.insertDecision = async () => { throw new Error("injected Release decision failure"); };
  await assert.rejects(reconcile(createEvidence, createStore), /injected Release decision failure/);
  assert.equal(await getGranotReleaseReconciliationCaseModel().countDocuments({ normalized_job_no: createJob }), 0);

  const third = await seedEvidence(job, new Date("2026-08-19T13:02:00.000Z"));
  const refreshStore = replicaStore(bookingId, () => revision);
  refreshStore.insertDecision = async () => { throw new Error("injected Release refresh failure"); };
  await assert.rejects(reconcile(third, refreshStore), /injected Release refresh failure/);
  row = await getGranotReleaseReconciliationCaseModel().findOne({ normalized_job_no: job }).lean();
  assert.equal(row?.evidence.length, 2);
  assert.equal(row?.evidence_revision, 2);
});

test("[AC-25][AC-29][AC-40] Booking and Release cases coexist without forbidden side effects", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = `926${Date.now().toString().slice(-8)}`;
  jobs.add(job);
  const bookingId = new mongoose.Types.ObjectId();
  const now = new Date();
  await getGranotBookingReconciliationCaseModel().collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    normalized_job_no: job,
    job_no_snapshot: job,
    action_kind: "booked",
    sequence_number: 1,
    mode: "review_existing_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    evidence: [{ observation_id: new mongoose.Types.ObjectId(), decision_id: new mongoose.Types.ObjectId(), captured_at: now, action: "booked" }],
    observed_context: {},
    deterministic_booking_id: bookingId,
    opened_at: now,
    last_evidence_at: now,
  });
  const forbidden = ["booked_leads", "cancelled_leads", "granot_record_links", "domain_command_executions", "entity_changes", "sheet_sync_jobs", "notifications"];
  const before = Object.fromEntries(await Promise.all(forbidden.map(async (name) => [name, await mongoose.connection.db!.collection(name).countDocuments()])));
  const evidence = await seedEvidence(job, now);
  await reconcile(evidence, replicaStore(bookingId, () => 4));
  assert.equal(await getGranotBookingReconciliationCaseModel().countDocuments({ normalized_job_no: job }), 1);
  assert.equal(await getGranotReleaseReconciliationCaseModel().countDocuments({ normalized_job_no: job }), 1);
  const mixedQueue = await listGranotLifecycleCases({
    normalized_job_no: job,
    sort: "last_evidence_at",
    order: "desc",
    limit: 25,
  });
  assert.deepEqual(new Set(mixedQueue.items.map((item) => item.kind)), new Set(["booking", "release"]));
  const firstPage = await listGranotLifecycleCases({
    normalized_job_no: job,
    sort: "last_evidence_at",
    order: "desc",
    limit: 1,
  });
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.next_cursor);
  const secondPage = await listGranotLifecycleCases({
    normalized_job_no: job,
    sort: "last_evidence_at",
    order: "desc",
    cursor: firstPage.next_cursor ?? undefined,
    limit: 1,
  });
  assert.equal(secondPage.items.length, 1);
  assert.notEqual(firstPage.items[0]!.case_id, secondPage.items[0]!.case_id);
  const releaseOnly = await listGranotLifecycleCases({
    kind: "release",
    normalized_job_no: job,
    sort: "last_evidence_at",
    order: "desc",
    limit: 25,
  });
  assert.equal(releaseOnly.items.length, 1);
  assert.equal(releaseOnly.items[0]!.mode, "release");
  const releaseId = releaseOnly.items[0]!.case_id;
  const detail = await getGranotLifecycleCaseDetail(releaseId);
  assert.equal(detail?.kind, "release");
  assert.equal(detail?.mode, "release");
  assert.equal(detail?.candidate_search.available, false);
  assert.equal(detail?.capabilities.commands, false);
  assert.equal(await listGranotLifecycleCaseCandidates(releaseId, { scope: "source", limit: 25 }), null);
  const timeline = await projectGranotJob(job, { limit: 100 });
  assert.ok(timeline.items.some((item) => item.type === "case" && item.data.kind === "booking"));
  assert.ok(timeline.items.some((item) => item.type === "case" && item.data.kind === "release"));
  assert.equal(timeline.capabilities.release_cases, true);
  const afterCounts = Object.fromEntries(await Promise.all(forbidden.map(async (name) => [name, await mongoose.connection.db!.collection(name).countDocuments()])));
  assert.deepEqual(afterCounts, before);
});
