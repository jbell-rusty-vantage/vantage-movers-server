import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Types } from "mongoose";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { persistLeadlessBookingCreateInTransaction } from "./leadlessBooking.service";

const originalSave = BookedLead.prototype.save;
const originalCaseSave = BookingLeadReconciliationCase.prototype.save;
const originalCreate = BookingLeadReconciliationCase.create;

afterEach(() => {
  BookedLead.prototype.save = originalSave;
  BookingLeadReconciliationCase.prototype.save = originalCaseSave;
  (BookingLeadReconciliationCase as any).create = originalCreate;
});

const prepared = {
  jobNo: "JOB-100",
  resolvedSource: {
    companySlug: "best_relocation_leads",
    assignment: {
      source_company: "best_relocation_leads",
      lead_source_company: new Types.ObjectId("64c0f47e4d8b0e1111111111"),
      source_granularity_id: new Types.ObjectId("64c0f47e4d8b0e2222222222"),
      source_granularity_key: "best_relocation_form",
      source_company_label_snapshot: "Best Relocation",
      source_granularity_label_snapshot: "Best Relocation Forms",
      crm_source_label_snapshot: "Best Relocation Forms",
    },
    channel: "form" as const,
    label: "Best Relocation Forms",
  },
  isBestRelocationImport: false,
  agent_allocations: [
    {
      agent: new Types.ObjectId("64c0f47e4d8b0e3333333333"),
      agent_name_snapshot: "JOSH",
      binder_amount: 900,
    },
  ],
  merchant: "Card",
  warnings: [] as string[],
  depositAmount: 300,
  customerName: "",
  source: "Best Relocation Forms",
};

const input = {
  book_date: new Date("2026-05-21T00:00:00.000Z"),
  job_no: "JOB-100",
  source_company: "Best Relocation Inbounds",
  agent: "JOSH",
  total_binder_amount: 900,
  deposit_amount: 300,
  merchant: "Card",
} as any;

test("Owner leadless create opens owner_booking case and sets booking_origin", async () => {
  let savedBooking: { booking_origin?: string; is_leadless_booking?: boolean; lead_ref?: unknown };
  let createdCase: { origin?: string; reason?: string; submission?: { submission_id?: string; lid?: unknown } };
  BookedLead.prototype.save = async function save() {
    savedBooking = this as any;
    (this as any)._id ??= new Types.ObjectId();
    return this;
  };
  BookingLeadReconciliationCase.prototype.save = async function save() {
    createdCase = this as any;
    (this as any)._id ??= new Types.ObjectId("64c0f47e4d8b0e4444444444");
    return this;
  };

  const result = await persistLeadlessBookingCreateInTransaction(
    input,
    prepared,
    { now: new Date("2026-05-21T12:00:00.000Z") },
    undefined,
    { persistSheetSyncIntent: async () => undefined },
  );

  assert.equal(savedBooking!.booking_origin, "owner_booking");
  assert.equal(savedBooking!.is_leadless_booking, true);
  assert.equal(savedBooking!.lead_ref, undefined);
  assert.equal(createdCase!.origin, "owner_booking");
  assert.equal(createdCase!.reason, "no_match");
  assert.equal(createdCase!.submission?.submission_id, "owner-booking:JOB 100");
  assert.equal(createdCase!.submission?.lid, undefined);
  assert.equal(result.reconciliation_case_id, String((createdCase as { _id?: unknown })._id));
  assert.equal(result.sheetJob.operation, "owner_booking.create_pending");
});

test("Best Relocation import leadless keeps external_sheet_ingestion and no booking_origin", async () => {
  let savedBooking: { booking_origin?: string };
  let createdCase: { origin?: string };
  BookedLead.prototype.save = async function save() {
    savedBooking = this as any;
    (this as any)._id ??= new Types.ObjectId();
    return this;
  };
  (BookingLeadReconciliationCase as any).create = async (docs: unknown[]) => {
    createdCase = (docs as any[])[0];
    return [{ _id: new Types.ObjectId() }];
  };

  const result = await persistLeadlessBookingCreateInTransaction(
    { ...input, ingestion_source: "best_relocation_sheet" },
    { ...prepared, isBestRelocationImport: true },
    { now: new Date("2026-05-21T12:00:00.000Z") },
    undefined,
    { persistSheetSyncIntent: async () => undefined },
  );

  assert.equal(savedBooking!.booking_origin, undefined);
  assert.equal(createdCase!.origin, "external_sheet_ingestion");
  assert.equal(result.sheetJob.operation, "leadless_booking.create");
});
