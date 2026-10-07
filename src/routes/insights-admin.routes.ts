/**
 * Insights reads (doc 09) and the live lead-cost reads built on them. Mounted behind `requireApiSecret` in
 * `v1.routes.ts`. Analytics and Reviews follow the existing analytics access (Owner and Admin); money per rep, the
 * live daily spend and the Money tab are Owner-only (signed Owner actor, like the Operations Registry).
 */
import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import { connectMongo } from "../db";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import { logger } from "../logger";
import {
  getDailyLeadSpend,
  getInsightsAllocation,
  getInsightsAnalytics,
  getInsightsReviews,
  getMoneySpend,
  insightsQuerySchema,
  InsightsPeriodError,
  moneySpendQuerySchema,
} from "../services/insights";
import { isRegistryError, requireRegistryOwnerActor } from "../services/operationsRegistry";

export type InsightsAdminRouteDeps = {
  connect?: typeof connectMongo;
  analytics?: typeof getInsightsAnalytics;
  reviews?: typeof getInsightsReviews;
  allocation?: typeof getInsightsAllocation;
  dailyLeadSpend?: typeof getDailyLeadSpend;
  moneySpend?: typeof getMoneySpend;
  requireOwner?: (req: Request) => void;
};

function auth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}

function sendError(req: Request, res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({ ok: false, error: "Invalid request query", issues: error.issues });
  }
  if (error instanceof InsightsPeriodError) {
    return res.status(400).json({ ok: false, error: error.message });
  }
  if (isRegistryError(error)) {
    return res.status(403).json({ ok: false, error: "This read is for the Owner only." });
  }
  ((req as Request & { log?: typeof logger }).log ?? logger).error({ msg: "insights.read_failed", err: error });
  return res.status(500).json({ ok: false, error: "Insights could not be read. Try again in a minute." });
}

export function createInsightsAdminRouter(deps: InsightsAdminRouteDeps = {}): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const requireOwner = deps.requireOwner ?? ((req: Request) => void requireRegistryOwnerActor(req, auth(req)));

  const read = (handler: (req: Request) => Promise<unknown>, ownerOnly: boolean) => async (req: Request, res: Response) => {
    try {
      if (ownerOnly) requireOwner(req);
      await connect();
      const data = await handler(req);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };

  router.get(
    "/api/v1/admin/insights/analytics",
    read((req) => (deps.analytics ?? getInsightsAnalytics)(insightsQuerySchema.parse(req.query)), false),
  );
  router.get(
    "/api/v1/admin/insights/reviews",
    read((req) => (deps.reviews ?? getInsightsReviews)(insightsQuerySchema.parse(req.query)), false),
  );
  router.get(
    "/api/v1/admin/insights/allocation-cost",
    read((req) => (deps.allocation ?? getInsightsAllocation)(insightsQuerySchema.parse(req.query)), true),
  );
  router.get(
    "/api/v1/admin/daily-operations/lead-spend",
    read(() => (deps.dailyLeadSpend ?? getDailyLeadSpend)(), true),
  );
  router.get(
    "/api/v1/admin/money/spend",
    read((req) => (deps.moneySpend ?? getMoneySpend)(moneySpendQuerySchema.parse(req.query).range), true),
  );
  return router;
}

export default createInsightsAdminRouter();
