import mongoose from "mongoose";
import { Router } from "express";
import { connectMongo } from "../db";
import { retireClosedDayEvents } from "../services/dailyOperations/eventRetirement";
import { requireCronAuth } from "./sales-intelligence-cron.routes";

/** Validated retirement of closed-day Daily Operations Events, every ten minutes (docs/knowledge/validated-retirement.md). */
const router = Router();
router.all("/api/cron/daily-operations-event-retirement", requireCronAuth, async (_req, res, next) => {
  try {
    await connectMongo();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Daily Operations event retirement database unavailable");
    res.status(200).json(await retireClosedDayEvents(db));
  } catch (error) {
    next(error);
  }
});
export default router;
