import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertLifecycleFixturesAreSynthetic,
  scanLifecycleFixtureInventory,
  scanLifecycleFixtureSourcePaths,
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

test("[AC-03][AC-05][AC-06][AC-29] invalid fixture authority and metadata combinations are rejected", () => {
  const webhook = normalizationFixtures.find(
    (fixture) => fixture.channel === "granot_webhook",
  );
  const extension = normalizationFixtures.find(
    (fixture) => fixture.channel === "browser_extension",
  );
  assert.ok(webhook);
  assert.ok(extension);

  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...webhook,
      operation_kind: "lead_snapshot_apply",
      operation_id: "77777777-7777-4777-8777-777777777777",
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...extension,
      operation_kind: undefined,
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...extension,
      acceptance_ids: [],
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...extension,
      acceptance_ids: ["AC-99"],
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...extension,
      operation_kind: "lead_snapshot_apply",
      input: { kind: "statement", value: { event_type: "Booked" } },
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...extension,
      operation_kind: "booking_action_apply",
      expected: {
        observation_kind: "booking_action_snapshot",
        normalization_result: "unsupported",
        issue_codes: ["unsupported_booking_action"],
        booking_action: { raw: "Released" },
      },
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...extension,
      expected: {
        ...extension.expected,
        priority: { raw: "invalid-priority", canonical: "5", valid: true },
      },
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...extension,
      operation_kind: "booking_action_apply",
      input: { kind: "statement", value: { event_type: "Released" } },
      expected: {
        observation_kind: "booking_action_snapshot",
        normalization_result: "valid",
        issue_codes: [],
        booking_action: { raw: "Released", normalized: "booked" },
      },
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...webhook,
      route_event_class: "booking_status_changed",
      input: { kind: "payload", value: { event_type: "Booked" } },
      expected: {
        observation_kind: "booking_action_snapshot",
        normalization_result: "valid",
        issue_codes: [],
        booking_action: {},
      },
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...webhook,
      route_event_class: "booking_status_changed",
      input: { kind: "payload", value: { event_type: "Booked" } },
      expected: {
        observation_kind: "booking_action_snapshot",
        normalization_result: "unsupported",
        issue_codes: [],
        booking_action: { raw: "Booked", normalized: "booked" },
      },
    }).success,
    false,
  );
  assert.equal(
    normalizationFixtureSchema.safeParse({
      ...webhook,
      route_event_class: "lead_created",
      input: { kind: "payload", value: { event_type: "Booked" } },
      expected: {
        observation_kind: "lead_snapshot",
        normalization_result: "valid",
        issue_codes: [],
      },
    }).success,
    false,
  );
});

test("[AC-03] identity fixtures preserve exact-reference priority and blank compatibility boundaries", () => {
  const identityFixtures = normalizationFixtures.filter((fixture) =>
    fixture.acceptance_ids.includes("AC-03"),
  );
  assert.deepEqual(
    new Set(identityFixtures.map((fixture) => fixture.fixture_id)),
    new Set([
      "synthetic_ac03_tracking_reference_round_trip",
      "synthetic_ac03_mongo_compatibility_after_exact_miss",
      "synthetic_ac03_blank_form_reference",
      "synthetic_ac03_not_provided_form_reference",
    ]),
  );
  assert.ok(
    identityFixtures.some((fixture) =>
      fixture.forbidden_inferences.includes("mongo_id_precedes_exact_form_reference"),
    ),
  );
  const roundTrip = identityFixtures.find(
    (fixture) => fixture.fixture_id === "synthetic_ac03_tracking_reference_round_trip",
  );
  assert.equal(
    roundTrip?.identity_setup?.persisted_form_ref_no,
    roundTrip?.identity_setup?.posted_leadno,
  );
  assert.equal(
    roundTrip?.identity_setup?.posted_leadno,
    roundTrip?.expected.identity?.normalized_form_ref,
  );
  assert.equal(
    identityFixtures.filter(
      (fixture) => fixture.expected.identity?.normalized_form_ref === undefined,
    ).length,
    2,
  );
});

test("[AC-05] valid Priority fixtures freeze raw and canonical values without false downgrade authority", () => {
  const priorities = normalizationFixtures
    .filter((fixture) => fixture.fixture_id.startsWith("synthetic_ac05_priority_"))
    .map((fixture) => [fixture.expected.priority?.raw, fixture.expected.priority?.canonical]);
  assert.deepEqual(priorities, [
    [0, "0"],
    ["1", "1"],
    [5, "5"],
    ["8", "8"],
    ["05", "5"],
    ["123456789012", "123456789012"],
    ["000", "0"],
  ]);
  assert.ok(
    normalizationFixtures
      .filter((fixture) => fixture.acceptance_ids.includes("AC-05"))
      .every(
        (fixture) =>
          fixture.expected.priority?.canonical === "1" ||
          fixture.expected.priority?.canonical === "5" ||
          fixture.forbidden_inferences.includes("priority_authorizes_broad_enrichment"),
      ),
  );
});

