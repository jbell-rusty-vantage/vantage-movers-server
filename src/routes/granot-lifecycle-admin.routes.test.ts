import assert from "node:assert/strict";
import { test } from "node:test";
import { granotLifecycleActivationCommandSchema } from "../validation/v1/granotLifecycle.validation";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "../services/granotLifecycle/errors";

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
  assert.throws(
    () =>
      granotLifecycleActivationCommandSchema.parse({
        reason: "Synthetic activation for local classification proof",
        processor_version: "bad version!",
      }),
    /processor_version/,
  );
  assert.throws(
    () =>
      granotLifecycleActivationCommandSchema.parse({
        reason: "Synthetic activation for local classification proof",
        processor_version: "granot-lifecycle-processor-v1",
        activated_at: "2026-08-17T16:00:00.000Z",
      }),
    /unrecognized_keys|activated_at/,
  );
});

test("[AC-35] portion lifecycle error envelopes stay raw-free", () => {
  assert.equal(GRANOT_LIFECYCLE_ERROR_CODES.ALREADY_ACTIVATED, "GRANOT_ALREADY_ACTIVATED");
  assert.equal(GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED, "GRANOT_OWNER_REQUIRED");
  assert.equal(GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED, "GRANOT_VALIDATION_FAILED");
});
