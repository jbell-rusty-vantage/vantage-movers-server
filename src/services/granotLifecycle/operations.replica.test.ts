import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getOperationalEventModel } from "../../models/OperationalEvent";
import { getOperationalIncidentModel } from "../../models/OperationalIncident";
import { projectGranotLifecycleHealth } from "./projections";

const seededIds = new Map<string, mongoose.Types.ObjectId[]>();

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
  return true;
}

function remember(collection: string, id: mongoose.Types.ObjectId): void {
  seededIds.set(collection, [...(seededIds.get(collection) ?? []), id]);
}

async function insert(collection: string, document: Record<string, unknown>): Promise<void> {
  const id = document._id;
  assert.ok(id instanceof mongoose.Types.ObjectId);
  remember(collection, id);
  await mongoose.connection.db!.collection(collection).insertOne(document);
}

after(async () => {
  if (mongoose.connection.readyState === 1) {
    for (const [collection, ids] of seededIds) {
      await mongoose.connection.db!.collection(collection).deleteMany({ _id: { $in: ids } });
    }
  }
  await mongoose.disconnect().catch(() => undefined);
});

test("[AC-31][AC-35][AC-37][AC-38] replica health counts come from Mongo and do not mutate official facts", async (t) => {
  if (!(await replicaReady(t))) return;

  const now = new Date("2026-08-19T16:00:00.000Z");
  const before = await projectGranotLifecycleHealth(now);
  const suffix = Date.now().toString().slice(-8);
  const pendingId = new mongoose.Types.ObjectId();
  const claimedLiveId = new mongoose.Types.ObjectId();
  const claimedExpiredId = new mongoose.Types.ObjectId();
  const deadLetterId = new mongoose.Types.ObjectId();
  const bookingCaseId = new mongoose.Types.ObjectId();
  const releaseCaseId = new mongoose.Types.ObjectId();
  const discrepancyId = new mongoose.Types.ObjectId();
  const conflictEventId = new mongoose.Types.ObjectId();
  const sourceId = new mongoose.Types.ObjectId();
  const granularityId = new mongoose.Types.ObjectId();

  const receipt = (
    id: mongoose.Types.ObjectId,
    processing: Record<string, unknown>,
  ): Record<string, unknown> => ({
    _id: id,
    source_system: "granot",
    observation_channel: "granot_webhook",
    captured_at: now,
    authentication_method: "shared_secret",
    evidence_version: 2,
    payload_kind: "object",
    headers: {},
    payload: { synthetic: true },
    payload_sha256: "a".repeat(64),
    processing,
    provider: "granot",
    schema_version: 2,
    createdAt: now,
    updatedAt: now,
  });

  await insert("granot_webhook_receipts", receipt(pendingId, {
    state: "pending",
    technical_attempts: 0,
    match_attempt: 0,
    next_attempt_at: new Date(now.getTime() - 60_000),
    manual_requeue_count: 0,
  }));
  await insert("granot_webhook_receipts", receipt(claimedLiveId, {
    state: "claimed",
    technical_attempts: 0,
    match_attempt: 0,
    next_attempt_at: new Date(now.getTime() - 60_000),
    leased_until: new Date(now.getTime() + 60_000),
    lease_owner: "queue:unit30",
    manual_requeue_count: 0,
  }));
  await insert("granot_webhook_receipts", receipt(claimedExpiredId, {
    state: "claimed",
    technical_attempts: 1,
    match_attempt: 0,
    next_attempt_at: new Date(now.getTime() - 60_000),
    leased_until: new Date(now.getTime() - 1_000),
    lease_owner: "queue:unit30",
    manual_requeue_count: 0,
  }));
  await insert("granot_webhook_receipts", receipt(deadLetterId, {
    state: "dead_letter",
    technical_attempts: 8,
    match_attempt: 0,
    next_attempt_at: now,
    last_error: { code: "dependency_failure", message: "synthetic", failed_at: now },
    manual_requeue_count: 0,
  }));
  await insert("granot_booking_reconciliation_cases", {
    _id: bookingCaseId,
    normalized_job_no: `UNIT30 ${suffix}`,
    job_no_snapshot: `unit30-${suffix}`,
    action_kind: "booked",
    sequence_number: 1,
    mode: "create_missing_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    source_scope: {
      granot_crm_source_id: sourceId,
      lead_source_company: sourceId,
      source_granularity_id: granularityId,
    },
    evidence: [],
    opened_at: now,
    last_evidence_at: now,
  });
  await insert("granot_release_reconciliation_cases", {
    _id: releaseCaseId,
    normalized_job_no: `UNIT30 ${suffix}`,
    job_no_snapshot: `unit30-${suffix}`,
    action_kind: "release",
    sequence_number: 1,
    mode: "release",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    source_scope: {
      granot_crm_source_id: sourceId,
      lead_source_company: sourceId,
      source_granularity_id: granularityId,
    },
    evidence: [],
    opened_at: now,
    last_evidence_at: now,
  });
  await insert("granot_booking_discrepancies", {
    _id: discrepancyId,
    normalized_job_no: `UNIT30 ${suffix}`,
    discrepancy_kind: "booking",
    reason_code: "booked_record_link_conflict",
    reason_fingerprint: "b".repeat(64),
    state: "open",
    evidence: [],
    evidence_revision: 1,
    revision: 1,
    opened_at: now,
    last_evidence_at: now,
  });
  const Event = getOperationalEventModel();
  remember(Event.collection.collectionName, conflictEventId);
  await Event.collection.insertOne({
    _id: conflictEventId,
    event_key: "granot_lifecycle.owner_command.conflict",
    occurred_at: now,
    received_at: now,
    details: { code: "DOMAIN_REVISION_CONFLICT" },
    level: "warn",
    category: "admin",
    workflow: "granot_lifecycle",
    summary: "synthetic conflict",
    fingerprint: `unit30-conflict-${conflictEventId.toHexString()}`,
    environment: "test",
    service: "vantage-main-server",
    pii_policy: "none",
    notification_candidate: false,
    reportable: true,
  });

  const bookedBefore = await mongoose.connection.db!.collection("booked_leads").countDocuments();
  const cancelledBefore = await mongoose.connection.db!.collection("cancelled_leads").countDocuments();
  const health = await projectGranotLifecycleHealth(now);
  const beforeBooking = before.open_cases.find((row) => row.kind === "booking" && row.mode === "create_missing_booking")?.count ?? 0;
  const beforeRelease = before.open_cases.find((row) => row.kind === "release")?.count ?? 0;
  const beforeDiscrepancy = before.open_discrepancies.find((row) => row.reason_code === "booked_record_link_conflict")?.count ?? 0;
  const beforeConflict = before.command_conflicts_last_24h.find((row) => row.code === "DOMAIN_REVISION_CONFLICT")?.count ?? 0;

  assert.equal(health.receipts.due_count, before.receipts.due_count + 2);
  assert.equal(health.receipts.claimed_count, before.receipts.claimed_count + 2);
  assert.equal(health.receipts.expired_claim_count, before.receipts.expired_claim_count + 1);
  assert.equal(health.receipts.dead_letter_count, before.receipts.dead_letter_count + 1);
  assert.equal(
    health.open_cases.find((row) => row.kind === "booking" && row.mode === "create_missing_booking")?.count ?? 0,
    beforeBooking + 1,
  );
  assert.equal(health.open_cases.find((row) => row.kind === "release")?.count ?? 0, beforeRelease + 1);
  assert.equal(
    health.open_discrepancies.find((row) => row.reason_code === "booked_record_link_conflict")?.count ?? 0,
    beforeDiscrepancy + 1,
  );
  assert.equal(
    health.command_conflicts_last_24h.find((row) => row.code === "DOMAIN_REVISION_CONFLICT")?.count ?? 0,
    beforeConflict + 1,
  );
  assert.equal(health.flags.GRANOT_LIFECYCLE_SHADOW_MODE, true);
  assert.equal(health.flags.GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED, false);
  assert.equal(health.alerts.find((alert) => alert.code === "dead_letter_present")?.state, "firing");
  assert.ok(health.alerts.some((alert) => alert.code === "capture_to_decision_p95"));
  assert.ok(health.alerts.some((alert) => alert.code === "source_ambiguity_policy_blocked_rate"));
  assert.equal(JSON.stringify(health).includes("payload"), false);
  assert.equal(await mongoose.connection.db!.collection("booked_leads").countDocuments(), bookedBefore);
  assert.equal(await mongoose.connection.db!.collection("cancelled_leads").countDocuments(), cancelledBefore);
  await getOperationalEventModel().deleteMany({
    event_key: { $in: ["granot_lifecycle.alert.firing", "granot_lifecycle.alert.recovered"] },
    occurred_at: { $gte: now },
  });
  await getOperationalIncidentModel().deleteMany({
    dedupe_key: { $regex: /^granot_lifecycle\.alert\./ },
  });
});
