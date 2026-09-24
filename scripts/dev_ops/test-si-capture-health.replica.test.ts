import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getOperationalEventModel } from "../../src/models/OperationalEvent";
import { getSalesIntelligenceSyncStateModel } from "../../src/models/SalesIntelligenceSyncState";
import { getRingCentralCollectionName } from "../../src/services/ringcentral/ringcentral-config";
import { ensureRingCentralWebhookEventIndexes } from "../../src/services/ringcentral/webhook-capture";
import { storeRingCentralWebhookSubscriptionMetadata } from "../../src/services/ringcentral/webhook-subscriptions";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../src/services/numberActivity/reconcileCallLog";
import { CALL_LOG_SWEEP_SCOPE } from "../../src/services/numberActivity/callLogSweep";
import {
  captureHealthQueries,
  composeCaptureHealth,
  readCaptureHealthFacts,
  readOwnerCoverage,
} from "../../src/services/salesIntelligence/ownerCoverage";
import { defaultCsiPolicy } from "../../src/services/salesIntelligence/policy";

/**
 * S5c-HEALTH (C20) replica proof. Seeds its own database: owned subscription rows
 * (healthy, then expired), webhook receipts, subscription-cron outcome events, a
 * quarantined Call Log record, sweep figures and in-progress calls; reads
 * `readOwnerCoverage`; asserts `capture_health`; counts the read's queries with
 * the database profiler; checks every plan is indexed; measures p50/p95.
 * The production Admin coverage schema (vantage-admin, read only) must parse the response.
 */

const ADMIN_API = "C:/Users/Pinda/Proyectos/vantage/vantage-admin/lib/api/salesIntelligence.ts";
const SUBSCRIPTION_ID = "882f9c2b-proof-4c3d-9e8f-0123456789ab";
const ALL = "/restapi/v1.0/account/~/telephony/sessions";

/** Every stage name and index name anywhere in an explain document (classic and SBE shapes). */
function planStages(node: unknown, out: { stages: string[]; indexes: string[] } = { stages: [], indexes: [] }) {
  if (Array.isArray(node)) node.forEach(n => planStages(n, out));
  else if (node && typeof node === "object") {
    const row = node as Record<string, unknown>;
    if (typeof row.stage === "string") out.stages.push(row.stage);
    if (typeof row.indexName === "string") out.indexes.push(row.indexName);
    for (const [key, value] of Object.entries(row)) if (key !== "rejectedPlans") planStages(value, out);
  }
  return out;
}
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

