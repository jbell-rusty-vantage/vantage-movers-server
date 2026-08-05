import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import {
  requireApiSecret,
  type VantageAuthContext,
} from "../middleware/requireApiSecret";
import { GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN } from "../models/GranotAutomationSource";
import {
  GranotCollectorError,
} from "../services/granotHttpCollector";
import { durableActorFromRegistryActor } from "../services/durableWork";
import {
  isRegistryError,
  requireRegistryOwnerActor,
} from "../services/operationsRegistry";
import {
  approveGranotRun,
  createGranotRun,
  createGranotRunGroup,
  getGranotRun,
  GranotRunConflict,
  listGranotRuns,
  recoverGranotRuns,
  runGranotWorker,
} from "../services/granotHttpCollector/runWorkflow";
import {
  createGranotAutomationSource,
  GranotAutomationSourceConflict,
  GranotAutomationSourceLimitReached,
  GranotAutomationSourceValidationError,
  listGranotAutomationSources,
} from "../services/granotHttpCollector/sourceCatalog";

const router = Router();
const apiBase = "/api/v1/admin/granot-automation";
const base = `${apiBase}/runs`;
const runGroupsBase = `${apiBase}/run-groups`;
router.use(apiBase, requireApiSecret);

const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
const requestSchema = z
  .object({
    operation: z.enum(["form_leads", "call_leads"]),
    workflow: z.enum(["preview", "apply"]).default("preview"),
    from: z.string().regex(datePattern, "from must use MM/DD/YYYY"),
    to: z.string().regex(datePattern, "to must use MM/DD/YYYY"),
    source_labels: z.array(z.string().trim().min(1)).min(1).max(50).optional(),
    source_ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(50).optional(),
    filters: z
      .object({
        date_factor: z.enum(["OPEN", "BOOK"]).default("OPEN"),
        type: z.string().trim().default("ALL"),
        department: z.string().trim().default(""),
        state: z.string().trim().default(""),
        status: z.string().trim().default("10"),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.source_labels && !value.source_ids) {
      context.addIssue({
        code: "custom",
        path: ["source_ids"],
        message: "source_ids or source_labels is required",
      });
    }
    if (value.source_labels && value.source_ids) {
      context.addIssue({
        code: "custom",
        path: ["source_ids"],
        message: "submit source_ids or source_labels, not both",
      });
    }
    const from = parseGranotDate(value.from);
    const to = parseGranotDate(value.to);
    if (!from) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must be a real calendar date",
      });
    }
    if (!to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "to must be a real calendar date",
      });
    }
    if (from && to && from.getTime() > to.getTime()) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "to must be on or after from",
      });
    }
  });

