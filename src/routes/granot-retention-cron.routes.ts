import mongoose from "mongoose";
import { Router } from "express";
import { connectMongo } from "../db";
import { runFutureRetention } from "../services/granotHistory/futureRetention";
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
      res.json(await runFutureRetention(db));
    } catch (e) {
      next(e);
    }
  },
);
export default router;
