import {
  timingSafeEqual,
} from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { connectMongo } from "../db";
import {
  claimDueBestRelocationConnection,
  createQueuedIngestionRun,
  ensureBestRelocationConnection,
  oldestRecoverableIngestionRun,
  publishIngestionWakeup,
} from "../services/ingestion";
import { createBestRelocationIngestionActor } from "../services/durableWork";
import { recordOperationalEvent } from "../services/observability";

const router = Router();

router.all(
  "/api/cron/best-relocation-ingest-heartbeat",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    const now = new Date();
    const actor = createBestRelocationIngestionActor(
      `heartbeat:${now.toISOString()}`,
    );
    try {
      await connectMongo();
      const connection = (await ensureBestRelocationConnection(actor)) as {
        application_enabled?: boolean;
        last_successful_run_at?: Date | null;
      };
      if (!envGateEnabled()) {
        return res.json({
          ok: true,
          skipped: true,
          reason: "environment_disabled",
        });
      }
      const strandedRunId = await oldestRecoverableIngestionRun(now);
      if (strandedRunId) {
        const recovered = await publishIngestionWakeup({
          reason: "recovery",
          run_hint: strandedRunId,
        });
        if (!recovered) {
          return res.status(503).json({
            ok: false,
            error: "Queued ingestion recovery could not publish a worker wakeup.",
            run_id: strandedRunId,
          });
        }
      }
      if (
        connection.application_enabled &&
        (!connection.last_successful_run_at ||
          now.getTime() -
            new Date(connection.last_successful_run_at).getTime() >
            30 * 60 * 60 * 1000)
      ) {
        await recordOperationalEvent({
          level: "error",
          eventKey: "best_relocation_ingestion.success_stale",
          category: "cron",
          workflow: "best_relocation_ingestion",
          summary:
            "Best Relocation ingestion has no successful run in the last 30 hours.",
          details: {
            last_successful_run_at:
              connection.last_successful_run_at?.toISOString() ?? null,
          },
          notificationCandidate: true,
        });
      }
      const claim = await claimDueBestRelocationConnection({
        now,
        actor,
      });
      if (!claim) {
        return res.json({
          ok: true,
          skipped: true,
          reason: "application_disabled_or_not_due",
        });
      }
      const queued = await createQueuedIngestionRun({
        connection_id: claim.connection_id,
        trigger: "schedule",
        actor,
        initiator: claim.initiator,
        now,
      });
      const published = await publishIngestionWakeup({
        reason: "schedule",
        run_hint: queued.run_id,
      });
      if (!published) {
        return res.status(503).json({
          ok: false,
          error: "Ingestion run was queued but its worker wakeup was not published.",
          run_id: queued.run_id,
        });
      }
      return res.status(202).json({
        ok: true,
        skipped: false,
        run_id: queued.run_id,
        next_due_at: claim.next_due_at,
        queue_published: published,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Ingestion heartbeat failed",
      });
    }
  },
);

export function envGateEnabled(
  value = process.env.BEST_RELOCATION_INGEST_ENABLED,
): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function ingestionHeartbeatSkipReason(input: {
  env_enabled: boolean;
  application_enabled: boolean;
  next_due_at: Date | null;
  now: Date;
}): "environment_disabled" | "application_disabled" | "not_due" | null {
  if (!input.env_enabled) return "environment_disabled";
  if (!input.application_enabled) return "application_disabled";
  if (
    input.next_due_at &&
    input.next_due_at.getTime() > input.now.getTime()
  ) {
    return "not_due";
  }
  return null;
}

function requireCronAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    res.status(500).json({ ok: false, error: "CRON_SECRET is not set" });
    return;
  }
  const authorization = req.get("authorization")?.trim();
  const provided =
    authorization?.toLowerCase().startsWith("bearer ")
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

export default router;
