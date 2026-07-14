import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLeadIdentity } from "./leadIdentity";

test("returns all-null for missing identity", () => {
  assert.deepEqual(normalizeLeadIdentity(undefined), {
    lead_name: null,
    lead_phone: null,
    lead_email: null,
  });
});

test("trims name/phone and lowercases email", () => {
  assert.deepEqual(
    normalizeLeadIdentity({
      name: "  Jane Doe  ",
      phone: " 555-111-2222 ",
      email: "  Jane@Example.COM ",
    }),
    {
      lead_name: "Jane Doe",
      lead_phone: "555-111-2222",
      lead_email: "jane@example.com",
    },
  );
});

test("empty strings become null", () => {
  assert.deepEqual(
    normalizeLeadIdentity({ name: "   ", phone: "", email: "  " }),
    { lead_name: null, lead_phone: null, lead_email: null },
  );
});
