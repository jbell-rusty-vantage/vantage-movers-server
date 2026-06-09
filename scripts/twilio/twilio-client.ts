import twilio from "twilio";
import type { Twilio } from "twilio";

export type TwilioCredentials =
  | {
      mode: "api-key";
      accountSid: string;
      apiKeySid: string;
      apiKeySecret: string;
    }
  | {
      mode: "auth-token";
      accountSid: string;
      authToken: string;
    };

export function resolveCredentials(): TwilioCredentials {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const apiKeySid = (
    process.env.TWILIO_API_KEY ?? process.env.TWILIO_CLIENT_SID
  )?.trim();
  const apiKeySecret = (
    process.env.TWILIO_API_SECRET ?? process.env.TWILIO_CLIENT_SECRET
  )?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!accountSid) {
    throw new Error("Missing required env var: TWILIO_ACCOUNT_SID");
  }

  if (apiKeySid && apiKeySecret) {
    return {
      mode: "api-key",
      accountSid,
      apiKeySid,
      apiKeySecret,
    };
  }

  if (authToken) {
    return {
      mode: "auth-token",
      accountSid,
      authToken,
    };
  }

  throw new Error(
    "Missing Twilio credentials. Provide TWILIO_API_KEY + TWILIO_CLIENT_SECRET (or TWILIO_API_SECRET), or TWILIO_AUTH_TOKEN.",
  );
}

export function createTwilioClient(credentials: TwilioCredentials): Twilio {
  if (credentials.mode === "api-key") {
    return twilio(credentials.apiKeySid, credentials.apiKeySecret, {
      accountSid: credentials.accountSid,
    });
  }

  return twilio(credentials.accountSid, credentials.authToken);
}

export function formatTwilioError(error: unknown): string {
  if (error && typeof error === "object") {
    const twilioError = error as {
      message?: string;
      status?: number;
      code?: number;
      moreInfo?: string;
    };
    const parts = [
      twilioError.code ? `code ${twilioError.code}` : null,
      twilioError.status ? `status ${twilioError.status}` : null,
      twilioError.message,
      twilioError.moreInfo,
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  return error instanceof Error ? error.message : String(error);
}

export function toE164UsPhoneNumber(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (input.startsWith("+") && digits.length >= 10) {
    return `+${digits}`;
  }

  throw new Error(
    `Invalid phone number "${input}". Use 10-digit US number or E.164 format.`,
  );
}

export type SmsSender =
  | { kind: "from"; value: string }
  | { kind: "messaging-service"; value: string };

export async function resolveSmsSender(client: Twilio): Promise<SmsSender> {
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  if (fromNumber) {
    return { kind: "from", value: toE164UsPhoneNumber(fromNumber) };
  }

  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (messagingServiceSid) {
    return { kind: "messaging-service", value: messagingServiceSid };
  }

  const services = await client.messaging.v1.services.list({ limit: 1 });
  if (services[0]?.sid) {
    return { kind: "messaging-service", value: services[0].sid };
  }

  const numbers = await client.incomingPhoneNumbers.list({ limit: 1 });
  if (numbers[0]?.phoneNumber) {
    return { kind: "from", value: numbers[0].phoneNumber };
  }

  throw new Error(
    "No sender found. Set TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID, or buy/provision a Twilio phone number.",
  );
}
