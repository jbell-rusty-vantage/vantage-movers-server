import { Router, type Request, type Response } from "express";
import { getTwilioVoiceConfig } from "../config/domain/leadMessaging";
import { logger } from "../logger";
import {
  buildTwilioVoiceCompletedResponse,
  buildTwilioVoiceForwardResponse,
  isExpectedTwilioVoiceDestination,
  validateTwilioWebhook,
} from "../services/leadMessaging";
import { recordOperationalEvent } from "../services/observability";
import { maskPhoneForLog } from "../utils/logging/sanitizeFormLeadForLog";

const router = Router();

router.post("/api/webhooks/twilio/voice", async (req: Request, res: Response) => {
  const params = stringParams(req.body);
  if (!validateVoiceRequest(req, params, "webhookUrl", res)) return;
  if (!isExpectedTwilioVoiceDestination(params.To)) {
    logger.warn({
      msg: "twilio.voice.unexpected_destination",
      to: params.To ? maskPhoneForLog(params.To) : null,
      call_sid: params.CallSid ?? null,
    });
    return res.status(400).send("Unexpected called number");
  }

  const config = getTwilioVoiceConfig();
  await recordOperationalEvent({
    level: "info",
    eventKey: "twilio.voice.inbound_received",
    category: "messaging",
    workflow: "twilio_voice_forwarding",
    summary: "Inbound Twilio call is being forwarded to RingCentral.",
    request: req,
    entity: params.CallSid ? { type: "twilio_call", id: params.CallSid } : undefined,
    leadIdentity: { phone: params.From || null },
    details: {
      call_sid: params.CallSid ?? null,
      from: params.From ?? null,
      to: params.To ?? null,
      forward_to: config.forwardTo,
      call_status: params.CallStatus ?? null,
    },
    notificationCandidate: false,
  });

  return res.type("text/xml").status(200).send(buildTwilioVoiceForwardResponse());
});

router.post("/api/webhooks/twilio/voice/status", async (req: Request, res: Response) => {
  const params = stringParams(req.body);
  if (!validateVoiceRequest(req, params, "statusCallbackUrl", res)) return;
  await recordVoiceCallback(req, params, "progress");
  return res.status(204).send();
});

router.post("/api/webhooks/twilio/voice/completed", async (req: Request, res: Response) => {
  const params = stringParams(req.body);
  if (!validateVoiceRequest(req, params, "completedCallbackUrl", res)) return;
  await recordVoiceCallback(req, params, "completed");
  return res.type("text/xml").status(200).send(buildTwilioVoiceCompletedResponse());
});

type VoiceUrlKey = "webhookUrl" | "statusCallbackUrl" | "completedCallbackUrl";

function validateVoiceRequest(
  req: Request,
  params: Record<string, string>,
  urlKey: VoiceUrlKey,
  res: Response,
): boolean {
  try {
    const signature = req.get("x-twilio-signature")?.trim() ?? "";
    const valid = validateTwilioWebhook(
      signature,
      params,
      getTwilioVoiceConfig()[urlKey],
    );
    if (!valid) {
      logger.warn({
        msg: "twilio.voice.signature_invalid",
        callback: urlKey,
        call_sid: params.CallSid ?? null,
      });
      res.status(403).send("Forbidden");
    }
    return valid;
  } catch (error) {
    logger.error({ err: error, msg: "twilio.voice.webhook.config_invalid" });
    res.status(500).send("Webhook configuration error");
    return false;
  }
}

async function recordVoiceCallback(
  req: Request,
  params: Record<string, string>,
  phase: "progress" | "completed",
): Promise<void> {
  await recordOperationalEvent({
    level: "info",
    eventKey: `twilio.voice.${phase}`,
    category: "messaging",
    workflow: "twilio_voice_forwarding",
    summary: `Twilio voice forwarding ${phase} callback received.`,
    request: req,
    entity: params.CallSid ? { type: "twilio_call", id: params.CallSid } : undefined,
    leadIdentity: { phone: params.From || null },
    details: {
      call_sid: params.CallSid ?? null,
      dial_call_sid: params.DialCallSid ?? params.ParentCallSid ?? null,
      call_status: params.CallStatus ?? params.DialCallStatus ?? null,
      dial_call_duration: params.DialCallDuration ?? null,
      from: params.From ?? null,
      to: params.To ?? null,
    },
    notificationCandidate: false,
  });
}

function stringParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export default router;
