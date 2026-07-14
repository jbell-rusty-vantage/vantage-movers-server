import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SHEET_TAB_NAMES } from "../../config/domain";
import { buildCallLeadDeletePreviousTargets } from "./callLead.service";

const originalMasterLeadsSheetId = process.env.MASTER_LEADS_SHEET_ID;
const originalTestMasterLeadsSheetId = process.env.TEST_MASTER_LEADS_SHEET_ID;

afterEach(() => {
  process.env.MASTER_LEADS_SHEET_ID = originalMasterLeadsSheetId;
  process.env.TEST_MASTER_LEADS_SHEET_ID = originalTestMasterLeadsSheetId;
});

test("buildCallLeadDeletePreviousTargets includes Calls and Duplicate Calls fallbacks", () => {
  process.env.MASTER_LEADS_SHEET_ID = "master-leads-test";
  process.env.TEST_MASTER_LEADS_SHEET_ID = "master-leads-test";

  const targets = buildCallLeadDeletePreviousTargets({
    source_company: "tbm_leads",
    sheet_sync: [],
  });

  assert.deepEqual(
    targets.map((target) => `${target.target}:${target.tab_name}`),
    [
      `master_calls:${SHEET_TAB_NAMES.calls}`,
      `master_duplicate_calls:${SHEET_TAB_NAMES.duplicateCalls}`,
    ],
  );
});

test("buildCallLeadDeletePreviousTargets preserves known rows from sheet_sync", () => {
  process.env.MASTER_LEADS_SHEET_ID = "master-leads-test";
  process.env.TEST_MASTER_LEADS_SHEET_ID = "master-leads-test";

  const targets = buildCallLeadDeletePreviousTargets({
    source_company: "tbm_leads",
    sheet_sync: [
      {
        target: "master_calls",
        spreadsheet_id: "master-leads-test",
        tab_name: SHEET_TAB_NAMES.calls,
        row_number: 42,
        status: "synced",
      },
    ],
  });

  const callsTarget = targets.find((target) => target.target === "master_calls");
  const duplicateCallsTarget = targets.find(
    (target) => target.target === "master_duplicate_calls",
  );

  assert.equal(callsTarget?.row_number, 42);
  assert.equal(duplicateCallsTarget?.row_number, undefined);
});
