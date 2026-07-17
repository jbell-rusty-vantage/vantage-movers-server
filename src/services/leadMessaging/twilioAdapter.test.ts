import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import twilio from "twilio";
import { validateTwilioWebhook } from "./twilioAdapter";

const originalToken = process.env.TWILIO_PRIMARY_AUTH_TOKEN;
const originalUrl = process.env.TWILIO_STATUS_CALLBACK_URL;
const originalSid = process.env.TWILIO_ACCOUNT_SID;
const originalFrom = process.env.TWILIO_FROM_NUMBER;

afterEach(() => {
  restore("TWILIO_PRIMARY_AUTH_TOKEN", originalToken);
  restore("TWILIO_STATUS_CALLBACK_URL", originalUrl);
  restore("TWILIO_ACCOUNT_SID", originalSid);
  restore("TWILIO_FROM_NUMBER", originalFrom);
});

test("status callback validation uses the exact configured URL and primary token", () => {
  const url = "https://api.example.com/api/webhooks/twilio/message-status";
  const params = { MessageSid: "SM123", MessageStatus: "delivered" };
  process.env.TWILIO_PRIMARY_AUTH_TOKEN = "primary-token";
  process.env.TWILIO_STATUS_CALLBACK_URL = url;
  process.env.TWILIO_ACCOUNT_SID = "AC123";
  process.env.TWILIO_FROM_NUMBER = "+18885550123";
  const signature = twilio.getExpectedTwilioSignature(
    "primary-token",
    url,
    params,
  );

  assert.equal(validateTwilioWebhook(signature, params), true);
  assert.equal(
    validateTwilioWebhook(signature, { ...params, MessageStatus: "failed" }),
    false,
  );
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
