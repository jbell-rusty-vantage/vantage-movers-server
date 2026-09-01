import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import { logger as rootLogger } from "../logger";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import {
  appendTariffAdjustmentRows,
  type AppendTariffAdjustmentRowsResult,
  type TariffAdjustmentRow,
} from "../services/tariff";
import {
  createTariffAdjustmentsSchema,
  formatTariffEffectiveDate,
  type CreateTariffAdjustmentsInput,
} from "../validation/v1/tariffAdjustments.validation";

export type TariffAdjustmentsRouteDeps = {
  appendRows?: (
    rows: TariffAdjustmentRow[],
  ) => Promise<AppendTariffAdjustmentRowsResult>;
  now?: () => Date;
};

export function createTariffAdjustmentsRouter(
  deps: TariffAdjustmentsRouteDeps = {},
): Router {
  const router = Router();
  const appendRows = deps.appendRows ?? appendTariffAdjustmentRows;
  const now = deps.now ?? (() => new Date());

  router.post("/api/v1/tariff-adjustments", async (req, res) => {
    const auth = getVantageAuth(req);
    try {
      const parsed = createTariffAdjustmentsSchema.parse(req.body);
      const rows = toServiceRows(parsed, now());
      const result = await appendRows(rows);
      rootLogger.info({
        msg: "tariff_adjustment.append.succeeded",
        actor_kind: auth?.kind,
        actor_role: auth?.kind === "user" ? auth.role : undefined,
        actor_email: auth?.kind === "user" ? auth.email : undefined,
        appended: result.appended,
        tab_name: result.tabName,
      });
      return res.status(200).json({
        ok: true,
        data: {
          appended: result.appended,
          tab_name: result.tabName,
          updated_range: result.updatedRange,
          rows: result.rows,
        },
      });
    } catch (error) {
      rootLogger.warn({
        msg: "tariff_adjustment.append.failed",
        actor_kind: auth?.kind,
        actor_role: auth?.kind === "user" ? auth.role : undefined,
        actor_email: auth?.kind === "user" ? auth.email : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      return sendError(res, error);
    }
  });

  return router;
}

function toServiceRows(
  parsed: CreateTariffAdjustmentsInput,
  stampedAt: Date,
): TariffAdjustmentRow[] {
  const effectiveDate =
    parsed.rows[0]?.effective_date ?? formatTariffEffectiveDate(stampedAt);
  return parsed.rows.map((row) => ({
    effectiveDate: row.effective_date ?? effectiveDate,
    pickupZone: row.pickup_zone,
    deliveryZone: row.delivery_zone,
    service: row.service,
    rule: row.rule,
    newRule: row.new_rule,
    carrier: row.carrier,
  }));
}

function getVantageAuth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}

function sendError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request payload",
      issues: error.issues,
    });
  }
  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Internal error",
  });
}
