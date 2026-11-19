import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getGranotLifecycleHealthStateModel } from "../../models/GranotLifecycleHealthState";
import { persistGranotLifecycleAlertTransitions, type GranotLifecycleAlertProjection } from "./alerts";
import {
  incrementGranotLifecycleHealthCounter,
  readGranotLifecycleHealthCounters,
  resetGranotLifecycleHealthStateMissedWrite,
} from "./healthState";
import { emitGranotLifecycleEvent } from "./observability";
import { captureGranotLifecycleLogs } from "./testLifecycleLogCapture";

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

after(async () => {
  if (mongoose.connection.readyState === 1) {
    await getGranotLifecycleHealthStateModel().deleteMany({});
  }
  await mongoose.disconnect().catch(() => undefined);
});

test("[SLIM-04] a capture failure while Mongo is down is logged, then fences the window as a gap", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return;
  }
  resetGranotLifecycleHealthStateMissedWrite();
  if (mongoose.connection.readyState === 1) {
    t.skip("This proof must run before the suite connects to Mongo.");
    return;
  }
  const missedAt = Date.now();
  const logs = captureGranotLifecycleLogs();
  await emitGranotLifecycleEvent({
    level: "error",
    eventKey: "granot_lifecycle.capture.failed",
    category: "mongo",
    summary: "Granot webhook receipt could not be stored.",
    details: { channel: "granot_webhook", event_class: "lead_created" },
    statusCode: 503,
  });
  logs.restore();
  assert.equal(logs.find("granot_lifecycle.health_state.write_missed")?.record.reason, "mongo_unavailable");
  if (!(await replicaReady(t))) return;
  const HealthState = getGranotLifecycleHealthStateModel();
  // The first connection after the miss fences it as the coverage `gap_at` (healthState `installReconnectFence`),
  // before any health write: an instance that saw one capture failure may never write health state again.
  const fenced = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = await HealthState.findById("coverage").lean();
      if (row?.gap_at && new Date(row.gap_at).getTime() >= missedAt) return row;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  };
  const coverage = await fenced();
  assert.ok(coverage?.gap_at, "the reconnection records the missed write as a coverage gap");
  const gapAt = new Date(coverage.gap_at).getTime();
  // Warm counters (30 h of coverage) still read unknown while the gap is inside their window, and a later
  // successful write keeps the fenced gap.
  await HealthState.deleteMany({ _id: { $ne: "coverage" } });
  await HealthState.updateOne({ _id: "coverage" }, { $set: { counters_since: new Date(Date.now() - 30 * 60 * 60 * 1000) } });
  await incrementGranotLifecycleHealthCounter("capture_failed");
  const afterWrite = await HealthState.findById("coverage").lean();
  assert.equal(afterWrite?.gap_at ? new Date(afterWrite.gap_at).getTime() : null, gapAt, "the next successful write keeps the gap");
  const counters = await readGranotLifecycleHealthCounters(new Date());
  assert.equal(counters.capture_failures_24h, null);
  assert.equal(counters.claim_recoveries_1h, null);
  await HealthState.deleteMany({});
});

test("[SLIM-04] alert transitions survive restart and two replicas without fan-out", async (t) => {
  if (!(await replicaReady(t))) return;
  const HealthState = getGranotLifecycleHealthStateModel();
  await HealthState.deleteMany({});
  const firing = (): GranotLifecycleAlertProjection[] => [
    { code: "dead_letter_present", state: "firing", observed_value: 2, threshold: 0, unit: "count" },
  ];
  const ok = (): GranotLifecycleAlertProjection[] => [
    { code: "dead_letter_present", state: "ok", observed_value: 0, threshold: 0, unit: "count" },
  ];
  const unknown = (): GranotLifecycleAlertProjection[] => [
    { code: "capture_unavailable", state: "insufficient_data", observed_value: null, threshold: 0, unit: "count" },
  ];
  const logs = captureGranotLifecycleLogs();
  const firstAt = new Date("2026-10-03T12:00:00.000Z");
  const replicaA = firing();
  const replicaB = firing();
  await Promise.all([
    persistGranotLifecycleAlertTransitions(replicaA, firstAt),
    persistGranotLifecycleAlertTransitions(replicaB, firstAt),
  ]);
  const afterRestart = firing();
  await persistGranotLifecycleAlertTransitions(afterRestart, new Date("2026-10-03T12:10:00.000Z"));
  assert.equal(logs.keys().filter((key) => key === "granot_lifecycle.alert.firing").length, 1);
  assert.equal(afterRestart[0]?.since, firstAt.toISOString());
  assert.equal(replicaA[0]?.since, firstAt.toISOString());
  assert.equal(replicaB[0]?.since, firstAt.toISOString());

  await persistGranotLifecycleAlertTransitions(unknown(), new Date("2026-10-03T12:15:00.000Z"));
  await Promise.all([
    persistGranotLifecycleAlertTransitions(ok(), new Date("2026-10-03T12:20:00.000Z")),
    persistGranotLifecycleAlertTransitions(ok(), new Date("2026-10-03T12:20:00.000Z")),
  ]);
  await persistGranotLifecycleAlertTransitions(ok(), new Date("2026-10-03T12:25:00.000Z"));
  logs.restore();
  assert.equal(logs.keys().filter((key) => key === "granot_lifecycle.alert.recovered").length, 1);
  const row = await HealthState.findById("alert:dead_letter_present:global").lean();
  assert.equal(row?.state, "ok");
  assert.equal(row?.since, undefined);
  assert.equal(await HealthState.countDocuments({ _id: "alert:capture_unavailable:global" }), 0);
  await HealthState.deleteMany({});
});
