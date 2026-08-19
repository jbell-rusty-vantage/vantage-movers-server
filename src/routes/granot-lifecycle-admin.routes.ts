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
  getGranotLifecycleCaseDetail,
  listGranotLifecycleCaseCandidates,
  listGranotLifecycleCases,
  projectGranotJob,
  projectGranotLeadTimeline,
  projectGranotLifecycleHealth,
} from "../services/granotLifecycle/projections";
import {
  confirmBooking as confirmGranotBooking,
  type BookingOwnerCommandResult,
  type ConfirmBookingInput,
} from "../services/granotLifecycle/bookingReconciliation";
import { durableActorFromRegistryActor } from "../services/durableWork";
import {
  DomainCommandContextError,
  DomainCommandIdempotencyConflictError,
} from "../services/domainCommands/types";
import {
  granotLifecycleCandidateQuerySchema,
  granotLifecycleCaseListQuerySchema,
  granotLifecycleCaseParamsSchema,
  granotLifecycleLeadTimelineParamsSchema,
  granotLifecycleTimelineQuerySchema,
  granotLifecycleActivationCommandSchema,
  granotLifecycleConfirmBookingCommandSchema,
  granotLifecycleRequeueCommandSchema,
} from "../validation/v1/granotLifecycle.validation";

export type GranotLifecycleAdminRouteDeps = {
  connect?: typeof connectMongo;
  activate?: typeof activateGranotLifecycle;
  requeue?: typeof requeueDeadLetterReceipt;
  projectJob?: typeof projectGranotJob;
  listCases?: typeof listGranotLifecycleCases;
  getCaseDetail?: typeof getGranotLifecycleCaseDetail;
  listCandidates?: typeof listGranotLifecycleCaseCandidates;
  projectLeadTimeline?: typeof projectGranotLeadTimeline;
  projectHealth?: typeof projectGranotLifecycleHealth;
  confirmBooking?: (input: ConfirmBookingInput) => Promise<BookingOwnerCommandResult>;
};

export function createGranotLifecycleAdminRouter(
  deps: GranotLifecycleAdminRouteDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const activate = deps.activate ?? activateGranotLifecycle;
  const requeue = deps.requeue ?? requeueDeadLetterReceipt;
  const projectJob = deps.projectJob ?? projectGranotJob;
  const listCases = deps.listCases ?? listGranotLifecycleCases;
  const getCaseDetail = deps.getCaseDetail ?? getGranotLifecycleCaseDetail;
  const listCandidates = deps.listCandidates ?? listGranotLifecycleCaseCandidates;
  const projectLead = deps.projectLeadTimeline ?? projectGranotLeadTimeline;
  const projectHealth = deps.projectHealth ?? projectGranotLifecycleHealth;
  const confirmBooking = deps.confirmBooking ?? confirmGranotBooking;

  router.post(
    "/api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking",
    async (req, res) => {
      try {
        await connect();
        const owner = durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
        const { case_id } = granotLifecycleCaseParamsSchema.parse({ case_id: req.params.id });
        const command = granotLifecycleConfirmBookingCommandSchema.parse(req.body);
        const idempotency_key = readSingleIdempotencyKey(req);
        const data = await confirmBooking({
          case_id,
          ...command,
          idempotency_key,
          owner,
          request_id: requestId(req),
        });
        return res.status(data.replayed || data.outcome === "already_satisfied" ? 200 : 201)
          .json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

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
        const query = granotLifecycleTimelineQuerySchema.parse(req.query);
        const data = await projectJob(raw, query);
        return res.json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.get("/api/v1/admin/granot-lifecycle/cases", async (req, res) => {
    try {
      await connect();
      requireRegistryReadActor(req, auth(req));
      const query = granotLifecycleCaseListQuerySchema.parse(req.query);
      const data = await listCases({
        ...query,
        state: query.state ?? "open",
        sort: query.sort ?? "last_evidence_at",
        order: query.order ?? "desc",
      });
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.get("/api/v1/admin/granot-lifecycle/cases/:case_id", async (req, res) => {
    try {
      await connect();
      requireRegistryReadActor(req, auth(req));
      const { case_id } = granotLifecycleCaseParamsSchema.parse(req.params);
      const data = await getCaseDetail(case_id);
      if (!data) {
        throw new GranotLifecycleError(
          "Granot reconciliation case not found",
          GRANOT_LIFECYCLE_ERROR_CODES.CASE_NOT_FOUND,
          404,
          requestId(req),
        );
      }
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.get(
    "/api/v1/admin/granot-lifecycle/cases/:case_id/candidates",
    async (req, res) => {
      try {
        await connect();
        requireRegistryOwnerActor(req, auth(req));
        const { case_id } = granotLifecycleCaseParamsSchema.parse(req.params);
        const query = granotLifecycleCandidateQuerySchema.parse(req.query);
        const data = await listCandidates(case_id, query);
        if (!data) {
          throw new GranotLifecycleError(
            "Granot reconciliation case not found",
            GRANOT_LIFECYCLE_ERROR_CODES.CASE_NOT_FOUND,
            404,
            requestId(req),
          );
        }
        return res.json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.get(
    "/api/v1/admin/leads/:lead_model/:lead_id/lifecycle",
    async (req, res) => {
      try {
        await connect();
        requireRegistryReadActor(req, auth(req));
        const params = granotLifecycleLeadTimelineParamsSchema.parse(req.params);
        const query = granotLifecycleTimelineQuerySchema.parse(req.query);
        const data = await projectLead(params.lead_model, params.lead_id, query);
        if (!data) {
          return res.status(404).json({ ok: false, error: "Lead not found" });
        }
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

export function readSingleIdempotencyKey(req: Request): string {
  const matches: string[] = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === "idempotency-key") {
      matches.push(req.rawHeaders[index + 1] ?? "");
    }
  }
  if (matches.length !== 1) {
    throw new GranotLifecycleError(
      "Exactly one Idempotency-Key header is required",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      requestId(req),
      [{ path: "Idempotency-Key", message: "exactly one header is required" }],
    );
  }
  return matches[0]!;
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
        error: "Owner authority is required",
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
  if (error instanceof DomainCommandIdempotencyConflictError) {
    return res.status(409).json({
      ok: false,
      code: GRANOT_LIFECYCLE_ERROR_CODES.DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT,
      error: error.message,
      request_id: requestIdValue ?? null,
    });
  }
  if (error instanceof DomainCommandContextError) {
    return res.status(400).json({
      ok: false,
      code: GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      error: error.message,
      request_id: requestIdValue ?? null,
    });
  }
  throw error;
}

export default createGranotLifecycleAdminRouter();
