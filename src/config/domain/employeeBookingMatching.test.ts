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

test("parseEmployeeBookingAutoMatchRules rejects retired phone, LID, and email rules", () => {
  for (const rule of [
    "channel_phone_exact",
    "form_lid_exact",
    "form_contact_triple_exact",
    "form_email_phone_exact",
  ]) {
    assert.throws(
      () => parseEmployeeBookingAutoMatchRules(rule),
      /Unknown employee auto-match rule/,
    );
  }
});

test("getEmployeeBookingMatchingConfig defaults to Exact Job Booking Attach", () => {
  delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;
  delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
  assert.deepEqual(getEmployeeBookingMatchingConfig(), {
    policyVersion: "exact-job-v1",
    enabledRules: ["call_job_no_exact", "form_job_no_exact"],
  });
});
