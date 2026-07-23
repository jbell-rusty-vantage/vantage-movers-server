import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { evaluateEmployeeBookingMatch } from "./leadMatchEvaluator";
import type { EvaluatedLeadCandidate, PreparedEmployeeBookingSubmission } from "./types";

const originalRules = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;

afterEach(() => {
  if (originalRules === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = originalRules;
});

const baseSubmission: PreparedEmployeeBookingSubmission = {
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

test("evaluateEmployeeBookingMatch auto-links a unique form LID candidate", async () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "form_lid_exact";
  const candidates: EvaluatedLeadCandidate[] = [
    {
      leadId: "64c0f47e4d8b0e1111111111",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["lid"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: [],
      snapshot: {},
    },
  ];

  const result = await evaluateEmployeeBookingMatch(baseSubmission, candidates);
  assert.equal(result.kind, "linked");
  if (result.kind === "linked") {
    assert.equal(result.rule, "form_lid_exact");
    assert.equal(result.leadModel, "FormLead");
  }
});

test("evaluateEmployeeBookingMatch never auto-links when candidate query overflowed", async () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "form_lid_exact";
  const candidates: EvaluatedLeadCandidate[] = [
    {
      leadId: "64c0f47e4d8b0e1111111111",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["lid"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: [],
      snapshot: {},
    },
  ];

  const result = await evaluateEmployeeBookingMatch(baseSubmission, candidates, true);

  assert.deepEqual(result, {
    kind: "pending",
    reason: "multiple_matches",
    candidates,
  });
});

test("evaluateEmployeeBookingMatch returns channel_conflict for opposite-channel only", async () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "channel_phone_exact";
  const candidates: EvaluatedLeadCandidate[] = [
    {
      leadId: "64c0f47e4d8b0e2222222222",
      leadModel: "CallLead",
      confidence: "medium",
      matchMethods: ["phone"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: [],
      snapshot: {},
    },
  ];

  const result = await evaluateEmployeeBookingMatch(baseSubmission, candidates);
  assert.deepEqual(result, {
    kind: "pending",
    reason: "channel_conflict",
    candidates,
  });
});

test("evaluateEmployeeBookingMatch respects none policy", async () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "none";
  const candidates: EvaluatedLeadCandidate[] = [
    {
      leadId: "64c0f47e4d8b0e3333333333",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["lid"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: [],
      snapshot: {},
    },
  ];

  const result = await evaluateEmployeeBookingMatch(baseSubmission, candidates);
  assert.equal(result.kind, "pending");
  if (result.kind === "pending") {
    assert.equal(result.reason, "no_match");
  }
});

test("evaluateEmployeeBookingMatch allows form fallback rules when LID was submitted but matched nothing", async () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "form_contact_triple_exact";
  const candidates: EvaluatedLeadCandidate[] = [
    {
      leadId: "64c0f47e4d8b0e4444444444",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["phone", "email", "normalized_name"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: [],
      snapshot: {},
    },
  ];

  const result = await evaluateEmployeeBookingMatch(baseSubmission, candidates);
  assert.equal(result.kind, "linked");
  if (result.kind === "linked") {
    assert.equal(result.rule, "form_contact_triple_exact");
  }
});

test("evaluateEmployeeBookingMatch treats contradictory phone/name signals as a hard conflict after LID miss", async () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "channel_phone_exact";
  const candidates: EvaluatedLeadCandidate[] = [
    {
      leadId: "64c0f47e4d8b0e5555555555",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["phone", "email"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: [],
      snapshot: {},
    },
    {
      leadId: "64c0f47e4d8b0e5555555555",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["phone", "normalized_name"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: ["name_contradiction"],
      snapshot: {},
    },
  ];

  const submission = {
    ...baseSubmission,
    normalizedLid: "LID-DOES-NOT-MATCH",
  };
  const result = await evaluateEmployeeBookingMatch(submission, candidates);

  assert.deepEqual(result, {
    kind: "pending",
    reason: "identity_conflict",
    candidates,
  });
});

test("evaluateEmployeeBookingMatch blocks LID and Phone pointing to different Leads", async () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "form_lid_exact";
  const candidates: EvaluatedLeadCandidate[] = [
    {
      leadId: "64c0f47e4d8b0e5555555555",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["lid"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: [],
      snapshot: {},
    },
    {
      leadId: "64c0f47e4d8b0e6666666666",
      leadModel: "FormLead",
      confidence: "medium",
      matchMethods: ["phone"],
      eligibility: "eligible",
      sourceCompatibility: "exact_granularity",
      warnings: [],
      snapshot: {},
    },
  ];

  const result = await evaluateEmployeeBookingMatch(baseSubmission, candidates);
  assert.equal(result.kind, "pending");
  if (result.kind === "pending") {
    assert.equal(result.reason, "identity_conflict");
  }
});

test("evaluateEmployeeBookingMatch does not auto-link a different same-company granularity", async () => {
  process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = "form_lid_exact";
  const candidates: EvaluatedLeadCandidate[] = [
    {
      leadId: "64c0f47e4d8b0e7777777777",
      leadModel: "FormLead",
      confidence: "high",
      matchMethods: ["lid"],
      eligibility: "eligible",
      sourceCompatibility: "same_company",
      warnings: [],
      snapshot: { source_granularity_key: "another-form-source" },
    },
  ];

  const result = await evaluateEmployeeBookingMatch(baseSubmission, candidates);
  assert.equal(result.kind, "pending");
  if (result.kind === "pending") {
    assert.equal(result.reason, "source_conflict");
  }
});
