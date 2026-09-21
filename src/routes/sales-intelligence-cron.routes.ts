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
import { runOutreachEnsureOnce, drainOutreachEnsureJobs, runAttentionPublishOnce } from "../services/salesIntelligence/outreach/worker";
import { drainRecordingDiscoveryJobs } from "../services/salesIntelligence/conversations/discover";
import { drainRepIdentityReevaluationJobs } from "../services/salesIntelligence/repIdentity/worker";
import { drainNudgeRepairJobs } from "../services/salesIntelligence/nudges/repair";
import { drainMediaFetchJobs } from "../services/salesIntelligence/conversations/media";
import { drainTranscriptionJobs } from "../services/salesIntelligence/conversations/transcribe";
import { drainIntelligenceJobs } from "../services/salesIntelligence/analysis/worker";
import { drainIntelligenceApplications } from "../services/salesIntelligence/analysis/apply";
import { drainRebuildJobs, type RebuildDrainSummary, type RebuildWorkerDeps } from "../services/numberActivity/rebuild";
import { runCallLogReconcileOnce } from "../services/numberActivity/reconcileCallLog";
import { runBackfillStepOnce } from "../services/salesIntelligence/backfill/step";
import { drainBackfillActivationJobs } from "../services/salesIntelligence/backfill/worker";
import { runRetentionOnce } from "../services/salesIntelligence/retention";
import { csiBackfillDays } from "../config/domain/salesIntelligence";
import {
  runReceiptWatermarkRecovery,
  type RecoverySummary,
} from "../services/numberActivity/webhookRecovery";

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
 * master Owner read switch `SALES_INTELLIGENCE_ENABLED`.
 */
export type SalesIntelligenceCronRouteDeps = {
  connect?: typeof connectMongo;
  flag?: typeof csiFlag;
  runCallLogReconcile?: typeof runCallLogReconcileOnce;
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
  runMediaFetch?: typeof drainMediaFetchJobs;
  runTranscription?: typeof drainTranscriptionJobs;
  drainRecordingDiscovery?: typeof drainRecordingDiscoveryJobs;
  runOutreachEnsure?: typeof runOutreachEnsureOnce;
  drainOutreachEnsure?: typeof drainOutreachEnsureJobs;
  runAttentionPublish?: typeof runAttentionPublishOnce;
  runBackfillStep?: typeof runBackfillStepOnce;
  drainBackfillActivation?: typeof drainBackfillActivationJobs;
  runRetention?: typeof runRetentionOnce;
  drainRepIdentity?: typeof drainRepIdentityReevaluationJobs;
  drainNudgeRepair?: typeof drainNudgeRepairJobs;
  runIntelligence?: typeof drainIntelligenceJobs;
  runApplication?: typeof drainIntelligenceApplications;
};

