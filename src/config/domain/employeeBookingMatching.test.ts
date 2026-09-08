import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getEmployeeBookingMatchingConfig,
  parseEmployeeBookingAutoMatchRules,
  snapshotEmployeeBookingAutoMatchPolicy,
} from "./employeeBookingMatching";

const originalRules = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
const originalVersion = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;

afterEach(() => {
  if (originalRules === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = originalRules;
  if (originalVersion === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION = originalVersion;
});

test("parseEmployeeBookingAutoMatchRules preserves Exact Job Booking Attach order", () => {
  assert.deepEqual(
    parseEmployeeBookingAutoMatchRules("call_job_no_exact,form_job_no_exact"),
    ["call_job_no_exact", "form_job_no_exact"],
  );
});

test("parseEmployeeBookingAutoMatchRules accepts none", () => {
  assert.deepEqual(parseEmployeeBookingAutoMatchRules("none"), []);
});

test("parseEmployeeBookingAutoMatchRules rejects duplicates", () => {
  assert.throws(
    () => parseEmployeeBookingAutoMatchRules("call_job_no_exact,call_job_no_exact"),
    /Duplicate employee auto-match rule/,
  );
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

test("getEmployeeBookingMatchingConfig reads env values", () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION = "custom-v1";
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "form_job_no_exact";
  assert.deepEqual(getEmployeeBookingMatchingConfig(), {
    policyVersion: "custom-v1",
    enabledRules: ["form_job_no_exact"],
  });
});

test("snapshotEmployeeBookingAutoMatchPolicy uses parsed config, not a raw env string", () => {
  delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "none";
  assert.deepEqual(snapshotEmployeeBookingAutoMatchPolicy(), {
    auto_match_policy_version: "exact-job-v1",
    enabled_auto_match_rules: [],
  });
});
