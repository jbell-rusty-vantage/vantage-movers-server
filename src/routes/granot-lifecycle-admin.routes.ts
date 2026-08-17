import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import { connectMongo } from "../db";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import {
  isRegistryError,
  requireRegistryOwnerActor,
  requireRegistryReadActor,
} from "../services/operationsRegistry";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
  isGranotLifecycleError,
} from "../services/granotLifecycle/errors";
import {
  activateGranotLifecycle,
  requeueDeadLetterReceipt,
} from "../services/granotLifecycle/operations";
import {
  projectGranotJob,
  projectGranotLifecycleHealth,
} from "../services/granotLifecycle/projections";
import {
  granotLifecycleActivationCommandSchema,
  granotLifecycleRequeueCommandSchema,
} from "../validation/v1/granotLifecycle.validation";

export type GranotLifecycleAdminRouteDeps = {
  connect?: typeof connectMongo;
  activate?: typeof activateGranotLifecycle;
  requeue?: typeof requeueDeadLetterReceipt;
  projectJob?: typeof projectGranotJob;
  projectHealth?: typeof projectGranotLifecycleHealth;
};

export function createGranotLifecycleAdminRouter(
  deps: GranotLifecycleAdminRouteDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const activate = deps.activate ?? activateGranotLifecycle;
  const requeue = deps.requeue ?? requeueDeadLetterReceipt;
  const projectJob = deps.projectJob ?? projectGranotJob;
  const projectHealth = deps.projectHealth ?? projectGranotLifecycleHealth;

  router.post("/api/v1/admin/granot-lifecycle/activation", async (req, res) => {
    try {
      await connect();
      const actor = requireRegistryOwnerActor(req, auth(req));
      const command = granotLifecycleActivationCommandSchema.parse(req.body);
      const data = await activate(command, actor);
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.post(
    "/api/v1/admin/granot-lifecycle/receipts/:id/requeue",
    async (req, res) => {
      try {
        await connect();
        const actor = requireRegistryOwnerActor(req, auth(req));
        const command = granotLifecycleRequeueCommandSchema.parse(req.body);
        const data = await requeue({ id: String(req.params.id), reason: command.reason }, actor);
        return res.status(200).json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.get(
    "/api/v1/admin/granot-lifecycle/jobs/:normalized_job_no",
    async (req, res) => {
      try {
        await connect();
        requireRegistryReadActor(req, auth(req));
        const raw = req.params.normalized_job_no;
        if (typeof raw !== "string") {
          throw new GranotLifecycleError(
            "normalized_job_no is invalid",
            GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
            400,
            requestId(req),
          );
        }
        const data = await projectJob(raw);
        return res.json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.get("/api/v1/admin/granot-lifecycle/operations/health", async (req, res) => {
    try {
      await connect();
      requireRegistryReadActor(req, auth(req));
      const data = await projectHealth();
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  return router;
}

function auth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}

function requestId(req: Request): string | undefined {
  const header = req.header("x-vantage-admin-request-id") ?? req.header("x-request-id");
  return header?.trim() || undefined;
}

function sendError(res: Response, error: unknown, requestIdValue?: string) {
  if (isGranotLifecycleError(error)) {
    return res.status(error.statusCode).json(error.toHttpBody());
  }
  if (isRegistryError(error)) {
    const ownerRequired =
      error.statusCode === 403 || String(error.registryCode).includes("ACTOR_");
    if (ownerRequired) {
      return res.status(403).json({
        ok: false,
        code: GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED,
        error: "Owner or Admin authority is required",
        request_id: requestIdValue ?? null,
      });
    }
    return res.status(error.statusCode).json({
      ok: false,
      code: error.registryCode,
      error: error.message,
      request_id: requestIdValue ?? null,
    });
  }
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      code: GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      error: "Invalid request",
      request_id: requestIdValue ?? null,
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  throw error;
}

export default createGranotLifecycleAdminRouter();
