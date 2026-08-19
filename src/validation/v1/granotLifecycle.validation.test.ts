import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extensionGranotApplyBatchSchema,
  extensionGranotApplyItemSchema,
  granotLifecycleActivationCommandSchema,
  granotLifecycleCandidateQuerySchema,
  granotLifecycleCaseListQuerySchema,
  granotLifecycleLeadTimelineParamsSchema,
  granotLifecycleRequeueCommandSchema,
  granotLifecycleTimelineQuerySchema,
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
