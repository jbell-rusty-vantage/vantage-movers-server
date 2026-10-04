import { Router, type Request, type Response } from "express";
import { getTwilioVoiceConfig } from "../config/domain/leadMessaging";
import { logger } from "../logger";
import {
  buildTwilioVoiceCompletedResponse,
  buildTwilioVoiceForwardResponse,
  isExpectedTwilioVoiceDestination,
  validateTwilioWebhook,
} from "../services/leadMessaging";
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

  logger.info({
    msg: "twilio.voice.inbound_received",
    workflow: "twilio_voice_forwarding",
    call_sid: params.CallSid ?? null,
    from: params.From ? maskPhoneForLog(params.From) : null,
    to: params.To ? maskPhoneForLog(params.To) : null,
    call_status: params.CallStatus ?? null,
  });

  return res.type("text/xml").status(200).send(buildTwilioVoiceForwardResponse());
});

router.post("/api/webhooks/twilio/voice/status", async (req: Request, res: Response) => {
  const params = stringParams(req.body);
  if (!validateVoiceRequest(req, params, "statusCallbackUrl", res)) return;
  logVoiceCallback(params, "progress");
  return res.status(204).send();
});

router.post("/api/webhooks/twilio/voice/completed", async (req: Request, res: Response) => {
  const params = stringParams(req.body);
  if (!validateVoiceRequest(req, params, "completedCallbackUrl", res)) return;
  logVoiceCallback(params, "completed");
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

function logVoiceCallback(
  params: Record<string, string>,
  phase: "progress" | "completed",
): void {
  logger.info({
    msg: `twilio.voice.${phase}`,
    workflow: "twilio_voice_forwarding",
    call_sid: params.CallSid ?? null,
    dial_call_sid: params.DialCallSid ?? params.ParentCallSid ?? null,
    call_status: params.CallStatus ?? params.DialCallStatus ?? null,
    dial_call_duration: params.DialCallDuration ?? null,
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
