import twilio from "twilio";
import { getLeadMessagingCredentials, getRequiredEnv } from "../../config/domain";
import { logger } from "../../logger";
import { maskPhoneForLog } from "../../utils/logging/sanitizeFormLeadForLog";

export type TwilioSendResult = {
  sid: string;
  status: string;
};

export type TwilioSender = (input: {
  to: string;
  from: string;
  body: string;
  statusCallback: string;
}) => Promise<TwilioSendResult>;

export function createTwilioSender(): TwilioSender {
  const credentials = getLeadMessagingCredentials();
  const client = twilio(credentials.accountSid, credentials.authToken, {
    timeout: 10_000,
  });
  return async (input) => {
    logger.info({
      msg: "twilio.message.send.started",
      to: maskPhoneForLog(input.to),
      from: maskPhoneForLog(input.from),
    });
    const result = await client.messages.create(input);
    logger.info({
      msg: "twilio.message.send.accepted",
      message_sid: result.sid,
      status: result.status,
      to: maskPhoneForLog(input.to),
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
