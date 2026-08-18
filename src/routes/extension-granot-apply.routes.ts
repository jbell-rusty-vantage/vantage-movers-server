import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { connectMongo } from "../db";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import { createBrowserExtensionOwnerInitiator } from "../services/durableWork/actors";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
  isGranotLifecycleError,
} from "../services/granotLifecycle/errors";
import {
  applyExtensionGranotItem,
  type ApplyExtensionGranotItemInput,
  type ExtensionGranotApplyResult,
} from "../services/granotLifecycle/extensionApply";
import {
  extensionGranotApplyBatchSchema,
  extensionGranotApplyItemSchema,
  type ExtensionGranotApplyItemInput,
} from "../validation/v1/granotLifecycle.validation";

export type ExtensionGranotApplyRouteDeps = {
  connect?: typeof connectMongo;
  applyItem?: (
    input: ApplyExtensionGranotItemInput,
  ) => Promise<ExtensionGranotApplyResult>;
};

export function createExtensionGranotApplyRouter(
  deps: ExtensionGranotApplyRouteDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const applyItem = deps.applyItem ?? applyExtensionGranotItem;

  router.patch("/api/v1/form-leads/:id/granot-sync", async (req, res) => {
    try {
      const initiator = requireExtensionOwnerInitiator(req);
      const leadId = requireObjectIdParam(req);
      await connect();
      const item = extensionGranotApplyItemSchema.parse(req.body);
      assertExpectedTarget(item, "FormLead", leadId, req);
      const data = await applyItem({
        item,
        initiator,
        headers: req.headers,
        request_id: requestId(req),
      });
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.post("/api/v1/call-leads/enrichment/sync", async (req, res) => {
    try {
      const initiator = requireExtensionOwnerInitiator(req);
      await connect();
      const parsed = extensionGranotApplyBatchSchema.parse(req.body);
      const data = [];
      for (const item of parsed.items) {
        if (item.operation_kind !== "lead_snapshot_apply") {
          throw new GranotLifecycleError(
            "Call enrichment permits only lead_snapshot_apply",
            GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
            400,
            requestId(req),
          );
        }
        assertExpectedTarget(item, "CallLead", item.expected_target?.id, req);
        data.push(
          await applyItem({
            item,
            initiator,
            headers: req.headers,
            request_id: requestId(req),
          }),
        );
      }
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.post(
    "/api/v1/call-leads/booked-reconciliation/sync",
    async (req, res) => {
      try {
        const initiator = requireExtensionOwnerInitiator(req);
        await connect();
        const parsed = extensionGranotApplyBatchSchema.parse(req.body);
        const data = [];
        for (const item of parsed.items) {
          if (item.operation_kind !== "booking_action_apply") {
            throw new GranotLifecycleError(
              "Booked reconciliation permits only booking_action_apply",
              GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
              400,
              requestId(req),
            );
          }
          assertExpectedTarget(item, "CallLead", item.expected_target?.id, req);
          data.push(
            await applyItem({
              item,
              initiator,
              headers: req.headers,
              request_id: requestId(req),
            }),
          );
        }
        return res.json({ ok: true, data });
      } catch (error) {
        return sendError(res, error, requestId(req));
      }
    },
  );

  return router;
}

function requireExtensionOwnerInitiator(req: Request) {
  const auth = (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
  if (auth?.kind !== "user" || auth.role !== "owner") {
    throw new GranotLifecycleError(
      "Extension apply requires an authenticated Owner session",
      GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED,
      403,
      requestId(req),
    );
  }
  return createBrowserExtensionOwnerInitiator({
    actor_id: auth.userId,
    actor_label: auth.email,
    request_id: requestId(req) ?? auth.userId,
  });
}

function requireObjectIdParam(req: Request): string {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || !mongoose.isValidObjectId(id)) {
    throw new GranotLifecycleError(
      "Form apply target id is invalid",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      requestId(req),
    );
  }
  return id;
}

function assertExpectedTarget(
  item: ExtensionGranotApplyItemInput,
  model: "FormLead" | "CallLead",
  id: string | undefined,
  req: Request,
): void {
  if (!item.expected_target) {
    return;
  }
  if (item.expected_target.model !== model || (id && item.expected_target.id !== id)) {
    throw new GranotLifecycleError(
      "expected_target must agree with the apply URL",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      requestId(req),
    );
  }
}

function requestId(req: Request): string | undefined {
  const header = req.header("x-request-id");
  const raw = (req as Request & { id?: string }).id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return header?.trim() || undefined;
}

function sendError(res: Response, error: unknown, requestIdValue?: string) {
  if (isGranotLifecycleError(error)) {
    return res.status(error.statusCode).json(error.toHttpBody());
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

export default createExtensionGranotApplyRouter();