export const CSI_CRON_PATHS = {
  extract: "/api/cron/sales-intelligence-extract",
  apply: "/api/cron/sales-intelligence-apply",
  nudgeRepair: "/api/cron/sales-intelligence-nudge-repair",
  backfillStep: "/api/cron/sales-intelligence-backfill-step",
  retention: "/api/cron/sales-intelligence-retention",
  callLogReconcile: "/api/cron/sales-intelligence-call-log-reconcile",
  jobRecovery: "/api/cron/sales-intelligence-job-recovery",
  directorySync: "/api/cron/sales-intelligence-directory-sync",
  mediaFetch: "/api/cron/sales-intelligence-media-fetch",
  transcribe: "/api/cron/sales-intelligence-transcribe",
  attachmentRefresh: "/api/cron/sales-intelligence-attachment-refresh",
  outreachEnsure: "/api/cron/sales-intelligence-outreach-ensure",
  attentionPublish: "/api/cron/sales-intelligence-attention-publish",
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
  const mediaFetch = deps.runMediaFetch ?? drainMediaFetchJobs;
  const transcribe = deps.runTranscription ?? drainTranscriptionJobs;
  const extraRecovery = deps.extraRecovery ?? [
    { name: "intelligence", flag: "EXTRACTION_ENABLED" as const, run: () => (deps.runIntelligence ?? drainIntelligenceJobs)() },
    { name: "application", flag: "EXTRACTION_ENABLED" as const, run: () => (deps.runApplication ?? drainIntelligenceApplications)() },
    { name: "nudge_repair", flag: "NUDGE_ENABLED" as const, run: () => (deps.drainNudgeRepair ?? drainNudgeRepairJobs)() },
    { name: "rep_identity_reevaluate", flag: "ENABLED" as const, run: () => (deps.drainRepIdentity ?? drainRepIdentityReevaluationJobs)() },
    { name: "outreach_ensure", flag: "OUTREACH_ENSURE" as const, run: () => (deps.drainOutreachEnsure ?? drainOutreachEnsureJobs)() },
    { name: "attachment_refresh", flag: "ATTACHMENT_REFRESH" as const, run: () => (deps.drainAttachmentRefresh ?? drainAttachmentRefreshJobs)() },
    { name: "recording_discovery", flag: "MEDIA_ENABLED" as const, run: () => (deps.drainRecordingDiscovery ?? drainRecordingDiscoveryJobs)() },
    { name: "media_fetch", flag: "MEDIA_ENABLED" as const, run: mediaFetch },
    { name: "transcription", flag: "STT_ENABLED" as const, run: transcribe },
    {
      name: "backfill_activation",
      flag: "ENABLED" as const,
      run: async () => {
        if (csiBackfillDays() <= 0) return { skipped: true, reason: "backfill_disabled" };
        return (deps.drainBackfillActivation ?? drainBackfillActivationJobs)();
      },
    },
  ];

  for (const [path, work] of [
    [CSI_CRON_PATHS.extract, () => (deps.runIntelligence ?? drainIntelligenceJobs)()],
    [CSI_CRON_PATHS.apply, () => (deps.runApplication ?? drainIntelligenceApplications)()],
  ] as const) router.all(path, requireCronAuth, async (_req, res) => {
    if (!flag("ENABLED") || !flag("EXTRACTION_ENABLED")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try { await connect(); return res.json({ ok: true, summary: await work() }); }
    catch { return res.status(500).json({ ok: false, error: "Intelligence processing failed" }); }
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

  router.all(CSI_CRON_PATHS.jobRecovery, requireCronAuth, async (_req, res) => {
    const captureOn = flag("CAPTURE_WEBHOOK");
    const rebuildOn = flag("ENABLED");
    const extras = extraRecovery.filter((step) => flag(step.flag));
    if (!captureOn && !rebuildOn && extras.length === 0) {
      return res.json({ ok: true, skipped: true, reason: "disabled" });
    }
    try {
      await connect();
      let receiptRecovery: RecoverySummary | null = null;
      let capture: DrainSummary | null = null;
      let rebuild: RebuildDrainSummary | null = null;
      if (captureOn) {
        receiptRecovery = await recovery();
        capture = await drainCapture(drainMax, drainDeadlineMs);
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

  router.all(CSI_CRON_PATHS.mediaFetch, requireCronAuth, async (_req, res) => {
    if (!flag("MEDIA_ENABLED")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try {
      await connect();
      const summary = await mediaFetch();
      if (summary.status === "not_claimable" || summary.status === "lease_lost") return res.json({ ok: true, skipped: true, reason: "lease_held", summary });
      if (summary.status === "disabled") return res.json({ ok: true, skipped: true, reason: "disabled", summary });
      return res.json({ ok: true, skipped: false, summary });
    } catch {
      return res.status(500).json({ ok: false, error: "Media fetch failed" });
    }
  });
  router.all(CSI_CRON_PATHS.transcribe, requireCronAuth, async (_req, res) => {
    if (!flag("STT_ENABLED")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try {
      await connect();
      const summary = await transcribe();
      return res.json({ ok: true, skipped: ["disabled", "not_claimable", "lease_lost"].includes(summary.status), summary });
    } catch {
      return res.status(500).json({ ok: false, error: "Transcription failed" });
    }
  });
  router.all(CSI_CRON_PATHS.attachmentRefresh, requireCronAuth, async (_req, res) => {
    if (!flag("ATTACHMENT_REFRESH")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try {
      await connect();
      return res.json({ ok: true, ...(await (deps.runAttachmentRefresh ?? runAttachmentRefreshOnce)()) });
    } catch { return res.status(500).json({ ok: false, error: "Attachment refresh failed" }); }
  });
  router.all(CSI_CRON_PATHS.outreachEnsure, requireCronAuth, async (_req, res) => {
    if (!flag("OUTREACH_ENSURE")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try { await connect(); return res.json({ ok: true, ...(await (deps.runOutreachEnsure ?? runOutreachEnsureOnce)()) }); }
    catch { return res.status(500).json({ ok: false, error: "Outreach ensure failed" }); }
  });
  // Publish owns its lease and its invocation so an ensure drain backlog can
  // never starve the Needs Attention desk (14 §5).
  router.all(CSI_CRON_PATHS.attentionPublish, requireCronAuth, async (_req, res) => {
    if (!flag("OUTREACH_ENSURE")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try { await connect(); return res.json({ ok: true, ...(await (deps.runAttentionPublish ?? runAttentionPublishOnce)()) }); }
    catch { return res.status(500).json({ ok: false, error: "Attention publish failed" }); }
  });
  router.all(CSI_CRON_PATHS.nudgeRepair, requireCronAuth, async (_req, res) => {
    if (!flag("ENABLED") || !flag("NUDGE_ENABLED")) return res.json({ ok: true, skipped: true, reason: "disabled" });
    try { await connect(); return res.json({ ok: true, summary: await (deps.drainNudgeRepair ?? drainNudgeRepairJobs)() }); }
    catch { return res.status(500).json({ ok: false, error: "Nudge repair failed" }); }
  });

  router.all(CSI_CRON_PATHS.backfillStep, requireCronAuth, async (_req, res) => {
    if (!flag("ENABLED") || csiBackfillDays() <= 0) {
      return res.json({ ok: true, skipped: true, reason: "disabled" });
    }
    try {
      await connect();
      const step = deps.runBackfillStep ?? runBackfillStepOnce;
      const summary = await step();
      await (deps.drainBackfillActivation ?? drainBackfillActivationJobs)();
      return res.json({ ok: true, skipped: summary.skipped, summary });
    } catch {
      return res.status(500).json({ ok: false, error: "Backfill step failed" });
    }
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
