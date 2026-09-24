import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { connectMongo } from "../db";
import { csiFlag, CSI_TOOLS } from "../config/domain/salesIntelligence";
import {
  CsiError,
  requireCsiReader,
  requireCsiRun,
  assertCurrentScope,
} from "../services/salesIntelligence/auth";
/** Mount AFTER requireApiSecret and BEFORE Team B–D endpoint routers. No feature services run here. */
export function createSalesIntelligenceBoundaryRouter(
  deps: { connect?: typeof connectMongo; run?: typeof requireCsiRun } = {},
) {
  const router = Router();
  const fail = (res: Response, error: unknown) =>
    res
      .status(
        error instanceof CsiError && error.code === "FEATURE_DISABLED"
          ? 404
          : 403,
      )
      .json({
        ok: false,
        code: error instanceof CsiError ? error.code : "RUN_SCOPE_DENIED",
        error: "Sales Intelligence access denied",
        request_id: res.locals.request_id ?? "unavailable",
      });
  router.use("/api/v1/admin/sales-intelligence", (req, res, next) => {
    try {
      if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
      // S8-REP: the Owner, or a signed rep with REP_ACCESS on; each admin route then decides (Owner-only routes refuse a rep).
      requireCsiReader(req);
      assertCurrentScope(req.query.scope, req.body?.scope);
      next();
    } catch (e) {
      fail(res, e);
    }
  });
  router.use("/api/v1/internal/sales-intelligence", async (req, res, next) => {
    try {
      if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
      const match =
        /^\/runs\/([a-f\d]{24})\/(context|read|submit|submission)\/?$/i.exec(
          req.path,
        );
      if (!match) throw new CsiError("RUN_SCOPE_DENIED");
      const [, runId, action] = match;
      if (
        req.method !==
        (action === "read" || action === "submit" ? "POST" : "GET")
      )
        throw new CsiError("RUN_SCOPE_DENIED");
      const tool =
        action === "context"
          ? "get_intelligence_context"
          : action === "read"
            ? z.enum(CSI_TOOLS).parse(req.body?.tool)
            : "submit_intelligence_analysis";
      if (
        action === "read" &&
        ["submit_intelligence_analysis", "get_intelligence_context"].includes(
          tool,
        )
      )
        throw new CsiError("RUN_SCOPE_DENIED");
      await (deps.connect ?? connectMongo)();
      await (deps.run ?? requireCsiRun)(req, runId!, tool);
      next();
    } catch (e) {
      fail(res, e);
    }
  });
  return router;
}
