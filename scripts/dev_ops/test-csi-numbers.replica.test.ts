import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { requireApiSecret } from "../../src/middleware/requireApiSecret";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../src/models/NumberLeadAttachment";
import { getRingCentralDirectorySnapshotModel } from "../../src/models/RingCentralDirectorySnapshot";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceCommandExecutionModel } from "../../src/models/SalesIntelligenceCommandExecution";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../src/models/SalesIntelligenceSyncState";
import {
  createSalesIntelligenceAdminRouter,
  CSI_ADMIN_PREFIX,
} from "../../src/routes/sales-intelligence-admin.routes";
import { createSalesIntelligenceBoundaryRouter } from "../../src/routes/sales-intelligence-boundary.routes";
import {
  createSalesIntelligenceCronRouter,
  CSI_CRON_PATHS,
} from "../../src/routes/sales-intelligence-cron.routes";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import {
  requireCsiOwner,
  CsiError,
  type CsiActor,
} from "../../src/services/salesIntelligence/auth";
import { claimCsiJob } from "../../src/services/salesIntelligence/jobs";
import { RingCentralApiError } from "../../src/services/ringcentral/client";
import { loadDirectoryLookup } from "../../src/services/numberActivity/directory";
import {
  DIRECTORY_SCOPE,
  runDirectorySyncOnce,
  type DirectoryFetcher,
} from "../../src/services/numberActivity/directorySync";
import { dispatchCsiWakeup } from "../../src/services/numberActivity/jobDispatch";
import {
  normalizeWebhookPartyObservations,
  observeRingCentralWebhookEvents,
} from "../../src/services/numberActivity/observeWebhookEvents";
import { applyInteractionObservation } from "../../src/services/numberActivity/persistInteraction";
import {
  drainRebuildJobs,
  enqueueNumberRebuild,
  enqueueRebuildAll,
  loadRebuildEvidence,
  recountNumber,
  runRebuildJob,
  sameRebuiltFields,
  REBUILD_ALL_SUBJECT,
  repairFirstObservedAt,
} from "../../src/services/numberActivity/rebuild";
import {
  buildSortedNumberSearchFilter,
  mongoNumberRowSource,
  NUMBER_SORT_CANDIDATE_CAP,
  NUMBER_SORT_INDEXES,
  numberSearchQuerySchema,
  pageNumberSearch,
  parseSearchTerm,
  sortedNumberMongoSort,
} from "../../src/services/numberActivity/search";
import {
  at,
  callLogRecord,
  inboundConnectedCallLog,
  inboundQueueAnsweredDeliveries,
  outboundUnansweredDeliveries,
  sessionIdOnlyCallLog,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_CUSTOMER,
  SYNTHETIC_QUEUE_EXTENSION,
  SYNTHETIC_SALES_DID,
  SYNTHETIC_USER_EXTENSION,
  SYNTHETIC_USER_EXTENSION_B,
  syntheticDirectory,
  webhookDelivery,
} from "../../src/services/numberActivity/fixtures";

const enabled = process.env.CSI_REPLICA_TEST === "true";
const noEvent = (async () => undefined) as never;
const noRoute = () => null;
const directory = syntheticDirectory();

/** Fake RingCentral directory reads with the synthetic roster; `version` changes the roster to force a new digest. */
function fakeFetcher(
  version: number,
  opts: { throttleOn?: "extensions"; accountId?: string } = {},
): DirectoryFetcher & { calls: string[] } {
  const calls: string[] = [];
  const throttle = () => {
    throw new RingCentralApiError(
      "429",
      429,
      "Too Many Requests",
      "/x",
      "GET",
      { errorCode: "CMN-301" },
    );
  };
  const extensions = [
    {
      id: SYNTHETIC_USER_EXTENSION.id,
      extensionNumber: SYNTHETIC_USER_EXTENSION.number,
      type: "User",
      name: SYNTHETIC_USER_EXTENSION.name,
      status: "Enabled",
    },
    {
      id: SYNTHETIC_USER_EXTENSION_B.id,
      extensionNumber: SYNTHETIC_USER_EXTENSION_B.number,
      type: "User",
      name: SYNTHETIC_USER_EXTENSION_B.name,
      status: "Enabled",
    },
    {
      id: SYNTHETIC_QUEUE_EXTENSION.id,
      extensionNumber: SYNTHETIC_QUEUE_EXTENSION.number,
      type: "Department",
      name: SYNTHETIC_QUEUE_EXTENSION.name,
      status: "Enabled",
    },
    ...Array.from({ length: version }, (_, i) => ({
      id: `99000000010${i}`,
      extensionNumber: `${110 + i}`,
      type: "User",
      name: `Synthetic Rep v${version}-${i}`,
      status: "Enabled",
    })),
  ];
  return {
    calls,
    account: async () => {
      calls.push("account");
      return { id: opts.accountId ?? SYNTHETIC_ACCOUNT_ID };
    },
    extensions: async (page) => {
      calls.push(`extensions:${page}`);
      if (opts.throttleOn === "extensions") throttle();
      return { records: extensions, navigation: {} };
    },
    phoneNumbers: async (page) => {
      calls.push(`phoneNumbers:${page}`);
      return {
        records: [
          {
            id: "n-main",
            phoneNumber: "+15550100100",
            usageType: "MainCompanyNumber",
            features: ["CallerId"],
          },
          {
            id: "n-sales",
            phoneNumber: SYNTHETIC_SALES_DID,
            usageType: "DirectNumber",
            extension: { id: SYNTHETIC_QUEUE_EXTENSION.id },
            features: ["CallerId"],
          },
        ],
      };
    },
    callQueues: async (page) => {
      calls.push(`callQueues:${page}`);
      return {
        records: [
          {
            id: SYNTHETIC_QUEUE_EXTENSION.id,
            extensionNumber: SYNTHETIC_QUEUE_EXTENSION.number,
            name: SYNTHETIC_QUEUE_EXTENSION.name,
          },
        ],
      };
    },
    callQueueMembers: async (id) => {
      calls.push(`members:${id}`);
      return { records: [{ id: SYNTHETIC_USER_EXTENSION.id }] };
    },
  };
}

const actorRequest: Request = Object.assign(Object.create(express.request), {
  method: "POST",
  originalUrl: "/api/v1/admin/sales-intelligence/numbers/x/rebuild",
  headers: {},
  vantageAuth: {
    kind: "user",
    userId: "synthetic-owner",
    email: "owner@example.test",
    roles: ["owner"],
  },
});

