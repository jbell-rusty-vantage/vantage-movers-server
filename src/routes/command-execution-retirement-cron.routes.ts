import mongoose from "mongoose";
import { Router } from "express";
import { connectMongo } from "../db";
import { retireProvenCommandExecutions } from "../services/domainCommands/retirement/commandExecutions";
import { requireCronAuth } from "./sales-intelligence-cron.routes";

/** Validated retirement of Domain Command receipts (phases 1–2), every ten minutes (docs/knowledge/validated-retirement.md). */
const router = Router();
router.all("/api/cron/command-execution-retirement", requireCronAuth, async (_req, res, next) => {
  try {
    await connectMongo();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Command execution retirement database unavailable");
    res.status(200).json(await retireProvenCommandExecutions(db));
  } catch (error) {
    next(error);
  }
});
export default router;
