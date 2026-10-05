import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import { csiFlag } from "../config/domain/salesIntelligence";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { readOwnerCoverage } from "../services/salesIntelligence/ownerCoverage";
import { commandCsiSettings, readCsiSettings } from "../services/salesIntelligence/settings";
import { csiSettingsCommandSchema } from "../validation/v1/salesIntelligence";
import { CsiError, requireCsiOwner, assertCurrentScope } from "../services/salesIntelligence/auth";
import { csiIdSchema } from "../validation/v1/salesIntelligence";
import { previewNudge, sendNudge } from "../services/salesIntelligence/nudges/commands";
import { listNudges, nudgeHistoryQuerySchema } from "../services/salesIntelligence/nudges/reads";
import { csiNudgeCommandSchema } from "../validation/v1/salesIntelligence";
import { streamCsiInvalidations } from "../services/salesIntelligence/live";
import { commandNumberLead, listAllNumbers, readNumberDetail, searchLeadsForLink } from "../services/numberActivity/allNumbers";
import { commandAccountAgent, readAccounts, suggestAccountMatches } from "../services/salesIntelligence/repIdentity/accounts";
import {
  accountAgentCommandSchema,
  accountsQuerySchema,
  accountsSuggestSchema,
  allNumbersQuerySchema,
  leadSearchQuerySchema,
  numberDetailQuerySchema,
  numberLeadCommandSchema,
} from "../validation/v1/allNumbers";

/**
 * Owner routes of All Numbers and Accounts (`all-numbers/CONTRACT.md` §4), plus the retained
 * coverage, settings, live stream and Accounts messages (`/nudges*`).
 *
 * Mounted in `v1.routes.ts` after `requireApiSecret` and after the CSI
 * boundary router (flag + reader + scope). Every handler re-checks the flag
 * and the signed Owner identity, so the router is safe if mounted alone. A
 * signed rep, the Admin role or a scoped key gets 403 `OWNER_REQUIRED` on
 * every route: Numbers carry full customer numbers and no rep scope exists for
 * them. Reads never mutate; commands go through the idempotent command ledger
 * (an `Idempotency-Key` header is the ledger key; without one the All Numbers and Accounts
 * commands derive it from the target revision and the body, and `/nudges` requires it). `/settings` carries only the retained policy
 * (staffed clock, capabilities, Call activity retention). The old backfill
 * activation (`POST /backfill`) is retired with the media/AI/Outreach pipeline
 * it fed and is not registered.
 */
export const CSI_ADMIN_PREFIX = "/api/v1/admin/sales-intelligence";

export type SalesIntelligenceAdminRouteDeps = {
  connect?: typeof connectMongo;
  flag?: typeof csiFlag;
  owner?: typeof requireCsiOwner;
  coverage?: typeof readOwnerCoverage;
  settings?: typeof readCsiSettings;
  updateSettings?: typeof commandCsiSettings;
  nudgePreview?: typeof previewNudge;
  nudgeSend?: typeof sendNudge;
  nudges?: typeof listNudges;
  live?: typeof streamCsiInvalidations;
  // All Numbers + Accounts (all-numbers CONTRACT §4).
  allNumbers?: typeof listAllNumbers;
  numberDetail?: typeof readNumberDetail;
  numberLead?: typeof commandNumberLead;
  leadSearch?: typeof searchLeadsForLink;
  accounts?: typeof readAccounts;
  accountAgent?: typeof commandAccountAgent;
  suggestAccounts?: typeof suggestAccountMatches;
};

const STATUS_BY_CODE: Partial<Record<CsiError["code"], number>> = {
  FEATURE_DISABLED: 404,
  OWNER_REQUIRED: 403,
  UNSUPPORTED_SCOPE: 403,
  INVALID_INPUT: 400,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  ILLEGAL_TRANSITION: 409,
  IDENTITY_BLOCKED: 409,
  NUDGE_NOT_ACTIONABLE: 409,
  NUDGE_CONFIGURATION_UNAVAILABLE: 409,
  NUDGE_DESTINATION_EVIDENCE_INCOMPLETE: 409,
  NUDGE_DESTINATION_IS_CUSTOMER: 422,
  NUDGE_BODY_INVALID: 422,
  FORBIDDEN: 403,
  CURSOR_EXPIRED: 409,
};

