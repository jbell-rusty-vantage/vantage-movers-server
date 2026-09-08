import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { evaluateEmployeeBookingMatch } from "./leadMatchEvaluator";
import type { EvaluatedLeadCandidate, PreparedEmployeeBookingSubmission } from "./types";

const originalRules = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;

afterEach(() => {
  if (originalRules === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = originalRules;
});

const formSubmission: PreparedEmployeeBookingSubmission = {
  submissionId: "550e8400-e29b-41d4-a716-446655440000",
  leadName: "Jane Customer",
  normalizedLeadName: "jane customer",
  phoneNumber: "2125550101",
  normalizedPhoneNumber: "2125550101",
  email: "jane@example.test",
  normalizedEmail: "jane@example.test",
  lid: "EBR-LID-001",
  normalizedLid: "EBR-LID-001",
  jobNo: "EBR-JOB-001",
  normalizedJobNo: "EBR JOB 001",
  binderAmount: 1200,
  depositAmount: 500,
  merchant: "Card",
  agent: "Agent One",
  splitAgent: "Agent Two",
  bookDate: new Date("2026-07-23T00:00:00.000Z"),
  sourceDisplayLabel: "Top10 Forms",
  sourceAssignment: {
    lead_source_company: {} as any,
    source_granularity_id: {} as any,
    source_granularity_key: "top10_form",
    source_company: "top10_leads",
    source_company_label_snapshot: "Top10",
    source_granularity_label_snapshot: "Top10 Forms",
    crm_source_label_snapshot: "Top10 Forms",
    channel: "form",
  },
  local: "long_distance",
  agentAllocations: [],
};

const callSubmission: PreparedEmployeeBookingSubmission = {
  ...formSubmission,
  sourceAssignment: {
    ...formSubmission.sourceAssignment,
    channel: "call",
  },
};

function candidate(
  overrides: Partial<EvaluatedLeadCandidate> &
    Pick<EvaluatedLeadCandidate, "leadId" | "leadModel" | "matchMethods">,
): EvaluatedLeadCandidate {
  return {
    confidence: overrides.matchMethods.includes("job_no") ? "high" : "medium",
    eligibility: "eligible",
    sourceCompatibility: "exact_granularity",
    warnings: [],
    snapshot: {},
    ...overrides,
  };
}

test("evaluateEmployeeBookingMatch auto-links a unique Call Lead Job Number", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e1111111111",
      leadModel: "CallLead",
      matchMethods: ["job_no"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(callSubmission, candidates);
  assert.equal(result.kind, "linked");
  if (result.kind === "linked") {
    assert.equal(result.rule, "call_job_no_exact");
    assert.equal(result.leadModel, "CallLead");
    assert.equal(result.leadId, "64c0f47e4d8b0e1111111111");
  }
});

test("evaluateEmployeeBookingMatch auto-links a unique Form Lead Job Number on form channel", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e1212121212",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["job_no"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(formSubmission, candidates);
  assert.equal(result.kind, "linked");
  if (result.kind === "linked") {
    assert.equal(result.rule, "form_job_no_exact");
    assert.equal(result.leadModel, "FormLead");
    assert.equal(result.leadId, "64c0f47e4d8b0e1212121212");
  }
});

test("evaluateEmployeeBookingMatch treats two Call Leads with the same Job Number as multiple_matches", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e3333333333",
      leadModel: "CallLead",
      matchMethods: ["job_no"],
    }),
    candidate({
      leadId: "64c0f47e4d8b0e4444444444",
      leadModel: "CallLead",
      matchMethods: ["job_no"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(callSubmission, candidates);
  assert.deepEqual(result, {
    kind: "pending",
    reason: "multiple_matches",
    candidates,
  });
});

test("evaluateEmployeeBookingMatch leaves same-phone no-job as pending no_match", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e1313131313",
      leadModel: "CallLead",
      matchMethods: ["phone"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(callSubmission, candidates);
  assert.deepEqual(result, {
    kind: "pending",
    reason: "no_match",
    candidates,
  });
});

test("evaluateEmployeeBookingMatch never auto-links LID, email, or phone under Exact Job Booking Attach", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e1414141414",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["lid", "phone", "email", "normalized_name"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(formSubmission, candidates);
  assert.deepEqual(result, {
    kind: "pending",
    reason: "no_match",
    candidates,
  });
});

