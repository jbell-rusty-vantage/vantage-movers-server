import mongoose from "mongoose";
import { Router } from "express";
import { connectMongo } from "../db";
import { retireIncidentEntityChanges } from "../services/domainCommands/retirement/entityChanges";
import { requireCronAuth } from "./sales-intelligence-cron.routes";

/** Validated retirement of the Granot incident Entity Changes, every ten minutes (docs/knowledge/validated-retirement.md). */
const router = Router();
router.all("/api/cron/entity-change-retirement", requireCronAuth, async (_req, res, next) => {
  try {
    await connectMongo();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Entity change retirement database unavailable");
    res.status(200).json(await retireIncidentEntityChanges(db));
  } catch (error) {
    next(error);
  }
});
export default router;
