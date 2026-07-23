import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getEmployeeBookingMatchingConfig,
  parseEmployeeBookingAutoMatchRules,
} from "./employeeBookingMatching";

const originalRules = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
const originalVersion = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;

afterEach(() => {
  if (originalRules === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = originalRules;
  if (originalVersion === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION = originalVersion;
});

test("parseEmployeeBookingAutoMatchRules preserves order", () => {
  assert.deepEqual(parseEmployeeBookingAutoMatchRules("call_job_no_exact,form_lid_exact"), [
    "call_job_no_exact",
    "form_lid_exact",
  ]);
});

test("parseEmployeeBookingAutoMatchRules accepts none", () => {
  assert.deepEqual(parseEmployeeBookingAutoMatchRules("none"), []);
});

test("parseEmployeeBookingAutoMatchRules rejects duplicates", () => {
  assert.throws(
    () => parseEmployeeBookingAutoMatchRules("form_lid_exact,form_lid_exact"),
    /Duplicate employee auto-match rule/,
  );
});

test("getEmployeeBookingMatchingConfig reads env values", () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION = "custom-v1";
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "channel_phone_exact";
  assert.deepEqual(getEmployeeBookingMatchingConfig(), {
    policyVersion: "custom-v1",
    enabledRules: ["channel_phone_exact"],
  });
});
