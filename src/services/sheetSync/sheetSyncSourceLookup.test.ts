import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("syncSourceLead evaluates no_sync before unmatched and deletes ordinary tabs without the facade", async () => {
  const source = await readFile(
    path.join(__dirname, "sheetSyncSourceLookup.ts"),
    "utf8",
  );
  const start = source.indexOf("export async function syncSourceLead");
  assert.ok(start >= 0);
  const next = source.indexOf("\nasync function deleteOrdinaryNoSyncLeadRows", start);
  const body = next === -1 ? source.slice(start) : source.slice(start, next);
  assert.match(body, /noSyncAppliesToNormalTabs/);
  assert.match(body, /deleteOrdinaryNoSyncLeadRows/);
  const unmatchedIndex = body.indexOf("created_on_unmatched");
  const noSyncIndex = body.indexOf("noSyncAppliesToNormalTabs");
  assert.ok(noSyncIndex >= 0 && unmatchedIndex > noSyncIndex);
  assert.match(body, /syncFormLeadToSheets/);
  assert.match(body, /syncCallLeadToSheets/);

  const deleteFn = source.slice(source.indexOf("async function deleteOrdinaryNoSyncLeadRows"));
  assert.match(deleteFn, /deleteRowsFromTargets/);
  assert.match(deleteFn, /master_forms/);
  assert.match(deleteFn, /master_calls/);
  assert.doesNotMatch(deleteFn, /master_duplicates/);
  assert.doesNotMatch(deleteFn, /master_bad_leads/);
  assert.doesNotMatch(deleteFn, /master_duplicate_calls/);
});