export function createSalesIntelligenceAdminRouter(deps: SalesIntelligenceAdminRouteDeps = {}): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const flag = deps.flag ?? csiFlag;
  const owner = deps.owner ?? requireCsiOwner;

  const guard = (req: Request) => {
    if (!flag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
    const actor = owner(req);
    assertCurrentScope(req.query.scope, req.body?.scope);
    return actor;
  };
  const fail = (req: Request, res: Response, error: unknown) => {
    const requestId = req.header("x-vantage-admin-request-id") ?? req.header("x-request-id") ?? "unavailable";
    if (error instanceof ZodError) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "Invalid request", message: "Invalid request", request_id: requestId });
    }
    if (error instanceof CsiError) {
      const status = STATUS_BY_CODE[error.code] ?? 500;
      const message = error.code === "FEATURE_DISABLED" ? "Sales Intelligence is disabled"
        : error.code === "REVISION_CONFLICT" ? "This changed since it was loaded; reload and try again" : "Sales Intelligence request rejected";
      return res.status(status).json({
        ok: false,
        code: error.code,
        error: message,
        message,
        request_id: requestId,
        // Additive (V-AC S5): which parts were refused, when the service said so.
        ...(error.issues?.length ? { issues: error.issues } : {}),
      });
    }
    logger.error({
      msg: "sales_intelligence.admin.route_failed",
      path: req.path,
      errorName: error instanceof Error ? error.name : "Error",
    });
    return res.status(500).json({ ok: false, code: "INVALID_INPUT", error: "Sales Intelligence request failed", message: "Sales Intelligence request failed", request_id: requestId });
  };
  const notFound = (req: Request, res: Response, resource = "Number") =>
    res.status(404).json({
      ok: false,
      code: "INVALID_INPUT",
      error: `${resource} not found`,
      message: `${resource} not found`,
      request_id: req.header("x-vantage-admin-request-id") ?? req.header("x-request-id") ?? "unavailable",
    });

  router.get(`${CSI_ADMIN_PREFIX}/live`, async (req, res) => {
    try {
      guard(req);
      z.object({ scope: z.literal("production").optional() }).strict().parse(req.query);
      await connect();
      (deps.live ?? streamCsiInvalidations)(req, res);
    } catch (error) { if (!res.headersSent) fail(req, res, error); else res.end(); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/coverage`, async (req, res) => {
    try {
      guard(req);
      z.object({ scope: z.literal("production").optional() }).strict().parse(req.query);
      await connect();
      const coverage = await (deps.coverage ?? readOwnerCoverage)();
      return res.json({ ok: true, data: { as_of: new Date().toISOString(), coverage } });
    } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/settings`, async (req, res) => {
    try {
      guard(req);
      z.object({ scope: z.literal("production").optional() }).strict().parse(req.query);
      await connect();
      const data = await (deps.settings ?? readCsiSettings)();
      return res.json({ ok: true, as_of: new Date().toISOString(), data });
    } catch (error) { return fail(req, res, error); }
  });
  router.patch(`${CSI_ADMIN_PREFIX}/settings`, async (req, res) => {
    try {
      const actor = guard(req);
      const idempotency_key = req.header("idempotency-key")?.trim();
      if (!idempotency_key) throw new CsiError("INVALID_INPUT");
      const command = csiSettingsCommandSchema.parse(req.body);
      await connect();
      return res.json({ ok: true, data: await (deps.updateSettings ?? commandCsiSettings)({ actor, idempotency_key, command }) });
    } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/numbers`, async (req, res) => {
    try {
      guard(req);
      const query = allNumbersQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, ...(await (deps.allNumbers ?? listAllNumbers)(query)) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  // Registered before `/numbers/:id`, so the literal segment is never read as an id.
  router.get(`${CSI_ADMIN_PREFIX}/numbers/lead-search`, async (req, res) => {
    try {
      guard(req);
      const query = leadSearchQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, ...(await (deps.leadSearch ?? searchLeadsForLink)(query.q)) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${CSI_ADMIN_PREFIX}/numbers/:id`, async (req, res) => {
    try {
      guard(req);
      const id = csiIdSchema.parse(req.params.id);
      numberDetailQuerySchema.parse(req.query);
      await connect();
      const result = await (deps.numberDetail ?? readNumberDetail)(id);
      if (!result) return notFound(req, res);
      return res.json({ ok: true, ...result });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.post(`${CSI_ADMIN_PREFIX}/numbers/:id/lead`, async (req, res) => {
    try {
      const actor = guard(req);
      const id = csiIdSchema.parse(req.params.id);
      const body = numberLeadCommandSchema.parse(req.body);
      const idempotency_key = req.header("idempotency-key")?.trim() || undefined;
      await connect();
      const done = await (deps.numberLead ?? commandNumberLead)({ actor, number_id: id, body, idempotency_key });
      if (!done) return notFound(req, res);
      const result = await (deps.numberDetail ?? readNumberDetail)(id);
      if (!result) return notFound(req, res);
      return res.json({ ok: true, ...result });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${CSI_ADMIN_PREFIX}/accounts`, async (req, res) => {
    try {
      guard(req);
      accountsQuerySchema.parse(req.query);
      await connect();
      const data = await (deps.accounts ?? readAccounts)();
      return res.json({ ok: true, as_of: new Date().toISOString(), data });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.post(`${CSI_ADMIN_PREFIX}/accounts/suggest`, async (req, res) => {
    try {
      const actor = guard(req);
      accountsSuggestSchema.parse(req.body ?? {});
      const idempotency_key = req.header("idempotency-key")?.trim() || undefined;
      await connect();
      const data = await (deps.suggestAccounts ?? suggestAccountMatches)({ actor, idempotency_key });
      return res.json({ ok: true, as_of: new Date().toISOString(), data });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.post(`${CSI_ADMIN_PREFIX}/accounts/:extension_id/agent`, async (req, res) => {
    try {
      const actor = guard(req);
      const extensionId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).parse(req.params.extension_id);
      const body = accountAgentCommandSchema.parse(req.body);
      const idempotency_key = req.header("idempotency-key")?.trim() || undefined;
      await connect();
      const account = await (deps.accountAgent ?? commandAccountAgent)({ actor, extension_id: extensionId, body, idempotency_key });
      if (!account) return notFound(req, res, "Account");
      return res.json({ ok: true, as_of: new Date().toISOString(), data: { account } });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${CSI_ADMIN_PREFIX}/nudges`, async (req, res) => {
    try { guard(req); const query = nudgeHistoryQuerySchema.parse(req.query); await connect(); return res.json({ ok: true, ...(await (deps.nudges ?? listNudges)(query)) }); }
    catch (error) { return fail(req, res, error); }
  });
  for (const path of ["/nudges/preview", "/nudges"] as const) router.post(`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
    try {
      const actor = guard(req); if (!flag("NUDGE_ENABLED")) throw new CsiError("FEATURE_DISABLED");
      const body = csiNudgeCommandSchema.parse(req.body), idempotency_key = req.header("idempotency-key")?.trim();
      if (!idempotency_key || idempotency_key.length > 200) throw new CsiError("INVALID_INPUT");
      await connect(); const input = { actor, body, idempotency_key };
      if (path === "/nudges/preview") return res.json({ ok: true, ...(await (deps.nudgePreview ?? previewNudge)(input)) });
      const data = await (deps.nudgeSend ?? sendNudge)(input);
      return res.status(data.nudge.status === "pending" ? 202 : 200).json({ ok: true, data });
    } catch (error) { return fail(req, res, error); }
  });
  return router;
}
