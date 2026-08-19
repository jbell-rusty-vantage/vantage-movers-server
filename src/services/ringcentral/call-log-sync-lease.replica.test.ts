import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../db";
import { getCallLeadModel } from "../../models/CallLead";
import { EntityChange } from "../../models/EntityChange";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getRingCentralInboundRouteModel } from "../../models/RingCentralInboundRoute";
import { getRingCentralInboundRouteAssignmentModel } from "../../models/RingCentralInboundRouteAssignment";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { runRingCentralCallLogSync } from "./call-log-sync.service";
import {
  createCallLogSyncLeaseOwner,
  getCallLogSyncState,
  RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY,
  RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX,
} from "./call-log-sync-state.store";
import { getRingCentralCollectionName } from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";
import { resetRingCentralMetrics } from "./ringcentral-metrics";
import { RingCentralApiError } from "./client";

/**
 * Unit 21 / AC-17 replica proof.
 *
 * Only the provider HTTP call is injected. The state lease, cursor, route
 * snapshot, vetting, Unit 20 shared ingest, and processed-call ledger are the
 * real production paths against a disposable replica-set database, so overlap,
 * expiry, fencing, cursor movement, and rescan idempotency are proven where
 * they actually happen.
 */

const COMPANY_ID = new mongoose.Types.ObjectId("68a500000000000000000030");
const GRANULARITY_ID = new mongoose.Types.ObjectId("68a500000000000000000031");
const ROUTE_ID = new mongoose.Types.ObjectId("68a500000000000000000032");
const ASSIGNMENT_ID = new mongoose.Types.ObjectId("68a500000000000000000033");
const SOURCE_SLUG = "unit21_synthetic";
const TARGET_PHONE = "+15550003000";
const CALLER_PHONE = "+15550004000";
const CALL_PREFIX = "u21-";

const actor = {
  actor_type: "system",
  actor_id: "unit21-test",
  actor_label: "Unit 21 synthetic",
  actor_role: "system",
};

const originalCreateFlag = process.env.RINGCENTRAL_CREATE_CALL_LEADS;

function replicaProofEnabled(): boolean {
  return (
    process.env.GRANOT_LIFECYCLE_REPLICA_TESTS === "true" &&
    process.env.TEST_MODE === "true" &&
    /^testvantagemovers/i.test(process.env.MONGO_DB_NAME ?? "") &&
    process.env.RINGCENTRAL_COLLECTION_MODE === "test" &&
    process.env.SHEET_SYNC_MODE === "disabled"
  );
}

function syntheticCallLogRecord(suffix: string, startTime: Date) {
  return {
    id: `${CALL_PREFIX}${suffix}`,
    sessionId: `${CALL_PREFIX}session-${suffix}`,
    telephonySessionId: `${CALL_PREFIX}telephony-${suffix}`,
    startTime: startTime.toISOString(),
    direction: "Inbound",
    result: "Completed",
    duration: 300,
    to: { phoneNumber: TARGET_PHONE, name: "Unit 21 Synthetic" },
    from: { phoneNumber: CALLER_PHONE, name: "Unit 21 Caller" },
  };
}

async function stateCollection() {
  const db = await getRingCentralDb();
  return db.collection(getRingCentralCollectionName("callLogSyncState"));
}

async function processedCollection() {
  const db = await getRingCentralDb();
  return db.collection(getRingCentralCollectionName("processedCalls"));
}

