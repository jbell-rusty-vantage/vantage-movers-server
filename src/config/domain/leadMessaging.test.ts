import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getLeadMessagingMode,
  isGranotLeadCreatedSmsEnabled,
  isLeadMessagingQuietHoursEnabled,
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
  "GRANOT_LEAD_CREATED_SMS_ENABLED",
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

test("Granot create-if-missing SMS stays off unless the env flag is an explicit boolean true", () => {
  delete process.env.GRANOT_LEAD_CREATED_SMS_ENABLED;
  assert.equal(isGranotLeadCreatedSmsEnabled(), false);
  process.env.GRANOT_LEAD_CREATED_SMS_ENABLED = "false";
  assert.equal(isGranotLeadCreatedSmsEnabled(), false);
  process.env.GRANOT_LEAD_CREATED_SMS_ENABLED = "true";
  assert.equal(isGranotLeadCreatedSmsEnabled(), true);
  process.env.GRANOT_LEAD_CREATED_SMS_ENABLED = "yes";
  assert.throws(() => isGranotLeadCreatedSmsEnabled(), /explicit boolean/);
});

test("quiet-hours scheduling is off unless the env flag is exactly true", () => {
  delete process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED;
  assert.equal(isLeadMessagingQuietHoursEnabled(), false);
  process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED = "false";
  assert.equal(isLeadMessagingQuietHoursEnabled(), false);
  process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED = " TRUE ";
  assert.equal(isLeadMessagingQuietHoursEnabled(), true);
});
