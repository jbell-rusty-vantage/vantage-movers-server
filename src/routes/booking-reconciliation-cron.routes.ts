import { Router, type NextFunction, type Request, type Response } from "express";
import { getBookingReconciliationConfig } from "../config/domain";
import mongoose from "mongoose";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { runBookingJobNormalizationInvariant } from "../services/bookings/bookingJobNormalizationInvariant";
import { runDueBookingLeadRematches } from "../services/employeeBookings";

const router = Router();

router.all(
  "/api/cron/booking-reconciliation-rematch",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    // The Booking cron also carries the hourly Job Number normalization invariant (it runs every five
    // minutes whatever the rematch setting; the invariant throttles itself). A failure never blocks rematch.
    const job_number_invariant = await checkJobNumberInvariant();
    const config = getBookingReconciliationConfig();
    if (!config.autoRematchEnabled) {
      return res.json({ ok: true, skipped: true, reason: "auto rematch disabled", job_number_invariant });
    }
    const summary = await runDueBookingLeadRematches({ actor: "cron" });
    return res.json({ ok: true, skipped: false, summary, job_number_invariant });
  },
);

async function checkJobNumberInvariant() {
  try {
    await connectMongo();
    const db = mongoose.connection.db;
    if (!db) return { ok: false as const, error: "no database handle" };
    return { ok: true as const, ...(await runBookingJobNormalizationInvariant(db)) };
  } catch (error) {
    logger.error({ err: error, msg: "booking.job_number.normalization_invariant.failed" });
    return { ok: false as const, error: error instanceof Error ? error.message : "invariant failed" };
  }
}

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