before(async () => {
  if (!replicaProofEnabled()) return;
  await connectMongo();
  assert.match(mongoose.connection.name, /^testvantagemovers/i);
  assert.equal(process.env.RINGCENTRAL_COLLECTION_MODE, "test");
  assert.equal(process.env.SHEET_SYNC_MODE, "disabled");
  // Unit 21 proves overlap safety around real Lead creation; adoption stays at
  // its checked-in default so no Unit 20 gate is widened here.
  process.env.RINGCENTRAL_CREATE_CALL_LEADS = "true";
  await cleanup();

  await getLeadSourceCompanyModel().create({
    _id: COMPANY_ID,
    company_slug: SOURCE_SLUG,
    name: "Unit 21 Synthetic",
    owner_label: "Unit 21 Synthetic",
    active: true,
    created_from: "unit21-test",
  });
  await getLeadSourceGranularityModel().create({
    _id: GRANULARITY_ID,
    source_company: COMPANY_ID,
    granularity_key: "unit21_synthetic_calls",
    channel: "call",
    owner_label: "Unit 21 Synthetic Calls",
    crm_label: "Unit 21 Synthetic Calls",
    active: true,
    activated_at: new Date(),
    created_from: "unit21-test",
  });
  await getRingCentralInboundRouteModel().create({
    _id: ROUTE_ID,
    provider: "ringcentral",
    phone_number: TARGET_PHONE,
    phone_locked: true,
    display_label: "Unit 21 Synthetic Route",
    active: true,
    ever_activated: true,
    validation_status: "valid",
    validated_at: new Date(),
    created_from: "unit21-test",
    created_by: actor,
  });
  await getRingCentralInboundRouteAssignmentModel().create({
    _id: ASSIGNMENT_ID,
    route: ROUTE_ID,
    source_company: COMPANY_ID,
    source_granularity: GRANULARITY_ID,
    effective_from: new Date("2020-01-01T00:00:00.000Z"),
    active: true,
    created_by: actor,
    change_reason: "Unit 21 synthetic verification",
  });

  // Disposable test database only. Production index deployment stays with
  // `pnpm migration:granot-lifecycle:indexes`.
  const state = await stateCollection();
  await state.createIndex(RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX.key, {
    name: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX.name,
    unique: true,
  });
});

after(async () => {
  if (!replicaProofEnabled()) return;
  await cleanup();
  if (originalCreateFlag === undefined) {
    delete process.env.RINGCENTRAL_CREATE_CALL_LEADS;
  } else {
    process.env.RINGCENTRAL_CREATE_CALL_LEADS = originalCreateFlag;
  }
  await mongoose.disconnect();
});

async function cleanup(): Promise<void> {
  const Lead = getCallLeadModel();
  const leads = await Lead.find({ source_granularity_id: GRANULARITY_ID })
    .select({ _id: 1 })
    .lean()
    .exec();
  const leadIds = leads.map((row) => String(row._id));
  await Promise.all([
    SheetSyncJob.deleteMany({ entity_id: { $in: leadIds } }),
    EntityChange.collection.deleteMany({ "entity.id": { $in: leadIds } }),
    processedCollection().then((collection) =>
      collection.deleteMany({
        $or: [
          { callLogId: new RegExp(`^${CALL_PREFIX}`) },
          { telephonySessionId: new RegExp(`^${CALL_PREFIX}`) },
        ],
      }),
    ),
    stateCollection().then((collection) =>
      collection.deleteMany({ key: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY }),
    ),
  ]);
  await Lead.deleteMany({ source_granularity_id: GRANULARITY_ID });
  await getRingCentralInboundRouteAssignmentModel().deleteMany({
    _id: ASSIGNMENT_ID,
  });
  await getRingCentralInboundRouteModel().deleteMany({ _id: ROUTE_ID });
  await getLeadSourceGranularityModel().deleteMany({ _id: GRANULARITY_ID });
  await getLeadSourceCompanyModel().deleteMany({ _id: COMPANY_ID });
}

async function resetRunState(): Promise<void> {
  const Lead = getCallLeadModel();
  const leads = await Lead.find({ source_granularity_id: GRANULARITY_ID })
    .select({ _id: 1 })
    .lean()
    .exec();
  const leadIds = leads.map((row) => String(row._id));
  await SheetSyncJob.deleteMany({ entity_id: { $in: leadIds } });
  await EntityChange.collection.deleteMany({ "entity.id": { $in: leadIds } });
  await Lead.deleteMany({ source_granularity_id: GRANULARITY_ID });
  const processed = await processedCollection();
  await processed.deleteMany({
    $or: [
      { callLogId: new RegExp(`^${CALL_PREFIX}`) },
      { telephonySessionId: new RegExp(`^${CALL_PREFIX}`) },
    ],
  });
  const state = await stateCollection();
  await state.deleteMany({ key: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY });
  resetRingCentralMetrics();
}

