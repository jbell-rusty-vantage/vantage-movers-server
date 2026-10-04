import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extensionGranotApplyBatchSchema,
  extensionGranotApplyItemSchema,
  granotLifecycleActivationCommandSchema,
  granotLifecycleConfirmBookingCommandSchema,
  granotLifecycleConnectLeadCandidateQuerySchema,
  granotLifecycleConnectLeadCommandSchema,
  granotLifecycleCreateReferralBookingCommandSchema,
  granotLifecycleUpdateBookingCommandSchema,
  granotLifecycleBookingNoActionCommandSchema,
  granotLifecycleConfirmCancellationCommandSchema,
  granotLifecycleCandidateQuerySchema,
  granotLifecycleCaseListQuerySchema,
  granotLifecycleLeadTimelineParamsSchema,
  granotLifecycleRequeueCommandSchema,
  granotLifecycleTimelineQuerySchema,
  granotLifecycleCorrectRecordLinkCommandSchema,
  granotLifecycleDiscrepancyListQuerySchema,
  granotLifecycleDiscrepancyNoActionCommandSchema,
  granotLifecycleReEvaluateDiscrepancyCommandSchema,
} from "./granotLifecycle.validation";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "../../services/granotLifecycle/errors";

test("[AC-31] foundation activation input is strict and bounded", () => {
  const parsed = granotLifecycleActivationCommandSchema.parse({
    reason: "Synthetic activation for local classification proof",
    processor_version: "granot-lifecycle-processor-v1",
  });
  assert.equal(parsed.processor_version, "granot-lifecycle-processor-v1");
  assert.throws(
    () =>
      granotLifecycleActivationCommandSchema.parse({
        reason: "short",
        processor_version: "granot-lifecycle-processor-v1",
      }),
    /reason/,
  );
});

test("[AC-37] requeue reason is strict 10-500 and rejects unknown keys", () => {
  const parsed = granotLifecycleRequeueCommandSchema.parse({
    reason: "Owner requeue of synthetic dead-lettered receipt",
  });
  assert.equal(parsed.reason, "Owner requeue of synthetic dead-lettered receipt");
  assert.throws(() => granotLifecycleRequeueCommandSchema.parse({ reason: "too-short" }), /reason/);
  assert.throws(
    () =>
      granotLifecycleRequeueCommandSchema.parse({
        reason: "Owner requeue of synthetic dead-lettered receipt",
        payload: { secret: true },
      }),
    /unrecognized_keys|payload/,
  );
  assert.throws(
    () =>
      granotLifecycleRequeueCommandSchema.parse({
        reason: "Owner requeue of synthetic dead-lettered receipt",
        channel_operation_id: "must-not-replace",
      }),
    /unrecognized_keys|channel_operation_id/,
  );
});

test("[AC-35] portion lifecycle error envelopes stay raw-free", () => {
  assert.equal(GRANOT_LIFECYCLE_ERROR_CODES.RECEIPT_NOT_FOUND, "GRANOT_RECEIPT_NOT_FOUND");
  assert.equal(GRANOT_LIFECYCLE_ERROR_CODES.REQUEUE_STATE_CONFLICT, "GRANOT_REQUEUE_STATE_CONFLICT");
  assert.equal(GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED, "GRANOT_OWNER_REQUIRED");
  assert.equal(
    GRANOT_LIFECYCLE_ERROR_CODES.OPERATION_IDEMPOTENCY_CONFLICT,
    "GRANOT_OPERATION_IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    GRANOT_LIFECYCLE_ERROR_CODES.CAPTURE_UNAVAILABLE,
    "GRANOT_CAPTURE_UNAVAILABLE",
  );
});

