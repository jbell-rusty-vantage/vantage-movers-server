import { retireLeadEvidence } from "../services/granotHistory/retireLeadEvidence";
import { retireCompletedWebhooks } from "../services/granotHistory/completedWebhooks";
import mongoose from "mongoose";
import { Router } from "express";
import { connectMongo } from "../db";
import { retireUsedReceipts } from "../services/granotHistory/retireOnUse";
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
      const [receipts, runs, webhooks, evidence] = await Promise.allSettled([retireUsedReceipts(db), archiveDueScheduledRuns(db), retireCompletedWebhooks(db), retireLeadEvidence(db)]);
      if (receipts.status === "rejected") throw receipts.reason;
      if (runs.status === "rejected") throw runs.reason;
      if (webhooks.status === "rejected") throw webhooks.reason;
      if (evidence.status === "rejected") throw evidence.reason;
      res.status(runs.value.failures || webhooks.value.failures || ("failures" in receipts.value && receipts.value.failures) ? 503 : 200).json({ ...receipts.value, scheduled_runs: runs.value, completed_webhooks: webhooks.value, lead_evidence:evidence.value });
    } catch (e) {
      next(e);
    }
  },
);
export default router;
