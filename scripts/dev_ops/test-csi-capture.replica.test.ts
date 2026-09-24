import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getCallInteractionAliasModel } from "../../src/models/CallInteractionAlias";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../src/models/SalesIntelligenceSyncState";
import { claimCsiJob } from "../../src/services/salesIntelligence/jobs";
import { RingCentralApiError } from "../../src/services/ringcentral/client";
import { getRingCentralCollectionName } from "../../src/services/ringcentral/ringcentral-config";
import {
  normalizeWebhookPartyObservations,
  observeRingCentralWebhookEvents,
} from "../../src/services/numberActivity/observeWebhookEvents";
import { applyInteractionObservation } from "../../src/services/numberActivity/persistInteraction";
import {
  CALL_LOG_ALL_DIRECTIONS_SCOPE,
  callLogReconcileConfig,
  runCallLogReconcileOnce,
  type ReconcileDependencies,
} from "../../src/services/numberActivity/reconcileCallLog";
import {
  at,
  callLogRecord,
  inboundConnectedCallLog,
  inboundQueueAnsweredDeliveries,
  internalCallDelivery,
  outboundMissedCallLog,
  sessionIdOnlyCallLog,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_CUSTOMER,
  SYNTHETIC_CUSTOMER_B,
  SYNTHETIC_OTHER_ACCOUNT_ID,
  SYNTHETIC_SALES_DID,
  syntheticDirectory,
  transferredCallLog,
  voicemailCallLog,
  webhookDelivery,
  withheldInboundDelivery,
} from "../../src/services/numberActivity/fixtures";
import {
  internalSnapshotRecord,
  liveFinalRecord,
  liveSnapshotRecord,
} from "../../src/services/numberActivity/callLogStateFixtures";

const enabled = process.env.CSI_REPLICA_TEST === "true";
const directory = syntheticDirectory();
const noRoute = () => null;
const noEvent = async () => undefined;
const observe = (payload: unknown, receivedAt: Date) =>
  observeRingCentralWebhookEvents(
    normalizeWebhookPartyObservations(payload, receivedAt),
    {
      now: () => receivedAt,
      directory: async () => directory,
      resolveRoute: noRoute,
      recordEvent: noEvent as never,
      configuredAccountId: null,
    },
  );
const okResult = (results: Awaited<ReturnType<typeof observe>>) => {
  const [first] = results;
  assert.ok(
    first && first.ok,
    `observation failed: ${JSON.stringify(results)}`,
  );
  return first.result;
};

