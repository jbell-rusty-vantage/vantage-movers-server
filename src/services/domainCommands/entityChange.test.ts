import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDeleteChangeFields,
  buildEntityChangeFields,
  CALL_LEAD_CHANGE_PATHS,
  changedPathsFromFields,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
} from "./entityChange";
import { DELETED_ENTITY_CHANGE_PATH } from "../../models/EntityChange";

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