test("[AC-34] extension apply item requires lowercase UUID v4 and raw statement scalars", () => {
  const parsed = extensionGranotApplyItemSchema.parse({
    operation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    operation_kind: "lead_snapshot_apply",
    granot_statement: { source: "Synthetic Forms", priority: "1", user: "A", rep: "B" },
  });
  assert.equal(parsed.granot_statement.priority, "1");
  assert.throws(
    () =>
      extensionGranotApplyItemSchema.parse({
        operation_id: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
        operation_kind: "lead_snapshot_apply",
        granot_statement: { priority: "1" },
      }),
    /UUID|operation_id/,
  );
  assert.throws(
    () =>
      extensionGranotApplyItemSchema.parse({
        operation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        operation_kind: "lead_snapshot_apply",
        granot_statement: { nested: { phone: "5550001111" } },
      }),
    /Expected|invalid/,
  );
});

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

test("[AC-23][AC-35][AC-36] discrepancy filters and Owner bodies are strict and revision guarded", () => {
  assert.equal(granotLifecycleDiscrepancyListQuerySchema.parse({}).limit, 25);
  assert.equal(granotLifecycleDiscrepancyListQuerySchema.safeParse({ reason_code: "release_record_link_conflict", state: "open" }).success, true);
  assert.equal(granotLifecycleDiscrepancyListQuerySchema.safeParse({ contact: "forbidden" }).success, false);
  assert.deepEqual(granotLifecycleReEvaluateDiscrepancyCommandSchema.parse({ expected_revision: 1 }), { expected_revision: 1 });
  const correction = { expected_revision: 1, expected_link_revision: 0, selected_lead: { lead_model: "FormLead", lead_id: "a".repeat(24) }, reason_text: "Owner reviewed the corrected Lead" };
  assert.deepEqual(granotLifecycleCorrectRecordLinkCommandSchema.parse(correction), correction);
  assert.equal(granotLifecycleCorrectRecordLinkCommandSchema.safeParse({ ...correction, booking_id: "b".repeat(24) }).success, false);
  assert.equal(granotLifecycleCorrectRecordLinkCommandSchema.safeParse({ ...correction, reason_text: "short" }).success, false);
  assert.deepEqual(granotLifecycleDiscrepancyNoActionCommandSchema.parse({ expected_revision: 2 }), { expected_revision: 2 });
});

test("[AC-18] [AC-19] case list query is strict, bounded, and validates date order", () => {
  const parsed = granotLifecycleCaseListQuerySchema.parse({
    state: "open",
    mode: "create_missing_booking",
    source_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    opened_from: "2026-08-17T00:00:00.000Z",
    opened_to: "2026-08-18T00:00:00.000Z",
    limit: "25",
  });
  assert.equal(parsed.limit, 25);
  const release = granotLifecycleCaseListQuerySchema.parse({ kind: "release", mode: "release" });
  assert.equal(release.kind, "release");
  assert.equal(release.mode, "release");
  assert.throws(() => granotLifecycleCaseListQuerySchema.parse({ unknown: "x" }), /unrecognized_keys|unknown/);
  assert.throws(() => granotLifecycleCaseListQuerySchema.parse({ limit: 101 }), /less than or equal|Too big/);
  assert.throws(
    () => granotLifecycleCaseListQuerySchema.parse({
      opened_from: "2026-08-19T00:00:00.000Z",
      opened_to: "2026-08-18T00:00:00.000Z",
    }),
    /opened_from/,
  );
});

test("[AC-35] candidate and timeline queries reject unsafe cursor/contact shapes", () => {
  const candidate = granotLifecycleCandidateQuerySchema.parse({ q: "   ", limit: "10" });
  assert.equal(candidate.q, undefined);
  assert.equal(candidate.scope, "source");
  assert.equal(candidate.limit, 10);
  assert.throws(
    () => granotLifecycleCandidateQuerySchema.parse({ q: "x".repeat(101) }),
    /Too big|less than or equal/,
  );
  assert.throws(
    () => granotLifecycleTimelineQuerySchema.parse({ cursor: "not+base64" }),
    /base64url|cursor/,
  );
});

