import { timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { connectMongo } from "../db";
import { ReportingRun } from "../models/ReportingRun";
import { publishReportingWakeup } from "../services/reporting/queue";
import { runReportingCleanupJanitor } from "../services/reporting/cleanup";
import { createReportingDriveAdapter } from "../services/reporting/google/reportingDriveAdapter";
import { createReportingSheetsAdapter } from "../services/reporting/google/reportingSheetsAdapter";
import { listCleanupPendingDeliveries } from "../services/reporting/reportingDeliveryRepository";
import {
  scanReportingOperationalHealth,
  type ReportingStuckRunCandidate,
} from "../services/reporting/reportingObservability";
import { runTestArtifactJanitor } from "../services/reporting/live/testArtifactJanitor";
import { operationalWorkbookRegistry } from "../services/operationalWorkbooks";
import { OperationalWorkbookConfigurationError } from "../services/operationalWorkbooks/registry";
import { isReportingGoogleDeliveryEnabled } from "../config/domain/reporting";

const router = Router();

router.all(
  "/api/cron/reporting-delivery-heartbeat",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    try {
      await connectMongo();
      const now = new Date();
      const stranded = await ReportingRun.collection.findOne(
        {
          ...(!isReportingGoogleDeliveryEnabled()
            ? { cancellation_requested_at: { $ne: null } }
            : {}),
          status: {
            $in: ["queued", "querying", "writing", "verifying", "promoting"],
          },
          $or: [{ leased_until: null }, { leased_until: { $lte: now } }],
        },
        { sort: { created_at: 1, _id: 1 } },
      );
      if (!stranded) {
        return res.json({ ok: true, woke: false });
      }
      const published = await publishReportingWakeup({
        reason: "cron",
        run_hint: String(stranded._id),
      });
      if (!published && process.env.VERCEL === "1") {
        return res.status(503).json({
          ok: false,
          error: "Reporting recovery wakeup could not be published.",
          run_id: String(stranded._id),
        });
      }
      return res.json({
        ok: true,
        woke: true,
        run_id: String(stranded._id),
        published,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: "Reporting heartbeat failed.",
      });
    }
  },
);

router.all(
  "/api/cron/reporting-health-scan",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    try {
      await connectMongo();
      const now = new Date();
      const activeRuns = await ReportingRun.collection
        .find(
          {
            status: {
              $in: ["queued", "querying", "writing", "verifying", "promoting"],
            },
          },
          {
            projection: {
              _id: 1,
              status: 1,
              updated_at: 1,
              lease_owner: 1,
            },
            limit: 100,
          },
        )
        .toArray();

      const stuckCandidates: ReportingStuckRunCandidate[] = activeRuns.map(
        (run) => ({
          runId: String(run._id),
          phase: String(run.status),
          updatedAtMs: new Date(run.updated_at ?? run._id.getTimestamp()).getTime(),
          leaseOwner: run.lease_owner ? String(run.lease_owner) : null,
        }),
      );

      const pendingCleanup = await listCleanupPendingDeliveries(100);
      let denylistIncomplete = false;
      let missingDenylistKeys: string[] = [];
      try {
        operationalWorkbookRegistry.assertConfigurationComplete();
      } catch (error) {
        if (error instanceof OperationalWorkbookConfigurationError) {
          denylistIncomplete = true;
          missingDenylistKeys = [...error.missing_registration_keys];
        } else {
          denylistIncomplete = true;
        }
      }

      await scanReportingOperationalHealth({
        stuckCandidates,
        cleanupPendingCount: pendingCleanup.length,
        oldestCleanupRunId:
          pendingCleanup[0]?.run_id != null
            ? String(pendingCleanup[0].run_id)
            : undefined,
        denylistIncomplete,
        missingDenylistKeys,
      });

      return res.json({
        ok: true,
        scanned_at: now.toISOString(),
        active_runs: activeRuns.length,
        cleanup_pending: pendingCleanup.length,
        denylist_incomplete: denylistIncomplete,
      });
    } catch {
      return res.status(500).json({ ok: false, error: "Reporting health scan failed." });
    }
  },
);

router.all(
  "/api/cron/reporting-test-artifact-janitor",
  requireCronAuth,
  async (req: Request, res: Response) => {
    try {
      const dryRun = req.query.dry_run === "true";
      const result = await runTestArtifactJanitor({ dryRun, limit: 50 });
      if (result.skipped) {
        return res.status(200).json({
          ok: true,
          skipped: true,
          reason: "REPORTING_LIVE_TEST_ENABLED is not true",
        });
      }
      return res.status(result.ok ? 200 : 503).json(result);
    } catch {
      return res.status(500).json({ ok: false, error: "Test artifact janitor failed." });
    }
  },
);

router.all(
  "/api/cron/reporting-cleanup-janitor",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    try {
      const drive = await createReportingDriveAdapter();
      const sheets = await createReportingSheetsAdapter();
      const result = await runReportingCleanupJanitor({ drive, sheets, limit: 25 });
      return res.json({ ok: true, ...result });
    } catch {
      return res.status(500).json({ ok: false, error: "Reporting cleanup janitor failed." });
    }
  },
);

function requireCronAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return res.status(503).json({ ok: false, error: "CRON_SECRET is not configured." });
  }
  const header = req.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  return next();
}

export default router;
