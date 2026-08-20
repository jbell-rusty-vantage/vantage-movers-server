import twilio from "twilio";
import { getLeadMessagingCredentials, getRequiredEnv } from "../../config/domain";
import { logger } from "../../logger";
import { maskPhoneForLog } from "../../utils/logging/sanitizeFormLeadForLog";

export type TwilioSendResult = {
  sid: string;
  status: string;
};

export type TwilioSendInput = {
  to: string;
  from: string;
  body: string;
  statusCallback: string;
  sendAt?: Date;
  messagingServiceSid?: string;
};

export type TwilioSender = (input: TwilioSendInput) => Promise<TwilioSendResult>;

export function buildTwilioMessageCreateInput(input: TwilioSendInput): {
  to: string;
  from: string;
  body: string;
  statusCallback: string;
  scheduleType?: "fixed";
  sendAt?: Date;
  messagingServiceSid?: string;
} {
  if (!input.sendAt) {
    return {
      to: input.to,
      from: input.from,
      body: input.body,
      statusCallback: input.statusCallback,
    };
  }
  if (!input.messagingServiceSid) {
    throw new Error(
      "TWILIO_MESSAGING_SERVICE_SID is required to schedule an SMS",
    );
  }
  return {
    to: input.to,
    from: input.from,
    body: input.body,
    statusCallback: input.statusCallback,
    messagingServiceSid: input.messagingServiceSid,
    scheduleType: "fixed",
    sendAt: input.sendAt,
  };
}

export function createTwilioSender(): TwilioSender {
  const credentials = getLeadMessagingCredentials();
  const client = twilio(credentials.accountSid, credentials.authToken, {
    timeout: 10_000,
  });
  return async (input) => {
    const payload = buildTwilioMessageCreateInput(input);
    logger.info({
      msg: payload.sendAt
        ? "twilio.message.schedule.started"
        : "twilio.message.send.started",
      to: maskPhoneForLog(input.to),
      from: maskPhoneForLog(input.from),
      send_at: payload.sendAt?.toISOString() ?? null,
    });
    const result = await client.messages.create(payload);
    logger.info({
      msg: payload.sendAt
        ? "twilio.message.schedule.accepted"
        : "twilio.message.send.accepted",
      message_sid: result.sid,
      status: result.status,
      to: maskPhoneForLog(input.to),
      send_at: payload.sendAt?.toISOString() ?? null,
    });
    return { sid: result.sid, status: result.status };
  };
}

export function validateTwilioWebhook(
  signature: string,
  params: Record<string, string>,
  requestUrl?: string,
): boolean {
  const authToken = getRequiredEnv("TWILIO_PRIMARY_AUTH_TOKEN");
  const callbackUrl = requestUrl ?? getRequiredEnv("TWILIO_STATUS_CALLBACK_URL");
  return twilio.validateRequest(
    authToken,
    signature,
    callbackUrl,
    params,
  );
}
