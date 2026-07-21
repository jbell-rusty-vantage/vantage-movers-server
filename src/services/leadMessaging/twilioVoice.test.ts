import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  DEFAULT_TWILIO_VOICE_FORWARD_TO,
  getTwilioVoiceConfig,
} from "../../config/domain/leadMessaging";
import {
  buildTwilioVoiceCompletedResponse,
  buildTwilioVoiceForwardResponse,
  isExpectedTwilioVoiceDestination,
} from "./twilioVoice";

const original = Object.fromEntries(
  ["TWILIO_FROM_NUMBER", "TWILIO_VOICE_FORWARD_TO", "TWILIO_VOICE_WEBHOOK_URL"].map(
    (name) => [name, process.env[name]],
  ),
);

afterEach(() => {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("builds signed-callback-compatible TwiML that forwards to RingCentral", () => {
  process.env.TWILIO_FROM_NUMBER = "+15551234567";
  process.env.TWILIO_VOICE_FORWARD_TO = "+18884862499";
  process.env.TWILIO_VOICE_WEBHOOK_URL = "https://api.example.com/api/webhooks/twilio/voice";

  const xml = buildTwilioVoiceForwardResponse();
  assert.match(xml, /<Dial[^>]*answerOnBridge="true"/);
  assert.match(xml, /action="https:\/\/api\.example\.com\/api\/webhooks\/twilio\/voice\/completed"/);
  assert.match(xml, /statusCallback="https:\/\/api\.example\.com\/api\/webhooks\/twilio\/voice\/status"/);
  assert.match(xml, />\+18884862499<\/Number>/);
  assert.equal(isExpectedTwilioVoiceDestination("+1 (555) 123-4567"), true);
});

test("defaults forwarding to the Vantage RingCentral number", () => {
  process.env.TWILIO_FROM_NUMBER = "+15551234567";
  delete process.env.TWILIO_VOICE_FORWARD_TO;
  delete process.env.TWILIO_VOICE_WEBHOOK_URL;
  assert.equal(getTwilioVoiceConfig().forwardTo, DEFAULT_TWILIO_VOICE_FORWARD_TO);
});

test("rejects a forwarding loop", () => {
  process.env.TWILIO_FROM_NUMBER = "+18884862499";
  process.env.TWILIO_VOICE_FORWARD_TO = "+18884862499";
  assert.throws(() => getTwilioVoiceConfig(), /cannot equal/);
});

test("completed callback hangs up the parent call", () => {
  assert.match(buildTwilioVoiceCompletedResponse(), /<Hangup\/>/);
});
