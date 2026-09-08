import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import {
  getEmployeeBookingMatchingConfig,
  snapshotEmployeeBookingAutoMatchPolicy,
} from "../../config/domain";
import { evaluateEmployeeBookingMatch } from "./leadMatchEvaluator";
import { runDueBookingLeadRematches } from "./reconciliationRematch.service";
import type { EvaluatedLeadCandidate, PreparedEmployeeBookingSubmission } from "./types";

const originalMongoUri = process.env.MONGO_URI;
const originalEnabled = process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED;
const originalRules = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
const originalVersion = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;
const originalConnect = mongoose.connect;

afterEach(() => {
  if (originalMongoUri === undefined) delete process.env.MONGO_URI;
  else process.env.MONGO_URI = originalMongoUri;
  if (originalEnabled === undefined) {
    delete process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED;
  } else {
    process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED = originalEnabled;
  }
  if (originalRules === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = originalRules;
  if (originalVersion === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION = originalVersion;
  (mongoose as any).connect = originalConnect;
  global.__mongooseCache = undefined;
});

test("cold rematch connects to Mongo before attempting a lease or model operation", async () => {
  process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED = "true";
  process.env.MONGO_URI = "mongodb://cold-path.invalid/vantagemovers";
  let connectCalls = 0;
  (mongoose as any).connect = async () => {
    connectCalls += 1;
    throw new Error("cold connection refused");
  };

  await assert.rejects(
    () => runDueBookingLeadRematches({ actor: "cron" }),
    /Database temporarily unavailable/,
  );
  assert.equal(connectCalls, 1);
});

test("rematch snapshots Exact Job Booking Attach, not the retired five-rule list", () => {
  delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;
  delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
  assert.deepEqual(getEmployeeBookingMatchingConfig(), {
    policyVersion: "exact-job-v1",
    enabledRules: ["call_job_no_exact", "form_job_no_exact"],
  });
  assert.deepEqual(snapshotEmployeeBookingAutoMatchPolicy(), {
    auto_match_policy_version: "exact-job-v1",
    enabled_auto_match_rules: ["call_job_no_exact", "form_job_no_exact"],
  });
});

test("rematch evaluator attaches only when a unique Call Lead job appears", async () => {
  const submission: PreparedEmployeeBookingSubmission = {
    submissionId: "550e8400-e29b-41d4-a716-446655440000",
    leadName: "Jane Customer",
    normalizedLeadName: "jane customer",
    phoneNumber: "2125550101",
    normalizedPhoneNumber: "2125550101",
    jobNo: "EBR-JOB-001",
    normalizedJobNo: "EBR JOB 001",
    binderAmount: 1200,
    depositAmount: 500,
    merchant: "Card",
    agent: "Agent One",
    bookDate: new Date("2026-07-23T00:00:00.000Z"),
    sourceDisplayLabel: "Inbound",
    sourceAssignment: {
      lead_source_company: {} as any,
      source_granularity_id: {} as any,
      source_granularity_key: "inbound_call",
      source_company: "inbound",
      source_company_label_snapshot: "Inbound",
      source_granularity_label_snapshot: "Inbound",
      crm_source_label_snapshot: "Inbound",
      channel: "call",
    },
    local: "long_distance",
    agentAllocations: [],
  };
  const phoneOnly: EvaluatedLeadCandidate[] = [
    {
      leadId: "64c0f47e4d8b0e8888888888",
      leadModel: "CallLead",
      confidence: "medium",
      matchMethods: ["phone"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: [],
      snapshot: {},
    },
  ];
  const uniqueJob: EvaluatedLeadCandidate[] = [
    {
      ...phoneOnly[0]!,
      confidence: "high",
      matchMethods: ["phone", "job_no"],
    },
  ];

  const phoneResult = await evaluateEmployeeBookingMatch(submission, phoneOnly);
  assert.deepEqual(phoneResult, {
    kind: "pending",
    reason: "no_match",
    candidates: phoneOnly,
  });

  const jobResult = await evaluateEmployeeBookingMatch(submission, uniqueJob);
  assert.equal(jobResult.kind, "linked");
  if (jobResult.kind === "linked") {
    assert.equal(jobResult.rule, "call_job_no_exact");
    assert.equal(jobResult.leadId, "64c0f47e4d8b0e8888888888");
  }
});
