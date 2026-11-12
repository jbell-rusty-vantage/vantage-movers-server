import assert from "node:assert/strict";
import test from "node:test";
import type { sheets_v4 } from "googleapis";
import { captureLiteralCallPhones, literalCallPhoneEvidence } from "./sourceCellEvidence";
import { BEST_RELOCATION_TRACKER_ID } from "../../src/services/leads/externalSheetReview";
import type { TabReadResult } from "../../src/services/bestRelocationSheetIngest/types";

const cell = (formulaValue = "+44 (0)20 1234 5678"): sheets_v4.Schema$CellData => ({
  userEnteredValue: { formulaValue }, effectiveValue: { errorValue: { type: "ERROR", message: "Formula parse error." } }, formattedValue: "#ERROR!",
});
const input = () => ({ workbook_id: BEST_RELOCATION_TRACKER_ID, sheet_id: 1191420872, row: 244, column: 1,
  checker: "International Number", captured_resolved_value: "#ERROR!", cell: cell() });

test("captures the exact international literal without deleting optional trunk digits", () => {
  const evidence = literalCallPhoneEvidence(input());
  assert.equal(evidence?.phone_literal, "+44 (0)20 1234 5678");
  assert.equal(evidence?.user_entered_formula, evidence?.phone_literal);
  assert.equal(evidence?.resolved_value, "#ERROR!");
});

test("refuses calculated formulas, implausible digits, and unrelated errors or annotations", () => {
  for (const formula of ['=CONCAT("+44", "2012345678")', "+1234567", "+1234567890123456", "+12345678/2", "+12345678;IMPORTDATA(1)"])
    assert.equal(literalCallPhoneEvidence({ ...input(), cell: cell(formula) }), null);
  assert.equal(literalCallPhoneEvidence({ ...input(), checker: "Bad Phone" }), null);
  assert.equal(literalCallPhoneEvidence({ ...input(), captured_resolved_value: "+442012345678" }), null);
  assert.equal(literalCallPhoneEvidence({ ...input(), sheet_id: 1 }), null);
  assert.equal(literalCallPhoneEvidence({ ...input(), cell: { ...cell(), effectiveValue: { errorValue: { type: "REF", message: "Formula parse error." } } } }), null);
  assert.equal(literalCallPhoneEvidence({ ...input(), cell: { ...cell(), effectiveValue: { errorValue: { type: "ERROR", message: "Other error" } } } }), null);
  assert.equal(literalCallPhoneEvidence({ ...input(), cell: { ...cell(), formattedValue: "123" } }), null);
});

function tab(): TabReadResult {
  return { spreadsheetId: BEST_RELOCATION_TRACKER_ID, spreadsheetTitle: "Tracker", tabId: 1191420872, tabName: "Calls",
    headers: ["PHONE NUMBER", "Form Fill Checker"], matrix: [["PHONE NUMBER", "Form Fill Checker"],
      ["#ERROR!", "International Number"], ["2125550100", ""], ["#ERROR!", "Unrelated"], ["#ERROR!", " international  number "]], rangeRead: "Calls!A1:B5" };
}
function client(get: (args: any) => Promise<any>) { return { spreadsheets: { get } } as unknown as sheets_v4.Sheets; }

test("reads only selected error coordinates and ignores a non-literal formula", async () => {
  let requests = 0;
  const result = await captureLiteralCallPhones(client(async args => {
    requests++;
    assert.deepEqual(args.ranges, ["'Calls'!A2:A2", "'Calls'!A5:A5"]);
    return { data: { spreadsheetId: BEST_RELOCATION_TRACKER_ID, sheets: [{ properties: { sheetId: 1191420872, title: "Calls" },
      data: [{ startRow: 1, startColumn: 0, rowData: [{ values: [cell("+81 80-1234-5678")] }] },
        { startRow: 4, startColumn: 0, rowData: [{ values: [cell('=NOW()')] }] }] }] } };
  }), tab());
  assert.equal(requests, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.row, 2);
  assert.equal(result[0]?.phone_literal, "+81 80-1234-5678");
});

test("empty selection does not call Sheets and mismatched grid evidence fails closed", async () => {
  const empty = tab(); empty.matrix = empty.matrix.filter((_row, i) => i === 0 || i === 2);
  assert.deepEqual(await captureLiteralCallPhones(client(async () => { throw new Error("unexpected read"); }), empty), []);
  await assert.rejects(captureLiteralCallPhones(client(async () => ({ data: { spreadsheetId: BEST_RELOCATION_TRACKER_ID,
    sheets: [{ properties: { sheetId: 1191420872, title: "Calls" }, data: [{ startRow: 2, rowData: [{ values: [cell()] }] }] }] } })), tab()), /cell_mismatch/);
  await assert.rejects(captureLiteralCallPhones(client(async () => ({ data: { spreadsheetId: BEST_RELOCATION_TRACKER_ID, sheets: [] } })), tab()), /cell_missing/);
});
