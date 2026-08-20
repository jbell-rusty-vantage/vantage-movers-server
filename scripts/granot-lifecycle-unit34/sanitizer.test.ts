import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePayloads, scanSanitizedPayloads, type JsonValue } from "./sanitizer";

const custody = {
  source_category: "owner_approved_external_files" as const,
  custodian_category: "owner" as const,
  allowed_operator: "primary_agent" as const,
  retention: "retain" as const,
};

test("UNIT-34 sanitizer strips credentials and preserves structural semantics", () => {
  const rawPayload: JsonValue = {
    route_event_class: "booking_status_changed",
    event_type: "Booked",
    priority: "05",
    x_api_secret: "SYNTHETIC-CREDENTIAL-CANARY",
    first_name: "Fixture Person",
    phone: "+1 (917) 555-4321",
    email: "fixture.person@synthetic.test",
    job_no: "JOB-CANARY-100",
    move_date: "08/20/2026",
    from_state: "NY",
    from_zip: "10001",
    blank_optional: "   ",
    unknown_free_text: "Fixture notes that must not survive",
    nested: { authorization: "Bearer SYNTHETIC-CREDENTIAL-CANARY", job_no: "JOB-CANARY-100" },
  };
  const raw: JsonValue = {
    route_event_class: "booking_status_changed",
    headers: { cookie: "SYNTHETIC-CREDENTIAL-CANARY" },
    payload: rawPayload,
  };
  const { families, summary } = sanitizePayloads([raw], custody);
  const payload = families[0]!.sanitized_payloads[0] as Record<string, JsonValue>;
  const nested = payload.nested as Record<string, JsonValue>;
  assert.equal(payload.route_event_class, "booking_status_changed");
  assert.equal(payload.event_type, "Booked");
  assert.equal(payload.priority, "05");
  assert.equal(payload.move_date, "01/15/2030");
  assert.equal(payload.from_state, "NY");
  assert.equal(payload.from_zip, "00000");
  assert.equal(payload.blank_optional, "   ");
  assert.equal("x_api_secret" in payload, false);
  assert.equal("authorization" in nested, false);
  assert.equal(payload.job_no, nested.job_no);
  assert.match(String(payload.unknown_free_text), /^\[synthetic-text-/);
  assert.match(String(payload.email), /@example\.invalid$/);
  assert.equal(summary.scanner.ok, true);
  assert.equal(families[0]!.route_event_class, "booking_status_changed");
  assert.deepEqual(scanSanitizedPayloads([payload]), []);
});

test("UNIT-34 schema fingerprints ignore customer values and remain deterministic", () => {
  const first = sanitizePayloads(
    [{ route_event_class: "lead_created", first_name: "Fixture One", phone: "9175550101" }],
    custody,
  );
  const second = sanitizePayloads(
    [{ route_event_class: "lead_created", first_name: "Fixture Two", phone: "6465550199" }],
    custody,
  );
  assert.equal(first.families[0]!.schema_fingerprint, second.families[0]!.schema_fingerprint);
  assert.deepEqual(first.summary.families[0]!.field_shape, second.summary.families[0]!.field_shape);
});

test("UNIT-34 scanner rejects unsanitized credential and contact values", () => {
  const violations = scanSanitizedPayloads([
    {
      authorization: "Bearer SYNTHETIC-CREDENTIAL-CANARY",
      email: "fixture@synthetic.test",
      phone: "9175550101",
    },
  ]);
  assert.ok(violations.some((entry) => entry.endsWith(":credential_key")));
  assert.ok(violations.some((entry) => entry.endsWith(":credential_value")));
  assert.ok(violations.some((entry) => entry.endsWith(":non_synthetic_email")));
  assert.ok(violations.some((entry) => entry.endsWith(":non_reserved_phone")));
});