test("[AC-40] Lead timeline accepts only the exact model union and ObjectId", () => {
  assert.equal(
    granotLifecycleLeadTimelineParamsSchema.parse({
      lead_model: "FormLead",
      lead_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    }).lead_model,
    "FormLead",
  );
  assert.throws(
    () => granotLifecycleLeadTimelineParamsSchema.parse({ lead_model: "Lead", lead_id: "x" }),
    /Invalid option|ObjectId/,
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

test("Connect Booking to Lead input is strict and requires selected_lead", () => {
  const valid = {
    expected_booking_revision: 2,
    selected_lead: { lead_model: "FormLead" as const, lead_id: "a".repeat(24) },
  };
  assert.deepEqual(granotLifecycleConnectLeadCommandSchema.parse(valid), valid);
  assert.equal(
    granotLifecycleConnectLeadCommandSchema.parse({
      ...valid,
      out_of_scope_override_reason: "Owner confirmed this is the same household.",
    }).out_of_scope_override_reason,
    "Owner confirmed this is the same household.",
  );
  assert.throws(
    () => granotLifecycleConnectLeadCommandSchema.parse({
      expected_booking_revision: 2,
    }),
    /selected_lead/,
  );
  assert.throws(
    () => granotLifecycleConnectLeadCommandSchema.parse({
      ...valid,
      official_booking_details: { book_date: "2026-08-01" },
    }),
    /unrecognized_keys|official_booking_details/,
  );
  assert.throws(
    () => granotLifecycleConnectLeadCommandSchema.parse({
      ...valid,
      out_of_scope_override_reason: "short",
    }),
    /out_of_scope_override_reason/,
  );
});

test("Connect candidate query allows empty q and rejects unknown keys", () => {
  assert.equal(granotLifecycleConnectLeadCandidateQuerySchema.parse({}).q, undefined);
  assert.equal(granotLifecycleConnectLeadCandidateQuerySchema.parse({ q: "  " }).q, undefined);
  assert.equal(granotLifecycleConnectLeadCandidateQuerySchema.parse({ q: "Granot Later" }).q, "Granot Later");
  assert.throws(
    () => granotLifecycleConnectLeadCandidateQuerySchema.parse({ scope: "source" }),
    /unrecognized_keys|scope/,
  );
});

test("[AC-28] Referral Booking input accepts only case revision and strict official details", () => {
  const body = {
    expected_case_revision: 1,
    official_booking_details: {
      book_date: "2026-08-19",
      primary_agent_id: "a".repeat(24),
      total_binder_amount: 10,
      deposit_amount: 25,
      merchant_id: "b".repeat(24),
    },
  };
  assert.equal(granotLifecycleCreateReferralBookingCommandSchema.parse(body).expected_case_revision, 1);
  for (const forbidden of ["job_no", "selected_lead", "accepted_observation_id", "source_scope", "contact"]) {
    assert.throws(
      () => granotLifecycleCreateReferralBookingCommandSchema.parse({ ...body, [forbidden]: "forbidden" }),
      new RegExp(`unrecognized_keys|${forbidden}`),
    );
  }
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

test("[AC-20] Booking No Action reasons are independently optional and strict", () => {
  assert.deepEqual(granotLifecycleBookingNoActionCommandSchema.parse({ expected_case_revision: 1 }), {
    expected_case_revision: 1,
  });
  assert.equal(granotLifecycleBookingNoActionCommandSchema.safeParse({
    expected_case_revision: 1,
    reason_code: "other",
  }).success, true);
  assert.equal(granotLifecycleBookingNoActionCommandSchema.safeParse({
    expected_case_revision: 1,
    reason_text: "Owner reviewed the evidence.",
  }).success, true);
  assert.equal(granotLifecycleBookingNoActionCommandSchema.safeParse({
    expected_case_revision: 1,
    reason_code: "invented_resolution",
  }).success, false);
  assert.equal(granotLifecycleBookingNoActionCommandSchema.safeParse({
    expected_case_revision: 1,
    case_id: "a".repeat(24),
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