test("[AC-06] malformed Priority and exact Booking Action aliases retain independent behavior", () => {
  const expectedById = new Map(
    normalizationFixtures
      .filter((fixture) => fixture.acceptance_ids.includes("AC-06"))
      .map((fixture) => [fixture.fixture_id, fixture.expected]),
  );
  assert.equal(
    expectedById.get("synthetic_ac06_missing_priority_update")?.normalization_result,
    "invalid",
  );
  assert.equal(
    expectedById.get("synthetic_ac06_malformed_priority_update")?.normalization_result,
    "invalid",
  );
  assert.equal(
    expectedById.get("synthetic_ac06_malformed_lead_created_priority")?.normalization_result,
    "valid_with_issues",
  );
  assert.equal(
    expectedById.get("synthetic_ac06_malformed_booked_priority")?.booking_action?.normalized,
    "booked",
  );
  assert.equal(
    expectedById.get("synthetic_ac06_malformed_release_priority")?.booking_action?.normalized,
    "release",
  );
  assert.equal(
    expectedById.get("synthetic_ac06_release_exact_alias")?.booking_action?.normalized,
    "release",
  );
  assert.equal(
    expectedById.get("synthetic_ac06_booked_mixed_case_alias")?.booking_action?.normalized,
    "booked",
  );
  assert.equal(
    expectedById.get("synthetic_ac06_released_is_unsupported")?.normalization_result,
    "unsupported",
  );
  assert.equal(
    expectedById.get("synthetic_ac06_released_is_unsupported")?.booking_action?.normalized,
    undefined,
  );
});

test("[AC-29] source labels remain separate from provider type and deferred effects", () => {
  const providerType = normalizationFixtures.find(
    (fixture) => fixture.fixture_id === "synthetic_ac29_provider_type_auto_is_context_only",
  );
  assert.equal(providerType?.expected.source_label?.raw, "Synthetic Forms");
  assert.equal(providerType?.expected.provider_context?.type_raw, "AUTO");
  assert.ok(providerType?.forbidden_inferences.includes("type_drives_source_classification"));

  for (const fixtureId of [
    "synthetic_ac29_paid_overflow_deferred",
    "synthetic_ac29_auto_source_deferred",
  ]) {
    const fixture = normalizationFixtures.find((candidate) => candidate.fixture_id === fixtureId);
    assert.ok(fixture?.forbidden_inferences.includes("deferred_source_authorizes_effects"));
  }
});

test("[AC-05][AC-06] equivalent statements seed cross-channel normalization parity", () => {
  for (const prefix of ["synthetic_ac05_lead_parity_", "synthetic_ac06_booking_parity_"]) {
    const fixtures = normalizationFixtures.filter((fixture) =>
      fixture.fixture_id.startsWith(prefix),
    );
    assert.equal(fixtures.length, 3);
    assert.deepEqual(new Set(fixtures.map((fixture) => fixture.channel)), new Set([
      "granot_webhook",
      "browser_extension",
      "granot_http_automation",
    ]));
    assert.deepEqual(new Set(fixtures.map((fixture) => JSON.stringify(fixture.input))).size, 1);
    assert.deepEqual(new Set(fixtures.map((fixture) => JSON.stringify(fixture.expected))).size, 1);
  }
});

test("[AC-03][AC-05][AC-06][AC-29] scanner accepts all schema-validated fixture sources", () => {
  const fixtureSource = path.join(
    process.cwd(),
    "src",
    "services",
    "granotLifecycle",
    "testSupport",
    "fixtures.ts",
  );
  assert.doesNotThrow(() =>
    assertLifecycleFixturesAreSynthetic(normalizationFixtures, [fixtureSource]),
  );
  assert.deepEqual(scanLifecycleFixtureInventory(process.cwd(), [fixtureSource]), []);
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

test("[AC-03][AC-05][AC-06][AC-29] scanner rejects raw and prohibited fixture source paths", () => {
  const workspaceRoot = process.cwd();
  const violations = scanLifecycleFixtureSourcePaths(
    [
      path.join(workspaceRoot, "src", "services", "granotLifecycle", "fixtures.json"),
      path.join(
        workspaceRoot,
        "scripts",
        "prototypes",
        "granot-lead-lifecycle",
        "payload_shapes.md",
      ),
      path.join(workspaceRoot, "current_payloads", "fixture.ts"),
    ],
    workspaceRoot,
  );
  assert.deepEqual(
    new Set(violations.map((violation) => violation.code)),
    new Set(["raw_fixture_source", "prohibited_fixture_source"]),
  );
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
