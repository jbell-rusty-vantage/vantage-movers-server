import twilio from "twilio";
import { getLeadMessagingCredentials } from "../../config/domain";

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
    const result = await client.messages.create(input);
    return { sid: result.sid, status: result.status };
  };
}

export function validateTwilioWebhook(
  signature: string,
  params: Record<string, string>,
): boolean {
  const { authToken, statusCallbackUrl } = getLeadMessagingCredentials();
  return twilio.validateRequest(
    authToken,
    signature,
    statusCallbackUrl,
    params,
  );
}
