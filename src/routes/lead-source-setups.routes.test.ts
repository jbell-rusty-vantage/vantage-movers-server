import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { RegistryError } from "../services/operationsRegistry/errors";
import {
  leadSourceDetailQuerySchema,
  leadSourceListQuerySchema,
  leadSourceSetupCommandSchema,
} from "../validation/v1/leadSourceSetup.validation";

const validSetup = {
  name: "Synthetic Harbor Leads",
  channel: "form",
  crm_label: "Synthetic Harbor Forms",
  reason: "Owner created this draft lead source from the guided setup",
};

test("lead-source-setups schema rejects unknown keys and derived internals", () => {
  for (const extra of [
    { company_slug: "synthetic_harbor_leads" },
    { granularity_key: "synthetic_harbor_leads" },
    { normalized_granot_label: "synthetic harbor" },
    { crm_origin: "granot" },
    { workspace_slug: "synthetic-harbor" },
    { lifecycle_disposition: "source_scoped_lead" },
    { lead_model: "FormLead" },
    { route_key: "any" },
  ]) {
    const result = leadSourceSetupCommandSchema.safeParse({ ...validSetup, ...extra });
    assert.equal(result.success, false, `should reject ${Object.keys(extra)[0]}`);
    assert.equal(result.error?.issues[0]?.code, "unrecognized_keys");
  }
});

test("lead-source-setups schema requires a 10-1000 character reason", () => {
  assert.equal(
    leadSourceSetupCommandSchema.safeParse({ ...validSetup, reason: "short" }).success,
    false,
  );
  assert.doesNotThrow(() => leadSourceSetupCommandSchema.parse(validSetup));
});

test("projection query schemas reject unknown keys", () => {
  assert.throws(
    () => leadSourceListQuerySchema.parse({ include_inactive: true }),
    /unrecognized_keys/,
  );
  assert.throws(
    () => leadSourceDetailQuerySchema.parse({ extra: true }),
    /unrecognized_keys/,
  );
});

test("error envelope parity uses RegistryError.toHttpBody and Zod unrecognized keys", () => {
  const registry = new RegistryError("Derived lead-source key is already held.", {
    registryCode: "REGISTRY_DUPLICATE_IDENTIFIER",
  });
  assert.deepEqual(registry.toHttpBody(), {
    ok: false,
    error: "Derived lead-source key is already held.",
    registry_code: "REGISTRY_DUPLICATE_IDENTIFIER",
  });
  try {
    leadSourceSetupCommandSchema.parse({ ...validSetup, company_slug: "x" });
    assert.fail("expected ZodError");
  } catch (error) {
    assert.ok(error instanceof ZodError);
    assert.equal(error.issues[0]?.code, "unrecognized_keys");
  }
});
