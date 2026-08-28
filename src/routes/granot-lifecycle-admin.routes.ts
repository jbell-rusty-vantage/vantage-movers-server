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
  observeGranotOwnerCommandConflict,
  observeGranotOwnerCommandResult,
} from "../services/granotLifecycle/observability";
import {
  activateGranotLifecycle,
  requeueDeadLetterReceipt,
} from "../services/granotLifecycle/operations";
import { getIntakeCreatingObservation } from "../services/granotLifecycle/creatingObservation";
import {
  getGranotLifecycleCaseDetail,
  listConnectLeadCandidates,
  listGranotLifecycleCaseCandidates,
  listGranotLifecycleCases,
  projectGranotJob,
  projectGranotLeadTimeline,
  projectGranotLifecycleHealth,
} from "../services/granotLifecycle/projections";
import {
  listLiveWebhookReceiptSnapshot,
  listLiveWebhookReceiptsAfter,
  type LiveReceiptCursor,
  type LiveWebhookReceipt,
} from "../services/granotLifecycle/liveReceipts";
import {
  LIVE_RECEIPT_HEARTBEAT_MS,
  LIVE_RECEIPT_MAX_MS,
  LIVE_RECEIPT_POLL_MS,
  runLiveReceiptSse,
} from "../services/granotLifecycle/liveReceiptStream";
import {
  confirmBooking as confirmGranotBooking,
  createReferralBooking as createGranotReferralBooking,
  updateExistingBooking as updateGranotBooking,
  noAction as resolveGranotBookingNoAction,
  type BookingOwnerCommandResult,
  type BookingNoActionInput,
  type ConfirmBookingInput,
  type ReferralBookingInput,
  type UpdateExistingBookingInput,
} from "../services/granotLifecycle/bookingReconciliation";
import {
  confirmCancellation as confirmGranotCancellation,
  updateExistingBooking as updateGranotReleaseBooking,
  noAction as resolveGranotReleaseNoAction,
  type ConfirmCancellationInput,
  type UpdateReleaseBookingInput,
  type ReleaseNoActionInput,
  type ReleaseOwnerCommandResult,
} from "../services/granotLifecycle/releaseReconciliation";
import { durableActorFromRegistryActor } from "../services/durableWork";
import type { DurableActor } from "../services/durableWork";
import { getGranotLifecycleDiscrepancyDetail, listGranotLifecycleDiscrepancies } from "../services/granotLifecycle/discrepancyProjections";
import {
  correctGranotRecordLink as correctDiscrepancyRecordLink,
  reEvaluateGranotDiscrepancy,
  resolveGranotDiscrepancyNoAction,
  type CorrectRecordLinkInput,
  type DiscrepancyNoActionInput,
  type DiscrepancyOwnerCommandResult,
  type ReEvaluateDiscrepancyInput,
} from "../services/granotLifecycle/discrepancyOwnerCommands";
import {
  connectBookingToLead as connectGranotBookingToLead,
  type ConnectBookingToLeadInput,
  type ConnectBookingToLeadResult,
} from "../services/granotLifecycle/connectBookingToLead";
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
  granotLifecycleBookingNoActionCommandSchema,
  granotLifecycleBookingParamsSchema,
  granotLifecycleConfirmBookingCommandSchema,
  granotLifecycleConnectLeadCandidateQuerySchema,
  granotLifecycleConnectLeadCommandSchema,
  granotLifecycleCreateReferralBookingCommandSchema,
  granotLifecycleUpdateBookingCommandSchema,
  granotLifecycleConfirmCancellationCommandSchema,
  granotLifecycleReleaseNoActionCommandSchema,
  granotLifecycleRequeueCommandSchema,
  granotLifecycleCorrectRecordLinkCommandSchema,
  granotLifecycleDiscrepancyListQuerySchema,
  granotLifecycleDiscrepancyNoActionCommandSchema,
  granotLifecycleDiscrepancyParamsSchema,
  granotLifecycleReEvaluateDiscrepancyCommandSchema,
} from "../validation/v1/granotLifecycle.validation";