test(
  "CSI-02 isolated replica proof",
  { skip: !enabled, timeout: 180_000 },
  async (t) => {
    assert.equal(process.env.TEST_MODE, "true");
    assert.match(getMongoDatabaseName(), /^testvantagemovers_csi02[a-z0-9]+$/);
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
    const Alias = getCallInteractionAliasModel();
    const ContactNumber = getContactNumberModel();
    const Audit = getSalesIntelligenceAuditEventModel();
    const Jobs = getSalesIntelligenceJobModel();
    const SyncState = getSalesIntelligenceSyncStateModel();
    const qualifiedSyncCollection =
      getRingCentralCollectionName("callLogSyncState");

    try {
      await t.test(
        "webhook lifecycle persists projection, aliases, number rollups, audit and jobs atomically; replay is a no-op",
        async () => {
          const d = inboundQueueAnsweredDeliveries("s-life-1");
          const created = okResult(await observe(d.ringing, at(1)));
          assert.equal(created.created, true);
          assert.equal(created.projection_revision, 1);
          assert.equal(created.contact_number_created, true);
          assert.deepEqual(
            created.jobs.map((j) => j.split(":")[1]),
            ["outreach_ensure", "attachment_refresh"],
          );
          const aliases = await Alias.find({
            interaction_id: created.interaction_id,
          }).lean();
          assert.deepEqual(aliases.map((a) => a.kind).sort(), [
            "session_id",
            "telephony_session_id",
          ]);
          const number = await ContactNumber.findOne({
            e164: SYNTHETIC_CUSTOMER,
          }).lean();
          assert.equal(number?.rollups.interactions_total, 1);
          assert.equal(number?.rollups.inbound_total, 1);
          assert.equal(number?.kind, "external");
          assert.equal(number?.classification, "unknown");
          const audit = await Audit.find({
            subject_key: `interaction:${created.interaction_id}`,
          }).lean();
          assert.equal(audit.length, 1);
          assert.equal(audit[0]!.event_kind, "interaction.created");
          assert.equal(audit[0]!.invalidation.kind, "interaction");
          assert.equal(
            (audit[0]!.current as { contact_number_id: string })
              .contact_number_id,
            String(number!._id),
          );
          // Review fix: audit rows tie back to the provider evidence and declare whether the
          // actor request id is a real job id or a generated placeholder.
          const createdCurrent = audit[0]!.current as {
            proof_ref: string;
            input_kind: string;
            request_id_generated: boolean;
            aliases_added: string[];
          };
          assert.equal(createdCurrent.proof_ref, `webhook:${d.ringing.uuid}`);
          assert.equal(createdCurrent.input_kind, "webhook");
          assert.equal(
            createdCurrent.request_id_generated,
            true,
            "no job id supplied by this test",
          );
          assert.deepEqual(
            createdCurrent.aliases_added.map((a) => a.split(":")[0]).sort(),
            ["session_id", "telephony_session_id"],
          );

          const jobId = new mongoose.Types.ObjectId().toHexString();
          const withJob = await observeRingCentralWebhookEvents(
            normalizeWebhookPartyObservations(d.repRinging, at(4)),
            {
              now: () => at(4),
              directory: async () => directory,
              resolveRoute: noRoute,
              recordEvent: noEvent as never,
              configuredAccountId: null,
              request_id: jobId,
            },
          );
          assert.ok(withJob[0]?.ok);
          const updated = await Audit.findOne({
            subject_key: `interaction:${created.interaction_id}`,
            event_kind: "interaction.updated",
          }).lean();
          assert.equal(
            updated?.actor.request_id,
            jobId,
            "supplied job id is the audit actor request id",
          );
          assert.equal(
            (updated?.current as { request_id_generated: boolean })
              .request_id_generated,
            false,
          );
          assert.equal(
            (updated?.current as { proof_ref: string }).proof_ref,
            `webhook:${d.repRinging.uuid}`,
          );

          okResult(await observe(d.answered, at(9)));
          const ended = okResult(await observe(d.disconnected, at(96)));
          assert.equal(ended.newly_terminal, true);
          assert.equal(ended.projection_revision, 4);
          assert.equal(
            ended.jobs.some((j) => j.endsWith(":pending")),
            true,
            "terminal without recording ids schedules pending discovery",
          );
          const jobsBefore = await Jobs.countDocuments();
          const auditBefore = await Audit.countDocuments();

          const replay = okResult(await observe(d.disconnected, at(200)));
          assert.equal(replay.noop, true);
          assert.equal(replay.projection_revision, 4);
          assert.equal(await Jobs.countDocuments(), jobsBefore);
          assert.equal(await Audit.countDocuments(), auditBefore);
          const stored = await Interaction.findById(
            created.interaction_id,
          ).lean();
          assert.equal(stored?.terminal, true);
          assert.equal(stored?.contact_type, "unknown");
          assert.equal(stored?.provider_connected, true);
          assert.equal(
            stored?.parties.find((p) => p.role === "external")?.e164,
            SYNTHETIC_CUSTOMER,
          );
          // Downstream intent is durable pending work a consumer can claim; nothing here completes it.
          const pending = await Jobs.find({
            input_refs: new mongoose.Types.ObjectId(created.interaction_id),
          }).lean();
          assert.deepEqual(
            [...new Set(pending.map((j) => j.status))],
            ["pending"],
          );
          const claimed = await claimCsiJob(
            "csi-02-proof",
            String(pending[0]!._id),
          );
          assert.equal(claimed?.stage, pending[0]!.stage);
        },
      );

      await t.test(
        "concurrent duplicate deliveries and concurrent sessions on one number keep one identity and exact rollups",
        async () => {
          const d = inboundQueueAnsweredDeliveries("s-race-1");
          const results = await Promise.all([
            observe(d.answered, at(10)),
            observe(d.answered, at(10)),
            observe(d.answered, at(10)),
          ]);
          const ids = new Set(results.map((r) => okResult(r).interaction_id));
          assert.equal(ids.size, 1);
          assert.equal(
            await Interaction.countDocuments({
              telephony_session_id: "s-race-1",
            }),
            1,
          );
          assert.equal(
            await Alias.countDocuments({
              kind: "telephony_session_id",
              value: "s-race-1",
            }),
            1,
          );
          const number = await ContactNumber.findOne({
            e164: SYNTHETIC_CUSTOMER,
          }).lean();
          assert.equal(
            number?.rollups.interactions_total,
            2,
            "s-life-1 plus s-race-1",
          );

          const many = ["s-race-2", "s-race-3", "s-race-4"].map(
            (s) => inboundQueueAnsweredDeliveries(s).disconnected,
          );
          const outcomes = await Promise.all(
            many.map((delivery) => observe(delivery, at(100))),
          );
          outcomes.forEach((o) => okResult(o));
          const after = await ContactNumber.findOne({
            e164: SYNTHETIC_CUSTOMER,
          }).lean();
          assert.equal(after?.rollups.interactions_total, 5);
          assert.equal(after?.rollups.inbound_total, 5);
          assert.equal(
            await ContactNumber.countDocuments({ e164: SYNTHETIC_CUSTOMER }),
            1,
          );
        },
      );

      await t.test(
        "Call Log reconciles the webhook session: authoritative result, recordings, late terminal no-op, per-recording discovery",
        async () => {
          const d = inboundQueueAnsweredDeliveries("s-recon-1");
          okResult(await observe(d.answered, at(9)));
          const reconciled = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            {
              kind: "call_log",
              record: inboundConnectedCallLog("s-recon-1"),
              proof_ref: "call_log:cl-s-recon-1",
            },
            { now: () => at(700), directory, resolveRoute: noRoute },
          );
          assert.equal(reconciled.noop, false);
          assert.equal(reconciled.newly_terminal, true);
          assert.deepEqual(reconciled.new_recording_ids, ["rec-s-recon-1-1"]);
          assert.equal(
            reconciled.jobs.some((j) =>
              j.endsWith(":recording:rec-s-recon-1-1"),
            ),
            true,
          );
          assert.equal(
            reconciled.jobs.some((j) => j.endsWith(":pending")),
            false,
          );
          const stored = await Interaction.findById(
            reconciled.interaction_id,
          ).lean();
          assert.equal(stored?.duration_seconds, 95);
          assert.deepEqual(stored?.sources, ["call_log_reconcile", "webhook"]);
          assert.equal(
            (
              await Alias.find({
                interaction_id: reconciled.interaction_id,
              }).lean()
            ).some((a) => a.kind === "call_log_id"),
            true,
          );

          const late = okResult(await observe(d.disconnected, at(800)));
          const after = await Interaction.findById(
            reconciled.interaction_id,
          ).lean();
          assert.equal(after?.provider_result, "Call connected");
          assert.equal(after?.duration_seconds, 95);
          assert.equal(after?.terminal, true);
          assert.equal(late.newly_terminal, false);

          // Delayed second recording after terminal still schedules discovery exactly once.
          const delayed = transferredCallLog("s-recon-1");
          delayed.id = "cl-s-recon-1";
          delayed.lastModifiedTime = at(2000).toISOString();
          const withMore = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            {
              kind: "call_log",
              record: delayed,
              proof_ref: "call_log:cl-s-recon-1",
            },
            { now: () => at(2100), directory, resolveRoute: noRoute },
          );
          assert.deepEqual(withMore.new_recording_ids, ["rec-s-recon-1-2"]);
          assert.equal(withMore.newly_terminal, false);
          assert.equal(
            await Jobs.countDocuments({
              dedupe_key: {
                $regex: `^csi:recording_discovery:interaction:${reconciled.interaction_id}:recording:`,
              },
            }),
            2,
          );
          const replay = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            {
              kind: "call_log",
              record: delayed,
              proof_ref: "call_log:cl-s-recon-1",
            },
            { now: () => at(2200), directory, resolveRoute: noRoute },
          );
          assert.equal(replay.noop, true);
          assert.equal(
            await Jobs.countDocuments({
              dedupe_key: {
                $regex: `^csi:recording_discovery:interaction:${reconciled.interaction_id}:recording:`,
              },
            }),
            2,
          );
        },
      );

      await t.test(
        "identity is account-scoped and never merged by phone/time; same-session proof merges provisional rows",
        async () => {
          // Same telephony session id under another account is a different interaction.
          const foreign = inboundQueueAnsweredDeliveries("s-recon-1").answered;
          foreign.body.parties.forEach((p) => {
            (p as { accountId: string }).accountId = SYNTHETIC_OTHER_ACCOUNT_ID;
          });
          foreign.event = `/restapi/v1.0/account/${SYNTHETIC_OTHER_ACCOUNT_ID}/telephony/sessions`;
          const other = okResult(await observe(foreign, at(9)));
          assert.equal(other.created, true);
          assert.equal(
            await Interaction.countDocuments({
              telephony_session_id: "s-recon-1",
            }),
            2,
          );
          assert.equal(
            await Alias.countDocuments({
              kind: "telephony_session_id",
              value: "s-recon-1",
            }),
            2,
          );

          // Two distinct sessions, same customer, one minute apart: two interactions.
          const a = okResult(
            await observe(
              inboundQueueAnsweredDeliveries("s-similar-a").disconnected,
              at(0),
            ),
          );
          const b = okResult(
            await observe(
              inboundQueueAnsweredDeliveries("s-similar-b").disconnected,
              at(60),
            ),
          );
          assert.notEqual(a.interaction_id, b.interaction_id);

          // Provisional rows: webhook without sessionId (telephony only) and a Call Log record with sessionId only.
          const noSid = webhookDelivery({
            uuid: "m-1",
            telephonySessionId: "s-merge-1",
            sessionId: null,
            sequence: 1,
            eventTime: at(0),
            parties: inboundQueueAnsweredDeliveries(
              "s-merge-1",
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
          const rowA = okResult(await observe(noSid, at(1)));
          const rowB = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            {
              kind: "call_log",
              record: sessionIdOnlyCallLog("s-merge-1"),
              proof_ref: "call_log:sidonly",
            },
            { now: () => at(700), directory, resolveRoute: noRoute },
          );
          assert.notEqual(rowA.interaction_id, rowB.interaction_id);
          const numberBefore = await ContactNumber.findOne({
            e164: SYNTHETIC_CUSTOMER,
          }).lean();

          const bridge = inboundConnectedCallLog("s-merge-1");
          bridge.sessionId = "s-merge-1-sid";
          const merged = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: bridge, proof_ref: "call_log:bridge" },
            { now: () => at(800), directory, resolveRoute: noRoute },
          );
          assert.equal(
            merged.interaction_id,
            rowA.interaction_id,
            "earlier-created row is canonical",
          );
          assert.deepEqual(merged.merged_interaction_ids, [
            rowB.interaction_id,
          ]);
          const tomb = await Interaction.findById(rowB.interaction_id).lean();
          assert.equal(String(tomb?.merged_into_id), rowA.interaction_id);
          assert.equal(
            await Alias.countDocuments({ interaction_id: rowB.interaction_id }),
            0,
          );
          assert.equal(
            await Alias.countDocuments({ interaction_id: rowA.interaction_id }),
            4,
            "telephony, session, record id, sid-only record id",
          );
          // Review fix: re-pointed aliases keep the proof that originally proved them.
          const sidOnlyAlias = await Alias.findOne({
            kind: "call_log_id",
            value: sessionIdOnlyCallLog("s-merge-1").id,
          }).lean();
          assert.equal(
            String(sidOnlyAlias?.interaction_id),
            rowA.interaction_id,
          );
          assert.equal(
            sidOnlyAlias?.proof_ref,
            "call_log:sidonly",
            "merge does not rewrite alias provenance",
          );
          const mergedAudit = await Audit.findOne({
            event_kind: "interaction.merged",
            subject_key: `interaction:${rowB.interaction_id}`,
          }).lean();
          assert.equal(
            (mergedAudit?.current as { proof_ref: string }).proof_ref,
            "call_log:bridge",
            "merge proof lives on the audit row",
          );
          const numberAfter = await ContactNumber.findOne({
            e164: SYNTHETIC_CUSTOMER,
          }).lean();
          assert.equal(
            numberAfter!.rollups.interactions_total,
            numberBefore!.rollups.interactions_total - 1,
          );
          assert.equal(
            await Audit.countDocuments({
              event_kind: "interaction.merged",
              subject_key: `interaction:${rowB.interaction_id}`,
            }),
            1,
          );
          const canonical = await Interaction.findById(
            rowA.interaction_id,
          ).lean();
          assert.equal(canonical?.identity_basis, "telephony_session_id");
          assert.equal(canonical?.session_id, "s-merge-1-sid");
          assert.equal(canonical?.recordings.length, 1);

          // Observing through the tombstoned row's alias resolves to the canonical row.
          const viaOld = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            {
              kind: "call_log",
              record: sessionIdOnlyCallLog("s-merge-1"),
              proof_ref: "call_log:sidonly",
            },
            { now: () => at(900), directory, resolveRoute: noRoute },
          );
          assert.equal(viaOld.interaction_id, rowA.interaction_id);
        },
      );

      await t.test(
        "internal, withheld and malformed observations: evidence without Contact Number or sales work",
        async () => {
          const numbersBefore = await ContactNumber.countDocuments();
          const internal = okResult(
            await observe(internalCallDelivery("s-int-1"), at(0)),
          );
          assert.equal(internal.contact_number_id, null);
          assert.deepEqual(
            internal.jobs,
            [],
            "internal calls schedule no operational or discovery work",
          );
          const withheld = okResult(
            await observe(withheldInboundDelivery("s-wh-1"), at(0)),
          );
          assert.equal(withheld.contact_number_id, null);
          assert.equal(
            withheld.jobs.some((j) => j.startsWith("csi:outreach_ensure")),
            false,
          );
          assert.equal(
            withheld.jobs.some((j) => j.startsWith("csi:recording_discovery")),
            true,
            "mapped inbound may still be eligible for discovery",
          );
          const stored = await Interaction.findById(
            withheld.interaction_id,
          ).lean();
          assert.equal(stored?.external_endpoint_kind, "withheld");
          assert.equal(stored?.provider_result, "Missed");
          assert.equal(await ContactNumber.countDocuments(), numbersBefore);
          const malformed = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            {
              kind: "call_log",
              record: callLogRecord({
                id: "cl-mal",
                telephonySessionId: "s-mal-1",
                direction: "Inbound",
                result: "Missed",
                startTime: at(0),
                duration: 5,
                from: { phoneNumber: "12" },
                to: { phoneNumber: SYNTHETIC_SALES_DID },
              }),
              proof_ref: "call_log:cl-mal",
            },
            { now: () => at(10), directory, resolveRoute: noRoute },
          );
          assert.equal(malformed.contact_number_id, null);
          assert.equal(await ContactNumber.countDocuments(), numbersBefore);
        },
      );

      await t.test(
        "a failed downstream enqueue rolls back projection, aliases, number and audit together",
        async () => {
          await db
            .collection("sales_intelligence_jobs")
            .dropIndex("csi_job_dedupe_unique");
          const before = {
            interactions: await Interaction.countDocuments(),
            aliases: await Alias.countDocuments(),
            numbers: await ContactNumber.countDocuments(),
            audit: await Audit.countDocuments(),
          };
          const [result] = await observe(
            inboundQueueAnsweredDeliveries("s-atomic-1").answered,
            at(0),
          );
          assert.equal(result?.ok, false);
          assert.equal(await Interaction.countDocuments(), before.interactions);
          assert.equal(await Alias.countDocuments(), before.aliases);
          assert.equal(await ContactNumber.countDocuments(), before.numbers);
          assert.equal(await Audit.countDocuments(), before.audit);
          await applyCsiMigration();
          okResult(
            await observe(
              inboundQueueAnsweredDeliveries("s-atomic-1").answered,
              at(0),
            ),
          );
          assert.equal(
            await Interaction.countDocuments(),
            before.interactions + 1,
          );
        },
      );

      const reconcileDeps = (
        pages:
          | Array<Record<string, unknown>[]>
          | ((page: number) => Promise<unknown[]>),
        overrides: Partial<ReconcileDependencies> = {},
      ): Partial<ReconcileDependencies> => ({
        now: () => new Date(),
        fetchPage:
          typeof pages === "function"
            ? ({ page }) => pages(page)
            : async ({ page }) => pages[page - 1] ?? [],
        directory: async () => directory,
        resolveRoute: noRoute,
        configuredAccountId: SYNTHETIC_ACCOUNT_ID,
        recordEvent: noEvent as never,
        requireFlag: false,
        config: {
          ...callLogReconcileConfig(),
          perPage: 2,
          maxPages: 5,
          leaseTtlMs: 5_000,
        },
        ...overrides,
      });

      await t.test(
        "reconcile: dedicated cursor and lease; full success advances cursor and watermark; qualified sync state untouched",
        async () => {
          assert.equal(await SyncState.countDocuments(), 0);
          const summary = await runCallLogReconcileOnce(
            reconcileDeps([
              [
                inboundConnectedCallLog("s-rc-1"),
                outboundMissedCallLog("s-rc-2"),
              ],
              [voicemailCallLog("s-rc-3")],
            ]),
          );
          assert.equal(summary.skipped, false);
          assert.equal(summary.error_code, null);
          assert.equal(summary.cursor_advanced, true);
          assert.equal(summary.pages, 2);
          assert.equal(summary.records, 3);
          assert.equal(summary.upserts, 3);
          const state = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          assert.equal(
            state?.cursor.last_sync_to?.toISOString(),
            summary.window_to,
          );
          assert.equal(
            state?.known_complete_through?.toISOString(),
            new Date(
              new Date(summary.window_to!).getTime() - 15 * 60_000,
            ).toISOString(),
          );
          assert.deepEqual(state?.gaps, []);
          assert.equal(state?.lease_owner, null);
          assert.equal(state?.consecutive_failures, 0);
          assert.equal(
            await Interaction.countDocuments({
              telephony_session_id: { $in: ["s-rc-1", "s-rc-2", "s-rc-3"] },
            }),
            3,
          );
          assert.equal(
            (
              await Interaction.findOne({
                telephony_session_id: "s-rc-2",
              }).lean()
            )?.direction,
            "Outbound",
          );
          assert.equal(
            (await ContactNumber.findOne({ e164: SYNTHETIC_CUSTOMER_B }).lean())
              ?.rollups.outbound_total,
            1,
          );
          assert.equal(
            await db.collection(qualifiedSyncCollection).countDocuments(),
            0,
            "qualified-call cursor collection is never written",
          );

          const replay = await runCallLogReconcileOnce(
            reconcileDeps([
              [
                inboundConnectedCallLog("s-rc-1"),
                outboundMissedCallLog("s-rc-2"),
              ],
              [voicemailCallLog("s-rc-3")],
            ]),
          );
          assert.equal(replay.noops, 3);
          assert.equal(replay.upserts, 0);
          assert.equal(replay.cursor_advanced, true);
        },
      );

      await t.test(
        "reconcile: page failure keeps cursor, projects fetched records, opens a gap; the next full run closes it",
        async () => {
          const before = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          const failing = await runCallLogReconcileOnce(
            reconcileDeps(async (page) => {
              if (page === 1)
                return [
                  inboundConnectedCallLog("s-gap-1"),
                  inboundConnectedCallLog("s-gap-2"),
                ];
              throw new Error("synthetic provider outage");
            }),
          );
          assert.equal(failing.cursor_advanced, false);
          assert.equal(failing.error_code, "provider_request_failed");
          assert.equal(
            failing.upserts,
            2,
            "records already fetched still land idempotently",
          );
          const after = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          assert.equal(
            after?.cursor.last_sync_to?.toISOString(),
            before?.cursor.last_sync_to?.toISOString(),
          );
          assert.equal(
            after?.known_complete_through?.toISOString(),
            before?.known_complete_through?.toISOString(),
          );
          assert.equal(after?.gaps.length, 1);
          assert.equal(after?.gaps[0]!.reason, "provider_request_failed");
          assert.equal(after?.consecutive_failures, 1);

          const repaired = await runCallLogReconcileOnce(
            reconcileDeps([[inboundConnectedCallLog("s-gap-1")]]),
          );
          assert.equal(repaired.cursor_advanced, true);
          const closed = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          assert.deepEqual(closed?.gaps, []);
          assert.equal(closed?.consecutive_failures, 0);
        },
      );

      await t.test(
        "reconcile: 429 ends the run without cursor advance and records the throttle; page limit records the missing range",
        async () => {
          const throttled = await runCallLogReconcileOnce(
            reconcileDeps(async () => {
              throw new RingCentralApiError(
                "throttled",
                429,
                "Too Many Requests",
                "/call-log",
                "GET",
                null,
              );
            }),
          );
          assert.equal(throttled.throttled_count, 1);
          assert.equal(throttled.error_code, "provider_throttled");
          assert.equal(throttled.cursor_advanced, false);
          assert.equal(
            throttled.windows.length,
            1,
            "no gap repair after a throttle",
          );
          let state = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          assert.equal(state?.gaps[0]!.reason, "provider_throttled");
          assert.equal(state?.last_run?.throttled_count, 1);

          const limited = await runCallLogReconcileOnce(
            reconcileDeps(
              async (page) => [
                inboundConnectedCallLog(`s-lim-${page}-a`, {
                  startTime: at(-page * 100),
                }),
                inboundConnectedCallLog(`s-lim-${page}-b`, {
                  startTime: at(-page * 100 - 50),
                }),
              ],
              {
                config: {
                  ...callLogReconcileConfig(),
                  perPage: 2,
                  maxPages: 1,
                  leaseTtlMs: 5_000,
                },
              },
            ),
          );
          assert.equal(limited.error_code, "page_limit");
          assert.equal(limited.cursor_advanced, false);
          assert.equal(
            limited.windows[0]!.incomplete_before?.toISOString(),
            at(-150).toISOString(),
          );
          state = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          assert.equal(
            state?.gaps.some(
              (g) =>
                g.reason === "page_limit" &&
                g.to.toISOString() === at(-150).toISOString(),
            ),
            true,
          );

          // Review fix: a 429 during gap repair ends the run; remaining gaps are not attempted,
          // and the provider-modified watermark does not advance on a partial run.
          await SyncState.updateOne(
            { scope: CALL_LOG_ALL_DIRECTIONS_SCOPE },
            {
              $set: {
                gaps: [
                  {
                    from: at(-400_000),
                    to: at(-390_000),
                    reason: "provider_request_failed",
                    opened_at: at(-389_000),
                  },
                  {
                    from: at(-380_000),
                    to: at(-370_000),
                    reason: "provider_request_failed",
                    opened_at: at(-369_000),
                  },
                ],
              },
            },
          );
          const watermarkBefore =
            (
              await SyncState.findOne({
                scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
              }).lean()
            )?.cursor.provider_modified_watermark ?? null;
          let fetches = 0;
          const repairThrottled = await runCallLogReconcileOnce(
            reconcileDeps(async () => {
              fetches += 1;
              if (fetches === 1)
                return [
                  inboundConnectedCallLog("s-wm-1", {
                    lastModifiedTime: new Date(Date.now() + 86_400_000),
                  }),
                ];
              throw new RingCentralApiError(
                "throttled",
                429,
                "Too Many Requests",
                "/call-log",
                "GET",
                null,
              );
            }),
          );
          assert.equal(
            repairThrottled.windows.length,
            2,
            "rolling window plus exactly one gap repair",
          );
          assert.equal(repairThrottled.windows[0]!.complete, true);
          assert.equal(repairThrottled.windows[1]!.kind, "gap_repair");
          assert.equal(
            repairThrottled.windows[1]!.error_code,
            "provider_throttled",
          );
          assert.equal(repairThrottled.throttled_count, 1);
          assert.equal(
            repairThrottled.throttle_retry_after_observed,
            false,
            "shared client exposes no Retry-After; the default is not reported as observed",
          );
          assert.equal(fetches, 2, "the second gap was never fetched");
          assert.match(repairThrottled.request_id ?? "", /^[a-f\d]{24}$/);
          const wmAudit = await Audit.findOne({
            subject_key: `interaction:${(await Interaction.findOne({ telephony_session_id: "s-wm-1" }).lean())!._id}`,
          }).lean();
          assert.equal(
            wmAudit?.actor.request_id,
            repairThrottled.request_id,
            "reconcile audit rows tie back to the run",
          );
          assert.equal(
            (wmAudit?.current as { request_id_generated: boolean })
              .request_id_generated,
            false,
          );
          state = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          assert.equal(
            state?.cursor.provider_modified_watermark?.toISOString() ?? null,
            watermarkBefore?.toISOString() ?? null,
            "watermark holds when any window of the run was incomplete",
          );
          assert.equal(
            state?.gaps.length,
            2,
            "throttled gap stays open, untouched gap stays open",
          );

          // Repair everything with a healthy run.
          const healthy = await runCallLogReconcileOnce(reconcileDeps([[]]));
          assert.equal(healthy.cursor_advanced, true);
          state = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          assert.deepEqual(state?.gaps, []);
        },
      );

      await t.test(
        "reconcile: concurrent workers elect one lease holder; an expired lease cannot write the cursor",
        async () => {
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const slow = runCallLogReconcileOnce(
            reconcileDeps(async () => {
              await gate;
              return [];
            }),
          );
          await new Promise((r) => setTimeout(r, 200));
          const contender = await runCallLogReconcileOnce(reconcileDeps([[]]));
          assert.equal(contender.skipped, true);
          assert.equal(contender.skip_reason, "lease_held");

          // Simulate lease expiry while the slow worker is mid-page, then let a successor take over.
          await SyncState.updateOne(
            { scope: CALL_LOG_ALL_DIRECTIONS_SCOPE },
            { $set: { leased_until: new Date(0) } },
          );
          const successor = await runCallLogReconcileOnce(
            reconcileDeps([[inboundConnectedCallLog("s-fence-1")]]),
          );
          assert.equal(successor.skipped, false);
          assert.equal(successor.cursor_advanced, true);
          const stateAfterSuccessor = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          release();
          const stale = await slow;
          assert.equal(stale.error_code, "lease_lost");
          assert.equal(stale.cursor_advanced, false);
          const stateAfterStale = await SyncState.findOne({
            scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
          }).lean();
          assert.equal(
            stateAfterStale?.cursor.last_sync_to?.toISOString(),
            stateAfterSuccessor?.cursor.last_sync_to?.toISOString(),
          );
          assert.equal(
            stateAfterStale?.lease_epoch,
            stateAfterSuccessor?.lease_epoch,
          );
          assert.equal(
            stateAfterStale?.last_run?.started_at.toISOString(),
            stateAfterSuccessor?.last_run?.started_at.toISOString(),
          );
        },
      );

      await t.test(
        "reconcile: unresolved provider account fails closed without fabricating identity",
        async () => {
          const record = inboundConnectedCallLog("s-noacct-1");
          delete (record as { uri?: string }).uri;
          const summary = await runCallLogReconcileOnce(
            reconcileDeps([[record]], { configuredAccountId: null }),
          );
          assert.equal(summary.error_code, "account_unresolved");
          assert.equal(summary.cursor_advanced, false);
          assert.equal(
            await Interaction.countDocuments({
              telephony_session_id: "s-noacct-1",
            }),
            0,
          );
          const mismatch = await runCallLogReconcileOnce(
            reconcileDeps([[inboundConnectedCallLog("s-noacct-2")]], {
              configuredAccountId: SYNTHETIC_OTHER_ACCOUNT_ID,
            }),
          );
          assert.equal(mismatch.error_code, "account_mismatch");
          assert.equal(
            await Interaction.countDocuments({
              telephony_session_id: "s-noacct-2",
            }),
            0,
          );
        },
      );
      await t.test(
        "CC-04: provisional Internal snapshot -> settled Inbound: one Contact Number, one outreach_ensure, discovery per recording, rollups once, audit with both proofs",
        async () => {
          const sessionId = "s-prov-1";
          const snapshot = internalSnapshotRecord(0, { sessionId });
          const caller = "+15550100300";
          const snapshotProof = `call_log:${String(snapshot.id)}@${String(snapshot.lastModifiedTime)}`;
          const deps = { directory, resolveRoute: noRoute };

          const first = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: snapshot, proof_ref: snapshotProof, source: "call_log_reconcile" },
            { ...deps, now: () => at(100) },
          );
          assert.equal(first.created, true);
          assert.equal(first.call_log_state, "provisional");
          assert.equal(first.newly_settled, false);
          assert.equal(first.newly_terminal, false);
          assert.equal(first.contact_number_id, null);
          assert.equal(first.contact_number_created, false);
          assert.deepEqual(first.jobs, [], "a snapshot schedules no downstream work");
          const provisionalRow = await Interaction.findById(first.interaction_id).lean();
          assert.equal(provisionalRow?.call_log_state, "provisional");
          assert.equal(provisionalRow?.terminal, false);
          assert.equal(provisionalRow?.direction, "Internal");
          assert.equal(provisionalRow?.ended_at, null);
          assert.equal(provisionalRow?.duration_seconds, null);
          assert.equal(await ContactNumber.countDocuments({ e164: caller }), 0);
          assert.equal(await Jobs.countDocuments({ input_refs: new mongoose.Types.ObjectId(first.interaction_id) }), 0);

          // The same snapshot on the next run, still inside the horizon: nothing to do.
          const again = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: snapshot, proof_ref: snapshotProof, source: "call_log_reconcile" },
            { ...deps, now: () => at(400) },
          );
          assert.equal(again.noop, true);
          assert.equal(again.call_log_state, "provisional");

          // The final version of the same record id, 24 minutes later.
          const final = callLogRecord({
            id: String(snapshot.id),
            telephonySessionId: sessionId,
            direction: "Inbound",
            result: "Accepted",
            startTime: new Date(String(snapshot.startTime)),
            duration: 1424,
            from: { phoneNumber: caller, name: "Synthetic Caller" },
            to: { phoneNumber: SYNTHETIC_SALES_DID },
            recording: { id: `rec-${sessionId}-1` },
            legs: [
              { startTime: String(snapshot.startTime), duration: 1424, direction: "Inbound", action: "Phone Call", result: "Accepted", legType: "Accept", master: true, from: { phoneNumber: caller }, to: { phoneNumber: SYNTHETIC_SALES_DID }, recording: { id: `rec-${sessionId}-1`, type: "Automatic" } },
              ...(snapshot.legs as Record<string, unknown>[]),
              { startTime: at(12).toISOString(), duration: 1417, direction: "Outbound", action: "VoIP Call", result: "Call connected", legType: "PstnToSip", from: { phoneNumber: caller, extensionId: "900000000101" }, to: { phoneNumber: SYNTHETIC_SALES_DID, extensionNumber: "101" }, extension: { id: "900000000101" }, recording: { id: `rec-${sessionId}-2`, type: "Automatic" } },
            ],
            lastModifiedTime: at(1450),
          });
          const finalProof = `call_log:${String(final.id)}@${String(final.lastModifiedTime)}`;
          const settled = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: final, proof_ref: finalProof, source: "call_log_reconcile" },
            { ...deps, now: () => at(1500) },
          );
          assert.equal(settled.noop, false);
          assert.equal(settled.created, false);
          assert.equal(settled.interaction_id, first.interaction_id);
          assert.equal(settled.newly_settled, true);
          assert.equal(settled.call_log_state, "settled");
          assert.equal(settled.contact_number_created, true);
          const stages = settled.jobs.map((j) => j.split(":")[1]).sort();
          assert.deepEqual(stages, ["attachment_refresh", "outreach_ensure", "recording_discovery", "recording_discovery"]);
          assert.ok(settled.jobs.every((j) => !j.endsWith(":pending")));

          const numbers = await ContactNumber.find({ e164: caller }).lean();
          assert.equal(numbers.length, 1, "one Contact Number");
          assert.equal(String(numbers[0]!._id), settled.contact_number_id);
          assert.equal(numbers[0]!.rollups.interactions_total, 1);
          assert.equal(numbers[0]!.rollups.inbound_total, 1);
          assert.equal(numbers[0]!.rollups.outbound_total, 0);
          assert.equal(numbers[0]!.rollups.recordings_total, 2);

          const row = await Interaction.findById(first.interaction_id).lean();
          assert.equal(row?.call_log_state, "settled");
          assert.equal(row?.direction, "Inbound");
          assert.equal(row?.external_e164, caller);
          assert.equal(row?.external_endpoint_kind, "external");
          assert.equal(String(row?.contact_number_id), settled.contact_number_id);
          assert.equal(row?.terminal, true);
          assert.equal(row?.duration_seconds, 1424);
          assert.equal(row?.projection_revision, 2);

          // A replay of the final version: no revision, no job, no rollup change.
          const replay = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: final, proof_ref: finalProof, source: "call_log_reconcile" },
            { ...deps, now: () => at(1800) },
          );
          assert.equal(replay.noop, true);
          const interactionRef = new mongoose.Types.ObjectId(first.interaction_id);
          assert.equal(await Jobs.countDocuments({ stage: "outreach_ensure", input_refs: interactionRef }), 1, "outreach_ensure once");
          assert.equal(await Jobs.countDocuments({ stage: "recording_discovery", input_refs: interactionRef }), 2, "discovery per recording");
          assert.equal(await Jobs.countDocuments({ stage: "attachment_refresh", subject_key: `number:${settled.contact_number_id}` }), 1);
          const recounted = await ContactNumber.findById(settled.contact_number_id).lean();
          assert.equal(recounted?.rollups.interactions_total, 1, "rollups counted once");
          assert.equal(recounted?.rollups.recordings_total, 2);

          const audit = await Audit.find({ subject_key: `interaction:${first.interaction_id}` }).sort({ _id: 1 }).lean();
          assert.deepEqual(audit.map((a) => a.event_kind), ["interaction.created", "interaction.updated"]);
          const created = audit[0]!.current as { proof_ref: string; call_log_state: string; terminal: boolean; contact_number_id: string | null };
          assert.equal(created.proof_ref, snapshotProof);
          assert.equal(created.call_log_state, "provisional");
          assert.equal(created.terminal, false);
          assert.equal(created.contact_number_id, null);
          const prior = audit[1]!.prior as { call_log_state: string; direction: string };
          const current = audit[1]!.current as { proof_ref: string; call_log_state: string; direction: string; contact_number_id: string };
          assert.equal(prior.call_log_state, "provisional");
          assert.equal(prior.direction, "Internal");
          assert.equal(current.proof_ref, finalProof);
          assert.equal(current.call_log_state, "settled");
          assert.equal(current.direction, "Inbound");
          assert.equal(current.contact_number_id, settled.contact_number_id);
        },
      );

      await t.test(
        "CC-04: a provisional row past the settle horizon settles on re-apply of the same record with its last observed values",
        async () => {
          const deps = { directory, resolveRoute: noRoute };
          // Internal snapshot: settles as Internal, still no Number and no work.
          const snapshot = internalSnapshotRecord(1, { sessionId: "s-prov-2" });
          const modified = new Date(String(snapshot.lastModifiedTime)).getTime();
          const first = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: snapshot, proof_ref: `call_log:${String(snapshot.id)}` },
            { ...deps, now: () => at(100) },
          );
          assert.equal(first.call_log_state, "provisional");
          const settled = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: snapshot, proof_ref: `call_log:${String(snapshot.id)}` },
            { ...deps, now: () => new Date(modified + 240 * 60_000) },
          );
          assert.equal(settled.noop, false);
          assert.equal(settled.newly_settled, true);
          assert.equal(settled.call_log_state, "settled");
          assert.deepEqual(settled.jobs, [], "an Internal call schedules nothing, settled or not");
          const row = await Interaction.findById(first.interaction_id).lean();
          assert.equal(row?.call_log_state, "settled");
          assert.equal(row?.terminal, true);
          assert.equal(row?.direction, "Internal");
          assert.equal(row?.provider_result, "IP Phone Offline");
          assert.equal(row?.duration_seconds, 0);
          assert.equal(row?.contact_number_id, null);

          // External P-a snapshot with a shorter configured horizon (passthrough):
          // the Number appears on the settle transition, counted once, with its work.
          const caller = "+15550100398";
          const external = callLogRecord({
            id: "cl-s-prov-3",
            telephonySessionId: "s-prov-3",
            direction: "Inbound",
            result: "In Progress",
            startTime: at(0),
            duration: 12,
            from: { phoneNumber: caller },
            to: { phoneNumber: SYNTHETIC_SALES_DID },
            legs: [
              { startTime: at(0).toISOString(), duration: 12, direction: "Inbound", action: "Phone Call", result: "In Progress", legType: "Accept", master: true, from: { phoneNumber: caller }, to: { phoneNumber: SYNTHETIC_SALES_DID } },
            ],
            lastModifiedTime: at(30),
          });
          const horizonDeps = { ...deps, settleHorizonMinutes: 60 };
          const pending = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: external, proof_ref: "call_log:cl-s-prov-3" },
            { ...horizonDeps, now: () => at(30 + 59 * 60) },
          );
          assert.equal(pending.call_log_state, "provisional");
          assert.equal(pending.contact_number_id, null);
          assert.deepEqual(pending.jobs, []);
          const pendingRow = await Interaction.findById(pending.interaction_id).lean();
          assert.equal(pendingRow?.direction, "Inbound");
          assert.equal(pendingRow?.external_e164, caller, "raw observation kept for display");
          assert.equal(await ContactNumber.countDocuments({ e164: caller }), 0);

          const done = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: external, proof_ref: "call_log:cl-s-prov-3" },
            { ...horizonDeps, now: () => at(30 + 60 * 60) },
          );
          assert.equal(done.newly_settled, true);
          assert.equal(done.contact_number_created, true);
          assert.deepEqual(
            done.jobs.map((j) => j.split(":")[1]).sort(),
            ["attachment_refresh", "outreach_ensure", "recording_discovery"],
          );
          assert.ok(done.jobs.some((j) => j.endsWith(":pending")), "no recording id yet: pending discovery");
          const number = await ContactNumber.findOne({ e164: caller }).lean();
          assert.equal(number?.rollups.interactions_total, 1);
          assert.equal(number?.rollups.inbound_total, 1);
          const doneRow = await Interaction.findById(done.interaction_id).lean();
          assert.equal(doneRow?.terminal, true);
          assert.equal(doneRow?.duration_seconds, 12);

          const replay = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: external, proof_ref: "call_log:cl-s-prov-3" },
            { ...horizonDeps, now: () => at(30 + 90 * 60) },
          );
          assert.equal(replay.noop, true);
          assert.equal((await ContactNumber.findOne({ e164: caller }).lean())?.rollups.interactions_total, 1);
        },
      );
      await t.test(
        "CC-04: live shape: Outbound ring-out snapshot -> Inbound Accepted final settles once with its Number and work",
        async () => {
          const deps = { directory, resolveRoute: noRoute };
          const snapshot = liveSnapshotRecord(2, "s-prov-live");
          const first = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: snapshot, proof_ref: "call_log:cl-s-prov-live" },
            { ...deps, now: () => at(60) },
          );
          assert.equal(first.call_log_state, "provisional");
          assert.deepEqual(first.jobs, []);
          assert.equal(first.contact_number_id, null);
          assert.equal((await Interaction.findById(first.interaction_id).lean())?.direction, "Outbound");
          const settled = await applyInteractionObservation(
            SYNTHETIC_ACCOUNT_ID,
            { kind: "call_log", record: liveFinalRecord(2, "s-prov-live"), proof_ref: "call_log:cl-s-prov-live" },
            { ...deps, now: () => at(200) },
          );
          assert.equal(settled.interaction_id, first.interaction_id);
          assert.equal(settled.newly_settled, true);
          assert.equal(settled.contact_number_created, true);
          assert.deepEqual(
            settled.jobs.map((j) => j.split(":")[1]).sort(),
            ["attachment_refresh", "outreach_ensure", "recording_discovery"],
          );
          const row = await Interaction.findById(first.interaction_id).lean();
          assert.equal(row?.direction, "Inbound");
          assert.equal(row?.company_e164, SYNTHETIC_SALES_DID);
          assert.equal(row?.started_at.toISOString(), at(0).toISOString());
          const number = await ContactNumber.findById(settled.contact_number_id).lean();
          assert.equal(number?.rollups.interactions_total, 1);
          assert.equal(number?.rollups.inbound_total, 1);
          assert.equal(number?.rollups.outbound_total, 0, "the snapshot's Outbound was never counted");
          assert.equal(number?.rollups.recordings_total, 1);
        },
      );

    } finally {
      // Disposable per-run database on the loopback replica; drop it so repeated
      // runs do not accumulate testvantagemovers_csi02* databases.
      if (/^testvantagemovers_csi02[a-z0-9]+$/.test(db.databaseName)) {
        await db.dropDatabase().catch(() => undefined);
      }
      await mongoose.disconnect();
    }
  },
);
