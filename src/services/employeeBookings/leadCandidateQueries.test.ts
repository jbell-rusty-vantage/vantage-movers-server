import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Types } from "mongoose";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { queryEmployeeBookingCandidates } from "./leadCandidateQueries";
import type { PreparedEmployeeBookingSubmission } from "./types";

const originalFormFind = FormLead.find;
const originalCallFind = CallLead.find;

afterEach(() => {
  (FormLead as any).find = originalFormFind;
  (CallLead as any).find = originalCallFind;
});

const submission: PreparedEmployeeBookingSubmission = {
  submissionId: "550e8400-e29b-41d4-a716-446655440000",
  leadName: "Jane Customer",
  normalizedLeadName: "jane customer",
  phoneNumber: "2125550101",
  normalizedPhoneNumber: "2125550101",
  lid: "EBR-LID-001",
  normalizedLid: "EBR-LID-001",
  jobNo: "EBR-JOB-001",
  normalizedJobNo: "EBR JOB 001",
  binderAmount: 1200,
  depositAmount: 500,
  merchant: "Card",
  agent: "Agent One",
  bookDate: new Date("2026-07-23T00:00:00.000Z"),
  sourceDisplayLabel: "Top10 Forms",
  sourceAssignment: {
    lead_source_company: new Types.ObjectId("64c0f47e4d8b0e1111111111"),
    source_granularity_id: new Types.ObjectId("64c0f47e4d8b0e2222222222"),
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

test("candidate query detects the 26th matching lead instead of proving false uniqueness", async () => {
  const docs = Array.from({ length: 26 }, (_, index) => ({
    _id: new Types.ObjectId(),
    lid: "EBR-LID-001",
    source_company: "top10_leads",
    source_granularity_key: "top10_form",
    ...(index === 25 ? { duplicate: false } : { duplicate: true }),
  }));
  const limits: number[] = [];
  (FormLead as any).find = (filter: Record<string, unknown>) =>
    buildQuery("normalized_lid" in filter ? docs : [], limits);
  (CallLead as any).find = () => buildQuery([], limits);

  const result = await queryEmployeeBookingCandidates(submission);

  assert.deepEqual(limits, [26, 26, 26, 26]);
  assert.equal(result.hasOverflow, true);
  assert.equal(result.candidates.length, 25);
  assert.equal(
    result.candidates.filter((candidate) => candidate.eligibility === "eligible").length,
    0,
  );
});

function buildQuery<T>(docs: T[], limits: number[]) {
  return {
    limit(limit: number) {
      limits.push(limit);
      return this;
    },
    exec: async () => docs,
  };
}
