import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDeleteChangeFields,
  buildEntityChangeFields,
  changedPathsFromFields,
  classifyEntityChangePath,
  collectDocumentFieldChanges,
} from "./entityChange";
import { DELETED_ENTITY_CHANGE_PATH } from "../../models/EntityChange";

test("[AC-32] contact and address paths are reference_only; low-risk paths stay stored", () => {
  assert.equal(classifyEntityChangePath("phone_number"), "reference_only");
  assert.equal(classifyEntityChangePath("email"), "reference_only");
  assert.equal(classifyEntityChangePath("pickup_zip"), "reference_only");
  assert.equal(classifyEntityChangePath("customer_name"), "reference_only");
  assert.equal(classifyEntityChangePath(DELETED_ENTITY_CHANGE_PATH), "reference_only");
  assert.equal(classifyEntityChangePath("quoted"), "stored");
  assert.equal(classifyEntityChangePath("deposit_amount"), "stored");
  assert.equal(classifyEntityChangePath("job_no"), "stored");
  assert.equal(classifyEntityChangePath("unknown_future_path"), "reference_only");
});

test("[AC-32] Change builders omit raw contact values and emit deterministic paths", () => {
  const fields = buildEntityChangeFields([
    { path: "quoted", before: false, after: true },
    { path: "phone_number", before: "5550000011", after: "5550000099" },
    { path: "quoted", after: true },
  ]);
  assert.deepEqual(
    fields.map((field) => field.path),
    ["phone_number", "quoted"],
  );
  assert.equal(fields[0]?.value_mode, "reference_only");
  assert.equal(fields[0]?.before, undefined);
  assert.equal(fields[0]?.after, undefined);
  assert.equal(fields[1]?.value_mode, "stored");
  assert.equal(fields[1]?.after, true);
  assert.deepEqual(changedPathsFromFields(fields), ["phone_number", "quoted"]);
  assert.deepEqual(buildDeleteChangeFields(), [
    { path: DELETED_ENTITY_CHANGE_PATH, value_mode: "reference_only" },
  ]);
});

test("[AC-32] no-op field collection emits no Change descriptors", () => {
  const before = { quoted: true, phone_number: "5550000011" };
  assert.deepEqual(
    collectDocumentFieldChanges(before, { ...before }, ["quoted", "phone_number"]),
    [],
  );
});
