import { Router, type NextFunction, type Request, type Response } from "express";
import { getBookingReconciliationConfig } from "../config/domain";
import { runDueBookingLeadRematches } from "../services/employeeBookings";

const router = Router();

router.all(
  "/api/cron/booking-reconciliation-rematch",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    const config = getBookingReconciliationConfig();
    if (!config.autoRematchEnabled) {
      return res.json({ ok: true, skipped: true, reason: "auto rematch disabled" });
    }
    const summary = await runDueBookingLeadRematches({ actor: "cron" });
    return res.json({ ok: true, skipped: false, summary });
  },
);

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
  if (bearer === expected || req.get("x-cron-secret")?.trim() === expected) {
    next();
    return;
  }
  res.status(401).json({ ok: false, error: "Unauthorized" });
}

export default router;
