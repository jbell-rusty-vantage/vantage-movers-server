import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import {
  sourceLabelMappingActivationSchema,
  sourceLabelMappingCreateSchema,
  sourceLabelResolutionPreviewSchema,
} from "../validation/v1/sourceLabelMappings.validation";
import { RegistryError } from "../services/operationsRegistry/errors";

const validCreate = {
  label: "Best Relocation Forms",
  namespace: "sheet_lead_source",
  source_company: "aaaaaaaaaaaaaaaaaaaaaaaa",
  source_granularity: "bbbbbbbbbbbbbbbbbbbbbbbb",
  change_reason: "Map the sheet Source Company spelling to this Feed",
};

test("source label mapping create rejects unknown keys", () => {
  const result = sourceLabelMappingCreateSchema.safeParse({
    ...validCreate,
    extra: true,
  });
  assert.equal(result.success, false);
  assert.equal(result.error?.issues[0]?.code, "unrecognized_keys");
});

test("source label mapping create rejects a client-supplied normalized_label", () => {
  const result = sourceLabelMappingCreateSchema.safeParse({
    ...validCreate,
    normalized_label: "best relocation forms",
  });
  assert.equal(result.success, false);
  assert.match(
    result.error?.issues[0]?.message ?? "",
    /unrecognized_keys|normalized_label/,
  );
});

test("source label mapping mutations require a 10-1000 character reason", () => {
  assert.equal(
    sourceLabelMappingCreateSchema.safeParse({
      ...validCreate,
      change_reason: "short",
    }).success,
    false,
  );
  assert.equal(
    sourceLabelMappingActivationSchema.safeParse({
      active: false,
      reason: "x".repeat(1001),
    }).success,
    false,
  );
  assert.doesNotThrow(() => sourceLabelMappingCreateSchema.parse(validCreate));
  assert.doesNotThrow(() =>
    sourceLabelMappingActivationSchema.parse({
      active: false,
      reason: "Retire the misspelled mapping before replacing it",
    }),
  );
});

test("label resolution preview rejects unknown keys and is read-only shape", () => {
  const parsed = sourceLabelResolutionPreviewSchema.parse({
    namespace: "legacy_api_source",
    label: "Paid Overflow",
  });
  assert.equal("normalized_label" in parsed, false);
  assert.throws(
    () =>
      sourceLabelResolutionPreviewSchema.parse({
        namespace: "legacy_api_source",
        label: "Paid Overflow",
        persist: true,
      }),
    /unrecognized_keys/,
  );
});

test("error envelope parity uses RegistryError.toHttpBody and Zod unrecognized keys", () => {
  const registry = new RegistryError("An active mapping already holds the label.", {
    registryCode: "REGISTRY_DUPLICATE_IDENTIFIER",
  });
  assert.deepEqual(registry.toHttpBody(), {
    ok: false,
    error: "An active mapping already holds the label.",
    registry_code: "REGISTRY_DUPLICATE_IDENTIFIER",
  });

  try {
    sourceLabelMappingCreateSchema.parse({
      ...validCreate,
      normalized_label: "best relocation forms",
    });
    assert.fail("expected ZodError");
  } catch (error) {
    assert.ok(error instanceof ZodError);
    assert.equal(error.issues[0]?.code, "unrecognized_keys");
  }
});