test("evaluateEmployeeBookingMatch never auto-links when candidate query overflowed", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e1111111111",
      leadModel: "CallLead",
      confidence: "high",
      matchMethods: ["job_no"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(callSubmission, candidates, true);

  assert.deepEqual(result, {
    kind: "pending",
    reason: "multiple_matches",
    candidates,
  });
});

test("evaluateEmployeeBookingMatch returns channel_conflict for opposite-channel-only Job Number", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e2222222222",
      leadModel: "CallLead",
      confidence: "high",
      matchMethods: ["job_no"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(formSubmission, candidates);
  assert.deepEqual(result, {
    kind: "pending",
    reason: "channel_conflict",
    candidates,
  });
});

test("evaluateEmployeeBookingMatch respects none policy", async () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "none";
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e3333333333",
      leadModel: "CallLead",
      confidence: "high",
      matchMethods: ["job_no"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(callSubmission, candidates);
  assert.equal(result.kind, "pending");
  if (result.kind === "pending") {
    assert.equal(result.reason, "no_match");
  }
});

test("evaluateEmployeeBookingMatch treats contradictory phone/name signals as a hard conflict", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e5555555555",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["phone", "email"],
    }),
    candidate({
      leadId: "64c0f47e4d8b0e5555555555",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["phone", "normalized_name"],
      warnings: ["name_contradiction"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(formSubmission, candidates);

  assert.deepEqual(result, {
    kind: "pending",
    reason: "identity_conflict",
    candidates,
  });
});

test("evaluateEmployeeBookingMatch blocks Job Number and Phone pointing to different Leads", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e5555555555",
      leadModel: "CallLead",
      confidence: "high",
      matchMethods: ["job_no"],
    }),
    candidate({
      leadId: "64c0f47e4d8b0e6666666666",
      leadModel: "CallLead",
      matchMethods: ["phone"],
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(callSubmission, candidates);
  assert.equal(result.kind, "pending");
  if (result.kind === "pending") {
    assert.equal(result.reason, "identity_conflict");
  }
});

test("evaluateEmployeeBookingMatch does not auto-link a different same-company granularity", async () => {
  const candidates: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e7777777777",
      leadModel: "CallLead",
      confidence: "high",
      matchMethods: ["job_no"],
      sourceCompatibility: "same_company",
      snapshot: { source_granularity_key: "another-call-source" },
    }),
  ];

  const result = await evaluateEmployeeBookingMatch(callSubmission, candidates);
  assert.equal(result.kind, "pending");
  if (result.kind === "pending") {
    assert.equal(result.reason, "source_conflict");
  }
});

test("evaluateEmployeeBookingMatch rematch attaches only after a unique job appears", async () => {
  const phoneOnly: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e8888888888",
      leadModel: "CallLead",
      matchMethods: ["phone"],
    }),
  ];
  const phoneThenJob: EvaluatedLeadCandidate[] = [
    candidate({
      leadId: "64c0f47e4d8b0e8888888888",
      leadModel: "CallLead",
      confidence: "high",
      matchMethods: ["phone", "job_no"],
    }),
  ];

  const before = await evaluateEmployeeBookingMatch(callSubmission, phoneOnly);
  assert.deepEqual(before, {
    kind: "pending",
    reason: "no_match",
    candidates: phoneOnly,
  });

  const after = await evaluateEmployeeBookingMatch(callSubmission, phoneThenJob);
  assert.equal(after.kind, "linked");
  if (after.kind === "linked") {
    assert.equal(after.rule, "call_job_no_exact");
    assert.equal(after.leadId, "64c0f47e4d8b0e8888888888");
  }
});
