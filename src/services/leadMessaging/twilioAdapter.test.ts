import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import twilio from "twilio";
import {
  buildTwilioMessageCreateInput,
  validateTwilioWebhook,
} from "./twilioAdapter";

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

test("immediate Twilio payloads keep the existing from-number send shape", () => {
  assert.deepEqual(
    buildTwilioMessageCreateInput({
      to: "+15555550123",
      from: "+18885550123",
      body: "hello",
      statusCallback: "https://example.com/status",
    }),
    {
      to: "+15555550123",
      from: "+18885550123",
      body: "hello",
      statusCallback: "https://example.com/status",
    },
  );
});

test("scheduled Twilio payloads require a Messaging Service and use fixed sendAt", () => {
  const sendAt = new Date("2026-01-15T13:00:00.000Z");
  assert.deepEqual(
    buildTwilioMessageCreateInput({
      to: "+15555550123",
      from: "+18885550123",
      body: "hello",
      statusCallback: "https://example.com/status",
      sendAt,
      messagingServiceSid: "MG123",
    }),
    {
      to: "+15555550123",
      from: "+18885550123",
      body: "hello",
      statusCallback: "https://example.com/status",
      messagingServiceSid: "MG123",
      scheduleType: "fixed",
      sendAt,
    },
  );
  assert.throws(
    () =>
      buildTwilioMessageCreateInput({
        to: "+15555550123",
        from: "+18885550123",
        body: "hello",
        statusCallback: "https://example.com/status",
        sendAt,
      }),
    /TWILIO_MESSAGING_SERVICE_SID/,
  );
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
