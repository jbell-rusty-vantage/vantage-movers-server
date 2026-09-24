import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { csiFlag } from "../config/domain/salesIntelligence";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import { CsiError } from "../services/salesIntelligence/auth";
import { assembleSubjectStory, resolveStorySubject } from "../services/salesIntelligence/story/assemble";
import { findLeadCandidates } from "../services/salesIntelligence/story/candidates";
import { selectPriorAnalyses } from "../services/salesIntelligence/analysis/prior";
import {
  listAnalysesForNumber, readAnalysis, readConversationHistory, readContactNumberHistory, readLeadHistory, readMoveAssessment,
} from "../services/salesIntelligence/analysis/history";
import { readCaptureCoverage } from "../services/numberActivity/coverage";
import { csiDateSchema, csiIdSchema } from "../validation/v1/salesIntelligence";
import { intelligenceRouteFailure } from "./sales-intelligence-internal.routes";

/**
 * History routes for the MCP general endpoint (context provenance specification §8.2).
 *
 * Mounted in `v1.routes.ts` after `requireApiSecret` and BEFORE the CSI boundary router, which
 * denies every other `/internal/sales-intelligence` path: these routes are read by the broad
 * `x-api-secret`, never by a run token or the CSI scoped key (`isCsiServiceRoute` excludes them).
 * Each handler re-checks the flag and the verified credential so the router is safe if mounted
 * alone. Responses carry names, E.164, job numbers, summaries, findings and prose; never a
 * transcript, a Lead Message body or an email (`history.ts` redacts every string).
 */
export const CSI_HISTORY_PREFIX = "/api/v1/internal/sales-intelligence/history";

export type SalesIntelligenceHistoryRouteDeps = {
  connect?: typeof connectMongo;
  flag?: typeof csiFlag;
  resolveSubject?: typeof resolveStorySubject;
  assembleStory?: typeof assembleSubjectStory;
  candidates?: typeof findLeadCandidates;
  contactNumber?: typeof readContactNumberHistory;
  listAnalyses?: typeof listAnalysesForNumber;
  readAnalysis?: typeof readAnalysis;
  readConversation?: typeof readConversationHistory;
  readMoveAssessment?: typeof readMoveAssessment;
  readLeadHistory?: typeof readLeadHistory;
  prior?: typeof selectPriorAnalyses;
  coverage?: typeof readCaptureCoverage;
};

const leadModel = z.enum(["FormLead", "CallLead"]);
const phone = z.string().trim().min(3).max(32);
const subjectKeySchema = z.string().regex(/^(lead:(FormLead|CallLead):[a-f\d]{24}|number:[a-f\d]{24})$/i);
const flag = z.enum(["true", "false"]).optional();
const one = <T extends Record<string, unknown>>(keys: (keyof T)[]) => (value: T) => keys.filter((key) => value[key] !== undefined).length === 1;
export const historyQuerySchemas = {
  contactNumber: z.object({ phone: phone.optional(), id: csiIdSchema.optional() }).strict()
    .refine(one(["phone", "id"]), "Provide exactly one of phone or id"),
  story: z.object({ phone: phone.optional(), contact_number_id: csiIdSchema.optional(), lead_model: leadModel.optional(), lead_id: csiIdSchema.optional(),
    as_of: csiDateSchema.optional(), limit_events: z.coerce.number().int().min(1).max(400).optional(), model_events: z.coerce.number().int().min(1).max(80).optional() }).strict()
    .refine((value) => (value.lead_model === undefined) === (value.lead_id === undefined), "lead_model and lead_id go together")
    .refine((value) => [value.phone, value.contact_number_id, value.lead_id].filter((v) => v !== undefined).length === 1, "Provide exactly one subject"),
  candidates: z.object({ phone: phone.optional(), contact_number_id: csiIdSchema.optional(), stated_name: z.string().trim().min(1).max(200).optional(),
    reference: z.union([z.string().trim().min(1).max(200), z.array(z.string().trim().min(1).max(200)).max(10)]).optional() }).strict()
    .refine(one(["phone", "contact_number_id"]), "Provide exactly one of phone or contact_number_id"),
  analyses: z.object({ contact_number_id: csiIdSchema, limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(200).optional() }).strict(),
  empty: z.object({}).strict(),
  moveAssessment: z.object({ outreach_record_id: csiIdSchema.optional(), subject_key: subjectKeySchema.optional(), include_model_output: flag }).strict()
    .refine(one(["outreach_record_id", "subject_key"]), "Provide exactly one of outreach_record_id or subject_key"),
  lead: z.object({ model: leadModel, id: csiIdSchema }).strict(),
  prior: z.object({ contact_number_id: csiIdSchema, subject_key: subjectKeySchema, outreach_record_id: csiIdSchema.optional(),
    exclude_conversation_id: csiIdSchema.optional(), as_of: csiDateSchema.optional() }).strict(),
};