export type GranotLifecycleAdminRouteDeps = {
  connect?: typeof connectMongo;
  activate?: typeof activateGranotLifecycle;
  requeue?: typeof requeueDeadLetterReceipt;
  projectJob?: typeof projectGranotJob;
  listCases?: typeof listGranotLifecycleCases;
  getCaseDetail?: typeof getGranotLifecycleCaseDetail;
  getCreatingObservation?: typeof getIntakeCreatingObservation;
  listCandidates?: typeof listGranotLifecycleCaseCandidates;
  listConnectLeadCandidates?: typeof listConnectLeadCandidates;
  connectBookingToLead?: (input: ConnectBookingToLeadInput) => Promise<ConnectBookingToLeadResult>;
  projectLeadTimeline?: typeof projectGranotLeadTimeline;
  projectHealth?: typeof projectGranotLifecycleHealth;
  confirmBooking?: (input: ConfirmBookingInput) => Promise<BookingOwnerCommandResult>;
  createReferralBooking?: (input: ReferralBookingInput) => Promise<BookingOwnerCommandResult>;
  updateBooking?: (input: UpdateExistingBookingInput) => Promise<BookingOwnerCommandResult>;
  noAction?: (input: BookingNoActionInput) => Promise<BookingOwnerCommandResult>;
  confirmCancellation?: (input: ConfirmCancellationInput) => Promise<ReleaseOwnerCommandResult>;
  updateReleaseBooking?: (input: UpdateReleaseBookingInput) => Promise<ReleaseOwnerCommandResult>;
  releaseNoAction?: (input: ReleaseNoActionInput) => Promise<ReleaseOwnerCommandResult>;
  listDiscrepancies?: typeof listGranotLifecycleDiscrepancies;
  getDiscrepancyDetail?: typeof getGranotLifecycleDiscrepancyDetail;
  reEvaluateDiscrepancy?: (input: ReEvaluateDiscrepancyInput) => Promise<DiscrepancyOwnerCommandResult>;
  correctRecordLink?: (input: CorrectRecordLinkInput) => Promise<DiscrepancyOwnerCommandResult>;
  discrepancyNoAction?: (input: DiscrepancyNoActionInput) => Promise<DiscrepancyOwnerCommandResult>;
  listLiveReceiptSnapshot?: () => Promise<LiveWebhookReceipt[]>;
  listLiveReceiptsAfter?: (cursor: LiveReceiptCursor) => Promise<LiveWebhookReceipt[]>;
  liveStreamSleep?: (ms: number) => Promise<void>;
  liveStreamNow?: () => number;
  liveStreamPollMs?: number;
  liveStreamHeartbeatMs?: number;
  liveStreamMaxMs?: number;
};

