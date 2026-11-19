import assert from "node:assert/strict";
import { test } from "node:test";
import { SHEET_TAB_NAMES } from "../../config/domain";
import {
  runSheetContainsCheck,
  type SheetContainsDeps,
  type SheetContainsLoadedRecord,
  type SheetContainsOpenJob,
  type SheetContainsTabRead,
} from "./sheetContains";
import type { SheetContainsTabRef } from "./expectedSheetTabs";
import { LEGACY_BEST_RELOCATION_CALL_IDS } from "../leads/legacyBestRelocationCalls";
import { BEST_RELOCATION_ADMISSION_COMPANY_ID, BEST_RELOCATION_ADMISSION_CALL_FEED_ID } from "../leads/callLeadAdmission";

const FORM_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const CALL_ID = "cccccccccccccccccccccccc";
const BOOKING_ID = "dddddddddddddddddddddddd";

function tabKey(tab: SheetContainsTabRef): string {
  return `${tab.workbook}:${tab.tabName}`;
}

function fakeDeps(args: {
  records: SheetContainsLoadedRecord[];
  tabs: Record<string, SheetContainsTabRead>;
  jobs?: Map<string, SheetContainsOpenJob>;
}): SheetContainsDeps {
  return {
    loadRecords: async (_model, ids) => args.records.filter((record) => ids.includes(record.id)),
    resolveSpreadsheetId: (workbook) =>
      workbook === "master_leads" ? "master-leads-id" : "master-booked-id",
    readTab: async (tab, spreadsheetId) => {
      const read = args.tabs[tabKey(tab)];
      return (
        read ?? {
          spreadsheetId,
          gid: 0,
          rows: new Map(),
        }
      );
    },
    loadOpenJobs: async () => args.jobs ?? new Map(),
    now: () => new Date("2026-09-03T15:00:00.000Z"),
  };
}

function formRow(id: string, extras: Record<string, string> = {}): SheetContainsTabRead {
  return {
    spreadsheetId: "master-leads-id",
    gid: 11,
    rows: new Map([
      [
        id,
        {
          rowNumber: 42,
          cells: {
            Name: "Ada Form",
            "Ref No": "REF-1",
            "Source Company": "Top10",
            "Phone Number": "3055551212",
            ...extras,
          },
        },
      ],
    ]),
  };
}

const qualifiedCall = { call_log_id: "call-log-1", duration_seconds: 120, ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s" };

test("contains transports historical BR identity for No-Sync Form Fill and duplicate exceptions", async () => {
  const id = LEGACY_BEST_RELOCATION_CALL_IDS[0];
  for (const flags of [{ form_fill: true }, { duplicate: true }, {}]) {
    const result = await runSheetContainsCheck({ entity_model: "CallLead", ids: [id] }, fakeDeps({
      records: [{ _id: id, id, label: "Synthetic historical", source_company: "best_relocation_leads",
        lead_source_company: BEST_RELOCATION_ADMISSION_COMPANY_ID, source_granularity_id: BEST_RELOCATION_ADMISSION_CALL_FEED_ID, no_sync: true, ...flags }],
      tabs: { "master_leads:Duplicate Calls": formRow(id) },
    }));
    assert.deepEqual(result.items[0].expected_tabs, "form_fill" in flags || "duplicate" in flags ? ["Duplicate Calls"] : []);
  }
});

test("missing Form Lead stays missing and can attach an open Sheet Sync job", async () => {
  const result = await runSheetContainsCheck(
    { entity_model: "FormLead", ids: [FORM_ID] },
    fakeDeps({
      records: [{ id: FORM_ID, label: "Ada Form", duplicate: false }],
      tabs: {},
      jobs: new Map([
        [
          FORM_ID,
          { job_id: "job-1", status: "pending", resource: "source_lead" },
        ],
      ]),
    }),
  );

  assert.equal(result.items[0]?.verdict, "missing");
  assert.deepEqual(result.items[0]?.missing_expected_tabs, [SHEET_TAB_NAMES.forms]);
  assert.equal(result.items[0]?.open_job?.status, "pending");
});

test("No-Sync bad Form found only on Forms is wrong_tab and still requires Bad Form Leads", async () => {
  const result = await runSheetContainsCheck(
    { entity_model: "FormLead", ids: [FORM_ID] },
    fakeDeps({
      records: [
        {
          id: FORM_ID,
          label: "Ada Form",
          no_sync: true,
          duplicate: false,
          bad_lead: "disconnected_number",
        },
      ],
      tabs: {
        [`master_leads:${SHEET_TAB_NAMES.forms}`]: formRow(FORM_ID),
      },
    }),
  );

  assert.equal(result.items[0]?.verdict, "wrong_tab");
  assert.notEqual(result.items[0]?.reason, "no_sync");
  assert.deepEqual(result.items[0]?.missing_expected_tabs, [SHEET_TAB_NAMES.badLeads]);
});

test("No-Sync + Duplicate Call Lead uses today's Duplicate Calls tab, not the no_sync skip", async () => {
  const result = await runSheetContainsCheck(
    { entity_model: "CallLead", ids: [CALL_ID] },
    fakeDeps({
      records: [
        {
          id: CALL_ID, ringcentral: qualifiedCall,
          label: "Job 99",
          no_sync: true,
          duplicate: true,
        },
      ],
      tabs: {
        [`master_leads:${SHEET_TAB_NAMES.duplicateCalls}`]: {
          spreadsheetId: "master-leads-id",
          gid: 33,
          rows: new Map([[CALL_ID, { rowNumber: 5, cells: { "Job No": "99" } }]]),
        },
      },
    }),
  );

  assert.equal(result.items[0]?.verdict, "found");
  assert.notEqual(result.items[0]?.reason, "no_sync");
  assert.deepEqual(result.items[0]?.expected_tabs, [SHEET_TAB_NAMES.duplicateCalls]);
});

test("Booking found on Booked Deals", async () => {
  const result = await runSheetContainsCheck(
    { entity_model: "BookedLead", ids: [BOOKING_ID] },
    fakeDeps({
      records: [{ id: BOOKING_ID, label: "Booked Ada" }],
      tabs: {
        [`master_booked:${SHEET_TAB_NAMES.bookedDeals}`]: {
          spreadsheetId: "master-booked-id",
          gid: 7,
          rows: new Map([
            [
              BOOKING_ID,
              {
                rowNumber: 3,
                cells: {
                  "Job No": "JN-1",
                  "Customer Name": "Booked Ada",
                  "Mongo Lead ID": FORM_ID,
                },
              },
            ],
          ]),
        },
      },
    }),
  );

  assert.equal(result.items[0]?.verdict, "found");
  assert.equal(result.items[0]?.found[0]?.workbook, "Master Booked");
  assert.equal(result.items[0]?.found[0]?.tab_name, SHEET_TAB_NAMES.bookedDeals);
});
