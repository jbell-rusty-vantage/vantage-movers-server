import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import type { CreateBookedLeadFromSourceInput } from "../../validation/v1.validation";
import type {
  EvaluatedLeadCandidate,
  SourceAssignmentSnapshot,
} from "../employeeBookings/types";
import {
  evaluateOwnerCallLeadMatch,
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
