// Tests for: booking lead reconciliation service — list/detail response shape
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import path from "node:path";
import { Types } from "mongoose";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { CallLead } from "../../models/CallLead";
import {
  persistBookingLeadReconciliationResolveInTransaction,
  searchBookingLeadCandidates,
} from "./bookingLeadReconciliation.service";

type ChainResult<T> = {
  sort: (value: unknown) => ChainResult<T>;
  limit: (value: number) => ChainResult<T>;
  lean: () => ChainResult<T>;
  populate: (value: string) => ChainResult<T>;
  exec: () => Promise<T>;
};

const originalFindById = BookingLeadReconciliationCase.findById;
const originalCallLeadFind = CallLead.find;
const originalBookedLeadFindById = BookedLead.findById;
const originalCallLeadCreate = CallLead.create;

afterEach(() => {
  (BookingLeadReconciliationCase as any).findById = originalFindById;
  (CallLead as any).find = originalCallLeadFind;
  (BookedLead as any).findById = originalBookedLeadFindById;
  (CallLead as any).create = originalCallLeadCreate;
});

test("searchBookingLeadCandidates Call q and contact filters include snapshot paths", async () => {
  const bookingId = new Types.ObjectId("64c0f47e4d8b0e1010101010");
  const sourceCompanyId = new Types.ObjectId("64c0f47e4d8b0e2020202020");
  const granularityId = new Types.ObjectId("64c0f47e4d8b0e3030303030");
  (BookingLeadReconciliationCase as any).findById = () =>
    buildChain({
      _id: new Types.ObjectId("64c0f47e4d8b0e4040404040"),
      booking: { _id: bookingId },
      submission: {
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
          channel: "call" as const,
        },
      },
    });
  let capturedFilter: unknown;
  (CallLead as any).find = (filter: unknown) => {
    capturedFilter = filter;
    return buildChain([]);
  };

  await searchBookingLeadCandidates("case-id", {
    lead_model: "CallLead",
    q: "555-9999",
    phone_number: "555-9999",
    name: "Granot-only Name",
    email: "granot@example.invalid",
    limit: 10,
  } as any);

  const preview = inspect(capturedFilter, { depth: null });
  assert.match(preview, /granot_contact_snapshot\.phone_number/);
  assert.match(preview, /ingested_contact_snapshot\.normalized_phone_number/);
  assert.match(preview, /granot_contact_snapshot\.name/);
  assert.match(preview, /ingested_contact_snapshot\.name/);
  assert.match(preview, /granot_contact_snapshot\.email/);
  assert.match(preview, /555-9999/);
});

test("dismissing an owner_booking pending case leaves the Booking Leadless", async () => {
  const bookingId = new Types.ObjectId("64c0f47e4d8b0eaaaaaaa001");
  const caseId = new Types.ObjectId("64c0f47e4d8b0eaaaaaaa002");
  let createdCallLeads = 0;
  const booking = {
    _id: bookingId,
    is_leadless_booking: true,
    booking_origin: "owner_booking",
    lead_ref: undefined,
    lead_model: undefined,
    cancelled: undefined,
  };
  const caseDoc = {
    _id: caseId,
    booking: bookingId,
    origin: "owner_booking",
    status: "pending",
    revision: 0,
    resolution_history: [] as unknown[],
    submission: {
      submission_id: "owner-booking:JOB-100",
      lead_name: "Unknown",
      normalized_name: "unknown",
      phone_number: "not provided",
      normalized_phone_number: "not_provided",
      job_no: "JOB-100",
      normalized_job_no: "JOB-100",
      binder_amount: 900,
      deposit_amount: 300,
      merchant: "Card",
      agent: "JOSH",
      book_date: new Date("2026-05-21T00:00:00.000Z"),
      source_assignment: {
        lead_source_company: new Types.ObjectId(),
        source_granularity_id: new Types.ObjectId(),
        source_granularity_key: "key",
        source_company: "best_relocation_leads",
        source_company_label_snapshot: "Best Relocation",
        source_granularity_label_snapshot: "Forms",
        crm_source_label_snapshot: "Forms",
        channel: "form",
      },
    },
    async save() {
      return this;
    },
  };
  (BookingLeadReconciliationCase as any).findById = () => ({
    session: () => ({ exec: async () => caseDoc }),
  });
  (BookedLead as any).findById = () => ({
    session: () => ({ exec: async () => booking }),
  });
  (CallLead as any).create = async () => {
    createdCallLeads += 1;
    return {};
  };

  await persistBookingLeadReconciliationResolveInTransaction(
    caseId.toString(),
    { action: "dismiss", revision: 0 },
    { actor: "owner@example.test" },
    { now: new Date() },
  );

  assert.equal(caseDoc.status, "dismissed");
  assert.equal(booking.is_leadless_booking, true);
  assert.equal(booking.lead_ref, undefined);
  assert.equal(booking.lead_model, undefined);
  assert.equal(booking.booking_origin, "owner_booking");
  assert.equal(createdCallLeads, 0);
  assert.equal(
    (caseDoc.resolution_history.at(-1) as { action?: string } | undefined)?.action,
    "dismiss",
  );
});

test("reopenBookingLeadReconciliation guards status and live booking before rematch", () => {
  const source = readFileSync(
    path.join(__dirname, "bookingLeadReconciliation.service.ts"),
    "utf8",
  );
  const reopen = source.slice(
    source.indexOf("export async function reopenBookingLeadReconciliation"),
    source.indexOf("async function searchCandidates"),
  );
  assert.match(reopen, /assertAllowedCaseAction\(caseDoc\.status, "reopen"\)/);
  assert.match(reopen, /BookedLead\.findById\(caseDoc\.booking\)/);
  assert.match(reopen, /assertLiveBookingStateForAction\(booking, "reopen"\)/);
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
