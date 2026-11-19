import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertLifecycleFixturesAreSynthetic,
  scanLifecycleFixtureInventory,
  scanLifecycleFixtures,
} from "./testSupport/fixtureSecurity";
import { normalizationFixtures } from "./testSupport/fixtures";
import {
  normalizationFixtureSchema,
  type NormalizationFixture,
} from "./testSupport/normalizationFixture";

test("[AC-03][AC-05][AC-06][AC-29] every committed fixture satisfies the strict contract", () => {
  const parsed = normalizationFixtureSchema.array().parse(normalizationFixtures);
  assert.equal(parsed.length, normalizationFixtures.length);
  assert.equal(new Set(parsed.map((fixture) => fixture.fixture_id)).size, parsed.length);
  assert.deepEqual(new Set(parsed.map((fixture) => fixture.channel)), new Set([
    "granot_webhook",
    "browser_extension",
    "granot_http_automation",
  ]));
  assert.ok(
    parsed.every((fixture) =>
      fixture.acceptance_ids.every((acceptanceId) =>
        ["AC-03", "AC-05", "AC-06", "AC-29"].includes(acceptanceId),
      ),
    ),
  );
});

test("[AC-03][AC-05][AC-06][AC-29] scanner rejects injected sensitive material with safe locations only", () => {
  const base = normalizationFixtures[0];
  assert.ok(base);
  const injected: NormalizationFixture[] = [
    {
      ...base,
      fixture_id: "synthetic_scanner_credential",
      input: {
        kind: "payload",
        value: { authorization: "Bearer sentinel-credential-value" },
      },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_email",
      input: { kind: "payload", value: { email: "fixture@nonreserved.test" } },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_phone",
      input: { kind: "payload", value: { phone: "212-555-0199" } },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_address",
      input: { kind: "payload", value: { address: "987 Market Street" } },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_name",
      input: { kind: "payload", value: { customer_name: "Nonallowlisted Person" } },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_secret_sentinel",
      input: {
        kind: "payload",
        value: { webhook_secret: "opaque-secret-sentinel-1234567890" },
      },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_webhook_token_variant",
      input: {
        kind: "payload",
        value: { webhook_token: "OpaqueCredentialSentinel1234567890" },
      },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_auth_token_variant",
      input: {
        kind: "payload",
        value: { auth_token: "AnotherOpaqueSentinel1234567890" },
      },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_credential_variant",
      input: {
        kind: "payload",
        value: { credential: "CredentialSentinelValue1234567890" },
      },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_country_code_phone",
      input: { kind: "payload", value: { phone: "+1 (212) 555-0199" } },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_display_name",
      input: { kind: "payload", value: { display_name: "Unapproved Display Name" } },
    },
    {
      ...base,
      fixture_id: "synthetic_scanner_contact_name",
      input: { kind: "payload", value: { contact_name: "Unapproved Contact Name" } },
    },
  ];

  const violations = scanLifecycleFixtures(injected);
  assert.deepEqual(
    new Set(violations.map((violation) => violation.code)),
    new Set([
      "credential_key",
      "credential_value",
      "non_synthetic_email",
      "non_reserved_phone",
      "street_address",
      "non_synthetic_name",
    ]),
  );
  for (const fixtureId of [
    "synthetic_scanner_webhook_token_variant",
    "synthetic_scanner_auth_token_variant",
    "synthetic_scanner_credential_variant",
  ]) {
    assert.ok(
      violations.some(
        (violation) =>
          violation.fixture_id === fixtureId && violation.code === "credential_key",
      ),
    );
    assert.ok(
      violations.some(
        (violation) =>
          violation.fixture_id === fixtureId && violation.code === "credential_value",
      ),
    );
  }
  assert.ok(
    violations.some(
      (violation) =>
        violation.fixture_id === "synthetic_scanner_country_code_phone" &&
        violation.code === "non_reserved_phone",
    ),
  );
  for (const fixtureId of [
    "synthetic_scanner_display_name",
    "synthetic_scanner_contact_name",
  ]) {
    assert.ok(
      violations.some(
        (violation) =>
          violation.fixture_id === fixtureId && violation.code === "non_synthetic_name",
      ),
    );
  }

  let message = "";
  try {
    assertLifecycleFixturesAreSynthetic(injected);
  } catch (error) {
    message = error instanceof Error ? error.message : "non-error scanner failure";
  }
  assert.match(message, /synthetic_scanner_credential:\$\.input\.value\.authorization/);
  assert.doesNotMatch(message, /sentinel-credential-value/);
  assert.doesNotMatch(message, /nonreserved\.test/);
  assert.doesNotMatch(message, /212-555-0199/);
  assert.doesNotMatch(message, /987 Market Street/);
  assert.doesNotMatch(message, /OpaqueCredentialSentinel/);
  assert.doesNotMatch(message, /Unapproved Display Name/);
});

test("[AC-03][AC-05][AC-06][AC-29] recursive inventory rejects alternate durable fixture sources", (testContext) => {
  const temporaryWorkspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "granot-lifecycle-fixture-inventory-"),
  );
  testContext.after(() => fs.rmSync(temporaryWorkspace, { recursive: true, force: true }));
  const lifecycleRoot = path.join(
    temporaryWorkspace,
    "src",
    "services",
    "granotLifecycle",
  );
  const alternateSourceDirectory = path.join(lifecycleRoot, "fixtures");
  fs.mkdirSync(alternateSourceDirectory, { recursive: true });
  fs.writeFileSync(path.join(alternateSourceDirectory, "cases.ts"), "export const cases = [];\n");
  fs.writeFileSync(
    path.join(alternateSourceDirectory, "fixtures.ts"),
    "export const fixtures = [];\n",
  );
  fs.writeFileSync(path.join(lifecycleRoot, "raw-observations.json"), "[]\n");

  const violations = scanLifecycleFixtureInventory(
    temporaryWorkspace,
    [],
    lifecycleRoot,
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.code === "unvalidated_fixture_source" &&
        violation.path.includes("cases.ts"),
    ),
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.code === "raw_fixture_source" &&
        violation.path.includes("raw-observations.json"),
    ),
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.code === "unvalidated_fixture_source" &&
        violation.path.includes("fixtures.fixtures.ts"),
    ),
  );
});