test("S5c-HEALTH replica: capture_health block, ≤ 6 indexed queries, p95 < 300 ms, Admin schema parse", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async (t) => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t3bhealth[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.command({ profile: 0 }).catch(() => null); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Network/provider access forbidden in S5c-HEALTH proof"); });

  await ensureRingCentralWebhookEventIndexes();
  await getOperationalEventModel().createIndexes();
  const receipts = db.collection(getRingCentralCollectionName("webhookEvents"));
  const events = getOperationalEventModel().collection;
  const calls = db.collection("call_interactions");
  const subscriptions = db.collection("ringcentral_webhook_subscriptions");
  const sync = getSalesIntelligenceSyncStateModel().collection;
  const staffing = { timezone: defaultCsiPolicy().timezone, staffed_hours: defaultCsiPolicy().staffed_hours };
  const oid = () => new mongoose.Types.ObjectId();
  let serial = 0;
  const call = (started: Date, fields: Record<string, unknown> = {}) => ({
    _id: oid(), provider: "ringcentral", provider_account_id: "proof", telephony_session_id: `s5c-health-${++serial}`,
    started_at: started, terminal: true, call_log_state: null, merged_into_id: null, sources: ["webhook"],
    first_observed_at: started, last_observed_at: started, createdAt: started, updatedAt: started, ...fields,
  });
  const receipt = (at: Date) => ({ _id: oid(), provider: "ringcentral", receivedAt: at, uuid: `s5c-health-r-${++serial}`, telephonySessionId: `s-${serial}`, rawBody: {} });

  // Owned all-direction subscription (through the real ownership store) plus a legacy inbound-only row.
  await storeRingCentralWebhookSubscriptionMetadata({ id: SUBSCRIPTION_ID, eventFilters: [ALL], status: "Active", expiresIn: 630_720_000, deliveryMode: { transportType: "WebHook", address: "https://proof.invalid/api/webhooks/ringcentral" } });
  await storeRingCentralWebhookSubscriptionMetadata({ id: "legacy-inbound-000001", eventFilters: [`${ALL}?direction=Inbound`], status: "Active", expiresIn: 604_800 });

  // --- 1. Fixed clock through the reads (Tue 2026-09-22 11:00 EDT): degraded, then healthy.
  const FIXED = new Date("2026-09-22T15:00:00.000Z");
  const m = (base: Date, minutes: number) => new Date(+base + minutes * 60_000);
  await calls.insertOne(call(m(FIXED, -15), { call_log_state: "settled", sources: ["call_log_reconcile"] }));
  await receipts.insertOne(receipt(m(FIXED, -40)));
  const degraded = composeCaptureHealth(await readCaptureHealthFacts({ now: FIXED, staffing, reconcile: null, sweep: null }));
  assert.equal(degraded.webhook.state, "degraded", "40 staffed minutes silent while the Call Log shows a call");
  assert.equal(degraded.webhook.last_receipt_at, m(FIXED, -40).toISOString());
  assert.equal(degraded.webhook.receipts_1h, 1);
  assert.deepEqual(degraded.reasons, ["webhook_degraded"]);
  await receipts.insertOne(receipt(m(FIXED, -5)));
  const recovered = composeCaptureHealth(await readCaptureHealthFacts({ now: FIXED, staffing, reconcile: null, sweep: null }));
  assert.equal(recovered.webhook.state, "healthy");
  assert.equal(recovered.status, "ok");

  // --- 2. Real clock through readOwnerCoverage: quarantine + pending finalization → attention.
  const now = new Date();
  await sync.insertMany([
    { scope: CALL_LOG_ALL_DIRECTIONS_SCOPE, known_complete_through: m(now, -10), gaps: [],
      quarantined_records: [{ call_log_id: "q-proof-1", telephony_session_id: "s-q-1", start_time: m(now, -200), error_code: "projection_failed", error_name: "InteractionPersistenceError", failures: 3, first_failed_at: m(now, -120), last_failed_at: m(now, -60), next_retry_at: m(now, 60) }],
      last_run: { started_at: m(now, -5), finished_at: m(now, -4), error_code: null } },
    { scope: CALL_LOG_SWEEP_SCOPE, consecutive_drift_runs: 1,
      last_run: { started_at: m(now, -300), finished_at: m(now, -295), error_code: null, from: m(now, -36 * 60), to: m(now, -4 * 60), provider_records: 400,
        stored_in_latest_version: 380, applied_changes: 21, missing_before: 4, stale_before: 16, provisional_after_horizon: 0, quarantined: 1 } },
  ]);
  await calls.insertMany([
    call(m(now, -3), { terminal: false }),                                   // in progress
    call(m(now, -30), { terminal: false }),                                  // pending finalization
    call(m(now, -300), { terminal: false }),                                 // older than 4 h: excluded
    call(m(now, -2), { terminal: false, merged_into_id: oid() }),            // merged: excluded
    call(m(now, -20), { call_log_state: "settled", sources: ["webhook", "call_log_reconcile"] }),
  ]);
  await receipts.insertMany([receipt(m(now, -1)), receipt(m(now, -5)), receipt(m(now, -20)), receipt(m(now, -120))]);

  const coverage = await readOwnerCoverage();
  const health = coverage.capture_health!;
  assert.ok(health, "capture_health is present");
  assert.equal(health.status, "attention");
  assert.deepEqual(health.reasons, ["quarantine", "pending_finalization"]);
  assert.equal(health.webhook.state, "healthy");
  assert.equal(health.webhook.subscription_id_suffix, "6789ab");
  assert.equal(JSON.stringify(coverage).includes(SUBSCRIPTION_ID), false, "the full subscription id never leaves the server");
  assert.equal(health.webhook.receipts_1h, 3);
  assert.equal(health.webhook.last_receipt_at, m(now, -1).toISOString());
  assert.equal(health.webhook.last_renewal_error, null);
  assert.ok(health.webhook.subscription_expires_at && new Date(health.webhook.subscription_expires_at) > now);
  assert.equal(health.in_progress_calls, 2);
  assert.equal(health.pending_finalization, 1);
  assert.equal(health.call_log.quarantined_count, 1);
  assert.equal(health.call_log.oldest_quarantined_at, m(now, -120).toISOString());
  assert.equal(health.call_log.last_reconcile_at, m(now, -4).toISOString());
  assert.equal(health.call_log.sync_mode, "shadow");
  assert.equal(health.known_complete_through, m(now, -10).toISOString());
  assert.equal(health.call_log.last_sweep?.recovered_calls, 20);
  // call_log_capture is unchanged (its successor is capture_health).
  assert.deepEqual(Object.keys(coverage.call_log_capture).sort(), ["last_sweep", "oldest_quarantined_at", "quarantined_count", "sync_mode"]);
  assert.equal("recovered_calls" in (coverage.call_log_capture.last_sweep ?? {}), false);
  assert.equal(coverage.call_log_capture.quarantined_count, 1);

  // Production Admin (vantage-admin@main, read only): the coverage route payload must still parse.
  const admin = await import(pathToFileURL(ADMIN_API).href) as { ownerCoverageSchema: { safeParse(value: unknown): { success: boolean; error?: unknown } } };
  const routePayload = JSON.parse(JSON.stringify({ data: { as_of: new Date().toISOString(), coverage } }));
  const parsed = admin.ownerCoverageSchema.safeParse(routePayload);
  assert.equal(parsed.success, true, `production Admin ownerCoverageSchema rejects the response: ${JSON.stringify(parsed.error)}`);

  // --- 3. Expired subscription → broken.
  await subscriptions.updateOne({ subscriptionId: SUBSCRIPTION_ID }, { $set: { expirationTime: m(now, -60) } });
  const expired = (await readOwnerCoverage()).capture_health!;
  assert.equal(expired.webhook.state, "down");
  assert.equal(expired.status, "broken");
  assert.deepEqual(expired.reasons, ["webhook_down", "quarantine", "pending_finalization"]);
  await subscriptions.updateOne({ subscriptionId: SUBSCRIPTION_ID }, { $set: { expirationTime: m(now, 20 * 365 * 24 * 60) } });

  // --- 4. The last renewal failed → down; a later renewal clears it.
  await events.insertOne({ occurred_at: m(now, -180), event_key: "sales_intelligence.webhook_subscription.failed", level: "error", category: "ringcentral", workflow: "sales_intelligence",
    summary: "All-direction webhook subscription maintenance failed.", details: { errorName: "SubscriptionOwnershipError", message: `Refusing to renew subscription ${SUBSCRIPTION_ID}` } });
  const failed = (await readOwnerCoverage()).capture_health!;
  assert.equal(failed.webhook.state, "down");
  assert.equal(failed.webhook.last_renewal_error, "SubscriptionOwnershipError");
  assert.equal(JSON.stringify(failed).includes(SUBSCRIPTION_ID), false, "the failure message (with the id) is never surfaced");
  await events.insertOne({ occurred_at: m(now, -60), event_key: "sales_intelligence.webhook_subscription.renewed", level: "info", category: "ringcentral", workflow: "sales_intelligence", summary: "renewed", details: {} });
  assert.equal((await readOwnerCoverage()).capture_health!.webhook.state, "healthy");

  // --- 5. Quarantine older than 24 h → broken.
  await sync.updateOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }, { $set: { "quarantined_records.0.first_failed_at": m(now, -25 * 60) } });
  const stale = (await readOwnerCoverage()).capture_health!;
  assert.equal(stale.status, "broken");
  assert.deepEqual(stale.reasons, ["quarantine_over_24h", "pending_finalization"]);

  // --- 6. Query bound: count what readCaptureHealthFacts sends (database profiler), flag on and off.
  const [reconcileRow, sweepRow] = await Promise.all([
    sync.findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }), sync.findOne({ scope: CALL_LOG_SWEEP_SCOPE }),
  ]) as unknown as [null, null];
  await readCaptureHealthFacts({ now, staffing, reconcile: reconcileRow, sweep: sweepRow }); // warm (model init)
  const profile = db.collection("system.profile");
  async function countOps(run: () => Promise<unknown>) {
    await db.command({ profile: 0 });
    await profile.drop().catch(() => null);
    await db.command({ profile: 2 });
    const since = new Date();
    await run();
    await db.command({ profile: 0 });
    const rows = await profile.find({ ts: { $gte: since }, ns: { $not: /system\.profile$/ } }).toArray();
    return rows.map(row => `${String(row.ns).split(".").slice(1).join(".")}:${String(row.op)}`);
  }
  const onOps = await countOps(() => readCaptureHealthFacts({ now, staffing, reconcile: reconcileRow, sweep: sweepRow }));
  console.log(`# capture_health queries (flag on): ${onOps.length} + 1 shared sync-state read -> ${JSON.stringify(onOps)}`);
  assert.ok(onOps.length <= 5, `at most 5 new queries (6 with the shared sync-state read); got ${onOps.length}`);
  process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "false";
  try {
    const offOps = await countOps(() => readCaptureHealthFacts({ now, staffing, reconcile: reconcileRow, sweep: sweepRow }));
    console.log(`# capture_health queries (flag off): ${offOps.length} -> ${JSON.stringify(offOps)}`);
    assert.equal(offOps.length, 1);
    const off = (await readOwnerCoverage()).capture_health!;
    assert.equal(off.webhook.state, "off");
    assert.equal(off.webhook.subscription_id_suffix, null);
    assert.equal(off.webhook.receipts_1h, 0);
  } finally {
    process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "true";
  }

  // --- 7. Plans: every capture_health query is indexed (no COLLSCAN).
  const q = captureHealthQueries(now, staffing);
  const plans: Record<string, { stages: string[]; indexes: string[] }> = {
    subscriptions: planStages(await subscriptions.find(q.subscriptions).limit(50).explain("queryPlanner")),
    latest_receipt: planStages(await receipts.find(q.latest_receipt).sort({ receivedAt: -1 }).limit(1).explain("queryPlanner")),
    receipts_1h: planStages(await receipts.find(q.receipts_1h).explain("queryPlanner")),
    renewal_event: planStages(await events.find(q.renewal_event).sort({ occurred_at: -1 }).hint(q.renewal_event_hint).limit(1).explain("queryPlanner")),
    calls: planStages(await calls.aggregate(q.calls_pipeline as object[]).explain("queryPlanner")),
  };
  for (const [name, plan] of Object.entries(plans)) {
    console.log(`# plan ${name}: stages=${[...new Set(plan.stages)].join(",")} indexes=${[...new Set(plan.indexes)].join(",")}`);
    assert.equal(plan.stages.includes("COLLSCAN"), false, `${name} must not scan the collection`);
    assert.ok(plan.indexes.length > 0, `${name} uses an index`);
  }
  assert.ok(plans.calls!.indexes.includes("call_interaction_call_log_state_started"), "the Call Log branch uses call_interaction_call_log_state_started");
  assert.ok(plans.calls!.indexes.includes("call_interaction_started_window"), "the in-progress branch uses call_interaction_started_window");
  assert.deepEqual([...new Set(plans.renewal_event!.indexes)], ["event_key_1_occurred_at_-1"]);

  // --- 8. Latency at production-like volume: 30 days of calls, 2 days of receipts.
  const bulkCalls = Array.from({ length: 15_000 }, (_, i) => call(m(now, -(i * 3 + 1)), {
    terminal: i % 400 !== 0, call_log_state: i % 7 === 0 ? null : "settled", sources: ["webhook", "call_log_reconcile"] }));
  for (let i = 0; i < bulkCalls.length; i += 5000) await calls.insertMany(bulkCalls.slice(i, i + 5000), { ordered: false });
  const bulkReceipts = Array.from({ length: 10_000 }, (_, i) => receipt(m(now, -(i * 0.3 + 0.5))));
  for (let i = 0; i < bulkReceipts.length; i += 5000) await receipts.insertMany(bulkReceipts.slice(i, i + 5000), { ordered: false });
  await events.insertMany(Array.from({ length: 200 }, (_, i) => ({ occurred_at: m(now, -i * 90), event_key: i % 2 ? "sales_intelligence.other" : "sales_intelligence.webhook_subscription.renewed",
    level: "info", category: "ringcentral", workflow: "sales_intelligence", summary: "bulk", details: {} })));
  const bulkPlan = planStages(await calls.aggregate(captureHealthQueries(new Date(), staffing).calls_pipeline as object[]).explain("queryPlanner"));
  console.log(`# plan calls at volume (15k calls): stages=${[...new Set(bulkPlan.stages)].join(",")} indexes=${[...new Set(bulkPlan.indexes)].join(",")}`);
  assert.equal(bulkPlan.stages.includes("COLLSCAN"), false);
  const timeHealth: number[] = [], timeCoverage: number[] = [];
  for (let i = 0; i < 50; i++) {
    const at = new Date();
    const started = performance.now();
    await readCaptureHealthFacts({ now: at, staffing, reconcile: reconcileRow, sweep: sweepRow });
    timeHealth.push(performance.now() - started);
  }
  for (let i = 0; i < 50; i++) {
    const started = performance.now();
    await readOwnerCoverage();
    timeCoverage.push(performance.now() - started);
  }
  const fmt = (v: number) => v.toFixed(1);
  console.log(`# capture_health facts x50: p50=${fmt(percentile(timeHealth, 50))} ms p95=${fmt(percentile(timeHealth, 95))} ms max=${fmt(Math.max(...timeHealth))} ms`);
  console.log(`# full readOwnerCoverage x50: p50=${fmt(percentile(timeCoverage, 50))} ms p95=${fmt(percentile(timeCoverage, 95))} ms max=${fmt(Math.max(...timeCoverage))} ms`);
  assert.ok(percentile(timeHealth, 95) < 300, "capture_health p95 under 300 ms");
});
