import { timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { csiFlag } from "../config/domain/salesIntelligence";
import { connectMongo } from "../db";
import { logger } from "../logger";
import {
  drainCaptureProjectionJobs,
  type CaptureProjectionWorkerDeps,
  type DrainSummary,
} from "../services/numberActivity/captureProjectionWorker";
import { runDirectorySyncOnce } from "../services/numberActivity/directorySync";
import { runAttachmentRefreshOnce, drainAttachmentRefreshJobs } from "../services/salesIntelligence/attachment/refresh";
import { drainNudgeRepairJobs } from "../services/salesIntelligence/nudges/repair";
import { retireLegacyCsiJobs } from "../services/salesIntelligence/jobs";
import { drainRebuildJobs, type RebuildDrainSummary, type RebuildWorkerDeps } from "../services/numberActivity/rebuild";
import { callLogReconcileConfig, runCallLogReconcileOnce } from "../services/numberActivity/reconcileCallLog";
import { settleProvisionalFromStore } from "../services/numberActivity/settleProvisional";
import { runCallLogSweepOnce } from "../services/numberActivity/callLogSweep";
import { runCallLogIsyncLaneOnce } from "../services/numberActivity/callLogIsyncLane";
import { runRetentionOnce } from "../services/salesIntelligence/retention";
import {
  runReceiptWatermarkRecovery,
  type RecoverySummary,
} from "../services/numberActivity/webhookRecovery";
import { refreshCaptureCoverage } from "../services/numberActivity/coverage";
import { ensureLeadMessageToIndex } from "../models/LeadMessage";
import { drainCallLogRefreshJobs } from "../services/numberActivity/callLogRefresh";
import { runWebhookSubscriptionMaintenance } from "../services/numberActivity/webhookSubscriptionCron";
import { runRepSmsSubscriptionMaintenance } from "../services/ringcentral/repSms/subscriptionMaintenance";
import { drainRepSmsSyncJobs } from "../services/ringcentral/repSms/intent";
import { runRepSmsSafetyPoll } from "../services/ringcentral/repSms/poll";
import { recordDeploymentCommitOnce } from "../services/salesIntelligence/deploymentStamp";

/**
 * Sales Intelligence cron routes (03 §11). Mounted before the `/api/v1`
 * guard like the other cron routers; authenticated with the existing
 * `Authorization: Bearer ${CRON_SECRET}` / `x-cron-secret` pattern.
 *
 * Every route: disabled flag → `{ ok: true, skipped: true, reason: "disabled" }`,
 * lease held → `{ ok: true, skipped: true, reason: "lease_held" }`, never a
 * provider body. Registration lives in `vercel.json`; tests assert it.
 *
 * Job recovery is gated per stage (03 §11 "stages honor their flags"): the
 * capture drain runs under `CAPTURE_WEBHOOK`, each `extraRecovery` step under
 * its own flag. Capture is operational work that does not depend on the
 * master Owner read switch `SALES_INTELLIGENCE_ENABLED`. Whenever recovery
 * runs it first terminalizes rows of retired stages (`retireLegacyCsiJobs`),
 * so a backlog left by an earlier release is never claimed by anyone.
 *
 * Only retained schedules exist here. The AI/media/Outreach crons (extract,
 * apply, transcribe, media fetch, Outreach ensure, Attention publish, Overview
 * refresh, legacy backfill step) are retired with their pipeline.
 */
export type SalesIntelligenceCronRouteDeps = {
  connect?: typeof connectMongo;
  flag?: typeof csiFlag;
  runCallLogReconcile?: typeof runCallLogReconcileOnce;
  /**
   * Settles provisional rows past the horizon from the store. Job recovery runs
   * it when webhook capture is on and Call Log capture is off, because then no
   * reconcile exists to settle them.
   */
  settleProvisional?: () => Promise<unknown>;
  /** RINGCENTRAL-CAPTURE §4: staffed-hours minute Call Log ISync lane under `CAPTURE_CALL_LOG`. */
  runCallLogIsyncLane?: typeof runCallLogIsyncLaneOnce;
  /** CC-06: nightly authoritative Call Log sweep under `CAPTURE_CALL_LOG`. */
  runCallLogSweep?: typeof runCallLogSweepOnce;
  runReceiptRecovery?: typeof runReceiptWatermarkRecovery;
  drainCaptureProjection?: (max: number, deadlineMs: number) => Promise<DrainSummary>;
  /** Additional per-stage recovery steps (e.g. the CSI-04 rebuild drain), each run only when its own flag is on. */
  extraRecovery?: Array<{ name: string; flag: Parameters<typeof csiFlag>[0]; run: () => Promise<unknown> }>;
  captureWorkerDeps?: CaptureProjectionWorkerDeps;
  /** Jobs drained per invocation (default 200, at least the recovery scan's per-run creation capacity in steady state). */
  captureDrainMax?: number;
  /** Wall-clock budget for the drain so a long invocation checkpoints instead of being killed mid-job (default 40 s). */
  captureDrainDeadlineMs?: number;
  /** CSI-04: rebuild jobs drained under `SALES_INTELLIGENCE_ENABLED` (the Owner command that creates them is behind the same flag). */
  drainRebuild?: (max: number, deadlineMs: number) => Promise<RebuildDrainSummary>;
  rebuildWorkerDeps?: RebuildWorkerDeps;
  rebuildDrainMax?: number;
  /** CSI-04: daily directory snapshot sync under `SALES_INTELLIGENCE_DIRECTORY_SYNC`. */
  runDirectorySync?: typeof runDirectorySyncOnce;
  runAttachmentRefresh?: typeof runAttachmentRefreshOnce;
  drainAttachmentRefresh?: typeof drainAttachmentRefreshJobs;
  runRetention?: typeof runRetentionOnce;
  drainNudgeRepair?: typeof drainNudgeRepairJobs;
  /** Terminalizes rows of retired stages; job recovery runs it first. */
  retireLegacyJobs?: () => Promise<{ retired: number; stages: Record<string, number> }>;
  /** Recounts the Owner coverage strip. Job recovery calls it once a minute. */
  refreshCoverage?: () => Promise<unknown>;
  /** Creates `lead_messages.to` if it is missing. Reads do not. */
  ensureLeadMessageIndex?: () => Promise<unknown>;
  /** CC-08: `call_log_refresh` drain (job recovery, under `CAPTURE_WEBHOOK`) and the daily subscription maintenance. */
  drainCallLogRefresh?: () => Promise<unknown>;
  runWebhookSubscription?: typeof runWebhookSubscriptionMaintenance;
  /** RINGCENTRAL-CAPTURE §3: `rep_sms` renew + filter reconcile, after the `calls` step (desk control gated). */
  runRepSmsSubscription?: typeof runRepSmsSubscriptionMaintenance;
  /** RINGCENTRAL-CAPTURE §5: due `rep_sms_sync` jobs (job recovery) and the staffed-hours safety poll. */
  drainRepSmsSync?: () => Promise<unknown>;
  runRepSmsPoll?: typeof runRepSmsSafetyPoll;
  /** CC-00 drift guard: records the deployed commit once per process (Vercel production only; never throws). */
  recordDeployment?: () => Promise<unknown>;
};

export const CSI_CRON_PATHS = {
  nudgeRepair: "/api/cron/sales-intelligence-nudge-repair",
  retention: "/api/cron/sales-intelligence-retention",
  callLogReconcile: "/api/cron/sales-intelligence-call-log-reconcile",
  callLogSweep: "/api/cron/sales-intelligence-call-log-sweep",
  callLogIsync: "/api/cron/sales-intelligence-call-log-isync",
  jobRecovery: "/api/cron/sales-intelligence-job-recovery",
  directorySync: "/api/cron/sales-intelligence-directory-sync",
  attachmentRefresh: "/api/cron/sales-intelligence-attachment-refresh",
  webhookSubscription: "/api/cron/sales-intelligence-webhook-subscription",
  repSmsPoll: "/api/cron/sales-intelligence-rep-sms-poll",
} as const;

export function createSalesIntelligenceCronRouter(
  deps: SalesIntelligenceCronRouteDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const flag = deps.flag ?? csiFlag;
  const reconcile = deps.runCallLogReconcile ?? runCallLogReconcileOnce;
  const recovery = deps.runReceiptRecovery ?? runReceiptWatermarkRecovery;
  const drainCapture =
    deps.drainCaptureProjection ??
    ((max: number, deadlineMs: number) =>
      drainCaptureProjectionJobs(max, deps.captureWorkerDeps, { deadlineMs }));
  const drainMax = deps.captureDrainMax ?? 200;
  const drainDeadlineMs = deps.captureDrainDeadlineMs ?? 40_000;
  const drainRebuild =
    deps.drainRebuild ??
    ((max: number, deadlineMs: number) => drainRebuildJobs(max, deps.rebuildWorkerDeps, { deadlineMs }));
  const rebuildMax = deps.rebuildDrainMax ?? 100;
  const directorySync = deps.runDirectorySync ?? runDirectorySyncOnce;
  const retireLegacyJobs = deps.retireLegacyJobs ?? (() => retireLegacyCsiJobs());
  const extraRecovery: NonNullable<SalesIntelligenceCronRouteDeps["extraRecovery"]> = deps.extraRecovery ?? [
    { name: "nudge_repair", flag: "NUDGE_ENABLED" as const, run: () => (deps.drainNudgeRepair ?? drainNudgeRepairJobs)() },
    { name: "attachment_refresh", flag: "ATTACHMENT_REFRESH" as const, run: () => (deps.drainAttachmentRefresh ?? drainAttachmentRefreshJobs)() },
  ];

  // CC-08 webhook acceleration: the `call_log_refresh` drain rides job
  // recovery under `CAPTURE_WEBHOOK`; the subscription cron renews/repairs
  // the owned all-direction subscription daily under the same flag.
  if (!deps.extraRecovery) {
    extraRecovery.push({
      name: "call_log_refresh",
      flag: "CAPTURE_WEBHOOK" as const,
      run: () => (deps.drainCallLogRefresh ?? (() => drainCallLogRefreshJobs()))(),
    });
    // Rep SMS sync intents ride the same recovery; each job re-checks controls.rep_sms_capture_enabled.
    extraRecovery.push({
      name: "rep_sms_sync",
      flag: "CAPTURE_WEBHOOK" as const,
      run: () => (deps.drainRepSmsSync ?? (() => drainRepSmsSyncJobs()))(),
    });
  }

  // RINGCENTRAL-CAPTURE §5/§7: every minute, the staffed-hours safety poll syncs the mailboxes whose
  // stagger slot is this minute. The service gates on the persisted desk control (fail closed).
  router.all(CSI_CRON_PATHS.repSmsPoll, requireCronAuth, async (_req, res) => {
    try {
      await connect();
      const summary = await (deps.runRepSmsPoll ?? runRepSmsSafetyPoll)();
      if (summary.skipped) return res.json({ ok: true, skipped: true, reason: summary.skip_reason, summary });
      return res.json({ ok: true, skipped: false, summary });
    } catch (error) {
      logger.error({ msg: "sales_outreach.cron.rep_sms_poll.failed", errorName: error instanceof Error ? error.name : "Error" });
      return res.status(500).json({ ok: false, error: "Rep SMS poll failed" });
    }
  });
  router.all(CSI_CRON_PATHS.webhookSubscription, requireCronAuth, async (_req, res) => {
    if (!flag("CAPTURE_WEBHOOK")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try {
      await connect();
      const summary = await (deps.runWebhookSubscription ?? runWebhookSubscriptionMaintenance)();
      // The SMS channel never blocks the calls outcome; its failure is reported beside it.
      const repSms = await (deps.runRepSmsSubscription ?? runRepSmsSubscriptionMaintenance)().catch((error: unknown) => ({
        skipped: false as const,
        error: error instanceof Error ? error.name : "Error",
      }));
      return res.json({ ok: true, skipped: false, summary, rep_sms: repSms });
    } catch {
      return res.status(500).json({ ok: false, error: "Webhook subscription maintenance failed" });
    }
  });

  router.all(CSI_CRON_PATHS.callLogReconcile, requireCronAuth, async (_req, res) => {
    // A disabled route never claims the lease; the service also re-checks the flag.
    if (!flag("CAPTURE_CALL_LOG")) {
      return res.json({ ok: true, skipped: true, reason: "disabled" });
    }
    try {
      await connect();
      const summary = await reconcile();
      if (summary.skipped) {
        return res.json({ ok: true, skipped: true, reason: summary.skip_reason ?? "disabled", summary });
      }
      return res.json({ ok: true, skipped: false, summary });
    } catch (error) {
      logger.error({
        msg: "sales_intelligence.cron.call_log_reconcile.failed",
        errorName: error instanceof Error ? error.name : "Error",
      });
      return res.status(500).json({ ok: false, error: "Call Log reconcile failed" });
    }
  });

  // RINGCENTRAL-CAPTURE §4: every minute in New York staffed hours [07:45, 20:30) one Call Log
  // ISync confirms calls; the service yields outside those hours and on the reconcile's minutes.
  router.all(CSI_CRON_PATHS.callLogIsync, requireCronAuth, async (_req, res) => {
    if (!flag("CAPTURE_CALL_LOG")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try {
      await connect();
      const summary = await (deps.runCallLogIsyncLane ?? runCallLogIsyncLaneOnce)();
      if (summary.skipped) return res.json({ ok: true, skipped: true, reason: summary.skip_reason ?? "disabled", summary });
      return res.json({ ok: true, skipped: false, summary });
    } catch (error) {
      logger.error({
        msg: "sales_intelligence.cron.call_log_isync.failed",
        errorName: error instanceof Error ? error.name : "Error",
      });
      return res.status(500).json({ ok: false, error: "Call Log ISync failed" });
    }
  });

  // CC-06: the nightly sweep takes the reconcile lease, so it never overlaps a
  // run; `lease_held` just means a reconcile run is in progress.
  router.all(CSI_CRON_PATHS.callLogSweep, requireCronAuth, async (_req, res) => {
    if (!flag("CAPTURE_CALL_LOG")) {
      return res.json({ ok: true, skipped: true, reason: "disabled" });
    }
    try {
      await connect();
      const summary = await (deps.runCallLogSweep ?? runCallLogSweepOnce)();
      if (summary.skipped) {
        return res.json({ ok: true, skipped: true, reason: summary.skip_reason ?? "disabled", summary });
      }
      return res.json({ ok: true, skipped: false, summary });
    } catch (error) {
      logger.error({
        msg: "sales_intelligence.cron.call_log_sweep.failed",
        errorName: error instanceof Error ? error.name : "Error",
      });
      return res.status(500).json({ ok: false, error: "Call Log sweep failed" });
    }
  });

  router.all(CSI_CRON_PATHS.jobRecovery, requireCronAuth, async (_req, res) => {
    const captureOn = flag("CAPTURE_WEBHOOK");
    const rebuildOn = flag("ENABLED");
    const extras = extraRecovery.filter((step) => flag(step.flag));
    if (!captureOn && !rebuildOn && extras.length === 0) {
      return res.json({ ok: true, skipped: true, reason: "disabled" });
    }
    try {
      await connect();
      // Retired-stage fence first: neither the drains below nor an earlier deployment can claim those rows
      // afterwards. A failed sweep never blocks retained recovery; claims exclude retired stages anyway.
      const retiredJobs = await retireLegacyJobs().catch((error: unknown) => {
        logger.error({
          msg: "sales_intelligence.cron.retire_legacy_jobs.failed",
          errorName: error instanceof Error ? error.name : "Error",
        });
        return null;
      });
      await (deps.recordDeployment ?? recordDeploymentCommitOnce)();
      await (deps.refreshCoverage ?? refreshCaptureCoverage)().catch((error: unknown) => {
        logger.error({
          msg: "sales_intelligence.cron.coverage_refresh.failed",
          errorName: error instanceof Error ? error.name : "Error",
        });
      });
      await (deps.ensureLeadMessageIndex ?? ensureLeadMessageToIndex)().catch((error: unknown) => {
        logger.error({
          msg: "sales_intelligence.cron.lead_message_index.failed",
          errorName: error instanceof Error ? error.name : "Error",
        });
      });
      let receiptRecovery: RecoverySummary | null = null;
      let capture: DrainSummary | null = null;
      let provisionalSettle: unknown = null;
      let rebuild: RebuildDrainSummary | null = null;
      if (captureOn) {
        receiptRecovery = await recovery();
        capture = await drainCapture(drainMax, drainDeadlineMs);
        if (!flag("CAPTURE_CALL_LOG")) {
          provisionalSettle = await (deps.settleProvisional ??
            (() => settleProvisionalFromStore({
              now: () => new Date(),
              settleHorizonMinutes: callLogReconcileConfig().settleHorizonMinutes,
              limit: 50,
            })))();
        }
      }
      if (rebuildOn) {
        rebuild = await drainRebuild(rebuildMax, drainDeadlineMs);
      }
      const extraResults: Record<string, unknown> = {};
      for (const step of extras) {
        extraResults[step.name] = await step.run();
      }
      return res.json({
        ok: true,
        skipped: false,
        retired_jobs: retiredJobs,
        receipt_recovery: receiptRecovery
          ? {
              skipped: receiptRecovery.skipped,
              skip_reason: receiptRecovery.skip_reason,
              pages: receiptRecovery.pages,
              scanned: receiptRecovery.scanned,
              created: receiptRecovery.created,
              existing: receiptRecovery.existing,
              quarantined: receiptRecovery.quarantined.length,
              failed: receiptRecovery.failed,
              budget_exhausted: receiptRecovery.budget_exhausted,
              watermark_after: receiptRecovery.watermark_after,
              error_code: receiptRecovery.error_code,
            }
          : null,
        capture_projection: capture
          ? {
              claimed: capture.claimed,
              completed: capture.completed,
              failed: capture.failed,
              lease_lost: capture.lease_lost,
              deadline_reached: capture.deadline_reached,
            }
          : null,
        rebuild,
        provisional_settle: provisionalSettle,
        ...extraResults,
      });
    } catch (error) {
      logger.error({
        msg: "sales_intelligence.cron.job_recovery.failed",
        errorName: error instanceof Error ? error.name : "Error",
      });
      return res.status(500).json({ ok: false, error: "Job recovery failed" });
    }
  });

  router.all(CSI_CRON_PATHS.directorySync, requireCronAuth, async (_req, res) => {
    if (!flag("DIRECTORY_SYNC")) {
      return res.json({ ok: true, skipped: true, reason: "disabled" });
    }
    try {
      await connect();
      const summary = await directorySync();
      if (summary.skipped) {
        return res.json({ ok: true, skipped: true, reason: summary.skip_reason ?? "disabled", summary });
      }
      return res.json({ ok: true, skipped: false, summary });
    } catch (error) {
      logger.error({
        msg: "sales_intelligence.cron.directory_sync.failed",
        errorName: error instanceof Error ? error.name : "Error",
      });
      return res.status(500).json({ ok: false, error: "Directory sync failed" });
    }
  });

  router.all(CSI_CRON_PATHS.attachmentRefresh, requireCronAuth, async (_req, res) => {
    if (!flag("ATTACHMENT_REFRESH")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try {
      await connect();
      return res.json({ ok: true, ...(await (deps.runAttachmentRefresh ?? runAttachmentRefreshOnce)()) });
    } catch { return res.status(500).json({ ok: false, error: "Attachment refresh failed" }); }
  });
  router.all(CSI_CRON_PATHS.nudgeRepair, requireCronAuth, async (_req, res) => {
    if (!flag("ENABLED") || !flag("NUDGE_ENABLED")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try { await connect(); return res.json({ ok: true, summary: await (deps.drainNudgeRepair ?? drainNudgeRepairJobs)() }); }
    catch { return res.status(500).json({ ok: false, error: "Nudge repair failed" }); }
  });

  router.all(CSI_CRON_PATHS.retention, requireCronAuth, async (_req, res) => {
    try {
      await connect();
      const summary = await (deps.runRetention ?? runRetentionOnce)();
      if (summary.skipped && summary.skip_reason === "disabled") {
        return res.json({ ok: true, skipped: true, reason: "disabled", summary });
      }
      return res.json({ ok: true, skipped: summary.skipped, summary });
    } catch {
      return res.status(500).json({ ok: false, error: "Retention failed" });
    }
  });

  return router;
}

export function requireCronAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    res.status(500).json({ ok: false, error: "CRON_SECRET is not set" });
    return;
  }
  const authorization = req.get("authorization")?.trim();
  const provided = authorization?.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : req.get("x-cron-secret")?.trim();
  const left = Buffer.from(provided ?? "");
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  next();
}

export default createSalesIntelligenceCronRouter();
