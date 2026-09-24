import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../src/models/SalesIntelligenceSyncState";
import ringCentralWebhookRoutes from "../../src/routes/ringcentral-webhook.routes";
import {
  createSalesIntelligenceCronRouter,
  CSI_CRON_PATHS,
} from "../../src/routes/sales-intelligence-cron.routes";
import {
  claimCsiJob,
  completeCsiJob,
  failCsiJob,
} from "../../src/services/salesIntelligence/jobs";
import { CsiError } from "../../src/services/salesIntelligence/auth";
import { getRingCentralCollectionName } from "../../src/services/ringcentral/ringcentral-config";
import {
  drainCaptureProjectionJobs,
  runCaptureProjectionJob,
  type CaptureProjectionWorkerDeps,
} from "../../src/services/numberActivity/captureProjectionWorker";
import { dispatchCsiWakeup } from "../../src/services/numberActivity/jobDispatch";
import {
  captureProjectionDedupeKey,
  WEBHOOK_RECEIPTS_SCOPE,
} from "../../src/services/numberActivity/webhookFanout";
import { runReceiptWatermarkRecovery } from "../../src/services/numberActivity/webhookRecovery";
import { webhookReceiptsCollection } from "../../src/services/numberActivity/webhookReceipts";
import {
  at,
  inboundQueueAnsweredDeliveries,
  outboundUnansweredDeliveries,
  SYNTHETIC_CUSTOMER,
  SYNTHETIC_CUSTOMER_B,
  syntheticDirectory,
  webhookDelivery,
} from "../../src/services/numberActivity/fixtures";
import { handleSalesIntelligenceQueueMessage } from "../../api/queues/sales-intelligence-consumer";
import {
  CALL_LOG_REFRESH_DELAY_MS,
  CALL_LOG_REFRESH_RETRY_DELAYS_MS,
  callLogRefreshDedupeKey,
  runCallLogRefreshJob,
  type CallLogRefreshDeps,
} from "../../src/services/numberActivity/callLogRefresh";
import { defaultStageHandlers } from "../../src/services/numberActivity/jobDispatch";
import { runWebhookSubscriptionMaintenance } from "../../src/services/numberActivity/webhookSubscriptionCron";
import {
  MAX_WEBHOOK_EXPIRES_IN_SECONDS,
  mongoOwnershipStore,
  type SubscriptionProvider,
  type SubscriptionRecord,
} from "../../src/services/ringcentral/webhook-subscription-lifecycle";
import { inboundConnectedCallLog } from "../../src/services/numberActivity/fixtures";

const enabled = process.env.CSI_REPLICA_TEST === "true";
const directory = syntheticDirectory();
const noEvent = (async () => undefined) as never;
const workerDeps = (owner: string): CaptureProjectionWorkerDeps => ({
  owner,
  observeDeps: {
    directory: async () => directory,
    resolveRoute: () => null,
    recordEvent: noEvent,
    configuredAccountId: null,
  },
  recordEvent: noEvent,
});

type RouteResponse = {
  ok: boolean;
  storedRawEvent: boolean;
  duplicateRawEvent?: boolean;
  processingEnabled: boolean;
  candidateUpdates?: unknown[];
  captureProjection:
    | { status: "skipped"; reason: string }
    | {
        status: "enqueued";
        job_id: string;
        dedupe_key: string;
        published: boolean;
      }
    | {
        status: "existing";
        job_id: string;
        dedupe_key: string;
        published: boolean;
      }
    | { status: "enqueue_failed"; error_code: string };
};

