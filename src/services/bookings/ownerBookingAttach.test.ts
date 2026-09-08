import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import type { CreateBookedLeadFromSourceInput } from "../../validation/v1.validation";
import type {
  EvaluatedLeadCandidate,
  SourceAssignmentSnapshot,
} from "../employeeBookings/types";
import {
  buildOwnerPendingCasePayload,
  evaluateOwnerCallLeadMatch,
  ownerBookingSubmissionId,
  ownerSnapshotLeadName,
  ownerSnapshotPhone,
  ownerSourceChannel,
} from "./ownerBookingAttach";

const sourceAssignment: SourceAssignmentSnapshot = {
  lead_source_company: new Types.ObjectId("64c0f47e4d8b0e1111111111"),
  source_granularity_id: new Types.ObjectId("64c0f47e4d8b0e2222222222"),
  source_granularity_key: "best_relocation_inbound",
  source_company: "best_relocation_leads",
  source_company_label_snapshot: "Best Relocation",
  source_granularity_label_snapshot: "Best Relocation Inbounds",
  crm_source_label_snapshot: "Best Relocation Inbounds",
  channel: "call",
};

const callInput: CreateBookedLeadFromSourceInput = {
  lead_type: "CallLead",
  call_job_no: "P5556278",
  book_date: new Date("2026-05-21T00:00:00.000Z"),
  agent: "JOSH",
  binder_amount: 900,
  deposit_amount: 900,
  merchant: "Card",
  source_company: "Best Relocation Inbounds",
};

function candidate(
  overrides: Partial<EvaluatedLeadCandidate> &
    Pick<EvaluatedLeadCandidate, "leadId" | "leadModel" | "matchMethods">,
): EvaluatedLeadCandidate {
  return {
    confidence: "high",
    eligibility: "eligible",
    sourceCompatibility: "exact_granularity",
    warnings: [],
    snapshot: { job_no: "P5556278", source_company: "best_relocation_leads" },
    ...overrides,
  };
}

const resolveSource = async () => sourceAssignment;

test("owner snapshot uses Call phone or customer phone, else not provided", () => {
  assert.equal(ownerSnapshotPhone("2125550101", "999"), "2125550101");
  assert.equal(ownerSnapshotPhone(undefined, "2125550101"), "2125550101");
  assert.equal(ownerSnapshotPhone(), "not provided");
  assert.equal(ownerSnapshotLeadName("Jane"), "Jane");
  assert.equal(ownerSnapshotLeadName(), "Unknown");
  assert.equal(ownerSourceChannel("call", "Best Relocation Forms"), "call");
  assert.equal(ownerSourceChannel("form", "Best Relocation Inbounds"), "call");
  assert.equal(ownerSourceChannel("form", "Best Relocation Forms"), "form");
  assert.equal(ownerBookingSubmissionId("P5556278"), "owner-booking:P5556278");
});

test("evaluateOwnerCallLeadMatch links a unique Call Lead Job Number", async () => {
  const result = await evaluateOwnerCallLeadMatch(callInput, undefined, {
    resolveSource,
    queryCandidates: async () => ({
      candidates: [
        candidate({
          leadId: "64c0f47e4d8b0e3333333333",
          leadModel: "CallLead",
          matchMethods: ["job_no"],
        }),
      ],
      hasOverflow: false,
    }),
  });

  assert.equal(result.kind, "linked");
  if (result.kind === "linked") {
    assert.equal(result.leadModel, "CallLead");
    assert.equal(result.rule, "call_job_no_exact");
  }
});

test("evaluateOwnerCallLeadMatch is pending multiple_matches for two Call Leads with the same job", async () => {
  const result = await evaluateOwnerCallLeadMatch(callInput, undefined, {
    resolveSource,
    queryCandidates: async () => ({
      candidates: [
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
      ],
      hasOverflow: false,
    }),
  });

  assert.equal(result.kind, "pending");
  if (result.kind === "pending") {
    assert.equal(result.reason, "multiple_matches");
  }
});

test("evaluateOwnerCallLeadMatch is pending no_match when no Call Lead has the job", async () => {
  const result = await evaluateOwnerCallLeadMatch(callInput, undefined, {
    resolveSource,
    queryCandidates: async () => ({ candidates: [], hasOverflow: false }),
  });

  assert.equal(result.kind, "pending");
  if (result.kind === "pending") assert.equal(result.reason, "no_match");
});

test("evaluateOwnerCallLeadMatch does not attach on phone of a different Call Lead", async () => {
  const result = await evaluateOwnerCallLeadMatch(
    { ...callInput, call_phone_number: "2125550199" },
    undefined,
    {
      resolveSource,
      queryCandidates: async () => ({
        candidates: [
          candidate({
            leadId: "64c0f47e4d8b0e3333333333",
            leadModel: "CallLead",
            matchMethods: ["job_no"],
          }),
          candidate({
            leadId: "64c0f47e4d8b0e5555555555",
            leadModel: "CallLead",
            matchMethods: ["phone"],
            confidence: "medium",
            snapshot: { phone_number: "2125550199" },
          }),
        ],
        hasOverflow: false,
      }),
    },
  );

  assert.equal(result.kind, "pending");
  if (result.kind === "pending") {
    assert.ok(
      result.reason === "identity_conflict" || result.reason === "no_match",
    );
  }
});

test("Owner pending case snapshot fills spec §4.6 fields and origin owner_booking", () => {
  const payload = buildOwnerPendingCasePayload({
    bookingId: new Types.ObjectId("64c0f47e4d8b0e6666666666"),
    jobNo: "P5556278",
    phoneNumber: "not provided",
    leadName: "Unknown",
    binderAmount: 900,
    depositAmount: 900,
    merchant: "Card",
    agent: "JOSH",
    bookDate: new Date("2026-05-21T00:00:00.000Z"),
    sourceAssignment,
    reason: "no_match",
  });

  assert.equal(payload.origin, "owner_booking");
  assert.equal(payload.status, "pending");
  assert.equal(payload.reason, "no_match");
  assert.equal(payload.submission.submission_id, "owner-booking:P5556278");
  assert.equal(payload.submission.job_no, "P5556278");
  assert.equal(payload.submission.phone_number, "not provided");
  assert.equal(payload.submission.lead_name, "Unknown");
  assert.equal(payload.submission.source_assignment.channel, "call");
  assert.equal("lid" in payload.submission, false);
});