type EnvelopeForRoute = {
  discrepancy_id: string;
  idempotency_key: string;
  owner: DurableActor;
  request_id?: string;
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
  const getCreatingObservation = deps.getCreatingObservation ?? getIntakeCreatingObservation;
  const listCandidates = deps.listCandidates ?? listGranotLifecycleCaseCandidates;
  const listConnectCandidates = deps.listConnectLeadCandidates ?? listConnectLeadCandidates;
  const connectBookingToLead = deps.connectBookingToLead ?? connectGranotBookingToLead;
  const projectLead = deps.projectLeadTimeline ?? projectGranotLeadTimeline;
  const projectHealth = deps.projectHealth ?? projectGranotLifecycleHealth;
  const confirmBooking = deps.confirmBooking ?? confirmGranotBooking;
  const createReferralBooking = deps.createReferralBooking ?? createGranotReferralBooking;
  const updateBooking = deps.updateBooking ?? updateGranotBooking;
  const noAction = deps.noAction ?? resolveGranotBookingNoAction;
  const confirmCancellation = deps.confirmCancellation ?? confirmGranotCancellation;
  const updateReleaseBooking = deps.updateReleaseBooking ?? updateGranotReleaseBooking;
  const releaseNoAction = deps.releaseNoAction ?? resolveGranotReleaseNoAction;
  const listDiscrepancies = deps.listDiscrepancies ?? listGranotLifecycleDiscrepancies;
  const getDiscrepancyDetail = deps.getDiscrepancyDetail ?? getGranotLifecycleDiscrepancyDetail;
  const reEvaluateDiscrepancy = deps.reEvaluateDiscrepancy ?? reEvaluateGranotDiscrepancy;
  const correctRecordLink = deps.correctRecordLink ?? correctDiscrepancyRecordLink;
  const discrepancyNoAction = deps.discrepancyNoAction ?? resolveGranotDiscrepancyNoAction;
  const listLiveSnapshot = deps.listLiveReceiptSnapshot ?? listLiveWebhookReceiptSnapshot;
  const listLiveAfter = deps.listLiveReceiptsAfter ?? listLiveWebhookReceiptsAfter;

  router.get("/api/v1/admin/granot-lifecycle/receipts/live", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
    } catch (error) {
      return sendError(res, error, requestId(req));
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const abort = new AbortController();
    req.on("close", () => abort.abort());
    try {
      await runLiveReceiptSse(
        {
          write: (chunk) => {
            res.write(chunk);
          },
        },
        {
          listSnapshot: listLiveSnapshot,
          listAfter: listLiveAfter,
          sleep: deps.liveStreamSleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
          now: deps.liveStreamNow ?? Date.now,
          pollMs: deps.liveStreamPollMs ?? LIVE_RECEIPT_POLL_MS,
          heartbeatMs: deps.liveStreamHeartbeatMs ?? LIVE_RECEIPT_HEARTBEAT_MS,
          maxMs: deps.liveStreamMaxMs ?? LIVE_RECEIPT_MAX_MS,
          signal: abort.signal,
        },
        req.header("last-event-id"),
      );
    } catch (error) {
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: "Live stream failed" })}\n\n`);
      }
      void error;
    }
    if (!res.writableEnded) {
      res.end();
    }
  });

  router.get("/api/v1/admin/granot-lifecycle/discrepancies", async (req, res) => {
    try {
      await connect();
      requireRegistryReadActor(req, auth(req));
      const data = await listDiscrepancies(granotLifecycleDiscrepancyListQuerySchema.parse(req.query));
      return res.status(200).json({ ok: true, data });
    } catch (error) { return sendError(res, error, requestId(req)); }
  });

  router.get("/api/v1/admin/granot-lifecycle/discrepancies/:id", async (req, res) => {
    try {
      await connect();
      requireRegistryReadActor(req, auth(req));
      const { discrepancy_id } = granotLifecycleDiscrepancyParamsSchema.parse({ discrepancy_id: req.params.id });
      return res.status(200).json({ ok: true, data: await getDiscrepancyDetail(discrepancy_id) });
    } catch (error) { return sendError(res, error, requestId(req)); }
  });

  const discrepancyAction = <T extends Record<string, unknown>>(
    path: string,
    schema: { parse(value: unknown): T },
    handler: (input: T & EnvelopeForRoute) => Promise<DiscrepancyOwnerCommandResult>,
  ) => router.post(path, async (req, res) => {
    try {
      await connect();
      const owner = durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
      const { discrepancy_id } = granotLifecycleDiscrepancyParamsSchema.parse({ discrepancy_id: req.params.id });
      const command = schema.parse(req.body);
      const data = await handler({ ...command, discrepancy_id, idempotency_key: readSingleIdempotencyKey(req), owner, request_id: requestId(req) });
      void observeGranotOwnerCommandResult({
        replayed: data.replayed,
        command: path,
        discrepancy_kind: data.discrepancy_kind,
        discrepancy_resolved: data.state === "resolved",
      });
      return res.status(200).json({ ok: true, data });
    } catch (error) { return sendError(res, error, requestId(req)); }
  });

  discrepancyAction("/api/v1/admin/granot-lifecycle/discrepancies/:id/re-evaluate", granotLifecycleReEvaluateDiscrepancyCommandSchema, reEvaluateDiscrepancy);
  discrepancyAction("/api/v1/admin/granot-lifecycle/discrepancies/:id/correct-record-link", granotLifecycleCorrectRecordLinkCommandSchema, correctRecordLink);
  discrepancyAction("/api/v1/admin/granot-lifecycle/discrepancies/:id/no-action", granotLifecycleDiscrepancyNoActionCommandSchema, discrepancyNoAction);

  router.get(
    "/api/v1/admin/bookings/:bookingId/connect-lead-candidates",
    async (req, res) => {
      try {
        await connect();
        requireRegistryOwnerActor(req, auth(req));
        const { booking_id } = granotLifecycleBookingParamsSchema.parse({ booking_id: req.params.bookingId });
        const query = granotLifecycleConnectLeadCandidateQuerySchema.parse(req.query);
        const data = await listConnectCandidates(booking_id, query);
        return res.status(200).json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.post(
    "/api/v1/admin/bookings/:bookingId/connect-lead",
    async (req, res) => {
      try {
        await connect();
        const owner = durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
        const { booking_id } = granotLifecycleBookingParamsSchema.parse({ booking_id: req.params.bookingId });
        const command = granotLifecycleConnectLeadCommandSchema.parse(req.body);
        const idempotency_key = readSingleIdempotencyKey(req);
        const data = await connectBookingToLead({
          booking_id,
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
        void observeGranotOwnerCommandResult({
          replayed: data.replayed,
          command: "confirmGranotBooking",
          case_kind: "booking",
          case_resolved: data.case_state === "resolved",
        });
        return res.status(data.replayed || data.outcome === "already_satisfied" ? 200 : 201)
          .json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.post(
    "/api/v1/admin/granot-lifecycle/booking-cases/:id/update-booking",
    async (req, res) => {
      try {
        await connect();
        const owner = durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
        const { case_id } = granotLifecycleCaseParamsSchema.parse({ case_id: req.params.id });
        const command = granotLifecycleUpdateBookingCommandSchema.parse(req.body);
        const data = await updateBooking({
          case_id,
          ...command,
          idempotency_key: readSingleIdempotencyKey(req),
          owner,
          request_id: requestId(req),
        });
        void observeGranotOwnerCommandResult({
          replayed: data.replayed,
          command: "updateGranotBooking",
          case_kind: "booking",
          case_resolved: data.case_state === "resolved",
        });
        return res.status(200).json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.post(
    "/api/v1/admin/granot-lifecycle/booking-cases/:id/create-referral-booking",
    async (req, res) => {
      try {
        await connect();
        const owner = durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
        const { case_id } = granotLifecycleCaseParamsSchema.parse({ case_id: req.params.id });
        const command = granotLifecycleCreateReferralBookingCommandSchema.parse(req.body);
        const data = await createReferralBooking({
          case_id,
          ...command,
          idempotency_key: readSingleIdempotencyKey(req),
          owner,
          request_id: requestId(req),
        });
        void observeGranotOwnerCommandResult({
          replayed: data.replayed,
          command: "createGranotReferralBooking",
          case_kind: "booking",
          case_resolved: data.case_state === "resolved",
        });
        return res.status(data.replayed || data.outcome === "already_satisfied" ? 200 : 201)
          .json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.post(
    "/api/v1/admin/granot-lifecycle/booking-cases/:id/no-action",
    async (req, res) => {
      try {
        await connect();
        const owner = durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
        const { case_id } = granotLifecycleCaseParamsSchema.parse({ case_id: req.params.id });
        const command = granotLifecycleBookingNoActionCommandSchema.parse(req.body);
        const data = await noAction({
          case_id,
          ...command,
          idempotency_key: readSingleIdempotencyKey(req),
          owner,
          request_id: requestId(req),
        });
        void observeGranotOwnerCommandResult({
          replayed: data.replayed,
          command: "resolveGranotBookingNoAction",
          case_kind: "booking",
          case_resolved: data.case_state === "resolved",
        });
        return res.status(200).json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.post(
    "/api/v1/admin/granot-lifecycle/release-cases/:id/confirm-cancellation",
    async (req, res) => {
      try {
        await connect();
        const owner = durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
        const { case_id } = granotLifecycleCaseParamsSchema.parse({ case_id: req.params.id });
        const command = granotLifecycleConfirmCancellationCommandSchema.parse(req.body);
        const data = await confirmCancellation({
          case_id,
          ...command,
          idempotency_key: readSingleIdempotencyKey(req),
          owner,
          request_id: requestId(req),
        });
        void observeGranotOwnerCommandResult({
          replayed: data.replayed,
          command: "confirmGranotCancellation",
          case_kind: "release",
          case_resolved: data.case_state === "resolved",
        });
        return res.status(data.replayed || data.outcome === "already_satisfied" ? 200 : 201)
          .json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.post(
    "/api/v1/admin/granot-lifecycle/release-cases/:id/update-booking",
    async (req, res) => {
      try {
        await connect();
        const owner = durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
        const { case_id } = granotLifecycleCaseParamsSchema.parse({ case_id: req.params.id });
        const command = granotLifecycleUpdateBookingCommandSchema.parse(req.body);
        const data = await updateReleaseBooking({
          case_id,
          ...command,
          idempotency_key: readSingleIdempotencyKey(req),
          owner,
          request_id: requestId(req),
        });
        void observeGranotOwnerCommandResult({
          replayed: data.replayed,
          command: "updateGranotReleaseBooking",
          case_kind: "release",
          case_resolved: data.case_state === "resolved",
        });
        return res.status(200).json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  router.post(
    "/api/v1/admin/granot-lifecycle/release-cases/:id/no-action",
    async (req, res) => {
      try {
        await connect();
        const owner = durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
        const { case_id } = granotLifecycleCaseParamsSchema.parse({ case_id: req.params.id });
        const command = granotLifecycleReleaseNoActionCommandSchema.parse(req.body);
        const data = await releaseNoAction({
          case_id,
          ...command,
          idempotency_key: readSingleIdempotencyKey(req),
          owner,
          request_id: requestId(req),
        });
        void observeGranotOwnerCommandResult({
          replayed: data.replayed,
          command: "resolveGranotReleaseNoAction",
          case_kind: "release",
          case_resolved: data.case_state === "resolved",
        });
        return res.status(200).json({ ok: true, data });
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
    "/api/v1/admin/granot-lifecycle/cases/:case_id/creating-observation",
    async (req, res) => {
      try {
        await connect();
        requireRegistryOwnerActor(req, auth(req));
        const { case_id } = granotLifecycleCaseParamsSchema.parse(req.params);
        const data = await getCreatingObservation(case_id);
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
  void observeGranotOwnerCommandConflict(error);
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
