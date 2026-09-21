import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { csiFlag, CSI_TOOLS } from "../config/domain/salesIntelligence";
import { CsiError, requireCsiRun } from "../services/salesIntelligence/auth";
import { captureIntelligenceRead } from "../services/salesIntelligence/analysis/capture";
import { intelligenceReadSchema } from "../services/salesIntelligence/analysis/contracts";
import { readIntelligenceSubmission, submitIntelligenceAnalysis } from "../services/salesIntelligence/analysis/submit";

export const CSI_INTERNAL_PREFIX = "/api/v1/internal/sales-intelligence/runs/:id";
export type SanitizedSchemaIssue = { path: string; code: string };
const ISSUE_PATH = /^[A-Za-z0-9_.:[\]]{1,160}$/;
/** Paths and Zod codes only. Never echo submitted claims, quotes, or received values. */
export function sanitizedSchemaIssues(error: ZodError): SanitizedSchemaIssue[] {
  return error.issues.slice(0, 16).flatMap((issue) => {
    const path = issue.path.map(String).join(".").slice(0, 160);
    const code = String(issue.code).slice(0, 48);
    return path && ISSUE_PATH.test(path) && code ? [{ path, code }] : [];
  });
}
export function intelligenceRouteFailure(error: unknown, requestId: string) {
  const code = error instanceof ZodError ? "INVALID_INPUT" : error instanceof CsiError ? error.code : "INTERNAL_ERROR";
  const status = code === "FEATURE_DISABLED" ? 404 : code === "INVALID_INPUT" || code === "EVIDENCE_SCOPE_INVALID" ? 400
    : code === "SUBMISSION_CONFLICT" || code === "REVISION_CONFLICT" || code === "LEASE_LOST" ? 409
    : code === "ORIGINAL_EVIDENCE_UNAVAILABLE" ? 422 : code === "EVIDENCE_LIMIT_REACHED" || code === "BUDGET_EXHAUSTED" ? 413
    : code === "PROVIDER_READ_UNAVAILABLE" ? 503 : code === "INTERNAL_ERROR" ? 500 : 403;
  const issues = error instanceof ZodError ? sanitizedSchemaIssues(error)
    : error instanceof CsiError && error.issues?.length
      ? error.issues.slice(0, 16).flatMap((issue) => {
          const path = issue.path.slice(0, 160), issueCode = String(issue.code).slice(0, 48);
          return path && ISSUE_PATH.test(path) && issueCode ? [{ path, code: issueCode }] : [];
        })
      : undefined;
  return {
    status,
    body: {
      ok: false as const,
      code,
      error: "Intelligence request could not be completed",
      request_id: requestId,
      ...(issues?.length ? { issues } : {}),
    },
  };
}
/** Mounted after the named-key boundary; each handler independently revalidates stored authority. */
export function createSalesIntelligenceInternalRouter(deps: {
  connect?: typeof connectMongo; authorize?: typeof requireCsiRun;
  capture?: typeof captureIntelligenceRead; submit?: typeof submitIntelligenceAnalysis;
  status?: typeof readIntelligenceSubmission;
} = {}) {
  const router = Router();
  const empty = z.object({}).strict();
  async function authorized(req: Request, tool: typeof CSI_TOOLS[number]) {
    if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
    empty.parse(req.query);
    await (deps.connect ?? connectMongo)();
    return (deps.authorize ?? requireCsiRun)(req, String(req.params.id), tool);
  }
  function fail(res: Response, error: unknown) {
    const failure = intelligenceRouteFailure(error, res.locals.request_id ?? "unavailable");
    if (failure.body.issues?.length) {
      logger.warn({
        msg: "csi.intelligence.invalid_input",
        request_id: failure.body.request_id,
        issue_paths: failure.body.issues.map((issue) => issue.path),
      });
    }
    res.status(failure.status).json(failure.body);
  }
  router.get(`${CSI_INTERNAL_PREFIX}/context`, async (req,res) => {
    try { empty.parse(req.body ?? {}); const auth = await authorized(req,"get_intelligence_context");
      res.json(await (deps.capture ?? captureIntelligenceRead)(auth,{tool:"get_intelligence_context",args:{}}));
    } catch(error) { fail(res,error); }
  });
  router.post(`${CSI_INTERNAL_PREFIX}/read`, async (req,res) => {
    try { const input = intelligenceReadSchema.parse(req.body); const auth = await authorized(req,input.tool);
      res.json(await (deps.capture ?? captureIntelligenceRead)(auth,input));
    } catch(error) { fail(res,error); }
  });
  router.post(`${CSI_INTERNAL_PREFIX}/submit`, async (req,res) => {
    try { const auth = await authorized(req,"submit_intelligence_analysis");
      res.status(202).json(await (deps.submit ?? submitIntelligenceAnalysis)(auth,req.body));
    } catch(error) { fail(res,error); }
  });
  router.get(`${CSI_INTERNAL_PREFIX}/submission`, async (req,res) => {
    try { empty.parse(req.body ?? {}); const auth = await authorized(req,"submit_intelligence_analysis");
      res.json(await (deps.status ?? readIntelligenceSubmission)(auth));
    } catch(error) { fail(res,error); }
  });
  return router;
}