export function createSalesIntelligenceHistoryRouter(deps: SalesIntelligenceHistoryRouteDeps = {}) {
  const router = Router();
  const enabled = deps.flag ?? csiFlag;
  function gate(req: Request) {
    if (!enabled("ENABLED")) throw new CsiError("FEATURE_DISABLED");
    const auth = (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
    // The broad secret (MCP) or a signed-in user; the CSI scoped key and unauthenticated calls never reach history.
    if (!auth || (auth.kind !== "secret" && auth.kind !== "user")) throw new CsiError("RUN_SCOPE_DENIED");
    // S8-REP: history is the MCP's (broad secret), never a rep's; a request signed as a rep is refused here too (the admin proxy already denies it).
    if (req.header("x-vantage-admin-role")?.trim().toLowerCase() === "rep") throw new CsiError("RUN_SCOPE_DENIED");
    historyQuerySchemas.empty.parse(req.body ?? {});
  }
  function fail(res: Response, error: unknown) {
    const failure = intelligenceRouteFailure(error, res.locals.request_id ?? "unavailable");
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
  const resolve = deps.resolveSubject ?? resolveStorySubject;
  const paramId = (req: Request) => { historyQuerySchemas.empty.parse(req.query); return csiIdSchema.parse(req.params.id); };

  router.get(`${CSI_HISTORY_PREFIX}/contact-number`, handle((req) => historyQuerySchemas.contactNumber.parse(req.query), async (q) => {
    const id = q.id ?? (await resolve({ phone: q.phone }))?.contact_number_id ?? null;
    return id ? (deps.contactNumber ?? readContactNumberHistory)(id) : null;
  }));
  router.get(`${CSI_HISTORY_PREFIX}/story`, handle((req) => historyQuerySchemas.story.parse(req.query), async (q) => {
    const as_of = q.as_of ? new Date(q.as_of) : undefined;
    const subject = await resolve({ phone: q.phone, contact_number_id: q.contact_number_id,
      lead: q.lead_model && q.lead_id ? { model: q.lead_model, id: q.lead_id } : undefined, as_of });
    if (!subject) return null;
    return (deps.assembleStory ?? assembleSubjectStory)(subject, { ...(q.limit_events ? { limit_events: q.limit_events } : {}), ...(q.model_events ? { model_events: q.model_events } : {}) });
  }));
  router.get(`${CSI_HISTORY_PREFIX}/lead-candidates`, handle((req) => historyQuerySchemas.candidates.parse(req.query), async (q) => {
    const subject = await resolve({ phone: q.phone, contact_number_id: q.contact_number_id });
    if (!subject) return null;
    const mentions = q.reference === undefined ? [] : Array.isArray(q.reference) ? q.reference : [q.reference];
    return { subject, candidates: await (deps.candidates ?? findLeadCandidates)(subject, { stated_name: q.stated_name ?? null, reference_mentions: mentions }) };
  }));
  router.get(`${CSI_HISTORY_PREFIX}/analyses`, handle((req) => historyQuerySchemas.analyses.parse(req.query), (q) =>
    (deps.listAnalyses ?? listAnalysesForNumber)(q.contact_number_id, { limit: q.limit, cursor: q.cursor ?? null })));
  router.get(`${CSI_HISTORY_PREFIX}/analyses/:id`, handle(paramId, (id) => (deps.readAnalysis ?? readAnalysis)(id)));
  router.get(`${CSI_HISTORY_PREFIX}/conversations/:id`, handle(paramId, (id) => (deps.readConversation ?? readConversationHistory)(id)));
  router.get(`${CSI_HISTORY_PREFIX}/move-assessment`, handle((req) => historyQuerySchemas.moveAssessment.parse(req.query), (q) =>
    (deps.readMoveAssessment ?? readMoveAssessment)({ outreach_record_id: q.outreach_record_id, subject_key: q.subject_key, include_model_output: q.include_model_output === "true" })));
  router.get(`${CSI_HISTORY_PREFIX}/lead`, handle((req) => historyQuerySchemas.lead.parse(req.query), (q) =>
    (deps.readLeadHistory ?? readLeadHistory)({ model: q.model, id: q.id })));
  router.get(`${CSI_HISTORY_PREFIX}/prior`, handle((req) => historyQuerySchemas.prior.parse(req.query), async (q) => {
    const coverage = await (deps.coverage ?? readCaptureCoverage)();
    return (deps.prior ?? selectPriorAnalyses)({ contact_number_id: q.contact_number_id, subject_key: q.subject_key, outreach_record_id: q.outreach_record_id ?? null,
      exclude_conversation_id: q.exclude_conversation_id ?? null, as_of: q.as_of ? new Date(q.as_of) : new Date() }, coverage);
  }));
  return router;
}
