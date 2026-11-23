import mongoose from "mongoose";
import { Router } from "express";
import { connectMongo } from "../db";
import { retireProvenReceipts } from "../services/numberActivity/receiptRetirement";
import { requireCronAuth } from "./sales-intelligence-cron.routes";

/** Validated retirement of proven RingCentral webhook receipts, every ten minutes (docs/knowledge/validated-retirement.md). */
const router = Router();
router.all("/api/cron/ringcentral-receipt-retirement", requireCronAuth, async (_req, res, next) => {
  try {
    await connectMongo();
    const db = mongoose.connection.db;
    if (!db) throw new Error("RingCentral receipt retirement database unavailable");
    res.status(200).json(await retireProvenReceipts(db));
  } catch (error) {
    next(error);
  }
});
export default router;
