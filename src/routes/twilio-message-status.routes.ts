import { Router, type Request, type Response } from "express";
import { connectMongo } from "../db";
import { logger } from "../logger";
import {
  applyTwilioStatusCallback,
  validateTwilioWebhook,
} from "../services/leadMessaging";

const router = Router();

router.post(
  "/api/webhooks/twilio/message-status",
  async (req: Request, res: Response) => {
    const signature = req.get("x-twilio-signature")?.trim() ?? "";
    const params = stringParams(req.body);
    let valid = false;
    try {
      valid = validateTwilioWebhook(signature, params);
    } catch (error) {
      logger.error({
        err: error,
        msg: "lead_messaging.callback.config_invalid",
      });
      return res.status(500).send("Webhook configuration error");
    }
    if (!valid) return res.status(403).send("Forbidden");

    const messageSid = params.MessageSid;
    const messageStatus = params.MessageStatus;
    if (!messageSid || !messageStatus) {
      return res.status(400).send("Missing MessageSid or MessageStatus");
    }

    try {
      await connectMongo();
      const matched = await applyTwilioStatusCallback({
        messageSid,
        messageStatus,
        errorCode: parseOptionalNumber(params.ErrorCode),
        errorMessage: params.ErrorMessage || null,
      });
      if (!matched) return res.status(404).send("Message not recorded yet");
      return res.status(204).send();
    } catch (error) {
      logger.error({ err: error, msg: "lead_messaging.callback.failed" });
      return res.status(500).send("Callback processing failed");
    }
  },
);

function stringParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default router;
