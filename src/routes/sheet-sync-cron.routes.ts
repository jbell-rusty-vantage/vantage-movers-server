import { Router, type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import { getSheetSyncMode } from "../config/domain";
import { logger as rootLogger } from "../logger";
import { runSheetSyncDrain } from "../services/sheetSync";

/**
 * Cron-triggered safety net for the sheet-sync outbox. Vercel Cron (see
 * `vercel.json`) invokes this on a fixed interval with
 * `Authorization: Bearer ${CRON_SECRET}`; the same secret may be supplied via
 * `x-cron-secret` for local testing.
 *
 * The queue consumer normally drains within seconds of a write, so this cron
 * exists only to recover jobs whose wake-up publish failed (or never fired in
 * legacy/local environments). It is a no-op unless `SHEET_SYNC_MODE=queued`.
 */
const router = Router();

type RequestWithLogger = Request & { log?: Logger };

router.all("/api/cron/sheet-sync-drain", requireCronAuth, async (req: Request, res: Response) => {
  const log = (req as RequestWithLogger).log ?? rootLogger;
  const mode = getSheetSyncMode();
  if (mode !== "queued") {
    return res.json({ ok: true, skipped: true, reason: `SHEET_SYNC_MODE is "${mode}"` });
  }

  try {
    const summary = await runSheetSyncDrain("cron");
    return res.json({ ok: true, skipped: false, summary });
  } catch (error) {
    log.error({ err: error, msg: "sheet_sync.cron.drain.failed" });
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Sheet sync drain failed",
    });
  }
});

function requireCronAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    res.status(500).json({ ok: false, error: "CRON_SECRET is not set" });
    return;
  }

  const authHeader = req.get("authorization")?.trim();
  const bearer = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : null;
  const headerSecret = req.get("x-cron-secret")?.trim();

  if (bearer === expected || headerSecret === expected) {
    next();
    return;
  }

  res.status(401).json({ ok: false, error: "Unauthorized" });
}

export default router;
