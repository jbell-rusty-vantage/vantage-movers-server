// Tests for: booking lead reconciliation service — list/detail response shape
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Types } from "mongoose";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { FormLead } from "../../models/FormLead";
import {
  getBookingLeadReconciliationCase,
  listBookingLeadReconciliationCases,
  searchBookingLeadCandidates,
} from "./bookingLeadReconciliation.service";

type ChainResult<T> = {
  sort: (value: unknown) => ChainResult<T>;
  limit: (value: number) => ChainResult<T>;
  lean: () => ChainResult<T>;
  populate: (value: string) => ChainResult<T>;
  exec: () => Promise<T>;
};

const originalFind = BookingLeadReconciliationCase.find;
const originalFindById = BookingLeadReconciliationCase.findById;
const originalFormLeadFind = FormLead.find;

afterEach(() => {
  (BookingLeadReconciliationCase as any).find = originalFind;
  (BookingLeadReconciliationCase as any).findById = originalFindById;
  (FormLead as any).find = originalFormLeadFind;
});

test("listBookingLeadReconciliationCases returns admin-facing summary fields", async () => {
  const bookingId = new Types.ObjectId("64c0f47e4d8b0e1111111111");
  const caseId = new Types.ObjectId("64c0f47e4d8b0e2222222222");
  const submission = {
    submission_id: "05db9651-8a3b-4743-bf35-e5a3ebae0f91",
    lead_name: "Casey Booker",
    normalized_name: "casey booker",
    phone_number: "2125550101",
    normalized_phone_number: "2125550101",
    email: "casey@example.test",
    normalized_email: "casey@example.test",
    lid: "LID-123",
    normalized_lid: "LID-123",
    job_no: "JOB-100",
    normalized_job_no: "JOB-100",
    binder_amount: 1200,
    deposit_amount: 250,
    merchant: "Merchant",
    agent: "Agent One",
    split_agent: "Agent Two",
    book_date: new Date("2026-07-23T00:00:00.000Z"),
    source_assignment: {
      lead_source_company: new Types.ObjectId("64c0f47e4d8b0e3333333333"),
      source_granularity_id: new Types.ObjectId("64c0f47e4d8b0e4444444444"),
      source_granularity_key: "granularity-key",
      source_company: "top10_leads",
      source_company_label_snapshot: "Top10 Leads",
      source_granularity_label_snapshot: "Top10 Forms",
      crm_source_label_snapshot: "Top10 Forms CRM",
      channel: "form" as const,
    },
  };
  const rows = [
    {
      _id: caseId,
      booking: bookingId,
      status: "pending",
      reason: "no_match",
      revision: 4,
      latest_candidates: [{ id: "candidate-1" }, { id: "candidate-2" }],
      submission,
      retry: { attempt_count: 1 },
      createdAt: new Date("2026-07-22T10:00:00.000Z"),
      updatedAt: new Date("2026-07-22T11:00:00.000Z"),
    },
  ];
  let capturedFilter: unknown;
  (BookingLeadReconciliationCase as any).find = (filter: unknown) => {
    capturedFilter = filter;
    return buildChain(rows);
  };

  const result = await listBookingLeadReconciliationCases({
    status: "pending",
    origin: "external_sheet_ingestion",
    reason: "no_match",
    q: "Casey",
    limit: 25,
    sort: "createdAt",
    direction: "asc",
  } as any);

  assert.deepEqual(capturedFilter, {
    status: "pending",
    origin: "external_sheet_ingestion",
    reason: "no_match",
    $or: [
      { "submission.job_no": /Casey/i },
      { "submission.lead_name": /Casey/i },
      { "submission.phone_number": /Casey/i },
      { "submission.lid": /Casey/i },
      { "submission.email": /Casey/i },
      { "submission.source_assignment.crm_source_label_snapshot": /Casey/i },
    ],
  });
  assert.equal(result.next_cursor, null);
  assert.deepEqual(result.items, [
    {
      id: caseId.toString(),
      _id: caseId.toString(),
      booking_id: bookingId.toString(),
      origin: "employee_booking",
      status: "pending",
      reason: "no_match",
      revision: 4,
      candidate_count: 2,
      submission,
      retry: { attempt_count: 1 },
      createdAt: new Date("2026-07-22T10:00:00.000Z"),
      updatedAt: new Date("2026-07-22T11:00:00.000Z"),
    },
  ]);
});