test("[AC-17] Unit 21 replica lease, cursor, overlap, and rescan proof", async (t) => {
  if (!replicaProofEnabled()) {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return;
  }

  await t.test(
    "two concurrent invocations produce one winner and one bounded skip",
    async () => {
      await resetRunState();
      const startTime = new Date(Date.now() - 10 * 60 * 1000);
      const record = syntheticCallLogRecord("overlap", startTime);
      let fetches = 0;
      const pageFetcher = async ({ page }: { page: number }) => {
        fetches += 1;
        return page === 1 ? [record] : [];
      };

      const [first, second] = await Promise.all([
        runRingCentralCallLogSync(new Date(), { fetchCallLogPage: pageFetcher }),
        runRingCentralCallLogSync(new Date(), { fetchCallLogPage: pageFetcher }),
      ]);

      const winners = [first, second].filter((run) => run.leaseAcquired);
      const losers = [first, second].filter((run) => run.skipped);
      assert.equal(winners.length, 1, "exactly one lease winner");
      assert.equal(losers.length, 1, "exactly one bounded skip");
      assert.equal(losers[0]?.skipReason, "lease_held");
      assert.equal(losers[0]?.fetchedRecords, 0);
      assert.equal(losers[0]?.cursorAdvanced, false);
      assert.equal(fetches, 1, "the loser issued no provider request");

      const state = await stateCollection();
      assert.equal(
        await state.countDocuments({
          key: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY,
        }),
        1,
        "the singleton stays singular under overlap",
      );

      const stored = await getCallLogSyncState();
      assert.equal(stored?.lastRunStatus, "success");
      assert.ok(stored?.lastSyncTo);
      assert.equal(stored?.lease_owner, undefined);
      assert.equal(stored?.leased_until, undefined);
      assert.ok((stored?.last_runtime_ms ?? -1) >= 0);
      assert.equal(stored?.last_throttled_count, 0);

      const Lead = getCallLeadModel();
      assert.equal(
        await Lead.countDocuments({ source_granularity_id: GRANULARITY_ID }),
        1,
        "overlap created exactly one Lead",
      );
      const processed = await processedCollection();
      assert.equal(
        await processed.countDocuments({
          telephonySessionId: record.telephonySessionId,
        }),
        1,
        "one processed-call ledger row",
      );
    },
  );

  await t.test(
    "[AC-14][AC-15][AC-16] rescanning the same window creates no second Lead, Change, or outbox row",
    async () => {
      await resetRunState();
      const startTime = new Date(Date.now() - 20 * 60 * 1000);
      const record = syntheticCallLogRecord("rescan", startTime);
      const pageFetcher = async ({ page }: { page: number }) =>
        page === 1 ? [record] : [];

      const firstRun = await runRingCentralCallLogSync(new Date(), {
        fetchCallLogPage: pageFetcher,
      });
      assert.equal(firstRun.cursorAdvanced, true);
      assert.equal(firstRun.ingestActions.lead_created, 1);

      const Lead = getCallLeadModel();
      const lead = await Lead.findOne({
        source_granularity_id: GRANULARITY_ID,
      })
        .select({ _id: 1 })
        .lean()
        .exec();
      assert.ok(lead);
      const leadId = String(lead!._id);
      const changesAfterFirst = await EntityChange.collection.countDocuments({
        "entity.id": leadId,
      });
      const sheetJobsAfterFirst = await SheetSyncJob.countDocuments({
        entity_id: leadId,
      });

      // The locked 12-hour rolling window rescans the same record.
      const secondRun = await runRingCentralCallLogSync(new Date(), {
        fetchCallLogPage: pageFetcher,
      });
      assert.equal(secondRun.cursorAdvanced, true);
      assert.equal(secondRun.ingestActions.skipped_already_processed, 1);
      assert.equal(secondRun.ingestActions.lead_created, 0);
      assert.equal(secondRun.leadsCreated, 0);

      assert.equal(
        await Lead.countDocuments({ source_granularity_id: GRANULARITY_ID }),
        1,
        "replay created no second Lead",
      );
      assert.equal(
        await EntityChange.collection.countDocuments({ "entity.id": leadId }),
        changesAfterFirst,
        "replay created no second Change",
      );
      assert.equal(
        await SheetSyncJob.countDocuments({ entity_id: leadId }),
        sheetJobsAfterFirst,
        "replay created no second outbox row",
      );
      const processed = await processedCollection();
      assert.equal(
        await processed.countDocuments({
          telephonySessionId: record.telephonySessionId,
        }),
        1,
      );
    },
  );

  await t.test(
    "a failed run leaves the committed cursor exactly where it was",
    async () => {
      await resetRunState();
      const record = syntheticCallLogRecord(
        "cursor",
        new Date(Date.now() - 30 * 60 * 1000),
      );
      await runRingCentralCallLogSync(new Date(), {
        fetchCallLogPage: async ({ page }) => (page === 1 ? [record] : []),
      });
      const committed = await getCallLogSyncState();
      const committedSyncTo = committed?.lastSyncTo;
      assert.ok(committedSyncTo);

      await assert.rejects(() =>
        runRingCentralCallLogSync(new Date(), {
          fetchCallLogPage: async () => {
            throw new RingCentralApiError(
              "RingCentral request failed with status 429",
              429,
              "Too Many Requests",
              "/restapi/v1.0/account/~/call-log",
              "GET",
              null,
            );
          },
        }),
      );

      const afterFailure = await getCallLogSyncState();
      assert.deepEqual(
        afterFailure?.lastSyncTo,
        committedSyncTo,
        "an unrecovered throttle moved the cursor",
      );
      assert.equal(afterFailure?.lastRunStatus, "error");
      assert.equal(afterFailure?.lastError, "provider_throttled");
      assert.equal(afterFailure?.last_throttled_count, 1);
      assert.equal(afterFailure?.lease_owner, undefined, "lease released");
    },
  );

  await t.test(
    "an expired lease permits exactly one successor and no stale takeover",
    async () => {
      await resetRunState();
      const state = await stateCollection();
      const staleOwner = createCallLogSyncLeaseOwner();
      const staleSyncTo = new Date(Date.now() - 60 * 60 * 1000);
      await state.insertOne({
        key: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY,
        provider: "ringcentral",
        lastSyncFrom: new Date(staleSyncTo.getTime() - 60_000),
        lastSyncTo: staleSyncTo,
        lastRunAt: staleSyncTo,
        lastRunStatus: "success",
        lastError: null,
        lastProcessedCount: 0,
        lastQualifiedCount: 0,
        lastLeadActionCount: 0,
        lease_owner: staleOwner,
        // Already expired: recovery is the only cleanup mechanism.
        leased_until: new Date(Date.now() - 1_000),
        lease_acquired_at: new Date(Date.now() - 6 * 60 * 1000),
        updatedAt: staleSyncTo,
      });

      const [first, second] = await Promise.all([
        runRingCentralCallLogSync(new Date(), {
          fetchCallLogPage: async () => [],
        }),
        runRingCentralCallLogSync(new Date(), {
          fetchCallLogPage: async () => [],
        }),
      ]);

      const winners = [first, second].filter((run) => run.leaseAcquired);
      assert.equal(winners.length, 1, "expiry admitted exactly one successor");
      assert.equal(winners[0]?.leaseRecovered, true);
      assert.equal(
        await state.countDocuments({
          key: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY,
        }),
        1,
      );

      const stored = await getCallLogSyncState();
      assert.equal(stored?.lease_owner, undefined);
      assert.notDeepEqual(
        stored?.lastSyncTo,
        staleSyncTo,
        "the successor completed and advanced the cursor",
      );
    },
  );
});