router.get(`${base}/sources`, async (req, res) => {
  try {
    ownerActor(req);
    const operation = z
      .enum(["form_leads", "call_leads"])
      .optional()
      .parse(req.query.operation);
    return res.json({
      ok: true,
      data: await listGranotAutomationSources(operation),
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(`${base}/sources`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const body = z
      .object({
        label: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine(
            (label) => !GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN.test(label),
            "label cannot contain control or bidirectional characters",
          ),
        supported_operations: z
          .array(z.enum(["form_leads", "call_leads"]))
          .min(1)
          .max(2)
          .refine(
            (operations) => new Set(operations).size === operations.length,
            "supported_operations must contain unique values",
          ),
      })
      .strict()
      .parse(req.body);
    const data = await createGranotAutomationSource({
      label: body.label,
      supportedOperations: body.supported_operations,
      createdBy: actor,
    });
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(base, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const parsed = requestSchema.parse(req.body);
    const data = await createGranotRun({
      operation: parsed.operation,
      workflow: parsed.workflow,
      dateWindow: { from: parsed.from, to: parsed.to },
      sourceLabels: parsed.source_labels ?? [],
      sourceIds: parsed.source_ids,
      filters: {
        dateFactor: parsed.filters?.date_factor,
        type: parsed.filters?.type,
        department: parsed.filters?.department,
        state: parsed.filters?.state,
        status: parsed.filters?.status,
      },
      initiator: actor,
    });
    if (!data.queue_published && process.env.VERCEL !== "1") {
      const worker = await runGranotWorker();
      return res.status(202).json({ ok: true, data: { ...data, local_worker: worker } });
    }
    return res.status(202).json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(runGroupsBase, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const parsed = z
      .object({
        operations: z
          .array(z.enum(["form_leads", "call_leads"]))
          .min(1)
          .max(2)
          .refine(
            (operations) => new Set(operations).size === operations.length,
            "operations must contain unique values",
          ),
        workflow: z.enum(["preview", "apply"]).default("preview"),
        from: z.string().regex(datePattern, "from must use MM/DD/YYYY"),
        to: z.string().regex(datePattern, "to must use MM/DD/YYYY"),
        source_ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(50),
        filters: z
          .object({
            date_factor: z.enum(["OPEN", "BOOK"]).default("OPEN"),
            type: z.string().trim().default("ALL"),
            department: z.string().trim().default(""),
            state: z.string().trim().default(""),
            status: z.string().trim().default("10"),
          })
          .strict()
          .optional(),
      })
      .strict()
      .superRefine(validateDateWindow)
      .parse(req.body);
    const data = await createGranotRunGroup({
      operations: parsed.operations,
      workflow: parsed.workflow,
      dateWindow: { from: parsed.from, to: parsed.to },
      sourceIds: parsed.source_ids,
      filters: {
        dateFactor: parsed.filters?.date_factor,
        type: parsed.filters?.type,
        department: parsed.filters?.department,
        state: parsed.filters?.state,
        status: parsed.filters?.status,
      },
      initiator: actor,
    });
    if (
      process.env.VERCEL !== "1" &&
      data.runs.some((run) => !run.queue_published)
    ) {
      const localWorkers = [];
      for (const _run of data.runs) {
        localWorkers.push(await runGranotWorker());
      }
      return res
        .status(202)
        .json({ ok: true, data: { ...data, local_workers: localWorkers } });
    }
    return res.status(202).json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get(base, async (req, res) => {
  try {
    ownerActor(req);
    const limit = z.coerce.number().int().min(1).max(100).default(25).parse(req.query.limit);
    return res.json({ ok: true, data: await listGranotRuns(limit) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(`${base}/worker`, async (req, res) => {
  try {
    ownerActor(req);
    const body = z
      .object({ action: z.enum(["execute", "recover"]).default("execute") })
      .strict()
      .parse(req.body ?? {});
    const data =
      body.action === "recover" ? await recoverGranotRuns() : await runGranotWorker();
    return res.status(202).json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(`${base}/:runId/approve`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const runId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.runId);
    const body = z
      .object({
        plan_checksum: z.string().regex(/^[a-f\d]{64}$/i),
        selected_action_ids: z.array(z.string().min(1)).min(1).max(5_000),
      })
      .strict()
      .parse(req.body);
    const data = await approveGranotRun({
      run_id: runId,
      ...body,
      approved_by: actor,
    });
    if (process.env.VERCEL !== "1") {
      return res.status(202).json({
        ok: true,
        data: { ...data, local_worker: await runGranotWorker() },
      });
    }
    return res.status(202).json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get(`${base}/:runId`, async (req, res) => {
  try {
    ownerActor(req);
    const runId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.runId);
    const details = req.query.details === "owner";
    const data = await getGranotRun(runId, details);
    return data
      ? res.json({ ok: true, data })
      : res.status(404).json({
          ok: false,
          code: "RUN_NOT_FOUND",
          error: "Granot automation run was not found.",
        });
  } catch (error) {
    return sendError(res, error);
  }
});

function parseGranotDate(value: string): Date | undefined {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : undefined;
}

function validateDateWindow(
  value: { from: string; to: string },
  context: z.RefinementCtx,
) {
  const from = parseGranotDate(value.from);
  const to = parseGranotDate(value.to);
  if (!from) {
    context.addIssue({
      code: "custom",
      path: ["from"],
      message: "from must be a real calendar date",
    });
  }
  if (!to) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "to must be a real calendar date",
    });
  }
  if (from && to && from.getTime() > to.getTime()) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "to must be on or after from",
    });
  }
}

function sendError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_REQUEST",
      error: "Invalid Granot automation request",
      issues: error.issues,
    });
  }
  if (error instanceof GranotRunConflict) {
    return res.status(409).json({ ok: false, code: error.code, error: error.message });
  }
  if (error instanceof GranotAutomationSourceConflict) {
    return res.status(409).json({ ok: false, code: error.code, error: error.message });
  }
  if (error instanceof GranotAutomationSourceLimitReached) {
    return res.status(409).json({ ok: false, code: error.code, error: error.message });
  }
  if (error instanceof GranotAutomationSourceValidationError) {
    return res.status(400).json({
      ok: false,
      code: error.code,
      error: error.message,
      issues: error.issues,
    });
  }
  if (error instanceof GranotCollectorError) {
    return res.status(502).json({
      ok: false,
      code: error.code,
      error: "Granot provider request failed",
    });
  }
  if (isRegistryError(error)) {
    return res.status(error.statusCode).json(error.toHttpBody());
  }
  return res.status(500).json({
    ok: false,
    code: "GRANOT_AUTOMATION_FAILED",
    error: "Granot automation failed",
  });
}

function ownerActor(req: Request) {
  const auth = (
    req as Request & { vantageAuth?: VantageAuthContext }
  ).vantageAuth;
  return durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth));
}

export default router;