test(
  "CSI-04 isolated replica proof",
  { skip: !enabled, timeout: 240_000 },
  async (t) => {
    assert.equal(process.env.TEST_MODE, "true");
    assert.match(getMongoDatabaseName(), /^testvantagemovers_csi04[a-z0-9]+$/);
    assert.equal(
      process.env.MONGO_URI,
      "mongodb://127.0.0.1:27189/?replicaSet=csi01",
    );
    await connectMongo();
    const db = mongoose.connection.useDb(getMongoDatabaseName(), {
      useCache: true,
    }).db!;
    assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
    assert.equal((await applyCsiMigration()).ready, true);
    const Interaction = getCallInteractionModel();
    const ContactNumber = getContactNumberModel();
    const Snapshot = getRingCentralDirectorySnapshotModel();
    const Jobs = getSalesIntelligenceJobModel();
    const Audit = getSalesIntelligenceAuditEventModel();
    const Commands = getSalesIntelligenceCommandExecutionModel();
    const SyncState = getSalesIntelligenceSyncStateModel();

    const fields = {
      adminId: "synthetic-owner",
      email: "owner@example.test",
      role: "owner",
      timestamp: String(Date.now()),
      requestId: "synthetic-request",
      method: actorRequest.method,
      path: actorRequest.originalUrl,
    };
    actorRequest.headers = {
      "x-vantage-admin-user-id": fields.adminId,
      "x-vantage-admin-email": fields.email,
      "x-vantage-admin-role": fields.role,
      "x-vantage-admin-timestamp": fields.timestamp,
      "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(
        fields,
        process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!,
      ),
    };
    const actor: CsiActor = requireCsiOwner(actorRequest);

    const app = express();
    app.use(express.json());
    app.use("/api/v1", requireApiSecret);
    app.use(createSalesIntelligenceBoundaryRouter());
    app.use(createSalesIntelligenceAdminRouter());
    app.use(
      createSalesIntelligenceCronRouter({
        runDirectorySync: () =>
          runDirectorySyncOnce({
            fetcher: fakeFetcher(0),
            recordEvent: noEvent,
          }),
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ownerHeaders = (
      method: string,
      routePath: string,
      extra: Record<string, string> = {},
    ) => {
      const f = {
        adminId: "synthetic-owner",
        email: "owner@example.test",
        role: "owner",
        timestamp: String(Date.now()),
        requestId: "req-route",
        method,
        path: routePath,
      };
      return {
        "content-type": "application/json",
        "x-api-secret": "synthetic-global",
        "x-vantage-admin-user-id": f.adminId,
        "x-vantage-admin-email": f.email,
        "x-vantage-admin-role": f.role,
        "x-vantage-admin-timestamp": f.timestamp,
        "x-vantage-admin-request-id": f.requestId,
        "x-vantage-admin-signature": computeAdminActorSignature(
          f,
          process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!,
        ),
        ...extra,
      };
    };
    const call = async (
      method: string,
      routePath: string,
      init: { headers?: Record<string, string>; body?: unknown } = {},
    ) => {
      const response = await fetch(base + routePath, {
        method,
        headers: init.headers ?? { "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(30_000),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    };
    const snapshotAll = async () => ({
      numbers: await ContactNumber.find({}).sort({ _id: 1 }).lean(),
      interactions: await Interaction.find({}).sort({ _id: 1 }).lean(),
      jobs: await Jobs.find({}).sort({ _id: 1 }).lean(),
      audit: await Audit.find({}).sort({ _id: 1 }).lean(),
    });

    try {
      await t.test(
        "directory sync: fenced lease, digest-deduplicated snapshots, bound of 30 (exercised as 3), honest failure states; loadDirectoryLookup reads the latest snapshot",
        async () => {
          assert.equal(
            (await loadDirectoryLookup(SYNTHETIC_ACCOUNT_ID)).isEmpty,
            true,
            "no snapshot: empty lookup, roles stay unknown",
          );

          const first = await runDirectorySyncOnce({
            fetcher: fakeFetcher(0),
            recordEvent: noEvent,
            bound: 3,
          });
          assert.equal(first.skipped, false);
          assert.equal(first.error_code, null);
          assert.equal(first.changed, true);
          assert.deepEqual(first.counts, {
            extensions: 3,
            users: 2,
            departments: 1,
            company_numbers: 2,
            queues: 1,
          });
          assert.equal(
            await Snapshot.countDocuments({
              provider_account_id: SYNTHETIC_ACCOUNT_ID,
            }),
            1,
          );
          const state1 = await SyncState.findOne({
            scope: DIRECTORY_SCOPE,
          }).lean();
          assert.equal(state1?.lease_owner, null);
          assert.equal(state1?.consecutive_failures, 0);
          assert.ok(state1?.cursor?.last_sync_to);

          const same = await runDirectorySyncOnce({
            fetcher: fakeFetcher(0),
            recordEvent: noEvent,
            bound: 3,
          });
          assert.equal(
            same.changed,
            false,
            "identical digest: no new document",
          );
          assert.equal(same.snapshot_id, first.snapshot_id);
          assert.equal(
            await Snapshot.countDocuments({
              provider_account_id: SYNTHETIC_ACCOUNT_ID,
            }),
            1,
          );

          const next = await runDirectorySyncOnce({
            fetcher: fakeFetcher(1),
            recordEvent: noEvent,
            bound: 5,
          });
          assert.equal(next.changed, true);
          await new Promise((resolve) => setTimeout(resolve, 5));
          const revertEarly = await runDirectorySyncOnce({
            fetcher: fakeFetcher(0),
            recordEvent: noEvent,
            bound: 5,
          });
          assert.equal(
            revertEarly.changed,
            true,
            "A→B→A advances taken_at on the existing A digest",
          );
          assert.equal(revertEarly.error_code, null);
          assert.equal(revertEarly.snapshot_id, first.snapshot_id);
          const afterRevertEarly =
            await loadDirectoryLookup(SYNTHETIC_ACCOUNT_ID);
          assert.equal(
            afterRevertEarly.snapshot_id,
            first.snapshot_id,
            "latest-by-taken_at is A again, not stale B",
          );
          assert.equal(afterRevertEarly.extensionByNumber("110"), null);
          assert.equal(
            await Snapshot.countDocuments({
              provider_account_id: SYNTHETIC_ACCOUNT_ID,
            }),
            2,
            "no third document for the reverted digest",
          );

          for (const version of [1, 2, 3]) {
            const run = await runDirectorySyncOnce({
              fetcher: fakeFetcher(version),
              recordEvent: noEvent,
              bound: 3,
            });
            assert.equal(run.changed, true);
            await new Promise((resolve) => setTimeout(resolve, 5)); // distinct taken_at milliseconds
          }
          const kept = await Snapshot.find({
            provider_account_id: SYNTHETIC_ACCOUNT_ID,
          })
            .sort({ taken_at: -1 })
            .lean();
          assert.equal(kept.length, 3, "bounded to the newest N snapshots");
          assert.equal(kept[0]!.counts.extensions, 6, "newest kept");
          assert.equal(
            kept.some((s) => s._id.toString() === first.snapshot_id),
            false,
            "oldest pruned",
          );

          const lookup = await loadDirectoryLookup(SYNTHETIC_ACCOUNT_ID);
          assert.equal(lookup.isEmpty, false);
          assert.equal(
            lookup.snapshot_id,
            String(kept[0]!._id),
            "latest snapshot is the one capture reads",
          );
          assert.equal(
            lookup.extensionByNumber("101")?.id,
            SYNTHETIC_USER_EXTENSION.id,
          );
          assert.equal(
            lookup.companyNumberByE164(SYNTHETIC_SALES_DID)?.extension_id,
            SYNTHETIC_QUEUE_EXTENSION.id,
          );
          assert.equal(
            lookup.isQueueExtension(SYNTHETIC_QUEUE_EXTENSION.id),
            true,
          );

          const [a, b] = await Promise.all([
            runDirectorySyncOnce({
              fetcher: fakeFetcher(3),
              recordEvent: noEvent,
              owner: "dir-a",
            }),
            runDirectorySyncOnce({
              fetcher: fakeFetcher(3),
              recordEvent: noEvent,
              owner: "dir-b",
            }),
          ]);
          assert.equal(
            [a.skip_reason, b.skip_reason].filter((r) => r === "lease_held")
              .length,
            1,
            "one directory lease holder",
          );

          const before = await Snapshot.countDocuments();
          const throttled = await runDirectorySyncOnce({
            fetcher: fakeFetcher(9, { throttleOn: "extensions" }),
            recordEvent: noEvent,
          });
          assert.equal(throttled.error_code, "provider_throttled");
          assert.equal(throttled.changed, false);
          assert.equal(
            await Snapshot.countDocuments(),
            before,
            "a failed sync writes no snapshot",
          );
          assert.equal(
            (await SyncState.findOne({ scope: DIRECTORY_SCOPE }).lean())
              ?.consecutive_failures,
            1,
          );
          assert.equal(
            (await SyncState.findOne({ scope: DIRECTORY_SCOPE }).lean())
              ?.lease_owner,
            null,
            "lease released on failure",
          );

          process.env.RINGCENTRAL_ACCOUNT_ID = "800000000002";
          const mismatch = await runDirectorySyncOnce({
            fetcher: fakeFetcher(9),
            recordEvent: noEvent,
            configuredAccountId: "800000000002",
          });
          assert.equal(
            mismatch.error_code,
            "account_mismatch",
            "provider account disagreeing with configuration fails closed",
          );
          process.env.RINGCENTRAL_ACCOUNT_ID = "";

          process.env.SALES_INTELLIGENCE_DIRECTORY_SYNC = "false";
          assert.deepEqual(
            await runDirectorySyncOnce({
              fetcher: fakeFetcher(0),
              recordEvent: noEvent,
            }).then((s) => [s.skipped, s.skip_reason]),
            [true, "disabled"],
          );
          process.env.SALES_INTELLIGENCE_DIRECTORY_SYNC = "true";
        },
      );

      await t.test(
        "snapshot is read by the projection: party roles resolve to user/queue and the company DID is classified",
        async () => {
          const d = inboundQueueAnsweredDeliveries("s-dir-1");
          const results = await observeRingCentralWebhookEvents(
            normalizeWebhookPartyObservations(d.answered, at(8)),
            {
              now: () => at(8),
              resolveRoute: noRoute,
              recordEvent: noEvent,
              configuredAccountId: null,
              // default `directory` dependency = loadDirectoryLookup → latest synced snapshot
            },
          );
          assert.ok(results[0]?.ok, JSON.stringify(results));
          const row = await Interaction.findById(
            results[0]!.result.interaction_id,
          ).lean();
          assert.equal(row?.company_e164, SYNTHETIC_SALES_DID);
          assert.deepEqual(row?.parties.map((p) => p.role).sort(), [
            "external",
            "queue",
            "user",
          ]);
          assert.equal(row?.direction, "Inbound");
        },
      );

      await t.test(
        "directory sync cron: auth, flag and lease mapping through the real router",
        async () => {
          const unauthorized = await fetch(
            base + CSI_CRON_PATHS.directorySync,
            { method: "POST" },
          );
          assert.equal(unauthorized.status, 401);
          const run = await fetch(base + CSI_CRON_PATHS.directorySync, {
            method: "POST",
            headers: { authorization: "Bearer synthetic-cron-secret" },
          });
          const body = (await run.json()) as {
            ok: boolean;
            skipped: boolean;
            summary: { changed: boolean; error_code: string | null };
          };
          assert.equal(run.status, 200);
          assert.equal(body.ok, true);
          assert.equal(body.skipped, false);
          assert.equal(body.summary.error_code, null);
        },
      );

      // ------------------------------------------------------------------
      // Rebuild
      // ------------------------------------------------------------------
      let numberId = "";
      let tombstoneId = "";
      await t.test(
        "rebuild: durable job via the idempotent Owner command; worker recount equals a fresh count, excludes merged tombstones, and is idempotent",
        async () => {
          const seedDeps = {
            now: () => at(0),
            directory,
            resolveRoute: noRoute,
          };
          // Two canonical interactions on the customer number plus a merged pair (tombstone keeps contact_number_id).
          const life = inboundQueueAnsweredDeliveries("s-rb-1");
          for (const [delivery, when] of [
            [life.ringing, 0],
            [life.answered, 8],
            [life.disconnected, 95],
          ] as const) {
            await applyInteractionObservation(
              SYNTHETIC_ACCOUNT_ID,
              {
                kind: "webhook",
                events: normalizeWebhookPartyObservations(delivery, at(when)),
                proof_ref: `webhook:${delivery.uuid}`,
              },
              { ...seedDeps, now: () => at(when) },
            );
          }
          const out = outboundUnansweredDeliveries("s-rb-2");
          // Outbound fixture targets CUSTOMER_B; retarget to the same customer so both land on one number.
          for (const delivery of [out.setup, out.disconnected]) {
            for (const party of delivery.body.parties)
              (party.to as { phoneNumber: string }).phoneNumber =
                SYNTHETIC_CUSTOMER;
            await applyInteractionObservation(
              SYNTHETIC_ACCOUNT_ID,
              {
                kind: "webhook",
                events: normalizeWebhookPartyObservations(delivery, at(200)),
                proof_ref: `webhook:${delivery.uuid}`,
              },
              { ...seedDeps, now: () => at(200) },
            );
          }
          // Provisional rows (CSI-02 merge recipe): webhook without sessionId, Call Log with sessionId only, then a bridge record naming both.
          const noSid = webhookDelivery({
            uuid: "rb-m-1",
            telephonySessionId: "s-rb-3",
            sessionId: null,
            sequence: 1,
            eventTime: at(300),
            parties: inboundQueueAnsweredDeliveries(
              "s-rb-3",
            ).disconnected.body.parties.map((p) => ({
              id: p.id,
              extensionId: p.extensionId,
              direction: p.direction,
              status: p.status.code,
              from: p.from,
              to: p.to,
              queueCall: p.queueCall,
            })),
          });
          await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            {
              kind: "webhook",
              events: normalizeWebhookPartyObservations(noSid, at(300)),
              proof_ref: "webhook:rb-m-1",
            },
            { ...seedDeps, now: () => at(300) },
          );
          await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            {
              kind: "call_log",
              record: sessionIdOnlyCallLog("s-rb-3"),
              proof_ref: "call_log:sidonly",
            },
            { ...seedDeps, now: () => at(301) },
          );
          const bridgeRecord = inboundConnectedCallLog("s-rb-3");
          bridgeRecord.sessionId = "s-rb-3-sid";
          const merged = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            {
              kind: "call_log",
              record: bridgeRecord,
              proof_ref: "call_log:bridge",
            },
            { ...seedDeps, now: () => at(302) },
          );
          assert.equal(
            merged.merged_interaction_ids.length,
            1,
            "a same-session provider bridge merged two rows",
          );
          tombstoneId = merged.merged_interaction_ids[0]!;
          const tombstone = await Interaction.findById(tombstoneId).lean();
          assert.ok(
            tombstone?.merged_into_id,
            "tombstone exists and still carries contact_number_id",
          );

          const number = await ContactNumber.findOne({
            e164: SYNTHETIC_CUSTOMER,
          }).lean();
          assert.ok(number);
          numberId = String(number._id);
          const canonicalCount = await Interaction.countDocuments({
            contact_number_id: number._id,
            merged_into_id: null,
          });
          assert.equal(
            number.rollups.interactions_total,
            canonicalCount,
            "incremental rollups already match the canonical count",
          );
          assert.ok(
            (await Interaction.countDocuments({
              contact_number_id: number._id,
            })) > canonicalCount,
            "the tombstone would double count without the filter",
          );

          // Corrupt the derived fields (never the business facts) to prove the rebuild restores them from evidence.
          await ContactNumber.updateOne(
            { _id: number._id },
            {
              $set: {
                "rollups.interactions_total": 99,
                "rollups.inbound_total": 0,
                search_terms: ["stale-term"],
                provider_names: [],
              },
              $inc: { revision: 1 },
            },
          );
          const corrupted = await ContactNumber.findById(number._id).lean();

          // Owner command: idempotent through the command ledger; expected_revision CAS at request time.
          await assert.rejects(
            () =>
              enqueueNumberRebuild({
                actor,
                number_id: numberId,
                expected_revision: corrupted!.revision - 1,
                reason: "stale",
                idempotency_key: "rb-stale",
              }),
            (e: unknown) =>
              e instanceof CsiError && e.code === "REVISION_CONFLICT",
          );
          const requested = await enqueueNumberRebuild({
            actor,
            number_id: numberId,
            expected_revision: corrupted!.revision,
            reason: "Owner requested recount",
            idempotency_key: "rb-1",
          });
          assert.equal(requested.replayed, false);
          const replay = await enqueueNumberRebuild({
            actor,
            number_id: numberId,
            expected_revision: corrupted!.revision,
            reason: "Owner requested recount",
            idempotency_key: "rb-1",
          });
          assert.equal(replay.replayed, true);
          assert.equal(
            replay.job_id,
            requested.job_id,
            "same key + payload replays the stored response",
          );
          await assert.rejects(
            () =>
              enqueueNumberRebuild({
                actor,
                number_id: numberId,
                expected_revision: corrupted!.revision,
                reason: "different payload",
                idempotency_key: "rb-1",
              }),
            (e: unknown) =>
              e instanceof CsiError && e.code === "IDEMPOTENCY_CONFLICT",
          );
          assert.equal(await Jobs.countDocuments({ stage: "rebuild" }), 1);
          assert.equal(
            await Commands.countDocuments({ command: "rebuild_number" }),
            1,
          );
          const requestedAudit = await Audit.findOne({
            subject_key: `number:${numberId}`,
            event_kind: "number.rebuild_requested",
          }).lean();
          assert.ok(requestedAudit);
          assert.equal(
            (await ContactNumber.findById(number._id).lean())?.rollups
              .interactions_total,
            99,
            "the command only enqueues; nothing is rebuilt inline",
          );

          // Worker: recount under revision CAS inside completion.
          const outcome = await runRebuildJob(requested.job_id, {
            owner: "rebuild-a",
          });
          assert.equal(outcome.status, "completed");
          assert.ok(
            outcome.status === "completed" && outcome.result.kind === "number",
          );
          assert.equal(outcome.result.changed, true);
          assert.equal(
            outcome.result.interactions_total,
            canonicalCount,
            "tombstone excluded",
          );
          const rebuilt = await ContactNumber.findById(number._id).lean();
          assert.equal(rebuilt?.revision, corrupted!.revision + 1);
          assert.equal(rebuilt?.rollups.interactions_total, canonicalCount);
          assert.equal(
            rebuilt?.rollups.inbound_total,
            number.rollups.inbound_total,
            "restored to the incremental value",
          );
          assert.equal(
            rebuilt?.rollups.outbound_total,
            number.rollups.outbound_total,
          );
          assert.deepEqual(rebuilt?.provider_names, number.provider_names);
          assert.deepEqual(
            [...rebuilt!.search_terms].sort(),
            [...number.search_terms].sort(),
            "stale term dropped; evidence terms restored",
          );
          assert.equal(
            rebuilt?.classification,
            number.classification,
            "no business fact changed",
          );
          assert.equal(
            rebuilt?.contact_eligibility.state,
            number.contact_eligibility.state,
          );
          const evidence = await loadRebuildEvidence(numberId);
          const fresh = recountNumber({
            number: evidence.number!,
            interactions: evidence.interactions,
            attachments: evidence.attachments,
            open_outreach_count: evidence.open_outreach_count,
          });
          assert.equal(
            sameRebuiltFields(
              {
                rollups: rebuilt!.rollups as never,
                provider_names: rebuilt!.provider_names,
                search_terms: rebuilt!.search_terms,
                first_observed_at: rebuilt!.first_observed_at,
                last_activity_at: rebuilt!.last_activity_at,
              },
              fresh,
            ),
            true,
            "stored fields equal a fresh recount",
          );
          const rebuiltAudit = await Audit.findOne({
            subject_key: `number:${numberId}`,
            event_kind: "number.rebuilt",
          }).lean();
          assert.equal(rebuiltAudit?.actor.request_id, requested.job_id);
          const job = await Jobs.findById(requested.job_id).lean();
          assert.equal(job?.status, "completed");
          assert.equal((job?.result as { changed: boolean }).changed, true);

          // Idempotent: a second rebuild of the same number changes nothing.
          const again = await enqueueNumberRebuild({
            actor,
            number_id: numberId,
            expected_revision: rebuilt!.revision,
            reason: "again",
            idempotency_key: "rb-2",
          });
          const second = await runRebuildJob(again.job_id, {
            owner: "rebuild-b",
          });
          assert.ok(
            second.status === "completed" && second.result.kind === "number",
          );
          assert.equal(second.result.changed, false);
          assert.equal(
            (await ContactNumber.findById(number._id).lean())?.revision,
            rebuilt!.revision,
            "no revision bump on a no-op rebuild",
          );
          assert.equal(
            await Audit.countDocuments({
              subject_key: `number:${numberId}`,
              event_kind: "number.rebuilt",
            }),
            1,
            "no audit row for a no-op",
          );
          assert.deepEqual(
            await runRebuildJob(again.job_id, { owner: "rebuild-c" }),
            { status: "not_claimable", job_id: again.job_id },
            "completed job is not re-runnable",
          );
        },
      );

      await t.test(
        "rebuild: concurrent capture bumps the revision → CAS conflict retries; expired lease cannot complete; rebuild-all fans out dedupe-keyed per-number jobs",
        async () => {
          const number = await ContactNumber.findById(numberId).lean();
          const req = await enqueueNumberRebuild({
            actor,
            number_id: numberId,
            expected_revision: number!.revision,
            reason: "race",
            idempotency_key: "rb-race",
          });
          // Corrupt then let a "concurrent capture" bump the revision between claim and completion via a claim-time hook.
          await ContactNumber.updateOne(
            { _id: number!._id },
            {
              $set: { "rollups.interactions_total": 77 },
              $inc: { revision: 1 },
            },
          );
          const claimed = await claimCsiJob(
            "racer",
            req.job_id,
            60_000,
            "rebuild",
          );
          assert.ok(claimed);
          await Jobs.updateOne(
            { _id: req.job_id },
            { $set: { leased_until: new Date(Date.now() - 1000) } },
          ); // crash simulation
          const successor = await runRebuildJob(req.job_id, {
            owner: "successor",
          });
          assert.ok(
            successor.status === "completed" &&
              successor.result.kind === "number" &&
              successor.result.changed === true,
          );
          assert.equal(
            (await ContactNumber.findById(numberId).lean())?.rollups
              .interactions_total,
            successor.result.interactions_total,
          );

          const all = await enqueueRebuildAll({
            actor,
            reason: "full recount",
            idempotency_key: "rb-all-1",
          });
          const fanned = await runRebuildJob(all.job_id, {
            owner: "all-worker",
          });
          assert.ok(
            fanned.status === "completed" && fanned.result.kind === "all",
          );
          const numbers = await ContactNumber.countDocuments();
          assert.equal(fanned.result.numbers, numbers);
          assert.equal(fanned.result.jobs_created, numbers);
          assert.equal(
            await Jobs.countDocuments({
              stage: "rebuild",
              status: "pending",
              subject_key: { $ne: REBUILD_ALL_SUBJECT },
            }),
            numbers,
          );
          const drained = await drainRebuildJobs(
            50,
            { owner: "drain" },
            { deadlineMs: 60_000 },
          );
          assert.equal(drained.claimed, numbers);
          assert.equal(drained.completed, numbers);
          assert.equal(
            await Jobs.countDocuments({
              stage: "rebuild",
              status: { $in: ["pending", "retry"] },
            }),
            0,
          );

          // Retry of the same all-job after a live revision bump must not IDEMPOTENCY_CONFLICT.
          await ContactNumber.updateOne(
            { _id: numberId },
            { $inc: { revision: 1 } },
          );
          await Jobs.updateOne(
            { _id: all.job_id },
            {
              $set: {
                status: "pending",
                lease_owner: null,
                leased_until: null,
                completed_at: null,
              },
            },
          );
          const retried = await runRebuildJob(all.job_id, {
            owner: "all-retry",
          });
          assert.equal(retried.status, "completed", JSON.stringify(retried));
          assert.ok(
            retried.status === "completed" && retried.result.kind === "all",
          );
          assert.equal(retried.result.numbers, numbers);
          assert.equal(
            retried.result.jobs_existing,
            numbers,
            "stable input_revision:1 reuses the per-number jobs",
          );
          assert.equal(retried.result.jobs_created, 0);

          // Dispatch through the shared wake-up path.
          const viaQueue = await enqueueNumberRebuild({
            actor,
            number_id: numberId,
            expected_revision: (await ContactNumber.findById(numberId).lean())!
              .revision,
            reason: "queue",
            idempotency_key: "rb-queue",
          });
          const dispatched = await dispatchCsiWakeup({
            job_id: viaQueue.job_id,
          });
          assert.equal(dispatched.status, "dispatched");
          assert.equal((dispatched as { stage: string }).stage, "rebuild");
          assert.equal(
            (await Jobs.findById(viaQueue.job_id).lean())?.status,
            "completed",
          );
        },
      );

      await t.test(
        "routes: Owner-only reads and the rebuild command through the real guard; flag-off 404; idempotency replay and conflict; reads mutate nothing",
        async () => {
          const numbersPath = `${CSI_ADMIN_PREFIX}/numbers`;
          const detailPath = `${numbersPath}/${numberId}`;
          const timelinePath = `${detailPath}/timeline`;
          const rebuildPath = `${detailPath}/rebuild`;
          const before = await snapshotAll();

          const search = await call("GET", `${numbersPath}?q=0200`, {
            headers: ownerHeaders("GET", numbersPath),
          });
          assert.equal(search.status, 200, JSON.stringify(search.body));
          const items = (
            search.body.data as {
              items: Array<{
                e164: string;
                rollups: { interactions_total: number };
              }>;
            }
          ).items;
          assert.ok(
            items.some((i) => i.e164 === SYNTHETIC_CUSTOMER),
            "suffix search finds the customer number",
          );
          assert.equal(typeof search.body.as_of, "string");
          assert.ok(search.body.coverage);

          const detail = await call("GET", detailPath, {
            headers: ownerHeaders("GET", detailPath),
          });
          assert.equal(detail.status, 200, JSON.stringify(detail.body));
          const data = detail.body.data as {
            id: string;
            e164: string;
            connections: { interactions_total_recount: number };
            rollups: { interactions_total: number };
          };
          assert.equal(data.id, numberId);
          assert.equal(
            data.e164,
            SYNTHETIC_CUSTOMER,
            "full customer number for the Owner",
          );
          assert.equal(
            data.connections.interactions_total_recount,
            data.rollups.interactions_total,
          );

          const timeline = await call("GET", `${timelinePath}?limit=2`, {
            headers: ownerHeaders("GET", timelinePath),
          });
          assert.equal(timeline.status, 200, JSON.stringify(timeline.body));
          const page = timeline.body.data as {
            items: Array<{ kind: string; evidence_refs: string[] }>;
            cursor: string | null;
          };
          assert.equal(page.items.length, 2);
          assert.ok(page.cursor);
          assert.equal(
            page.items.some((i) =>
              i.evidence_refs.includes(`interaction:${tombstoneId}`),
            ),
            false,
            "tombstone never appears",
          );

          assert.equal(
            (
              await call("GET", detailPath, {
                headers: {
                  "content-type": "application/json",
                  "x-api-secret": "synthetic-global",
                },
              })
            ).status,
            403,
            "broad secret alone is not the Owner",
          );
          assert.deepEqual(await snapshotAll(), before, "reads changed no row");

          const body = {
            command: "rebuild_number",
            expected_revision: (await ContactNumber.findById(numberId).lean())!
              .revision,
            reason: "route",
          };
          const accepted = await call("POST", rebuildPath, {
            headers: ownerHeaders("POST", rebuildPath, {
              "idempotency-key": "route-1",
            }),
            body,
          });
          assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
          const first = accepted.body.data as {
            job_id: string;
            replayed: boolean;
          };
          assert.equal(first.replayed, false);
          const replayed = await call("POST", rebuildPath, {
            headers: ownerHeaders("POST", rebuildPath, {
              "idempotency-key": "route-1",
            }),
            body,
          });
          assert.equal(replayed.status, 202);
          assert.deepEqual(
            replayed.body.data as { job_id: string; replayed: boolean },
            {
              ...(replayed.body.data as object),
              job_id: first.job_id,
              replayed: true,
            },
          );
          const conflict = await call("POST", rebuildPath, {
            headers: ownerHeaders("POST", rebuildPath, {
              "idempotency-key": "route-1",
            }),
            body: { ...body, reason: "changed" },
          });
          assert.equal(conflict.status, 409);
          assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");
          const stale = await call("POST", rebuildPath, {
            headers: ownerHeaders("POST", rebuildPath, {
              "idempotency-key": "route-2",
            }),
            body: { ...body, expected_revision: body.expected_revision + 5 },
          });
          assert.equal(stale.status, 409);
          assert.equal(stale.body.code, "REVISION_CONFLICT");
          assert.equal(
            (
              await call("POST", rebuildPath, {
                headers: ownerHeaders("POST", rebuildPath),
                body,
              })
            ).status,
            400,
            "Idempotency-Key required",
          );
          assert.equal(
            await Jobs.countDocuments({ _id: first.job_id, status: "pending" }),
            1,
            "the command enqueued a durable job; nothing ran inline",
          );

          process.env.SALES_INTELLIGENCE_ENABLED = "false";
          const disabled = await call("GET", detailPath, {
            headers: ownerHeaders("GET", detailPath),
          });
          assert.equal(disabled.status, 404);
          assert.equal(disabled.body.code, "FEATURE_DISABLED");
          process.env.SALES_INTELLIGENCE_ENABLED = "true";
        },
      );

      await t.test(
        "LP-06 Numbers time sorts: three sorts x two directions page globally through the real route, nulls last, index-served, cursor bound, attached Lead progress batched, reads mutate nothing",
        async () => {
          const numbersPath = `${CSI_ADMIN_PREFIX}/numbers`;
          const day = (n: number) => new Date(Date.UTC(2026, 7, 1 + n, 12));
          const human = [3, null, 7, 7, null, 1, 9, null, 2, 7, null, 5, null, 4];
          const firstObserved = [4, 2, 2, 8, 1, 6, 2, 3, 9, 5, 7, 1, 6, 10];
          const lastActivity = [3, 5, 5, 1, 9, 2, 5, 8, 7, 4, 6, 0, 2, 11];
          const seeded = await ContactNumber.insertMany(
            human.map((h, i) => ({
              e164: `+1555019${String(1000 + i)}`,
              national_ten: `555019${String(1000 + i)}`,
              digits_reversed: `${String(1000 + i).split("").reverse().join("")}9100555`,
              kind: "external",
              classification: "unknown",
              search_terms: ["lp06 synthetic"],
              first_observed_at: day(firstObserved[i]!),
              last_activity_at: day(40 + lastActivity[i]!),
              rollups: {
                human_conversations_total: h === null ? 0 : 1,
                last_human_conversation_at: h === null ? null : day(h),
              },
            })),
          );
          // Two decoys the listing must never show.
          await ContactNumber.insertMany([
            { e164: "+15550192000", digits_reversed: "00029100555", kind: "extension", first_observed_at: day(1), last_activity_at: day(50) },
            { e164: "+15550192001", digits_reversed: "10029100555", kind: "external", purged_at: day(2), first_observed_at: day(1), last_activity_at: day(50) },
          ]);
          // Edges for the attached Lead progress statuses: one resolved, one multiple.
          const leadA = new mongoose.Types.ObjectId();
          const leadB = new mongoose.Types.ObjectId();
          const edge = (numberId: mongoose.Types.ObjectId, lead: mongoose.Types.ObjectId) => ({
            contact_number_id: numberId,
            lead_ref: { model: "FormLead", id: lead },
            state: "attached",
            certainty: "likely",
            evidence: [{ source: "lead_phone_live", field_path: "normalized_phone_number", observed_at: day(0), window_from: day(0), window_to: day(1) }],
          });
          await getNumberLeadAttachmentModel().create([edge(seeded[0]!._id, leadA), edge(seeded[1]!._id, leadA), edge(seeded[1]!._id, leadB)]);

          const fieldOf = { last_activity: "last_activity_at", last_human_conversation: "rollups.last_human_conversation_at", first_observed: "first_observed_at" } as const;
          const valueOf = (row: Record<string, unknown>, path: string) =>
            path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), row) as Date | null | undefined;
          const live = (await ContactNumber.find({ kind: "external", purged_at: null }).lean()) as unknown as Array<Record<string, unknown> & { _id: mongoose.Types.ObjectId }>;
          assert.ok(live.length >= 14);
          const expected = (sort: keyof typeof fieldOf, direction: "asc" | "desc") => {
            const dir = direction === "desc" ? -1 : 1;
            const byId = (a: { _id: mongoose.Types.ObjectId }, b: { _id: mongoose.Types.ObjectId }) => dir * (String(a._id) < String(b._id) ? -1 : String(a._id) > String(b._id) ? 1 : 0);
            const valued = live.filter((r) => valueOf(r, fieldOf[sort]) != null).sort((a, b) => dir * (+valueOf(a, fieldOf[sort])! - +valueOf(b, fieldOf[sort])!) || byId(a, b));
            const empty = live.filter((r) => valueOf(r, fieldOf[sort]) == null).sort(byId);
            return [...valued, ...empty].map((r) => String(r._id));
          };
          const before = await snapshotAll();
          for (const sort of ["last_activity", "last_human_conversation", "first_observed"] as const) {
            for (const direction of ["desc", "asc"] as const) {
              const seen: string[] = [];
              let cursor: string | null = null;
              for (let guard = 0; guard < 40; guard += 1) {
                const qs = `sort=${sort}&direction=${direction}&limit=4${cursor ? `&cursor=${cursor}` : ""}`;
                const page = await call("GET", `${numbersPath}?${qs}`, { headers: ownerHeaders("GET", numbersPath) });
                assert.equal(page.status, 200, JSON.stringify(page.body));
                const data = page.body.data as {
                  items: Array<{ id: string; attached_lead_progress?: { status: string; lead_ref?: { id: string } } }>;
                  cursor: string | null;
                  sort: { sort: string; direction: string };
                };
                assert.deepEqual(data.sort, { sort, direction });
                for (const item of data.items) {
                  assert.ok(item.attached_lead_progress, "every listed Number carries its batched attachment status");
                  if (item.id === String(seeded[0]!._id)) {
                    assert.equal(item.attached_lead_progress.status, "resolved");
                    assert.equal(item.attached_lead_progress.lead_ref?.id, String(leadA));
                  } else if (item.id === String(seeded[1]!._id)) {
                    // S4-NUMBER: `outreach_records_total` (final spec §9.1 line 5) is present on every status; no Lead fields otherwise.
                    assert.deepEqual(item.attached_lead_progress, { status: "multiple", outreach_records_total: item.attached_lead_progress.outreach_records_total }, "no Lead fields on multiple");
                  } else if (seeded.some((s) => String(s._id) === item.id)) {
                    assert.deepEqual(item.attached_lead_progress, { status: "none", outreach_records_total: 0 });
                  }
                }
                seen.push(...data.items.map((i) => i.id));
                cursor = data.cursor;
                if (!cursor) break;
              }
              assert.deepEqual(seen, expected(sort, direction), `${sort} ${direction}: global, stable, nulls last`);
            }
          }
          const humanTail = expected("last_human_conversation", "asc").slice(-5).map((id) => valueOf(live.find((r) => String(r._id) === id)!, fieldOf.last_human_conversation));
          assert.deepEqual(humanTail.map((v) => v ?? null), [null, null, null, null, null], "no-conversation Numbers are last even ascending");

          // A cursor is bound to its sort, direction and filters.
          const firstPage = await call("GET", `${numbersPath}?sort=first_observed&direction=asc&limit=3`, { headers: ownerHeaders("GET", numbersPath) });
          const bound = (firstPage.body.data as { cursor: string }).cursor;
          for (const qs of [`sort=first_observed&direction=desc`, `sort=last_activity&direction=asc`, `sort=first_observed&direction=asc&classification=customer`, `cursor-only`]) {
            const path = qs === "cursor-only" ? `${numbersPath}?cursor=${bound}` : `${numbersPath}?${qs}&cursor=${bound}`;
            const rejected = await call("GET", path, { headers: ownerHeaders("GET", numbersPath) });
            assert.equal(rejected.status, 400, qs);
            assert.equal(rejected.body.code, "INVALID_INPUT", qs);
          }
          const noLeadSort = await call("GET", `${numbersPath}?sort=last_lead_progress`, { headers: ownerHeaders("GET", numbersPath) });
          assert.equal(noLeadSort.status, 400, "no Lead progress sort on Numbers");
          // The historical request is unchanged: legacy cursor keys.
          const legacy = await call("GET", `${numbersPath}?limit=3`, { headers: ownerHeaders("GET", numbersPath) });
          assert.deepEqual(
            Object.keys(JSON.parse(Buffer.from((legacy.body.data as { cursor: string }).cursor, "base64url").toString("utf8"))).sort(),
            ["id", "last_activity_at"],
          );
          assert.deepEqual(
            (legacy.body.data as { items: Array<{ id: string }> }).items.map((i) => i.id),
            expected("last_activity", "desc").slice(0, 3),
          );
          assert.deepEqual(await snapshotAll(), before, "sorted reads changed no row");

          // Above the q candidate cap the page is read through the sort index (a real hint on the replica), same order.
          const real = mongoNumberRowSource();
          const forced = { find: real.find, count: async () => NUMBER_SORT_CANDIDATE_CAP + 1 };
          const seededIds = new Set(seeded.map((s) => String(s._id)));
          for (const sort of ["last_human_conversation", "first_observed"] as const) {
            for (const direction of ["desc", "asc"] as const) {
              const seen: string[] = [];
              let cursor: string | undefined;
              for (let guard = 0; guard < 20; guard += 1) {
                const sq = numberSearchQuerySchema.parse({ sort, direction, q: "lp06", limit: 4, ...(cursor ? { cursor } : {}) });
                const result = await pageNumberSearch(sq, parseSearchTerm(sq.q), forced);
                assert.equal(result.hint, NUMBER_SORT_INDEXES[sort]);
                seen.push(...result.page.map((r) => String(r._id)));
                if (!result.next) break;
                cursor = result.next;
              }
              assert.deepEqual(seen, expected(sort, direction).filter((id) => seededIds.has(id)), `hinted ${sort} ${direction}`);
            }
          }

          // Value segments are index-served: no blocking SORT stage with the kind filter.
          const hasStage = (plan: unknown, stage: string): boolean =>
            Boolean(plan && typeof plan === "object" && (((plan as { stage?: string }).stage === stage) || Object.values(plan as object).some((v) => (Array.isArray(v) ? v.some((x) => hasStage(x, stage)) : hasStage(v, stage)))));
          const q = numberSearchQuerySchema.parse({ sort: "first_observed" });
          for (const sort of ["last_activity", "last_human_conversation", "first_observed"] as const) {
            for (const direction of ["desc", "asc"] as const) {
              const applied = { sort, direction };
              const plan = (await ContactNumber.collection
                .find(buildSortedNumberSearchFilter(q, applied, "value", null))
                .sort(sortedNumberMongoSort(applied, "value"))
                .limit(5)
                .explain("executionStats")) as { queryPlanner: { winningPlan: unknown } };
              assert.equal(hasStage(plan.queryPlanner.winningPlan, "SORT"), false, `${sort} ${direction} value segment has no in-memory SORT`);
              assert.equal(hasStage(plan.queryPlanner.winningPlan, "IXSCAN"), true);
            }
          }
        },
      );

      await t.test(
        "LP-06 acceptance 25: calls ingested out of order keep first_observed_at at the earliest; the bounded repair lowers a late value, raises past merged evidence, and never touches last_activity_at",
        async () => {
          const customer = "+15550193333";
          const deps = { now: () => at(20_000), directory, resolveRoute: noRoute };
          const record = (id: string, offset: number) =>
            callLogRecord({
              id: `cl-lp06-${id}`,
              telephonySessionId: `s-lp06-${id}`,
              direction: "Inbound",
              result: "Missed",
              startTime: at(offset),
              duration: 0,
              from: { phoneNumber: customer, name: "Synthetic Out Of Order" },
              to: { phoneNumber: SYNTHETIC_SALES_DID, name: "Sales Line" },
            });
          // The later call is ingested first.
          for (const [id, offset] of [["late", 9_000], ["early", 1_000], ["middle", 5_000]] as const) {
            await applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", record: record(id, offset), proof_ref: `call_log:lp06-${id}` }, deps);
          }
          const number = (await ContactNumber.findOne({ e164: customer }).lean())!;
          assert.ok(number, "the out-of-order calls created one Contact Number");
          assert.equal(number.first_observed_at.toISOString(), at(1_000).toISOString(), "capture lowers with earlierOf");
          assert.equal(number.last_activity_at.toISOString(), at(9_000).toISOString());

          // Rows written before the fix stored the first *processed* call.
          await ContactNumber.updateOne({ _id: number._id }, { $set: { first_observed_at: at(9_000) } });
          const stale = (await ContactNumber.findById(number._id).lean())!;
          const dry = await repairFirstObservedAt({ limit: 5_000, apply: false });
          assert.equal(dry.errors, 0);
          assert.ok(dry.changes.some((c) => c.id === String(number._id) && c.direction === "lowered" && c.after === at(1_000).toISOString()));
          assert.equal(dry.scanned, dry.changed + dry.unchanged + dry.errors);
          assert.deepEqual(await ContactNumber.findById(number._id).lean(), stale, "dry run writes nothing");

          const applied = await repairFirstObservedAt({ limit: 5_000, apply: true });
          assert.equal(applied.errors, 0);
          const repaired = (await ContactNumber.findById(number._id).lean())!;
          assert.equal(repaired.first_observed_at.toISOString(), at(1_000).toISOString(), "equals the earliest interaction");
          assert.equal(repaired.last_activity_at.toISOString(), stale.last_activity_at.toISOString(), "last_activity_at untouched");
          assert.deepEqual(repaired.rollups, stale.rollups, "rollups untouched");
          assert.equal(repaired.revision, stale.revision + 1);
          assert.equal(await Audit.countDocuments({ subject_key: `number:${String(number._id)}`, event_kind: "number.first_observed_repaired" }), 1);

          const again = await repairFirstObservedAt({ limit: 5_000, apply: true });
          assert.equal(again.changes.some((c) => c.id === String(number._id)), false, "a second pass is a no-op for the repaired row");
          assert.equal((await ContactNumber.findById(number._id).lean())!.revision, repaired.revision);

          // Bounded and resumable: pages of 2 visit every Number exactly once.
          const total = await ContactNumber.countDocuments({});
          let after: string | null = null;
          let scanned = 0;
          for (let guard = 0; guard < 1_000; guard += 1) {
            const page = await repairFirstObservedAt({ limit: 2, after, apply: false });
            assert.ok(page.scanned <= 2);
            scanned += page.scanned;
            after = page.next_after;
            if (!after) break;
          }
          assert.equal(scanned, total);

          // Merged evidence is not canonical: tombstoning the earliest call raises the value.
          const early = (await Interaction.findOne({ contact_number_id: number._id, started_at: at(1_000) }).lean())!;
          const middle = (await Interaction.findOne({ contact_number_id: number._id, started_at: at(5_000) }).lean())!;
          await Interaction.updateOne({ _id: early._id }, { $set: { merged_into_id: middle._id } });
          const raised = await repairFirstObservedAt({ limit: 5_000, apply: true });
          assert.ok(raised.changes.some((c) => c.id === String(number._id) && c.direction === "raised"));
          const final = (await ContactNumber.findById(number._id).lean())!;
          assert.equal(final.first_observed_at.toISOString(), at(5_000).toISOString());
          assert.equal(final.last_activity_at.toISOString(), stale.last_activity_at.toISOString());
          await Interaction.updateOne({ _id: early._id }, { $set: { merged_into_id: null } });
        },
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
