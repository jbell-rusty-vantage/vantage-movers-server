import mongoose from "mongoose";
import { Router } from "express";
import { connectMongo } from "../db";
import { runFutureRetention } from "../services/granotHistory/futureRetention";
import { archiveDueScheduledRuns } from "../services/granotHistory/scheduledRunArchive";
import { requireCronAuth } from "./sales-intelligence-cron.routes";
const router = Router();
router.all(
  "/api/cron/granot-storage-retention",
  requireCronAuth,
  async (_req, res, next) => {
    try {
      await connectMongo();
      const db = mongoose.connection.db;
      if (!db) throw new Error("Granot retention database unavailable");
      const [receipts, runs] = await Promise.allSettled([runFutureRetention(db), archiveDueScheduledRuns(db)]);
      if (receipts.status === "rejected") throw receipts.reason;
      if (runs.status === "rejected") throw runs.reason;
      res.status(runs.value.failures ? 503 : 200).json({ ...receipts.value, scheduled_runs: runs.value });
    } catch (e) {
      next(e);
    }
  },
);
export default router;
