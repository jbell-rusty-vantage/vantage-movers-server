import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getLeadMessagingCredentials,
  getLeadMessagingAllowedCountryPrefixes,
  getLeadMessagingDestinationCooldownMs,
  getLeadMessagingHourlyLimit,
  getLeadMessagingMode,
  getLeadMessagingQueueTopic,
  isLeadMessagingQuietHoursEnabled,
  shouldPublishLeadMessagingQueue,
} from "./leadMessaging";

const KEYS = [
  "LEAD_MESSAGING_MODE",
  "LEAD_MESSAGING_QUEUE_TOPIC",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_PRIMARY_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_STATUS_CALLBACK_URL",
  "TWILIO_MESSAGING_SERVICE_SID",
  "VERCEL_ENV",
  "LEAD_MESSAGING_ALLOWED_COUNTRY_PREFIXES",
  "LEAD_MESSAGING_DESTINATION_COOLDOWN_MINUTES",
  "LEAD_MESSAGING_HOURLY_LIMIT",
  "LEAD_MESSAGING_QUIET_HOURS_ENABLED",
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("lead messaging mode defaults invalid and missing values to disabled", () => {
  delete process.env.LEAD_MESSAGING_MODE;
  assert.equal(getLeadMessagingMode(), "disabled");
  process.env.LEAD_MESSAGING_MODE = "unknown";
  assert.equal(getLeadMessagingMode(), "disabled");
  process.env.LEAD_MESSAGING_MODE = " INLINE ";
  assert.equal(getLeadMessagingMode(), "inline");
});

test("lead messaging credentials use only definite environment variables", () => {
  process.env.TWILIO_ACCOUNT_SID = "AC123";
  process.env.TWILIO_PRIMARY_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM_NUMBER = "+18885550123";
  process.env.TWILIO_STATUS_CALLBACK_URL =
    "https://example.com/api/webhooks/twilio/message-status";
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  assert.deepEqual(getLeadMessagingCredentials(), {
    accountSid: "AC123",
    authToken: "token",
    fromNumber: "+18885550123",
    statusCallbackUrl:
      "https://example.com/api/webhooks/twilio/message-status",
    messagingServiceSid: null,
  });
  process.env.TWILIO_MESSAGING_SERVICE_SID = " MG123 ";
  assert.equal(getLeadMessagingCredentials().messagingServiceSid, "MG123");
});

test("lead messaging queue topic is environment scoped and test-safe", () => {
  delete process.env.LEAD_MESSAGING_QUEUE_TOPIC;
  process.env.VERCEL_ENV = "production";
  assert.equal(getLeadMessagingQueueTopic(), "lead-messaging-events");
  process.env.VERCEL_ENV = "preview";
  assert.equal(getLeadMessagingQueueTopic(), "lead-messaging-events-dev");
  assert.equal(shouldPublishLeadMessagingQueue(), false);
});

test("quiet-hours scheduling is off unless the env flag is exactly true", () => {
  delete process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED;
  assert.equal(isLeadMessagingQuietHoursEnabled(), false);
  process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED = "false";
  assert.equal(isLeadMessagingQuietHoursEnabled(), false);
  process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED = " TRUE ";
  assert.equal(isLeadMessagingQuietHoursEnabled(), true);
});

test("lead messaging abuse guards have safe defaults and env overrides", () => {
  delete process.env.LEAD_MESSAGING_ALLOWED_COUNTRY_PREFIXES;
  delete process.env.LEAD_MESSAGING_DESTINATION_COOLDOWN_MINUTES;
  delete process.env.LEAD_MESSAGING_HOURLY_LIMIT;
  assert.deepEqual(getLeadMessagingAllowedCountryPrefixes(), ["+1"]);
  assert.equal(getLeadMessagingDestinationCooldownMs(), 15 * 60_000);
  assert.equal(getLeadMessagingHourlyLimit(), 200);

  process.env.LEAD_MESSAGING_ALLOWED_COUNTRY_PREFIXES = "+1,+44";
  process.env.LEAD_MESSAGING_DESTINATION_COOLDOWN_MINUTES = "30";
  process.env.LEAD_MESSAGING_HOURLY_LIMIT = "50";
  assert.deepEqual(getLeadMessagingAllowedCountryPrefixes(), ["+1", "+44"]);
  assert.equal(getLeadMessagingDestinationCooldownMs(), 30 * 60_000);
  assert.equal(getLeadMessagingHourlyLimit(), 50);
});
