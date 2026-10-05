/**
 * SRV-5 replica proof (local csi01 loopback replica only; synthetic rows in a unique database that is
 * dropped afterwards). Never loads production env and never calls RingCentral (every provider read is
 * a local fake). Run:
 *
 *   node --import tsx ops/sales-outreach/rep-sms-capture.replica.ts
 *
 * Proves on real Mongo what the unit tests prove on in-memory stand-ins:
 * - `ringcentral_rep_sms_evidence` indexes build from the model and the unique fence holds;
 * - evidence upsert: concurrent first inserts of one message leave one row; Sent → Delivered →
 *   SendingFailed bump `source_revision` and keep the history; an older version is stale;
 * - mailbox sync: the per-mailbox lease, FSync then ISync token chain, coverage written on the
 *   `rep_sms:<ext>` sync-state row only when complete; a concurrent run is `lease_held`;
 * - minute ISync lane: shares the reconcile's state row and lease; a held lease is skipped by the
 *   lane and waited for by `acquireWithWait`; the lane's fenced write releases the lease.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_sodsms${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.sod-sms-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "sod-sms-replica";
process.env.SHEET_SYNC_MODE = "disabled";

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { getRingCentralRepSmsEvidenceModel } = await import("../../src/models/salesOutreach/repSmsEvidence.js");
  const { getSalesIntelligenceSyncStateModel } = await import("../../src/models/SalesIntelligenceSyncState.js");
  const { mapProviderMessage } = await import("../../src/services/ringcentral/repSms/mapper.js");
  const { upsertRepSmsEvidence, mongoRepSmsEvidenceStore } = await import("../../src/services/ringcentral/repSms/evidenceStore.js");
  const { runRepSmsMailboxSync } = await import("../../src/services/ringcentral/repSms/mailboxSync.js");
  const { runCallLogIsyncLaneOnce, mongoIsyncLaneStore } = await import("../../src/services/numberActivity/callLogIsyncLane.js");
  const { acquireWithWait, syncStateLeaseModel, CALL_LOG_ALL_DIRECTIONS_SCOPE } = await import("../../src/services/numberActivity/reconcileCallLog.js");
  const { MongoLeaseStore } = await import("../../src/services/durableWork/leases.js");
  const { resetVerifiedCsiFences } = await import("../../src/models/salesIntelligence/common.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  resetVerifiedCsiFences();
  for (const Model of [getRingCentralRepSmsEvidenceModel(), getSalesIntelligenceSyncStateModel()]) {
    await Model.createCollection();
    await Model.createIndexes();
  }

  // --- evidence upsert -------------------------------------------------------------------------
  const agent = new mongoose.Types.ObjectId().toHexString();
  const link = new mongoose.Types.ObjectId().toHexString();
  const context = { provider_account_id: "800000000001", extension_id: "101", sender_numbers: [], identityAt: () => ({ agent_id: agent, link_id: link }) };
  const raw = (status: string, modified: string) => ({
    id: 4242, type: "SMS", direction: "Outbound", messageStatus: status, creationTime: "2026-10-05T14:00:00Z", lastModifiedTime: modified,
    from: { phoneNumber: "+15550000101" }, to: [{ phoneNumber: "+15550100200" }],
  });
  const map = (status: string, modified: string) => {
    const m = mapProviderMessage(raw(status, modified), context);
    assert.ok(m.ok);
    return m.evidence;
  };
  const store = mongoRepSmsEvidenceStore();
  const now = new Date("2026-10-05T15:00:00Z");
  const first = await Promise.all([1, 2, 3].map(() => upsertRepSmsEvidence(map("Sent", "2026-10-05T14:00:01Z"), { now, syncKind: "FSync" }, store)));
  assert.equal(first.filter((r) => r.outcome === "inserted").length, 1, "one insert wins the unique fence");
  assert.equal(await getRingCentralRepSmsEvidenceModel().countDocuments({}), 1);
  assert.equal((await upsertRepSmsEvidence(map("Delivered", "2026-10-05T14:00:05Z"), { now, syncKind: "ISync" }, store)).source_revision, 2);
  assert.equal((await upsertRepSmsEvidence(map("Sent", "2026-10-05T14:00:02Z"), { now, syncKind: "ISync" }, store)).outcome, "stale");
  assert.equal((await upsertRepSmsEvidence(map("SendingFailed", "2026-10-05T14:05:00Z"), { now, syncKind: "ISync" }, store)).source_revision, 3);
  const row = await getRingCentralRepSmsEvidenceModel().findOne({ message_id: "4242" }).lean();
  assert.deepEqual(row?.status_history.map((h) => h.status), ["sent", "delivered", "send_failed"]);
  assert.equal(row?.credit_effect, "revoke");
  assert.equal(JSON.stringify(row).includes("subject"), false, "no body field exists");

  // --- mailbox sync (fake provider) -------------------------------------------------------------
  const mailbox = { rc_account_id: "800000000001", extension_id: "101", agent_id: agent, link_id: link, sender_numbers: [] };
  const pages = [
    { records: [raw("Sent", "2026-10-05T14:30:00Z")], syncType: "FSync" as const, syncToken: "tok-1", syncTime: now, olderRecordsExist: false },
    { records: [], syncType: "ISync" as const, syncToken: "tok-2", syncTime: new Date(now.getTime() + 60_000), olderRecordsExist: false },
  ];
  const deps = { now: () => now, fetchSync: async () => pages.shift()!, identity: async () => context.identityAt, wake: async () => undefined };
  const s1 = await runRepSmsMailboxSync(mailbox, deps);
  assert.equal(s1.sync_type, "FSync");
  const s2 = await runRepSmsMailboxSync(mailbox, { ...deps, now: () => new Date(now.getTime() + 60_000) });
  assert.equal(s2.sync_type, "ISync");
  const state = await getSalesIntelligenceSyncStateModel().findOne({ scope: "rep_sms:101" }).lean();
  assert.equal(state?.message_sync?.token, "tok-2");
  assert.equal(state?.known_complete_through?.toISOString(), new Date(now.getTime() + 60_000).toISOString());
  assert.equal(state?.lease_owner, null, "the fenced write released the mailbox");
  const leases = new MongoLeaseStore(syncStateLeaseModel());
  const held = await leases.acquire({ scope: "rep_sms:101", owner: "someone-else", ttl_ms: 60_000, now: new Date() });
  assert.ok(held);
  assert.equal((await runRepSmsMailboxSync(mailbox, { ...deps, now: () => new Date() })).skip_reason, "lease_held");
  await leases.release({ token: held, now: new Date() });

  // --- minute ISync lane on the reconcile's state row -------------------------------------------
  const laneNow = new Date("2026-10-05T14:01:00Z");
  await getSalesIntelligenceSyncStateModel().updateOne(
    { scope: CALL_LOG_ALL_DIRECTIONS_SCOPE },
    { $set: { call_log_sync: { token: "cl-1", sync_time: new Date(laneNow.getTime() - 60_000), last_full_sync_at: null, consecutive_expiries: 0 } } },
    { upsert: true },
  );
  const lane = await runCallLogIsyncLaneOnce({
    now: () => laneNow,
    flagOn: () => true,
    config: { syncMode: "on", perPage: 250, settleHorizonMinutes: 240, quarantineAfter: 3 },
    fetchSync: async () => ({ records: [], syncType: "ISync", syncToken: "cl-2", syncTime: laneNow }),
    configuredAccountId: "800000000001",
    store: mongoIsyncLaneStore(),
    wake: async () => undefined,
  });
  assert.equal(lane.error_code, null);
  const reconcileRow = await getSalesIntelligenceSyncStateModel().findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }).lean();
  assert.equal(reconcileRow?.call_log_sync?.token, "cl-2");
  assert.equal(reconcileRow?.isync_lane?.last_success_at?.toISOString(), laneNow.toISOString());
  const blocker = await leases.acquire({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE, owner: "reconcile", ttl_ms: 300_000, now: new Date() });
  assert.ok(blocker);
  assert.equal((await runCallLogIsyncLaneOnce({ now: () => laneNow, flagOn: () => true, config: { syncMode: "on", perPage: 250, settleHorizonMinutes: 240, quarantineAfter: 3 }, store: mongoIsyncLaneStore(), wake: async () => undefined })).skip_reason, "lease_held");
  setTimeout(() => void leases.release({ token: blocker, now: new Date() }), 1_500);
  const waited = await acquireWithWait(leases, { scope: CALL_LOG_ALL_DIRECTIONS_SCOPE, owner: "reconcile-2", ttl_ms: 300_000, now: () => new Date(), waitMs: 10_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  assert.ok(waited, "the reconcile waits for a briefly held lease");
  await leases.release({ token: waited, now: new Date() });
  console.log(JSON.stringify({ ok: true, database }));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (mongoose.connection.readyState === 1 && mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  });
