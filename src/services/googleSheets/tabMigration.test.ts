import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { sheets_v4 } from "googleapis";
import { planLeadTabMigration, applyLeadTabMigration, type TabIdentity } from "./tabMigration";
import { getMasterLeadsTabs } from "./targets";
import { resolveCompatibleSheetTitle, resetEnsuredTabsCache } from "./tabs";

afterEach(resetEnsuredTabsCache);

const before: TabIdentity[] = ["Forms", "Calls", "Duplicates", "Duplicate Calls", "Bad Leads"].map((title, sheetId) => ({ title, sheetId }));
function metadata(tabs: TabIdentity[]) {
  let writes = 0;
  const headers = new Map<string, readonly string[]>();
  const sheets = { spreadsheets: {
    get: async () => ({ data: { sheets: tabs.map((properties) => ({ properties: { ...properties, gridProperties: { columnCount: 30 } } })) } }),
    batchUpdate: async ({ requestBody }: any) => {
      writes++;
      for (const request of requestBody.requests) {
        if (request.updateSheetProperties?.fields === "title") {
          const p = request.updateSheetProperties.properties;
          tabs.find((tab) => tab.sheetId === p.sheetId)!.title = p.title;
        }
        if (request.addSheet) tabs.push({ sheetId: 100, title: request.addSheet.properties.title });
      }
      return { data: {} };
    },
    values: {
      batchGet: async ({ ranges }: { ranges: string[] }) => ({ data: { valueRanges: ranges.map((range) => ({ values: [headers.get(/^'([^']+)'!/.exec(range)![1]) ?? []] })) } }),
      update: async ({ range, requestBody }: any) => { writes++; headers.set(/^'([^']+)'!/.exec(range)![1], requestBody.values[0]); return { data: {} }; },
      clear: async () => { writes++; return { data: {} }; },
    },
  } } as unknown as sheets_v4.Sheets;
  return { sheets, writes: () => writes, headers };
}

test("both titles are a conflict and compatibility never silently chooses a tab", async () => {
  const tabs = [...before, { sheetId: 99, title: "Duplicate Forms" }];
  const plan = planLeadTabMigration("fixture", tabs);
  assert.ok(plan.conflicts[0].includes("2:99"));
  await assert.rejects(resolveCompatibleSheetTitle(metadata(tabs).sheets, "fixture", "Duplicate Forms"), /sheet_title_conflict/);
});

test("a warm writer observes the legacy tab rename without a local cache reset", async () => {
  const tabs = [{ sheetId: 2, title: "Duplicates" }];
  const f = metadata(tabs);
  assert.equal(await resolveCompatibleSheetTitle(f.sheets, "warm-fixture", "Duplicate Forms"), "Duplicates");
  tabs[0].title = "Duplicate Forms";
  assert.equal(await resolveCompatibleSheetTitle(f.sheets, "warm-fixture", "Duplicate Forms"), "Duplicate Forms");
  assert.equal(await resolveCompatibleSheetTitle(f.sheets, "warm-fixture", "Duplicates"), "Duplicate Forms");
});

test("fenced apply preserves numeric IDs, verifies headers, and a repeated apply writes nothing", async () => {
  const tabs = structuredClone(before), f = metadata(tabs), plan = planLeadTabMigration("fixture", tabs);
  await assert.rejects(applyLeadTabMigration(f.sheets, plan, { writersFenced: false }), /must_be_fenced/);
  const after = await applyLeadTabMigration(f.sheets, plan, { writersFenced: true });
  assert.equal(tabs.find((tab) => tab.sheetId === 2)!.title, "Duplicate Forms");
  assert.equal(tabs.find((tab) => tab.sheetId === 4)!.title, "Bad Form Leads");
  assert.deepEqual(after.conflicts, []);
  assert.equal(after.renames.length + after.creates.length, 0);
  for (const tab of getMasterLeadsTabs()) assert.deepEqual(f.headers.get(tab.tabName), tab.headers);
  const writes = f.writes();
  await applyLeadTabMigration(f.sheets, plan, { writersFenced: true });
  assert.equal(f.writes(), writes);
});

test("apply rejects changed topology and tampered plans", async () => {
  const plan = planLeadTabMigration("fixture", before);
  await assert.rejects(applyLeadTabMigration(metadata([...before]).sheets, { ...plan, checksum: "invalid" }, { writersFenced: true }), /checksum/);
  await assert.rejects(applyLeadTabMigration(metadata([...before, { sheetId: 200, title: "new owner tab" }]).sheets, plan, { writersFenced: true }), /topology_changed/);
});
