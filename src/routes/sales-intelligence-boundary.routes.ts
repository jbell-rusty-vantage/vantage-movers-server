import { Router, type Response } from "express";
import { csiFlag } from "../config/domain/salesIntelligence";
import {
  CsiError,
  requireCsiReader,
  assertCurrentScope,
} from "../services/salesIntelligence/auth";
/**
 * Sales Intelligence Owner boundary. Mount AFTER requireApiSecret and BEFORE the Owner endpoint
 * routers. No feature services run here. The scoped AI-run endpoints under
 * `/api/v1/internal/sales-intelligence/runs/:id/*` are retired: no router serves them.
 */
export function createSalesIntelligenceBoundaryRouter() {
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
  return router;
}
