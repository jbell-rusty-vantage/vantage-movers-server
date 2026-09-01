import assert from "node:assert/strict";
import { test } from "node:test";
import type { sheets_v4 } from "googleapis";
import { TARIFF_SHEET_HEADERS } from "../../config/domain/tariff";
import {
  appendTariffAdjustmentRows,
  toTariffSheetRow,
  type TariffAdjustmentRow,
} from "./append";

const SAMPLE_ROWS: TariffAdjustmentRow[] = [
  {
    effectiveDate: "9/1/2026",
    pickupZone: "22079",
    deliveryZone: "29671",
    service: "Linehaul",
    rule: "300 cf",
    newRule: "$3.75 per cf",
    carrier: "C2C",
  },
  {
    effectiveDate: "9/1/2026",
    pickupZone: "22079",
    deliveryZone: "29671",
    service: "Additional Services",
    rule: "Binding Estimate Fee",
    newRule: "$956.25",
    carrier: "C2C",
  },
];

test("projects tariff rows into Effective Date through Carrier columns", () => {
  assert.deepEqual(toTariffSheetRow(SAMPLE_ROWS[0]), [
    "9/1/2026",
    "22079",
    "29671",
    "Linehaul",
    "300 cf",
    "$3.75 per cf",
    "C2C",
  ]);
  assert.equal(toTariffSheetRow(SAMPLE_ROWS[0]).length, TARIFF_SHEET_HEADERS.length);
});

test("appends both service rows and never upserts by identifier", async () => {
  const calls: string[] = [];
  const sheets = fakeTariffSheets({
    onAppend: (body) => {
      calls.push("append");
      assert.deepEqual(body.values, SAMPLE_ROWS.map(toTariffSheetRow));
      return { updates: { updatedRange: "'TARIFFS'!A2:G3" } };
    },
  });

  const result = await appendTariffAdjustmentRows(SAMPLE_ROWS, {
    sheets,
    spreadsheetId: "tariff-sheet",
  });

  assert.equal(result.appended, 2);
  assert.equal(result.tabName, "TARIFFS");
  assert.equal(result.updatedRange, "'TARIFFS'!A2:G3");
  assert.ok(calls.includes("append"));
  assert.equal(
    JSON.stringify(result.rows),
    JSON.stringify(SAMPLE_ROWS.map(toTariffSheetRow)),
  );
});

test("refuses an empty append", async () => {
  await assert.rejects(
    () =>
      appendTariffAdjustmentRows([], {
        sheets: fakeTariffSheets({}),
        spreadsheetId: "tariff-sheet",
      }),
    /at least one row/,
  );
});

function fakeTariffSheets(options: {
  onAppend?: (body: { values?: string[][] }) => { updates?: { updatedRange?: string } };
}): sheets_v4.Sheets {
  // Same duck-typed Sheets fake as tabs.test.ts: only the methods
  // ensureTabsAndHeaders and values.append call.
  return {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: "TARIFFS",
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
          ],
        },
      }),
      batchUpdate: async () => ({ data: {} }),
      values: {
        get: async () => ({ data: { values: [] } }),
        update: async () => ({ data: {} }),
        clear: async () => ({ data: {} }),
        append: async (request: { requestBody?: { values?: string[][] } }) => ({
          data: options.onAppend?.(request.requestBody ?? {}) ?? {},
        }),
      },
    },
  } as unknown as sheets_v4.Sheets;
}
