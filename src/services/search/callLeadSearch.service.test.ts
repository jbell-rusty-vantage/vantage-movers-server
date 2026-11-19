import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { searchCallLeadsSchema } from "../../validation/v1.validation";
import { buildCallLeadSearchFilter } from "./callLeadSearch.service";

test("Call Lead Search phone ORs live, ingested, and Granot snapshot paths", () => {
  const filter = buildCallLeadSearchFilter(
    searchCallLeadsSchema.parse({ phone_number: "555-123-4567" }),
  );
  const preview = inspect(filter, { depth: null });
  assert.match(preview, /normalized_phone_number/);
  assert.match(preview, /ingested_contact_snapshot\.normalized_phone_number/);
  assert.match(preview, /ingested_contact_snapshot\.phone_number/);
  assert.match(preview, /granot_contact_snapshot\.normalized_phone_number/);
  assert.match(preview, /granot_contact_snapshot\.phone_number/);
  assert.doesNotMatch(preview, /score/);
});

test("Call Lead Search keeps OR across phone, name, and email", () => {
  const filter = buildCallLeadSearchFilter(
    searchCallLeadsSchema.parse({
      phone_number: "555-123-4567",
      name: "Granot Later",
      email: "granot@example.invalid",
    }),
  );
  assert.ok(filter.$or);
  assert.equal(Array.isArray(filter.$or), true);
  assert.equal((filter.$or as unknown[]).length, 3);
  assert.equal("$and" in filter, false);
});