test(
  "CSI-03 isolated replica proof",
  { skip: !enabled, timeout: 240_000 },
  async (t) => {
    assert.equal(process.env.TEST_MODE, "true");
    assert.match(getMongoDatabaseName(), /^testvantagemovers_csi03[a-z0-9]+$/);
    assert.equal(
      process.env.MONGO_URI,
      "mongodb://127.0.0.1:27189/?replicaSet=csi01",
    );
    await connectMongo();
    const db = mongoose.connection.useDb(getMongoDatabaseName(), {
      useCache: true,
    }).db!;
    assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
    const applied = await applyCsiMigration();
    assert.equal(applied.ready, true);
    const Interaction = getCallInteractionModel();
    const ContactNumber = getContactNumberModel();
    const Audit = getSalesIntelligenceAuditEventModel();
    const Jobs = getSalesIntelligenceJobModel();
    const SyncState = getSalesIntelligenceSyncStateModel();
    const receipts = await webhookReceiptsCollection();
    const qualifiedSyncCollection =
      getRingCentralCollectionName("callLogSyncState");

    const app = express();
    app.use(express.json());
    app.use(ringCentralWebhookRoutes);
    app.use(
      createSalesIntelligenceCronRouter({
        captureWorkerDeps: workerDeps("cron-worker"),
        captureDrainMax: 10,
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (payload: unknown): Promise<RouteResponse> => {
      const response = await fetch(`${base}/api/webhooks/ringcentral`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      assert.equal(
        response.status,
        200,
        "RingCentral requires an acknowledgement",
      );
      return (await response.json()) as RouteResponse;
    };
    const cron = async (routePath: string) => {
      const response = await fetch(base + routePath, {
        method: "POST",
        headers: { authorization: "Bearer synthetic-cron-secret" },
        signal: AbortSignal.timeout(60_000),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    };

    try {
      const life = inboundQueueAnsweredDeliveries("s-fan-1");

      await t.test(
        "route acknowledges only after receipt and deduplicated job are durable; duplicate uuid yields one receipt and one job",
        async () => {
          const first = await post(life.ringing);
          assert.equal(first.storedRawEvent, true);
          assert.equal(
            first.processingEnabled,
            false,
            "qualification processing off in this run; fan-out is independent of it",
          );
          const enqueued = first.captureProjection;
          assert.ok(
            enqueued.status === "enqueued",
            `expected enqueued, got ${JSON.stringify(enqueued)}`,
          );
          assert.equal(
            enqueued.published,
            false,
            "test runner never publishes; Mongo is the durable truth",
          );
          const receipt = await receipts.findOne({ uuid: life.ringing.uuid });
          assert.ok(receipt, "receipt durable");
          const job = await Jobs.findById(enqueued.job_id).lean();
          assert.ok(job);
          assert.equal(job.stage, "capture_projection");
          assert.equal(job.status, "pending");
          assert.equal(
            job.dedupe_key,
            captureProjectionDedupeKey({
              receiptId: String(receipt._id),
              uuid: life.ringing.uuid,
            }),
          );
          assert.deepEqual(
            job.input_refs.map(String),
            [String(receipt._id)],
            "job references the stored receipt, not the payload",
          );

          const duplicate = await post(life.ringing);
          assert.equal(duplicate.duplicateRawEvent, true);
          const dup = duplicate.captureProjection;
          assert.ok(
            dup.status === "existing",
            `expected existing, got ${JSON.stringify(dup)}`,
          );
          assert.equal(dup.job_id, enqueued.job_id);
          assert.equal(
            await receipts.countDocuments({ uuid: life.ringing.uuid }),
            1,
          );
          assert.equal(
            await Jobs.countDocuments({ stage: "capture_projection" }),
            1,
          );
        },
      );

      await t.test(
        "flag matrix: capture off creates no CSI job while the qualified path is unchanged; capture on with qualification processing on still creates the job",
        async () => {
          process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "false";
          const off = await post(life.repRinging);
          assert.deepEqual(off.captureProjection, {
            status: "skipped",
            reason: "flag_off",
          });
          assert.equal(
            await receipts.countDocuments({ uuid: life.repRinging.uuid }),
            1,
            "receipt capture is unchanged",
          );
          assert.equal(
            await Jobs.countDocuments({ stage: "capture_projection" }),
            1,
          );

          process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "true";
          process.env.RINGCENTRAL_WEBHOOK_ENABLED = "true";
          const both = await post(life.answered);
          assert.equal(both.processingEnabled, true);
          assert.ok(
            Array.isArray(both.candidateUpdates),
            "qualified evaluation still ran",
          );
          assert.equal(both.captureProjection.status, "enqueued");
          process.env.RINGCENTRAL_WEBHOOK_ENABLED = "false";
          assert.equal(
            await Jobs.countDocuments({ stage: "capture_projection" }),
            2,
          );
          assert.equal(
            await db.collection(qualifiedSyncCollection).countDocuments(),
            0,
            "qualified cursor collection never written",
          );
        },
      );

      await t.test(
        "receipt without a provider uuid still gets a job keyed by receipt id",
        async () => {
          const { uuid: _omitted, ...noUuid } = webhookDelivery({
            uuid: "unused",
            telephonySessionId: "s-nouuid",
            sequence: 1,
            eventTime: at(0),
            parties: [
              {
                id: "p-nouuid",
                direction: "Inbound",
                status: "Proceeding",
                from: { phoneNumber: SYNTHETIC_CUSTOMER_B },
                to: { phoneNumber: "+15550100101" },
              },
            ],
          });
          const response = await post(noUuid);
          assert.equal(response.captureProjection.status, "enqueued");
          const dedupe = (response.captureProjection as { dedupe_key: string })
            .dedupe_key;
          assert.match(
            dedupe,
            /^csi:capture_projection:receipt_id:[a-f\d]{24}$/,
          );

          // A validation handshake / non-telephony body is stored as a receipt but carries no party evidence: no job, here or in recovery.
          const handshake = await post({
            uuid: "handshake-1",
            event: "/restapi/v1.0/account/~/telephony/sessions",
            body: {},
          });
          assert.equal(handshake.storedRawEvent, true);
          assert.deepEqual(handshake.captureProjection, {
            status: "skipped",
            reason: "no_telephony_session",
          });
          assert.equal(
            await Jobs.countDocuments({
              dedupe_key: "csi:capture_projection:receipt:handshake-1",
            }),
            0,
          );
        },
      );

      await t.test(
        "enqueue failure after a durable receipt is acknowledged; watermark recovery closes the missing-job gap exactly once",
        async () => {
          const saved = process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID;
          delete process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID; // the job transaction cannot start without the dataset identity
          const failed = await post(life.disconnected);
          process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = saved;
          assert.equal(failed.storedRawEvent, true);
          assert.deepEqual(failed.captureProjection, {
            status: "enqueue_failed",
            error_code: "enqueue_failed",
          });
          const receipt = await receipts.findOne({
            uuid: life.disconnected.uuid,
          });
          assert.ok(receipt);
          const key = captureProjectionDedupeKey({
            receiptId: String(receipt._id),
            uuid: life.disconnected.uuid,
          });
          assert.equal(
            await Jobs.countDocuments({ dedupe_key: key }),
            0,
            "gap: receipt without job",
          );

          const before = await Jobs.countDocuments({
            stage: "capture_projection",
          });
          const now = () => new Date(Date.now() + 1000);
          const config = {
            lookbackMinutes: 720,
            overlapMs: 60_000,
            settleMs: 0,
            batch: 500,
            maxPages: 10,
            deadlineMs: 30_000,
            leaseTtlMs: 60_000,
          };
          const flagOffReceipt = await receipts.findOne({
            uuid: life.repRinging.uuid,
          });
          const flagOffKey = captureProjectionDedupeKey({
            receiptId: String(flagOffReceipt!._id),
            uuid: life.repRinging.uuid,
          });
          assert.equal(
            await Jobs.countDocuments({ dedupe_key: flagOffKey }),
            0,
            "the receipt stored while the flag was off is also a gap",
          );
          const first = await runReceiptWatermarkRecovery({
            now,
            config,
            recordEvent: noEvent,
          });
          assert.equal(first.skipped, false);
          assert.equal(first.error_code, null);
          assert.equal(
            first.created,
            2,
            "exactly the two receipts without jobs (enqueue failure, flag-off window) get one job each",
          );
          assert.equal(
            first.existing,
            before,
            "receipts that already had jobs are recognized, not duplicated",
          );
          assert.equal(await Jobs.countDocuments({ dedupe_key: key }), 1);
          assert.equal(
            await Jobs.countDocuments({ dedupe_key: flagOffKey }),
            1,
          );
          assert.equal(
            await Jobs.countDocuments({
              dedupe_key: "csi:capture_projection:receipt:handshake-1",
            }),
            0,
            "recovery also skips the handshake receipt",
          );
          const state = await SyncState.findOne({
            scope: WEBHOOK_RECEIPTS_SCOPE,
          }).lean();
          assert.equal(
            state?.cursor?.last_sync_to?.toISOString(),
            first.watermark_after,
          );
          assert.equal(state?.lease_owner, null);

          const second = await runReceiptWatermarkRecovery({
            now,
            config,
            recordEvent: noEvent,
          });
          assert.equal(second.created, 0, "second scan finds no gap");
          assert.ok(
            second.existing >= 1,
            "overlap re-checks recent receipts idempotently",
          );
          assert.equal(
            await Jobs.countDocuments({ stage: "capture_projection" }),
            before + 2,
          );

          const [a, b] = await Promise.all([
            runReceiptWatermarkRecovery({
              now,
              config,
              recordEvent: noEvent,
              owner: "rec-a",
            }),
            runReceiptWatermarkRecovery({
              now,
              config,
              recordEvent: noEvent,
              owner: "rec-b",
            }),
          ]);
          assert.deepEqual(
            [a.skip_reason, b.skip_reason].filter((r) => r === "lease_held")
              .length,
            1,
            "one recovery lease holder",
          );
        },
      );

      await t.test(
        "watermark recovery pages forward within a run, never regresses the stored watermark, and quarantines deterministic failures (review finding 1 and 4)",
        async () => {
          const stateBefore = await SyncState.findOne({
            scope: WEBHOOK_RECEIPTS_SCOPE,
          }).lean();
          const watermark = stateBefore!.cursor!.last_sync_to!;
          const now = () => new Date(watermark.getTime() + 30 * 60_000);
          const config = {
            lookbackMinutes: 720,
            overlapMs: 5 * 60_000,
            settleMs: 0,
            batch: 3,
            maxPages: 2,
            deadlineMs: 30_000,
            leaseTtlMs: 60_000,
          };
          // Synthetic receipt stream: nine receipts clustered inside the overlap window, older than the watermark.
          const synthetic = Array.from({ length: 9 }, (_, i) => ({
            _id: new mongoose.Types.ObjectId(),
            receivedAt: new Date(watermark.getTime() - 4 * 60_000 + i * 1000),
            uuid: `synthetic-${i}`,
          }));
          const listCalls: Array<[string, string | null]> = [];
          const keyset =
            (rows: typeof synthetic) =>
            (
              from: Date,
              to: Date,
              limit: number,
              after: {
                receivedAt: Date;
                _id: mongoose.Types.ObjectId;
              } | null = null,
            ) => {
              listCalls.push([
                from.toISOString(),
                after
                  ? `${after.receivedAt.toISOString()}/${String(after._id)}`
                  : null,
              ]);
              return Promise.resolve(
                rows
                  .filter((r) => r.receivedAt >= from && r.receivedAt <= to)
                  .filter(
                    (r) =>
                      !after ||
                      r.receivedAt > after.receivedAt ||
                      (r.receivedAt.getTime() === after.receivedAt.getTime() &&
                        String(r._id) > String(after._id)),
                  )
                  .sort(
                    (a, b) =>
                      a.receivedAt.getTime() - b.receivedAt.getTime() ||
                      String(a._id).localeCompare(String(b._id)),
                  )
                  .slice(0, limit),
              );
            };
          const listReceipts = keyset(synthetic);
          const ensured: string[] = [];
          const ensure = async (ref: {
            receiptId: string;
            uuid: string | null;
          }) => {
            if (ref.uuid === "synthetic-4")
              throw new CsiError("IDEMPOTENCY_CONFLICT");
            ensured.push(ref.uuid!);
            return {
              job_id: new mongoose.Types.ObjectId().toHexString(),
              dedupe_key: `k:${ref.uuid}`,
              created: true,
            };
          };
          const publish = async () => ({ published: false, error_code: null });

          const run1 = await runReceiptWatermarkRecovery({
            now,
            config,
            listReceipts,
            ensure: ensure as never,
            publish,
            recordEvent: noEvent,
          });
          assert.equal(run1.pages, 2, "page budget used");
          assert.equal(run1.budget_exhausted, true);
          assert.equal(
            run1.scanned,
            6,
            "3 + 3 rows: the second page resumed after the last processed receipt, not from scan_from",
          );
          assert.equal(
            listCalls[1]![1],
            `${synthetic[2]!.receivedAt.toISOString()}/${String(synthetic[2]!._id)}`,
            "page 2 resumes strictly after the last processed keyset position",
          );
          assert.deepEqual(
            run1.quarantined,
            [String(synthetic[4]!._id)],
            "deterministic conflict is quarantined, not a blocker",
          );
          assert.equal(run1.created, 5);
          assert.equal(
            run1.watermark_after,
            watermark.toISOString(),
            "monotone: receipts older than the watermark never move it backwards",
          );
          const state1 = await SyncState.findOne({
            scope: WEBHOOK_RECEIPTS_SCOPE,
          }).lean();
          assert.equal(
            state1?.cursor?.last_sync_to?.toISOString(),
            watermark.toISOString(),
          );

          // Same clustered stream with a generous budget: the run completes and the watermark advances to scan_to.
          const run2 = await runReceiptWatermarkRecovery({
            now,
            config: { ...config, maxPages: 10 },
            listReceipts,
            ensure: ensure as never,
            publish,
            recordEvent: noEvent,
          });
          assert.equal(run2.budget_exhausted, false);
          assert.equal(run2.watermark_after, run2.scan_to);
          assert.ok(
            new Date(run2.watermark_after!) > watermark,
            "forward progress once the window is fully scanned",
          );
          const state2 = await SyncState.findOne({
            scope: WEBHOOK_RECEIPTS_SCOPE,
          }).lean();
          assert.equal(
            state2?.cursor?.last_sync_to?.toISOString(),
            run2.scan_to,
          );
          assert.equal(
            state2?.consecutive_failures,
            0,
            "quarantine is not a run failure",
          );

          // R2: ten receipts sharing one millisecond, batch 3: keyset paging still visits each once and finishes.
          const sameInstant = new Date(
            state2!.cursor!.last_sync_to!.getTime() - 60_000,
          );
          const cluster = Array.from({ length: 10 }, (_, i) => ({
            _id: new mongoose.Types.ObjectId(),
            receivedAt: sameInstant,
            uuid: `cluster-${i}`,
          }));
          const seen: string[] = [];
          const run3 = await runReceiptWatermarkRecovery({
            now: () => new Date(sameInstant.getTime() + 10 * 60_000),
            config: { ...config, maxPages: 10 },
            listReceipts: keyset(cluster),
            ensure: (async (ref: { uuid: string | null }) => {
              seen.push(ref.uuid!);
              return {
                job_id: new mongoose.Types.ObjectId().toHexString(),
                dedupe_key: `k:${ref.uuid}`,
                created: true,
              };
            }) as never,
            publish,
            recordEvent: noEvent,
          });
          assert.equal(
            run3.budget_exhausted,
            false,
            "a same-millisecond cluster larger than a page does not park the scan",
          );
          assert.equal(run3.pages, 4, "3 + 3 + 3 + 1");
          assert.deepEqual(
            [...seen].sort(),
            cluster.map((c) => c.uuid).sort(),
            "each receipt ensured exactly once",
          );
        },
      );

      await t.test(
        "worker: loads the stored receipt, projects with the job id as request_id, completes with visible result and job audit; replay on the completed job is not claimable",
        async () => {
          const receipt = await receipts.findOne({ uuid: life.ringing.uuid });
          const job = await Jobs.findOne({ input_refs: receipt!._id }).lean();
          assert.ok(job);
          const jobId = String(job._id);
          const outcome = await runCaptureProjectionJob(
            jobId,
            workerDeps("worker-a"),
          );
          assert.equal(outcome.status, "completed");
          assert.ok(outcome.status === "completed");
          assert.equal(outcome.result.ok, 1);
          assert.equal(outcome.result.receipt_uuid, life.ringing.uuid);
          const session = outcome.result.results[0]!;
          assert.ok(session.ok);
          const interaction = await Interaction.findById(
            session.interaction_id,
          ).lean();
          assert.ok(interaction);
          assert.equal(interaction.telephony_session_id, "s-fan-1");
          assert.equal(interaction.direction, "Inbound");
          assert.deepEqual(interaction.sources, ["webhook"]);
          const number = await ContactNumber.findOne({
            e164: SYNTHETIC_CUSTOMER,
          }).lean();
          assert.ok(number, "Contact Number created by the projection");
          const interactionAudit = await Audit.findOne({
            subject_key: `interaction:${session.interaction_id}`,
          }).lean();
          assert.equal(
            interactionAudit?.actor.request_id,
            jobId,
            "audit rows tie back to the durable job",
          );
          assert.equal(
            (interactionAudit?.current as { request_id_generated: boolean })
              .request_id_generated,
            false,
          );
          assert.equal(
            (interactionAudit?.current as { proof_ref: string }).proof_ref,
            `webhook:${life.ringing.uuid}`,
          );
          const jobAudit = await Audit.findOne({
            subject_key: `job:${jobId}`,
          }).lean();
          assert.equal(jobAudit?.event_kind, "capture_projection.completed");
          assert.equal(jobAudit?.invalidation.kind, "job");
          assert.equal((jobAudit?.current as { ok: number }).ok, 1);
          const stored = await Jobs.findById(jobId).lean();
          assert.equal(stored?.status, "completed");
          assert.equal((stored?.result as { sessions: number }).sessions, 1);
          assert.equal(stored?.lease_owner, null);

          const replay = await runCaptureProjectionJob(
            jobId,
            workerDeps("worker-b"),
          );
          assert.deepEqual(replay, { status: "not_claimable", job_id: jobId });
          assert.equal(
            await Interaction.countDocuments({
              telephony_session_id: "s-fan-1",
            }),
            1,
          );
        },
      );

      await t.test(
        "worker: per-session account_unresolved stays visible in the job result and audit; the job completes rather than retrying a deterministic failure",
        async () => {
          const unresolved = webhookDelivery({
            uuid: "s-unres-u1",
            telephonySessionId: "s-unres",
            sequence: 1,
            eventTime: at(0),
            parties: [
              {
                id: "p-unres",
                direction: "Inbound",
                status: "Proceeding",
                from: { phoneNumber: SYNTHETIC_CUSTOMER_B },
                to: { phoneNumber: "+15550100101" },
              },
            ],
          });
          unresolved.event = "/restapi/v1.0/account/~/telephony/sessions";
          for (const party of unresolved.body.parties)
            delete (party as { accountId?: string }).accountId;
          const response = await post(unresolved);
          const jobId = (response.captureProjection as { job_id: string })
            .job_id;
          const outcome = await runCaptureProjectionJob(
            jobId,
            workerDeps("worker-c"),
          );
          assert.equal(outcome.status, "completed");
          assert.ok(outcome.status === "completed");
          assert.deepEqual(outcome.result.results, [
            {
              telephony_session_id: "s-unres",
              ok: false,
              error_code: "account_unresolved",
            },
          ]);
          const stored = await Jobs.findById(jobId).lean();
          assert.equal(stored?.status, "completed");
          assert.equal((stored?.result as { failed: number }).failed, 1);
          const audit = await Audit.findOne({
            subject_key: `job:${jobId}`,
          }).lean();
          assert.equal(
            (audit?.current as { results: Array<{ error_code: string }> })
              .results[0]!.error_code,
            "account_unresolved",
          );
          assert.equal(
            await Interaction.countDocuments({
              telephony_session_id: "s-unres",
            }),
            0,
            "no fabricated account, no row",
          );
        },
      );

      await t.test(
        "worker: retryable per-session failure retries the job with the partial result on the row",
        async () => {
          const outbound = outboundUnansweredDeliveries("s-retry-1");
          const response = await post(outbound.setup);
          const jobId = (response.captureProjection as { job_id: string })
            .job_id;
          const deps = workerDeps("worker-d");
          const outcome = await runCaptureProjectionJob(jobId, {
            ...deps,
            observeDeps: {
              ...deps.observeDeps,
              apply: async () => {
                throw new Error("synthetic persistence outage");
              },
            },
          });
          assert.equal(outcome.status, "failed");
          assert.ok(outcome.status === "failed");
          assert.equal(outcome.reason, "transient");
          assert.equal(outcome.error_code, "session_retryable");
          const stored = await Jobs.findById(jobId).lean();
          assert.equal(stored?.status, "retry");
          assert.equal(stored?.reason, "transient");
          assert.equal(stored?.attempts, 1);
          assert.equal(
            (stored?.result as { results: Array<{ error_code: string }> })
              .results[0]!.error_code,
            "persist_failed",
          );
          // Recovery later re-runs the same handler successfully once the outage is over.
          await Jobs.updateOne(
            { _id: jobId },
            { $set: { next_attempt_at: new Date(0) } },
          );
          const recovered = await runCaptureProjectionJob(jobId, deps);
          assert.equal(recovered.status, "completed");
          assert.equal(
            await Interaction.countDocuments({
              telephony_session_id: "s-retry-1",
            }),
            1,
          );
        },
      );

      await t.test(
        "concurrent workers on one job: one claims, the other is not claimable; an expired lease holder cannot complete or fail after a successor claims",
        async () => {
          const outbound = outboundUnansweredDeliveries("s-race-1");
          const response = await post(outbound.proceeding);
          const jobId = (response.captureProjection as { job_id: string })
            .job_id;
          const [a, b] = await Promise.all([
            runCaptureProjectionJob(jobId, workerDeps("race-a")),
            runCaptureProjectionJob(jobId, workerDeps("race-b")),
          ]);
          assert.deepEqual([a.status, b.status].sort(), [
            "completed",
            "not_claimable",
          ]);
          assert.equal(
            await Interaction.countDocuments({
              telephony_session_id: "s-race-1",
            }),
            1,
          );

          const fenced = await post(outbound.disconnected);
          const fencedJobId = (fenced.captureProjection as { job_id: string })
            .job_id;
          const stale = await claimCsiJob(
            "stale-worker",
            fencedJobId,
            60_000,
            "capture_projection",
          );
          assert.ok(stale);
          const staleLease = {
            job_id: fencedJobId,
            owner: "stale-worker",
            epoch: stale.lease_epoch,
          };
          await Jobs.updateOne(
            { _id: fencedJobId },
            { $set: { leased_until: new Date(Date.now() - 1000) } },
          ); // crash simulation
          const successor = await runCaptureProjectionJob(
            fencedJobId,
            workerDeps("successor"),
          );
          assert.equal(successor.status, "completed");
          await assert.rejects(
            () => completeCsiJob(staleLease, async () => undefined),
            (e: unknown) => e instanceof CsiError && e.code === "LEASE_LOST",
          );
          await assert.rejects(
            () => failCsiJob(staleLease, "transient"),
            (e: unknown) => e instanceof CsiError && e.code === "LEASE_LOST",
          );
          const stored = await Jobs.findById(fencedJobId).lean();
          assert.equal(stored?.status, "completed");
          assert.equal(stored?.lease_epoch, stale.lease_epoch + 1);
        },
      );

      await t.test(
        "queue consumer and recovery cron call the same handler; foreign stages are left pending, not claimed",
        async () => {
          const pending = await Jobs.find({
            stage: "capture_projection",
            status: "pending",
          }).lean();
          assert.ok(
            pending.length >= 1,
            "pending capture jobs remain from earlier steps",
          );
          const viaQueue = await handleSalesIntelligenceQueueMessage(
            { job_id: String(pending[0]!._id) },
            { capture: workerDeps("queue-worker") },
          );
          assert.equal(viaQueue.status, "dispatched");
          assert.equal(
            (viaQueue as { outcome: { status: string } }).outcome.status,
            "completed",
          );
          assert.equal(
            (await Jobs.findById(pending[0]!._id).lean())?.status,
            "completed",
          );

          const foreign = await Jobs.findOne({
            stage: "outreach_ensure",
          }).lean();
          assert.ok(foreign, "projection scheduled downstream work for Team C");
          const untouched = await dispatchCsiWakeup({
            job_id: String(foreign._id),
          });
          assert.equal(untouched.status, "dispatched");
          assert.equal(
            (untouched as { outcome: { status: string } }).outcome.status,
            "disabled",
          );
          const after = await Jobs.findById(foreign._id).lean();
          assert.equal(after?.status, "pending");
          assert.equal(
            after?.attempts,
            0,
            "a wake-up for a stage without a consumer never burns its attempts",
          );
          const unknownId = String(new mongoose.Types.ObjectId());
          assert.deepEqual(await dispatchCsiWakeup({ job_id: unknownId }), {
            status: "unknown_job",
            job_id: unknownId,
          });
          assert.deepEqual(
            await dispatchCsiWakeup({ job_id: unknownId, stage: "rebuild" }),
            { status: "invalid_payload" },
          );

          const recovery = await cron(CSI_CRON_PATHS.jobRecovery);
          assert.equal(recovery.status, 200);
          assert.equal(recovery.body.skipped, false);
          const drained = recovery.body.capture_projection as {
            claimed: number;
            completed: number;
          };
          assert.equal(
            await Jobs.countDocuments({
              stage: "capture_projection",
              status: { $in: ["pending", "retry"] },
            }),
            0,
            "cron drained the rest",
          );
          assert.ok(drained.claimed >= 1);
          const drainAgain = await drainCaptureProjectionJobs(
            5,
            workerDeps("idle"),
          );
          assert.equal(drainAgain.claimed, 0);

          process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "false";
          assert.deepEqual((await cron(CSI_CRON_PATHS.jobRecovery)).body, {
            ok: true,
            skipped: true,
            reason: "disabled",
          });
          assert.deepEqual((await cron(CSI_CRON_PATHS.callLogReconcile)).body, {
            ok: true,
            skipped: true,
            reason: "disabled",
          });
          process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "true";
          assert.equal(
            await db.collection(qualifiedSyncCollection).countDocuments(),
            0,
            "qualified cursor collection never written",
          );
        },
      );

      // ---------------------------------------------------------------
      // CC-08: hang-up -> one call_log_refresh -> targeted Call Log apply
      // ---------------------------------------------------------------
      const runReceipt = async (uuid: string) => {
        const receipt = await receipts.findOne({ uuid });
        assert.ok(receipt, `receipt ${uuid} durable`);
        const job = await Jobs.findOne({ stage: "capture_projection", input_refs: receipt._id }).lean();
        assert.ok(job, `capture job for ${uuid}`);
        const outcome = await runCaptureProjectionJob(String(job._id), workerDeps(`cc08-${uuid}`));
        assert.equal(outcome.status, "completed", JSON.stringify(outcome));
        assert.ok(outcome.status === "completed");
        return outcome.result;
      };
      const refreshDeps = (fetchRecords: CallLogRefreshDeps["fetch"], now = () => new Date()): CallLogRefreshDeps => ({
        now,
        owner: "cc08-refresh",
        fetch: fetchRecords,
        directory: async () => directory,
        resolveRoute: () => null,
        configuredAccountId: null,
        recordEvent: noEvent,
        publish: { shouldPublish: () => false },
      });
      const makeDue = (dedupe_key: string) =>
        Jobs.updateOne({ dedupe_key }, { $set: { next_attempt_at: new Date(Date.now() - 1000) } });

      await t.test(
        "CC-08: a session hang-up enqueues exactly one call_log_refresh due 90 s later; a live party or a repeat hang-up adds none",
        async () => {
          const cc = inboundQueueAnsweredDeliveries("s-cc08");
          for (const delivery of [cc.ringing, cc.repRinging, cc.answered]) await post(delivery);
          assert.deepEqual((await runReceipt(cc.ringing.uuid)).call_log_refresh, []);
          assert.deepEqual((await runReceipt(cc.repRinging.uuid)).call_log_refresh, []);
          const answered = await runReceipt(cc.answered.uuid);
          assert.deepEqual(answered.call_log_refresh, [], "queue leg Disconnected while the rep is still Answered: not a hang-up");
          assert.equal(await Jobs.countDocuments({ stage: "call_log_refresh", subject_key: "telephony_session:s-cc08" }), 0);

          await post(cc.disconnected);
          const before = Date.now();
          const hungUp = await runReceipt(cc.disconnected.uuid);
          assert.deepEqual(hungUp.call_log_refresh, ["s-cc08"]);
          const refresh = await Jobs.find({ stage: "call_log_refresh", subject_key: "telephony_session:s-cc08" }).lean();
          assert.equal(refresh.length, 1);
          assert.equal(refresh[0]!.dedupe_key, callLogRefreshDedupeKey("s-cc08"));
          assert.equal(refresh[0]!.status, "pending");
          assert.equal(refresh[0]!.subject_key, "telephony_session:s-cc08");
          const interaction = await Interaction.findOne({ telephony_session_id: "s-cc08" }).lean();
          assert.ok(interaction);
          assert.equal(interaction.terminal, true);
          assert.deepEqual(refresh[0]!.input_refs.map(String), [String(interaction._id)]);
          const due = refresh[0]!.next_attempt_at.getTime();
          assert.ok(
            due >= before + CALL_LOG_REFRESH_DELAY_MS - 1000 && due <= Date.now() + CALL_LOG_REFRESH_DELAY_MS,
            "resume_at = now + 90 s",
          );
          assert.equal(
            (await runCallLogRefreshJob(String(refresh[0]!._id), refreshDeps(async () => assert.fail("not due yet")))).status,
            "not_claimable",
            "not claimable before it is due",
          );

          // A repeat terminal delivery for the same session (new uuid, later sequence) never adds a second refresh.
          const again = { ...cc.disconnected, uuid: "s-cc08-u5", body: { ...cc.disconnected.body, sequence: 5 } };
          await post(again);
          assert.deepEqual((await runReceipt("s-cc08-u5")).call_log_refresh, ["s-cc08"]);
          assert.equal(await Jobs.countDocuments({ stage: "call_log_refresh", subject_key: "telephony_session:s-cc08" }), 1);
        },
      );

      await t.test(
        "CC-08: the refresh reads the session Call Log record and applies it (final duration, Call Log identity) to the same row",
        async () => {
          const key = callLogRefreshDedupeKey("s-cc08");
          await makeDue(key);
          const job = await Jobs.findOne({ dedupe_key: key }).lean();
          const fetched: Array<{ telephonySessionId: string; dateFrom: Date }> = [];
          const outcome = await runCallLogRefreshJob(
            String(job!._id),
            refreshDeps(async (input) => {
              fetched.push(input);
              return [inboundConnectedCallLog("s-cc08")];
            }),
          );
          assert.equal(outcome.status, "completed", JSON.stringify(outcome));
          assert.ok(outcome.status === "completed");
          assert.equal(outcome.result.state, "applied");
          assert.equal(fetched.length, 1);
          assert.equal(fetched[0]!.telephonySessionId, "s-cc08");
          const interaction = await Interaction.findOne({ telephony_session_id: "s-cc08" }).lean();
          assert.ok(interaction);
          assert.equal(fetched[0]!.dateFrom.getTime(), interaction.started_at.getTime() - 60 * 60_000, "dateFrom = started_at - 1 h");
          assert.ok(interaction.call_log_ids.includes("cl-s-cc08"), "Call Log identity attached to the webhook row");
          assert.equal(interaction.duration_seconds, 95);
          assert.ok(interaction.sources.includes("call_log_reconcile"));
          assert.ok(interaction.provider_last_modified_at, "the Call Log record is now the authority");
          assert.equal(await Interaction.countDocuments({ telephony_session_id: "s-cc08" }), 1, "same row, no duplicate");
          const audit = await Audit.findOne({
            subject_key: `interaction:${String(interaction._id)}`,
            "current.proof_ref": "call_log_refresh:cl-s-cc08",
          }).lean();
          assert.ok(audit, "audit proof names the refresh");
          assert.equal(audit.actor.request_id, String(job!._id));
          const stored = await Jobs.findById(job!._id).lean();
          assert.equal(stored?.status, "completed");
          assert.equal((stored?.result as { state: string }).state, "applied");
          assert.equal(
            (await Audit.findOne({ subject_key: `job:${String(job!._id)}` }).lean())?.event_kind,
            "call_log_refresh.completed",
          );
        },
      );

      await t.test("CC-08: a record not yet published retries at +2, +5, +15 min, then completes not_published", async () => {
        const np = outboundUnansweredDeliveries("s-cc08-np");
        await post(np.setup);
        await post(np.disconnected);
        await runReceipt(np.setup.uuid);
        assert.deepEqual((await runReceipt(np.disconnected.uuid)).call_log_refresh, ["s-cc08-np"]);
        const key = callLogRefreshDedupeKey("s-cc08-np");
        const jobId = String((await Jobs.findOne({ dedupe_key: key }).lean())!._id);
        let fetches = 0;
        const empty: CallLogRefreshDeps["fetch"] = async () => {
          fetches += 1;
          return [];
        };
        for (const wait of CALL_LOG_REFRESH_RETRY_DELAYS_MS) {
          await makeDue(key);
          const fixed = new Date();
          const outcome = await runCallLogRefreshJob(jobId, refreshDeps(empty, () => fixed));
          assert.equal(outcome.status, "retry", JSON.stringify(outcome));
          const row = await Jobs.findById(jobId).lean();
          assert.equal(row?.status, "retry");
          assert.equal(row?.next_attempt_at.getTime(), fixed.getTime() + wait);
        }
        await makeDue(key);
        const last = await runCallLogRefreshJob(jobId, refreshDeps(empty));
        assert.equal(last.status, "completed");
        assert.ok(last.status === "completed");
        assert.equal(last.result.state, "not_published");
        assert.equal(fetches, 4);
        const row = await Jobs.findById(jobId).lean();
        assert.equal(row?.status, "completed");
        assert.equal((row?.result as { state: string }).state, "not_published");
        const interaction = await Interaction.findOne({ telephony_session_id: "s-cc08-np" }).lean();
        assert.deepEqual(interaction?.call_log_ids, [], "nothing applied; the reconcile window covers it");
      });

      await t.test("CC-08: the dispatcher routes call_log_refresh wake-ups to the refresh consumer", async () => {
        assert.equal(typeof defaultStageHandlers().call_log_refresh, "function");
        const done = await Jobs.findOne({ dedupe_key: callLogRefreshDedupeKey("s-cc08") }).lean();
        const outcome = await dispatchCsiWakeup({ job_id: String(done!._id) });
        assert.equal(outcome.status, "dispatched");
        assert.deepEqual(
          (outcome as { outcome: unknown }).outcome,
          { status: "not_claimable", job_id: String(done!._id) },
          "a completed refresh is never re-run",
        );
      });

      await t.test(
        "CC-08: subscription cron with durable Mongo ownership: create (auto-create), noop, renew when < 7 days, repair blacklisted, never touch foreign",
        async () => {
          const ADDRESS = "https://example.test/api/webhooks/ringcentral";
          const ALL = ["/restapi/v1.0/account/~/telephony/sessions"];
          const DAY = 24 * 60 * 60_000;
          const now = new Date();
          const calls: string[] = [];
          const events: string[] = [];
          let records: SubscriptionRecord[] = [];
          const provider: SubscriptionProvider = {
            list: async () => records,
            create: async (input) => {
              calls.push(`create:${input.expiresIn}`);
              return { id: `sub-${calls.length}`, eventFilters: input.eventFilters, deliveryMode: { transportType: "WebHook", address: input.address }, status: "Active", expiresIn: input.expiresIn };
            },
            renew: async (id) => {
              calls.push(`renew:${id}`);
              return { id, eventFilters: ALL, deliveryMode: { transportType: "WebHook", address: ADDRESS }, status: "Active", expiresIn: 604_800 };
            },
            remove: async (id) => {
              calls.push(`delete:${id}`);
            },
          };
          const sub = (id: string, extra: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
            id, eventFilters: ALL, transportType: "WebHook", address: ADDRESS, status: "Active", expiresIn: null,
            expirationTime: new Date(now.getTime() + 365 * DAY), raw: { id }, ...extra,
          });
          const run = (autoCreate: boolean) =>
            runWebhookSubscriptionMaintenance({
              provider, store: mongoOwnershipStore(), address: ADDRESS, now: () => now, eventFilters: async () => ALL, autoCreate,
              recordEvent: (async (event: { eventKey: string }) => { events.push(event.eventKey.split(".").pop()!); return null; }) as never,
            });

          records = [sub("foreign-1")];
          assert.equal((await run(false)).action, "missing", "auto-create off: report, never create");
          assert.deepEqual(calls, []);
          const created = await run(true);
          assert.equal(created.action, "created");
          assert.deepEqual(calls, [`create:${MAX_WEBHOOK_EXPIRES_IN_SECONDS}`]);
          const ownedRow = await db.collection("ringcentral_webhook_subscriptions").findOne({ subscriptionId: created.subscription_id });
          assert.ok(ownedRow, "ownership evidence is durable in Mongo");

          records = [sub("foreign-1", { status: "Blacklisted" }), sub(created.subscription_id!)];
          assert.equal((await run(true)).action, "noop");
          records = [sub("foreign-1"), sub(created.subscription_id!, { expirationTime: new Date(now.getTime() + 6 * DAY) })];
          assert.equal((await run(true)).action, "renewed");
          records = [sub("foreign-1", { status: "Blacklisted" }), sub(created.subscription_id!, { status: "Blacklisted" })];
          const repaired = await run(true);
          assert.equal(repaired.action, "repaired");
          assert.equal(repaired.removed_subscription_id, created.subscription_id);
          assert.equal(
            (await db.collection("ringcentral_webhook_subscriptions").findOne({ subscriptionId: created.subscription_id }))?.status,
            "Deleted",
          );
          assert.deepEqual(calls, [
            `create:${MAX_WEBHOOK_EXPIRES_IN_SECONDS}`,
            `renew:${created.subscription_id}`,
            `delete:${created.subscription_id}`,
            `create:${MAX_WEBHOOK_EXPIRES_IN_SECONDS}`,
          ], "the foreign subscription is never renewed, deleted or replaced");
          assert.ok(events.includes("foreign_warning"));
          assert.deepEqual(events.filter((e) => e !== "foreign_warning"), ["missing", "created", "renewed", "repaired"]);
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
