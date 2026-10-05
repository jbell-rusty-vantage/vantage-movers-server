import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { csiFlag } from "../config/domain/salesIntelligence";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import { CsiError } from "../services/salesIntelligence/auth";
import { findLeadCandidates, resolveHistorySubject } from "../services/salesIntelligence/history/candidates";
import { readContactNumberHistory, readLeadHistory } from "../services/salesIntelligence/history/reads";
import { csiIdSchema } from "../validation/v1/salesIntelligence";

/**
 * Canonical history routes for the MCP general endpoint (`find_contact_number`,
 * `find_lead_candidates`, `get_lead_history`).
 *
 * Mounted in `v1.routes.ts` after `requireApiSecret`: these routes are read by the broad
 * `x-api-secret` or a signed-in user, never by the Sales Intelligence scoped key. Each handler
 * re-checks the flag and the verified credential so the router is safe if mounted alone.
 * Responses carry canonical records and provider metadata only (names, E.164, job numbers,
 * lead links, entity changes); never a transcript, an analysis, a Lead Message body or an email.
 */
export const CSI_HISTORY_PREFIX = "/api/v1/internal/sales-intelligence/history";

export type SalesIntelligenceHistoryRouteDeps = {
  connect?: typeof connectMongo;
  flag?: typeof csiFlag;
  resolveSubject?: typeof resolveHistorySubject;
  candidates?: typeof findLeadCandidates;
  contactNumber?: typeof readContactNumberHistory;
  readLeadHistory?: typeof readLeadHistory;
};

const leadModel = z.enum(["FormLead", "CallLead"]);
const phone = z.string().trim().min(3).max(32);
const one = <T extends Record<string, unknown>>(keys: (keyof T)[]) => (value: T) => keys.filter((key) => value[key] !== undefined).length === 1;
export const historyQuerySchemas = {
  contactNumber: z.object({ phone: phone.optional(), id: csiIdSchema.optional() }).strict()
    .refine(one(["phone", "id"]), "Provide exactly one of phone or id"),
  candidates: z.object({ phone: phone.optional(), contact_number_id: csiIdSchema.optional(), stated_name: z.string().trim().min(1).max(200).optional(),
    reference: z.union([z.string().trim().min(1).max(200), z.array(z.string().trim().min(1).max(200)).max(10)]).optional() }).strict()
    .refine(one(["phone", "contact_number_id"]), "Provide exactly one of phone or contact_number_id"),
  empty: z.object({}).strict(),
  lead: z.object({ model: leadModel, id: csiIdSchema }).strict(),
};

const ISSUE_PATH = /^[A-Za-z0-9_.:[\]]{1,160}$/;
/** Paths and Zod codes only. Never echo submitted values. */
function sanitizedIssues(issues: ReadonlyArray<{ path: string; code: string }>) {
  return issues.slice(0, 16).flatMap((issue) => {
    const path = issue.path.slice(0, 160), code = String(issue.code).slice(0, 48);
    return path && ISSUE_PATH.test(path) && code ? [{ path, code }] : [];
  });
}
export function historyRouteFailure(error: unknown, requestId: string) {
  const code = error instanceof ZodError ? "INVALID_INPUT" : error instanceof CsiError ? error.code : "INTERNAL_ERROR";
  const status = code === "FEATURE_DISABLED" ? 404 : code === "INVALID_INPUT" ? 400 : code === "INTERNAL_ERROR" ? 500 : 403;
  const issues = error instanceof ZodError
    ? sanitizedIssues(error.issues.map((issue) => ({ path: issue.path.map(String).join("."), code: String(issue.code) })))
    : error instanceof CsiError && error.issues?.length ? sanitizedIssues(error.issues) : [];
  return {
    status,
    body: {
      ok: false as const,
      code,
      error: "History request could not be completed",
      request_id: requestId,
      ...(issues.length ? { issues } : {}),
    },
  };
}

export function createSalesIntelligenceHistoryRouter(deps: SalesIntelligenceHistoryRouteDeps = {}) {
  const router = Router();
  const enabled = deps.flag ?? csiFlag;
  function gate(req: Request) {
    if (!enabled("ENABLED")) throw new CsiError("FEATURE_DISABLED");
    const auth = (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
    // The broad secret (MCP) or a signed-in user; the scoped key and unauthenticated calls never reach history.
    if (!auth || (auth.kind !== "secret" && auth.kind !== "user")) throw new CsiError("RUN_SCOPE_DENIED");
    // History is the MCP's (broad secret), never a rep's; a request signed as a rep is refused here too (the admin proxy already denies it).
    if (req.header("x-vantage-admin-role")?.trim().toLowerCase() === "rep") throw new CsiError("RUN_SCOPE_DENIED");
    historyQuerySchemas.empty.parse(req.body ?? {});
  }
  function fail(res: Response, error: unknown) {
    const failure = historyRouteFailure(error, res.locals.request_id ?? "unavailable");
    if (failure.status === 500) logger.error({ msg: "csi.history.failed", request_id: failure.body.request_id, error: error instanceof Error ? error.message : String(error) });
    else if (failure.body.issues?.length) logger.warn({ msg: "csi.history.invalid_input", request_id: failure.body.request_id, issue_paths: failure.body.issues.map((issue) => issue.path) });
    res.status(failure.status).json(failure.body);
  }
  const notFound = (res: Response) => res.status(404).json({ ok: false as const, code: "NOT_FOUND", error: "History record not found", request_id: res.locals.request_id ?? "unavailable" });
  /** Flag and credential, then query validation, then one connection, then the read; `null` is 404. */
  const handle = <Q>(parse: (req: Request) => Q, read: (q: Q) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      gate(req);
      const q = parse(req);
      await (deps.connect ?? connectMongo)();
      const data = await read(q);
      if (data === null) notFound(res); else res.json({ ok: true as const, data });
    } catch (error) { fail(res, error); }
  };
  const resolve = deps.resolveSubject ?? resolveHistorySubject;

  router.get(`${CSI_HISTORY_PREFIX}/contact-number`, handle((req) => historyQuerySchemas.contactNumber.parse(req.query), async (q) => {
    const id = q.id ?? (await resolve({ phone: q.phone }))?.contact_number_id ?? null;
    return id ? (deps.contactNumber ?? readContactNumberHistory)(id) : null;
  }));
  router.get(`${CSI_HISTORY_PREFIX}/lead-candidates`, handle((req) => historyQuerySchemas.candidates.parse(req.query), async (q) => {
    const subject = await resolve({ phone: q.phone, contact_number_id: q.contact_number_id });
    if (!subject) return null;
    const mentions = q.reference === undefined ? [] : Array.isArray(q.reference) ? q.reference : [q.reference];
    return { subject, candidates: await (deps.candidates ?? findLeadCandidates)(subject, { stated_name: q.stated_name ?? null, reference_mentions: mentions }) };
  }));
  router.get(`${CSI_HISTORY_PREFIX}/lead`, handle((req) => historyQuerySchemas.lead.parse(req.query), (q) =>
    (deps.readLeadHistory ?? readLeadHistory)({ model: q.model, id: q.id })));
  return router;
}
