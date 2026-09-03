import assert from "node:assert/strict";
import { test } from "node:test";
import { SHEET_TAB_NAMES } from "../../config/domain";
import {
  runSheetContainsCheck,
  rowsFromValues,
  type SheetContainsDeps,
  type SheetContainsLoadedRecord,
  type SheetContainsOpenJob,
  type SheetContainsTabRead,
} from "./sheetContains";
import type { SheetContainsTabRef } from "./expectedSheetTabs";

const FORM_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const FORM_ID_TWO = "bbbbbbbbbbbbbbbbbbbbbbbb";
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

test("rowsFromValues maps Mongo ID cells and keeps evidence columns", () => {
  const rows = rowsFromValues(
    [
      ["Timestamp", "Name", "Mongo ID", "Phone Number"],
      ["1/1/2026", "Ada", FORM_ID, "3055551212"],
    ],
    ["Timestamp", "Name", "Mongo ID", "Phone Number"],
  );
  assert.equal(rows.get(FORM_ID)?.rowNumber, 2);
  assert.equal(rows.get(FORM_ID)?.cells.Name, "Ada");
});

test("found Form Lead returns Master Leads Forms evidence and a sheet link", async () => {
  const result = await runSheetContainsCheck(
    { entity_model: "FormLead", ids: [FORM_ID] },
    fakeDeps({
      records: [{ id: FORM_ID, label: "Ada Form", duplicate: false }],
      tabs: {
        [`master_leads:${SHEET_TAB_NAMES.forms}`]: formRow(FORM_ID),
      },
    }),
  );

  assert.equal(result.items[0]?.verdict, "found");
  assert.deepEqual(result.items[0]?.expected_tabs, [SHEET_TAB_NAMES.forms]);
  assert.equal(result.items[0]?.found[0]?.tab_name, SHEET_TAB_NAMES.forms);
  assert.equal(result.items[0]?.found[0]?.row_number, 42);
  assert.equal(
    result.items[0]?.found[0]?.sheet_url,
    `https://docs.google.com/spreadsheets/d/master-leads-id/edit#gid=11&range=A42`,
  );
  assert.ok(
    result.items[0]?.found[0]?.evidence.some(
      (cell) => cell.header === "Phone Number" && cell.value === "1212",
    ),
  );
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

test("Form Lead on Duplicates when Forms was expected is wrong_tab", async () => {
  const result = await runSheetContainsCheck(
    { entity_model: "FormLead", ids: [FORM_ID] },
    fakeDeps({
      records: [{ id: FORM_ID, label: "Ada Form", duplicate: false }],
      tabs: {
        [`master_leads:${SHEET_TAB_NAMES.duplicates}`]: {
          spreadsheetId: "master-leads-id",
          gid: 22,
          rows: new Map([[FORM_ID, { rowNumber: 8, cells: { Name: "Ada Form" } }]]),
        },
      },
    }),
  );

  assert.equal(result.items[0]?.verdict, "wrong_tab");
  assert.equal(result.items[0]?.found[0]?.tab_name, SHEET_TAB_NAMES.duplicates);
  assert.equal(result.items[0]?.found[0]?.role, "sibling");
});

test("unmatched Call Lead is not_expected and does not read tabs", async () => {
  let reads = 0;
  const result = await runSheetContainsCheck(
    { entity_model: "CallLead", ids: [CALL_ID] },
    {
      ...fakeDeps({
        records: [
          {
            id: CALL_ID,
            label: "Job 99",
            created_on_unmatched: true,
          },
        ],
        tabs: {},
      }),
      readTab: async (tab, spreadsheetId) => {
        reads += 1;
        return { spreadsheetId, rows: new Map() };
      },
    },
  );

  assert.equal(result.items[0]?.verdict, "not_expected");
  assert.equal(result.items[0]?.reason, "created_on_unmatched");
  assert.equal(reads, 0);
});

test("unknown Mongo id is not_found", async () => {
  const result = await runSheetContainsCheck(
    { entity_model: "FormLead", ids: [FORM_ID] },
    fakeDeps({ records: [], tabs: {} }),
  );
  assert.equal(result.items[0]?.verdict, "not_found");
  assert.equal(result.items[0]?.reason, "missing_from_mongo");
});

test("Bad Lead found on Forms but missing Bad Leads is still found with a missing tab", async () => {
  const result = await runSheetContainsCheck(
    { entity_model: "FormLead", ids: [FORM_ID] },
    fakeDeps({
      records: [
        {
          id: FORM_ID,
          label: "Ada Form",
          duplicate: false,
          bad_lead: "disconnected_number",
        },
      ],
      tabs: {
        [`master_leads:${SHEET_TAB_NAMES.forms}`]: formRow(FORM_ID),
      },
    }),
  );

  assert.equal(result.items[0]?.verdict, "found");
  assert.deepEqual(result.items[0]?.missing_expected_tabs, [SHEET_TAB_NAMES.badLeads]);
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

test("preserves request order and dedupes ids", async () => {
  const result = await runSheetContainsCheck(
    { entity_model: "FormLead", ids: [FORM_ID_TWO, FORM_ID, FORM_ID_TWO] },
    fakeDeps({
      records: [
        { id: FORM_ID, label: "One", duplicate: false },
        { id: FORM_ID_TWO, label: "Two", duplicate: false },
      ],
      tabs: {
        [`master_leads:${SHEET_TAB_NAMES.forms}`]: {
          spreadsheetId: "master-leads-id",
          rows: new Map([
            [FORM_ID, { rowNumber: 2, cells: { Name: "One" } }],
            [FORM_ID_TWO, { rowNumber: 3, cells: { Name: "Two" } }],
          ]),
        },
      },
    }),
  );

  assert.deepEqual(
    result.items.map((item) => item.id),
    [FORM_ID_TWO, FORM_ID],
  );
});
