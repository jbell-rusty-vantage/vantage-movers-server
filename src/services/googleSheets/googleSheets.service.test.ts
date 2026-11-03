import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { syncFormLeadToSheets } from "./googleSheets.service";
import type { FormLeadSheetSource } from "./types";
import type { SheetSyncEntry } from "../../models/schemaHelpers";

const previous = { master: process.env.MASTER_LEADS_SHEET_ID, testMaster: process.env.TEST_MASTER_LEADS_SHEET_ID };
afterEach(() => {
  if (previous.master === undefined) delete process.env.MASTER_LEADS_SHEET_ID; else process.env.MASTER_LEADS_SHEET_ID = previous.master;
  if (previous.testMaster === undefined) delete process.env.TEST_MASTER_LEADS_SHEET_ID; else process.env.TEST_MASTER_LEADS_SHEET_ID = previous.testMaster;
});
function form(overrides: Partial<FormLeadSheetSource> = {}): FormLeadSheetSource {
  process.env.MASTER_LEADS_SHEET_ID = process.env.TEST_MASTER_LEADS_SHEET_ID = "fixture-master";
  return { _id: { toString: () => "form-id" }, timestamp: new Date(), name: "Synthetic", phone_number: "5551112222",
    pickup_zip: "10001", destination_zip: "90210", move_size: "Studio", move_date: new Date(), source_company: "main_site",
    local: "long_distance", bad_lead: "auto_only", sheet_sync: [], ...overrides } as FormLeadSheetSource;
}

test("direct bad Form facade upserts only Bad Form Leads then discovers stale primaries without metadata", async () => {
  const lead = form({ duplicate: true, no_sync: true });
  const calls: string[] = [];
  await syncFormLeadToSheets(lead, {
    syncRowToTargets: async (doc, targets) => {
      assert.equal(doc, lead);
      assert.deepEqual(targets.map(target => target.tabName), ["Bad Form Leads"]);
      calls.push("upsert");
      return targets.map(target => ({ target: target.target, status: "synced" } as SheetSyncEntry));
    },
    deleteRowsFromTargets: async (doc, targets, keys) => {
      assert.deepEqual(calls, ["upsert"]);
      assert.equal(doc, lead);
      assert.deepEqual(targets.map(target => target.tabName), ["Forms", "Duplicate Forms", "Duplicates"]);
      assert.deepEqual(keys, ["master_forms", "source_forms", "master_duplicates", "source_duplicates"]);
      calls.push("delete"); return [];
    },
  });
  assert.deepEqual(calls, ["upsert", "delete"]);
  assert.equal(lead.duplicate, true);
});

test("failed bad Form destination keeps primary rows; destination-written delete failure can replay", async () => {
  const lead = form();
  let failedDestination = true, failedDelete = false, deletes = 0, upserts = 0;
  const delivery: NonNullable<Parameters<typeof syncFormLeadToSheets>[1]> = {
    syncRowToTargets: async (_doc, targets) => {
      upserts++;
      return targets.map(target => ({ target: target.target, status: failedDestination ? "failed" : "synced" } as SheetSyncEntry));
    },
    deleteRowsFromTargets: async () => { deletes++; if (failedDelete) throw new Error("stale_delete_interrupted"); return ["master_forms"]; },
  };
  const failed = await syncFormLeadToSheets(lead, delivery);
  assert.equal(failed[0].status, "failed"); assert.equal(deletes, 0);
  failedDestination = false; failedDelete = true;
  await assert.rejects(syncFormLeadToSheets(lead, delivery), /stale_delete_interrupted/);
  failedDelete = false;
  const repaired = await syncFormLeadToSheets(lead, delivery);
  assert.equal(upserts, 3); assert.equal(deletes, 2);
  assert.deepEqual(repaired.map(result => [result.target, result.status]), [["master_bad_leads", "synced"], ["master_forms", "deleted"]]);
});

test("No-Sync Form whose bad flag was cleared cleans both old and new exception titles", async () => {
  await syncFormLeadToSheets(form({ no_sync: true, bad_lead: null }), {
    syncRowToTargets: async () => { throw new Error("must_not_upsert"); },
    deleteRowsFromTargets: async (_doc, targets) => {
      assert.deepEqual(targets.map(target => target.tabName), ["Forms", "Duplicate Forms", "Duplicates", "Bad Form Leads", "Bad Leads"]);
      return [];
    },
  });
});
