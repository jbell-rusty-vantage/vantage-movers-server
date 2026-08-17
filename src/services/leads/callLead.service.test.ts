import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SHEET_TAB_NAMES } from "../../config/domain";
import { buildCallLeadDeletePreviousTargets } from "./callLead.service";
import {
  callLeadCreationProvenanceFields,
  deriveCallLeadIngestionOrigin,
} from "./leadIngestionProvenance";

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

test("[AC-12] manual Admin and RingCentral Call paths derive exact origins and quoted false", () => {
  assert.equal(deriveCallLeadIngestionOrigin({}), "vantage_admin");
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "ringcentral" }),
    "ringcentral",
  );
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "external_sheet_ingestion" }),
    "best_relocation_sheet",
  );
  const now = new Date("2026-08-17T16:10:00.000Z");
  const ringcentral = callLeadCreationProvenanceFields({
    origin: "ringcentral",
    now,
    contact: { phone_number: "5550100101" },
  });
  assert.equal(ringcentral.quoted, false);
  assert.equal(ringcentral.ingestion_origin, "ringcentral");
  assert.equal(ringcentral.ingested_contact_snapshot.evidence_status, "captured_at_ingestion");
});
