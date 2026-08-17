import { Router, type Request, type Response } from "express";
import type { GranotWebhookEventType } from "../config/domain/granotWebhook";
import { logger } from "../logger";
import {
  getGranotWebhookAuth,
  requireGranotWebhookSecret,
} from "../middleware/requireGranotWebhookSecret";
import { recordOperationalEvent } from "../services/observability";
import {
  captureGranotLifecycleWebhookReceipt,
  type CaptureGranotLifecycleWebhookInput,
  type CaptureGranotLifecycleWebhookResult,
} from "../services/granotLifecycle/capture";
import { incrementGranotLifecycleCaptureFailures } from "../services/granotLifecycle/metrics";
import { publishGranotLifecycleReceiptWakeup } from "../services/granotLifecycle/queuePublisher";

type CaptureGranotLifecycleWebhook = (
  input: CaptureGranotLifecycleWebhookInput,
) => Promise<CaptureGranotLifecycleWebhookResult>;

type PublishGranotLifecycleWakeup = (message: {
  receipt_id: string;
}) => Promise<{ published: boolean }>;

export type GranotWebhookRouterDeps = {
  capture?: CaptureGranotLifecycleWebhook;
  publish?: PublishGranotLifecycleWakeup;
};

const routes: ReadonlyArray<{
  path: string;
  event_type: GranotWebhookEventType;
}> = [
  { path: "/api/webhooks/granot/lead-created", event_type: "lead_created" },
  {
    path: "/api/webhooks/granot/priority-updated",
    event_type: "priority_updated",
  },
  {
    path: "/api/webhooks/granot/booking-status-changed",
    event_type: "booking_status_changed",
  },
];

export function createGranotWebhookRouter(deps: GranotWebhookRouterDeps = {}) {
  const capture = deps.capture ?? captureGranotLifecycleWebhookReceipt;
  const publish = deps.publish ?? publishGranotLifecycleReceiptWakeup;
  const router = Router();

  for (const route of routes) {
    router.post(
      route.path,
      requireGranotWebhookSecret,
      async (req: Request, res: Response) => {
        const auth = getGranotWebhookAuth(req);
        if (!auth) {
          return res.status(401).json({
            ok: false,
            code: "GRANOT_WEBHOOK_UNAUTHORIZED",
            error: "Unauthorized",
          });
        }

        let result: CaptureGranotLifecycleWebhookResult;
        try {
          result = await capture({
            route_event_class: route.event_type,
            captured_at: new Date(),
            headers: req.headers,
            payload: req.body,
            authentication_method: auth.authentication_method,
          });
        } catch (error) {
          incrementGranotLifecycleCaptureFailures();
          logger.error({ err: error, msg: "granot_lifecycle.capture.failed" });
          await recordOperationalEvent({
            level: "error",
            eventKey: "granot_lifecycle.capture.failed",
            category: "mongo",
            workflow: "granot_lifecycle_capture",
            summary: "Granot webhook receipt could not be stored.",
            details: {
              observation_channel: "granot_webhook",
              route_event_class: route.event_type,
            },
            statusCode: 503,
            notificationCandidate: false,
          });
          return res.status(503).json({
            ok: false,
            error: "Webhook receipt could not be stored",
          });
        }

        try {
          await publish({ receipt_id: result.receipt_id });
        } catch (error) {
          logger.error({
            err: error,
            msg: "granot_lifecycle.queue.publish_failed",
            receipt_id: result.receipt_id,
            observation_channel: "granot_webhook",
            route_event_class: route.event_type,
          });
        }

        return res.status(202).json({
          ok: true,
          accepted: true,
          event_type: route.event_type,
          receipt_id: result.receipt_id,
        });
      },
    );
  }

  return router;
}

export default createGranotWebhookRouter();
