import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import { connectMongo } from "../db";
import { csiFlag, CSI_TOOLS } from "../config/domain/salesIntelligence";
import { CsiError, requireCsiRun } from "../services/salesIntelligence/auth";
import { captureIntelligenceRead } from "../services/salesIntelligence/analysis/capture";
import { intelligenceReadSchema } from "../services/salesIntelligence/analysis/contracts";
import { readIntelligenceSubmission, submitIntelligenceAnalysis } from "../services/salesIntelligence/analysis/submit";

export const CSI_INTERNAL_PREFIX = "/api/v1/internal/sales-intelligence/runs/:id";
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
    const code = error instanceof ZodError ? "INVALID_INPUT" : error instanceof CsiError ? error.code : "INTERNAL_ERROR";
    const status = code === "FEATURE_DISABLED" ? 404 : code === "INVALID_INPUT" || code === "EVIDENCE_SCOPE_INVALID" ? 400
      : code === "SUBMISSION_CONFLICT" || code === "REVISION_CONFLICT" || code === "LEASE_LOST" ? 409
      : code === "ORIGINAL_EVIDENCE_UNAVAILABLE" ? 422 : code === "EVIDENCE_LIMIT_REACHED" || code === "BUDGET_EXHAUSTED" ? 413
      : code === "PROVIDER_READ_UNAVAILABLE" ? 503 : code === "INTERNAL_ERROR" ? 500 : 403;
    res.status(status).json({ok:false,code,error:"Intelligence request could not be completed",request_id:res.locals.request_id ?? "unavailable"});
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
