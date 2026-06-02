import { waitUntil } from "@vercel/functions";
import { Router, type Request, type Response } from "express";
import type { Logger } from "pino";
import { logger as rootLogger } from "../logger";
import {
  captureRingCentralWebhookEvent,
  previewRingCentralWebhookPayload,
  sanitizeHeaders,
} from "../services/ringcentral/webhook-capture";

const router = Router();

type RequestWithLogger = Request & {
  log?: Logger;
};

router.get("/api/webhooks/ringcentral", (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    provider: "ringcentral",
    route: "/api/webhooks/ringcentral",
    method: "GET",
    ready: true,
  });
});

router.post("/api/webhooks/ringcentral", (req: Request, res: Response) => {
  const receivedAt = new Date();
  const log = (req as RequestWithLogger).log ?? rootLogger;
  const validationToken = getValidationToken(req);
  const validationTokenPresent = validationToken !== null;
  const headers = sanitizeHeaders(headersToRecord(req));
  const normalizedPreview = previewRingCentralWebhookPayload(req.body);

  log.info({
    msg: "ringcentral.webhook.received",
    receivedAt: receivedAt.toISOString(),
    method: req.method,
    validationTokenPresent,
    contentType: req.get("content-type") ?? null,
    userAgent: req.get("user-agent") ?? null,
    eventHeaders: getEventHeaders(headers),
    subscriptionId: normalizedPreview.subscriptionId,
    telephonySessionId: normalizedPreview.telephonySessionId,
    partyId: normalizedPreview.partyId,
    event: normalizedPreview.event,
  });

  scheduleWebhookCapture(
    captureRingCentralWebhookEvent({
      receivedAt,
      validationTokenPresent,
      headers,
      payload: req.body ?? null,
    }),
    log,
  );

  if (validationToken) {
    res.setHeader("Validation-Token", validationToken);
  }

  return res.status(200).json({ ok: true });
});

function getValidationToken(req: Request): string | null {
  const token = req.get("validation-token") ?? req.get("Validation-Token");
  return token && token.trim() ? token : null;
}

function headersToRecord(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers[key] = value.join(", ");
      continue;
    }
    if (typeof value === "string") {
      headers[key] = value;
    }
  }
  return headers;
}

function getEventHeaders(headers: Record<string, string>): Record<string, string> {
  const eventHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (
      key.includes("event") ||
      key.startsWith("x-ringcentral") ||
      key.startsWith("ringcentral")
    ) {
      eventHeaders[key] = value;
    }
  }
  return eventHeaders;
}

function scheduleWebhookCapture(task: Promise<void>, log: Logger): void {
  const handledTask = task.catch((error) => {
    log.error({ err: error, msg: "ringcentral.webhook.capture.failed" });
  });

  try {
    waitUntil(handledTask);
  } catch {
    void handledTask;
  }
}

export default router;