test("getBookingLeadReconciliationCase returns detail fields consumed by admin", async () => {
  const caseId = new Types.ObjectId("64c0f47e4d8b0e5555555555");
  const bookingObjectId = new Types.ObjectId("64c0f47e4d8b0e6666666666");
  const attachedLeadId = new Types.ObjectId("64c0f47e4d8b0e7777777777");
  const submission = {
    submission_id: "05db9651-8a3b-4743-bf35-e5a3ebae0f91",
    lead_name: "Casey Booker",
    normalized_name: "casey booker",
    phone_number: "2125550101",
    normalized_phone_number: "2125550101",
    email: "casey@example.test",
    normalized_email: "casey@example.test",
    lid: "LID-123",
    normalized_lid: "LID-123",
    job_no: "JOB-100",
    normalized_job_no: "JOB-100",
    binder_amount: 1200,
    deposit_amount: 250,
    merchant: "Merchant",
    agent: "Agent One",
    split_agent: "Agent Two",
    book_date: new Date("2026-07-23T00:00:00.000Z"),
    source_assignment: {
      lead_source_company: new Types.ObjectId("64c0f47e4d8b0e8888888888"),
      source_granularity_id: new Types.ObjectId("64c0f47e4d8b0e9999999999"),
      source_granularity_key: "granularity-key",
      source_company: "top10_leads",
      source_company_label_snapshot: "Top10 Leads",
      source_granularity_label_snapshot: "Top10 Forms",
      crm_source_label_snapshot: "Top10 Forms CRM",
      channel: "call" as const,
    },
  };
  const booking = {
    _id: bookingObjectId,
    lead_model: "CallLead",
    lead_ref: attachedLeadId,
    source: "Top10 Forms CRM",
    customer_name: "Casey Booker",
  };
  const doc = {
    _id: caseId,
    booking,
    status: "resolved",
    reason: "no_match",
    submission,
    latest_candidates: [],
    match_attempts: [
      {
        attempted_at: new Date("2026-07-22T10:00:00.000Z"),
        trigger: "owner_refresh",
        outcome: "no_match",
        reason: "no_match",
        candidate_count: 0,
        candidate_snapshot_hash: "hash",
        auto_match_policy_version: "employee-booking-v1",
        enabled_auto_match_rules: ["channel_phone_exact"],
      },
    ],
    retry: { attempt_count: 0 },
    resolution_history: [],
    revision: 8,
    createdAt: new Date("2026-07-22T10:00:00.000Z"),
    updatedAt: new Date("2026-07-22T11:00:00.000Z"),
  };
  (BookingLeadReconciliationCase as any).findById = () => buildChain(doc);

  const result = await getBookingLeadReconciliationCase(caseId.toString());

  assert.deepEqual(result, {
    id: caseId.toString(),
    _id: caseId.toString(),
    booking_id: bookingObjectId.toString(),
    origin: "employee_booking",
    booking,
    attached_lead: {
      id: attachedLeadId.toString(),
      _id: attachedLeadId.toString(),
      lead_model: "CallLead",
    },
    status: "resolved",
    reason: "no_match",
    submission,
    latest_candidates: [],
    match_attempts: doc.match_attempts,
    retry: { attempt_count: 0 },
    resolution_history: [],
    revision: 8,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
});

test("searchBookingLeadCandidates returns compact case-aware results with a cursor", async () => {
  const bookingId = new Types.ObjectId("64c0f47e4d8b0e1010101010");
  const sourceCompanyId = new Types.ObjectId("64c0f47e4d8b0e2020202020");
  const granularityId = new Types.ObjectId("64c0f47e4d8b0e3030303030");
  const submission = {
    submission_id: "05db9651-8a3b-4743-bf35-e5a3ebae0f91",
    lead_name: "Casey Booker",
    normalized_name: "casey booker",
    phone_number: "2125550101",
    normalized_phone_number: "2125550101",
    email: "casey@example.test",
    normalized_email: "casey@example.test",
    job_no: "JOB-100",
    normalized_job_no: "JOB-100",
    binder_amount: 1200,
    deposit_amount: 250,
    merchant: "Merchant",
    agent: "Agent One",
    book_date: new Date("2026-07-23T00:00:00.000Z"),
    source_assignment: {
      lead_source_company: sourceCompanyId,
      source_granularity_id: granularityId,
      source_granularity_key: "source-key",
      source_company: "source-slug",
      source_company_label_snapshot: "Source",
      source_granularity_label_snapshot: "Source Forms",
      crm_source_label_snapshot: "Source Forms CRM",
      channel: "form" as const,
    },
  };
  (BookingLeadReconciliationCase as any).findById = () =>
    buildChain({
      _id: new Types.ObjectId("64c0f47e4d8b0e4040404040"),
      booking: { _id: bookingId },
      submission,
    });
  const leads = [
    {
      _id: new Types.ObjectId("64c0f47e4d8b0e5050505050"),
      name: "Available Lead",
      phone_number: "2125550101",
      source_company: "source-slug",
      source_company_label_snapshot: "Source",
      lead_source_company: sourceCompanyId,
      source_granularity_key: "source-key",
      duplicate: false,
      createdAt: new Date("2026-07-23T12:00:00.000Z"),
      internal_secret: "must-not-leak",
    },
    {
      _id: new Types.ObjectId("64c0f47e4d8b0e6060606060"),
      name: "Next Lead",
      source_company: "source-slug",
      lead_source_company: sourceCompanyId,
      source_granularity_key: "source-key",
      createdAt: new Date("2026-07-22T12:00:00.000Z"),
    },
  ];
  (FormLead as any).find = () => buildChain(leads);

  const result = await searchBookingLeadCandidates("case-id", {
    lead_model: "FormLead",
    limit: 1,
  } as any);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.name, "Available Lead");
  assert.deepEqual(result.items[0]?.warnings, []);
  assert.equal("internal_secret" in result.items[0]!, false);
  assert.ok(result.next_cursor);
});

function buildChain<T>(value: T): ChainResult<T> {
  const chain: ChainResult<T> = {
    sort: () => chain,
    limit: () => chain,
    lean: () => chain,
    populate: () => chain,
    exec: async () => value,
  };
  return chain;
}
