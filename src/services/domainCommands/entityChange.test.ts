import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDeleteChangeFields,
  buildEntityChangeFields,
  CALL_LEAD_CHANGE_PATHS,
  changedPathsFromFields,
  classifyEntityChangePath,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
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
  assert.equal(classifyEntityChangePath("granot_priority"), "stored");
  assert.equal(classifyEntityChangePath("quoted"), "stored");
  assert.equal(classifyEntityChangePath("receiver_agent"), "stored");
  assert.equal(classifyEntityChangePath("lead_ref"), "stored");
  assert.equal(classifyEntityChangePath("source_scope"), "stored");
  assert.equal(classifyEntityChangePath("granot_contact_snapshot"), "reference_only");
  assert.equal(classifyEntityChangePath("name"), "reference_only");
  assert.equal(classifyEntityChangePath("destination_zip"), "reference_only");
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

test("FORM and CALL CHANGE_PATHS include no_sync so a flip is not a silent no-op", () => {
  assert.equal(FORM_LEAD_CHANGE_PATHS.includes("no_sync"), true);
  assert.equal(CALL_LEAD_CHANGE_PATHS.includes("no_sync"), true);
  assert.equal(classifyEntityChangePath("no_sync"), "stored");
});

test("collectDocumentFieldChanges reports no_sync when it flips and no-ops when unchanged", () => {
  const flipped = collectDocumentFieldChanges(
    { no_sync: false },
    { no_sync: true },
    FORM_LEAD_CHANGE_PATHS,
  );
  assert.deepEqual(flipped, [{ path: "no_sync", before: false, after: true }]);

  const cleared = collectDocumentFieldChanges(
    { no_sync: true },
    { no_sync: false },
    CALL_LEAD_CHANGE_PATHS,
  );
  assert.deepEqual(cleared, [{ path: "no_sync", before: true, after: false }]);

  assert.deepEqual(
    collectDocumentFieldChanges({ no_sync: true }, { no_sync: true }, FORM_LEAD_CHANGE_PATHS),
    [],
  );
  assert.deepEqual(
    collectDocumentFieldChanges({ quoted: true }, { quoted: true }, FORM_LEAD_CHANGE_PATHS),
    [],
  );
});
