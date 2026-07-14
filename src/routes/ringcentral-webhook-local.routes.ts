import { Router, type Request, type Response } from "express";
import type { Logger } from "pino";
import { logger as rootLogger } from "../logger";
import {
  appendLocalRingCentralWebhookEvent,
  RINGCENTRAL_LOCAL_WEBHOOK_ROUTE,
} from "../services/ringcentral/local-webhook-capture";
import { sanitizeHeaders } from "../services/ringcentral/webhook-capture";

/**
 * Local-only debug webhook. Subscribed via `pnpm ringcentral:webhook:create:local`
 * (which points an ngrok tunnel at this route). It does NOT run the production
 * candidate/session/lead pipeline — it simply echoes the RingCentral
 * `Validation-Token` (so subscription creation succeeds) and appends every raw
 * notification to a gitignored JSONL file for local inspection.
 */
const router = Router();

type RequestWithLogger = Request & { log?: Logger };

router.get(RINGCENTRAL_LOCAL_WEBHOOK_ROUTE, (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    provider: "ringcentral",
    route: RINGCENTRAL_LOCAL_WEBHOOK_ROUTE,
    method: "GET",
    ready: true,
    mode: "local-file-capture",
  });
});

router.post(RINGCENTRAL_LOCAL_WEBHOOK_ROUTE, async (req: Request, res: Response) => {
  const receivedAt = new Date();
  const log = (req as RequestWithLogger).log ?? rootLogger;
  const validationToken = getValidationToken(req);

  // Echo the validation token so RingCentral accepts the subscription.
  if (validationToken) {
    res.setHeader("Validation-Token", validationToken);
  }

  let storedPath: string | null = null;
  try {
    storedPath = await appendLocalRingCentralWebhookEvent({
      receivedAt: receivedAt.toISOString(),
      validationTokenPresent: validationToken !== null,
      headers: sanitizeHeaders(headersToRecord(req)),
      payload: req.body ?? null,
    });
  } catch (error) {
    log.error({ err: error, msg: "ringcentral.local_webhook.write_failed" });
  }

  log.info({
    msg: "ringcentral.local_webhook.received",
    receivedAt: receivedAt.toISOString(),
    validationTokenPresent: validationToken !== null,
    storedPath,
  });

  return res.status(200).json({
    ok: true,
    provider: "ringcentral",
    mode: "local-file-capture",
    storedRawEvent: storedPath !== null,
  });
});

function getValidationToken(req: Request): string | null {
  const token = req.get("validation-token") ?? req.get("Validation-Token");
  return token && token.trim() ? token : null;
}

function headersToRecord(
  req: Request,
): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value) || typeof value === "string") {
      headers[key] = value;
    }
  }
  return headers;
}

export default router;
