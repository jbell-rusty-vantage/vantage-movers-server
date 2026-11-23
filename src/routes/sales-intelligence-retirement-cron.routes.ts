import mongoose from "mongoose";
import { Router } from "express";
import { connectMongo } from "../db";
import { retireCompletedJobs } from "../services/salesIntelligence/retirement/worker";
import { requireCronAuth } from "./sales-intelligence-cron.routes";

/** Validated retirement of completed Sales Intelligence jobs, every two minutes (docs/knowledge/validated-retirement.md). */
const router = Router();
router.all("/api/cron/sales-intelligence-job-retirement", requireCronAuth, async (_req, res, next) => {
  try {
    await connectMongo();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Sales Intelligence retirement database unavailable");
    res.status(200).json(await retireCompletedJobs(db));
  } catch (error) {
    next(error);
  }
});
export default router;
