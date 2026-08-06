import { Router, type Request, type Response } from "express";
import type { GranotWebhookEventType } from "../config/domain/granotWebhook";
import { requireGranotWebhookSecret } from "../middleware/requireGranotWebhookSecret";
import { logger } from "../logger";
import {
  captureGranotWebhookReceipt,
  type CaptureGranotWebhookInput,
  type CaptureGranotWebhookResult,
} from "../services/granotWebhooks/granotWebhookCapture.service";

type CaptureGranotWebhook = (
  input: CaptureGranotWebhookInput,
) => Promise<CaptureGranotWebhookResult>;

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

export function createGranotWebhookRouter(
  capture: CaptureGranotWebhook = captureGranotWebhookReceipt,
) {
  const router = Router();

  for (const route of routes) {
    router.post(
      route.path,
      requireGranotWebhookSecret,
      async (req: Request, res: Response) => {
        try {
          const result = await capture({
            event_type: route.event_type,
            received_at: new Date(),
            headers: req.headers,
            payload: req.body,
          });
          return res.status(202).json({
            ok: true,
            accepted: true,
            event_type: route.event_type,
            receipt_id: result.receipt_id,
          });
        } catch (error) {
          logger.error({ err: error, msg: "granot.webhook.capture_failed" });
          return res.status(503).json({
            ok: false,
            error: "Webhook receipt could not be stored",
          });
        }
      },
    );
  }

  return router;
}

export default createGranotWebhookRouter();
