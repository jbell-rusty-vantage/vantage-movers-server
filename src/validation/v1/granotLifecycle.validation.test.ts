import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extensionGranotApplyBatchSchema,
  granotLifecycleConfirmBookingCommandSchema,
  granotLifecycleUpdateBookingCommandSchema,
  granotLifecycleConfirmCancellationCommandSchema,
} from "./granotLifecycle.validation";

test("[AC-02] batch rejects duplicate operation IDs and more than 100 items", () => {
  const item = {
    operation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    operation_kind: "lead_snapshot_apply",
    granot_statement: { priority: "1" },
  };
  assert.throws(
    () => extensionGranotApplyBatchSchema.parse({ items: [item, item] }),
    /duplicate operation_id/,
  );
});

test("[AC-22] confirm Booking input is strict and validates exact official cents", () => {
  const valid = {
    expected_case_revision: 1,
    selected_lead: { lead_model: "FormLead", lead_id: "a".repeat(24) },
    official_booking_details: {
      book_date: "2026-02-28",
      primary_agent_id: "b".repeat(24),
      secondary_agent_id: "c".repeat(24),
      total_binder_amount: 10.25,
      deposit_amount: 100.01,
      merchant_id: "d".repeat(24),
    },
  };
  assert.equal(
    granotLifecycleConfirmBookingCommandSchema.parse(valid).official_booking_details.book_date,
    "2026-02-28",
  );
  assert.throws(
    () => granotLifecycleConfirmBookingCommandSchema.parse({ ...valid, case_id: "e".repeat(24) }),
    /unrecognized_keys|case_id/,
  );
  assert.throws(
    () => granotLifecycleConfirmBookingCommandSchema.parse({
      ...valid,
      official_booking_details: { ...valid.official_booking_details, book_date: "2026-02-30" },
    }),
    /calendar-valid|book_date/,
  );
  assert.throws(
    () => granotLifecycleConfirmBookingCommandSchema.parse({
      ...valid,
      official_booking_details: { ...valid.official_booking_details, deposit_amount: 1.005 },
    }),
    /two decimal|deposit_amount/,
  );
  assert.throws(
    () => granotLifecycleConfirmBookingCommandSchema.parse({
      ...valid,
      official_booking_details: {
        ...valid.official_booking_details,
        agent_allocations: [{ agent_id: "b".repeat(24), binder_amount: 10.25 }],
      },
    }),
    /unrecognized_keys|agent_allocations/,
  );
  const { selected_lead: _omitted, ...withoutLead } = valid;
  assert.equal(
    granotLifecycleConfirmBookingCommandSchema.parse(withoutLead).selected_lead,
    undefined,
  );
  assert.throws(
    () => granotLifecycleConfirmBookingCommandSchema.parse({
      ...withoutLead,
      unknown_mode: "leadless",
    }),
    /unrecognized_keys|unknown_mode/,
  );
});

test("[AC-22] confirm Booking accepts one or two unique Agents and rejects a matching secondary", () => {
  const base = {
    expected_case_revision: 1,
    selected_lead: { lead_model: "CallLead" as const, lead_id: "a".repeat(24) },
    official_booking_details: {
      book_date: "2026-08-19",
      primary_agent_id: "b".repeat(24),
      total_binder_amount: 0,
      deposit_amount: 0,
      merchant_id: "d".repeat(24),
    },
  };
  assert.equal(
    granotLifecycleConfirmBookingCommandSchema.parse(base).official_booking_details.primary_agent_id,
    "b".repeat(24),
  );
  assert.equal(
    granotLifecycleConfirmBookingCommandSchema.parse({
      ...base,
      official_booking_details: {
        ...base.official_booking_details,
        secondary_agent_id: "",
      },
    }).official_booking_details.secondary_agent_id,
    undefined,
  );
  assert.throws(
    () => granotLifecycleConfirmBookingCommandSchema.parse({
      ...base,
      official_booking_details: {
        ...base.official_booking_details,
        secondary_agent_id: "b".repeat(24),
      },
    }),
    /different|secondary_agent_id/,
  );
});

test("[AC-24] update Booking is a strict complete replacement with both revisions", () => {
  const valid = {
    expected_case_revision: 2,
    expected_booking_revision: 4,
    official_booking_details: {
      book_date: "2026-08-19",
      primary_agent_id: "a".repeat(24),
      total_binder_amount: 10.25,
      deposit_amount: 0,
      merchant_id: "b".repeat(24),
    },
  };
  assert.deepEqual(granotLifecycleUpdateBookingCommandSchema.parse(valid), valid);
  for (const forbidden of ["case_id", "job_no", "source", "lead_ref", "estimate"]) {
    assert.equal(granotLifecycleUpdateBookingCommandSchema.safeParse({ ...valid, [forbidden]: "forbidden" }).success, false);
  }
  const { merchant_id: _merchant, ...partial } = valid.official_booking_details;
  assert.equal(granotLifecycleUpdateBookingCommandSchema.safeParse({
    ...valid,
    official_booking_details: partial,
  }).success, false);
});

test("[AC-25] Confirm Cancellation accepts only strict official fields with exact date and cents", () => {
  const valid = {
    expected_case_revision: 2,
    expected_booking_revision: 4,
    official_cancellation_details: {
      cancel_date: "2026-08-19",
      refund_amount: 125.25,
      reason: "Owner-confirmed synthetic cancellation",
      notes: "Reviewed against the deterministic Booking.",
      cancelled_by: "Owner",
    },
  };
  assert.deepEqual(granotLifecycleConfirmCancellationCommandSchema.parse(valid), valid);
  assert.equal(granotLifecycleConfirmCancellationCommandSchema.safeParse({
    ...valid,
    case_id: "a".repeat(24),
  }).success, false);
  assert.equal(granotLifecycleConfirmCancellationCommandSchema.safeParse({
    ...valid,
    official_cancellation_details: {
      ...valid.official_cancellation_details,
      cancel_date: "2026-02-30",
    },
  }).success, false);
  assert.equal(granotLifecycleConfirmCancellationCommandSchema.safeParse({
    ...valid,
    official_cancellation_details: {
      ...valid.official_cancellation_details,
      refund_amount: 1.005,
    },
  }).success, false);
});
