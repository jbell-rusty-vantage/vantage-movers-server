import assert from "node:assert/strict";
import { test } from "node:test";
import type { sheets_v4 } from "googleapis";
import { TARIFF_SHEET_HEADERS } from "../../config/domain/tariff";
import { V1ServiceError } from "../v1ServiceError";
import {
  appendTariffAdjustmentRows,
  toTariffSheetRow,
  type TariffAdjustmentRow,
} from "./append";
import { formatTariffCarrierCell, resolveTariffCarrierCell } from "./resolveCarrier";

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

const RESOLVED_CARRIER = "COAST TO COAST VAN LINES INC 4168983";
const TIMESTAMP = "9/1/2026 12:00:00";

test("projects tariff rows into Timestamp through Carrier columns", () => {
  assert.deepEqual(toTariffSheetRow(SAMPLE_ROWS[0], TIMESTAMP), [
    TIMESTAMP,
    "9/1/2026",
    "22079",
    "29671",
    "Linehaul",
    "300 cf",
    "$3.75 per cf",
    "C2C",
  ]);
  assert.equal(toTariffSheetRow(SAMPLE_ROWS[0], TIMESTAMP).length, TARIFF_SHEET_HEADERS.length);
  assert.equal(TARIFF_SHEET_HEADERS[0], "Timestamp");
  assert.equal(TARIFF_SHEET_HEADERS[5], "Rule ");
});

test("resolves a Granot Carrier Code to the Moving Carrier name and DOT", async () => {
  assert.equal(
    formatTariffCarrierCell({
      name: "COAST TO COAST VAN LINES INC",
      dot_number: "4168983",
    }),
    RESOLVED_CARRIER,
  );

  const cell = await resolveTariffCarrierCell("c2c", async (code) => {
    assert.equal(code, "C2C");
    return { name: "COAST TO COAST VAN LINES INC", dot_number: "4168983" };
  });
  assert.equal(cell, RESOLVED_CARRIER);

  await assert.rejects(
    () => resolveTariffCarrierCell("UNKNOWN", async () => null),
    (error: unknown) =>
      error instanceof V1ServiceError &&
      error.statusCode === 400 &&
      error.message === "Unknown Granot Carrier Code: UNKNOWN",
  );
});

test("appends both service rows with resolved Carrier and never upserts by identifier", async () => {
  const calls: string[] = [];
  const sheets = fakeTariffSheets({
    onAppend: (body) => {
      calls.push("append");
      assert.deepEqual(
        body.values,
        SAMPLE_ROWS.map((row) =>
          toTariffSheetRow({ ...row, carrier: RESOLVED_CARRIER }, TIMESTAMP),
        ),
      );
      return { updates: { updatedRange: "'Master'!A2:H3" } };
    },
  });

  const result = await appendTariffAdjustmentRows(SAMPLE_ROWS, {
    sheets,
    spreadsheetId: "tariff-sheet",
    now: new Date("2026-09-01T16:00:00.000Z"),
    resolveCarrier: async (code) => {
      assert.equal(code, "C2C");
      return RESOLVED_CARRIER;
    },
  });

  assert.equal(result.appended, 2);
  assert.equal(result.tabName, "Master");
  assert.equal(result.updatedRange, "'Master'!A2:H3");
  assert.ok(calls.includes("append"));
  assert.equal(result.rows[0]?.[0], "9/1/2026 12:00:00");
  assert.equal(result.rows[0]?.[7], RESOLVED_CARRIER);
  assert.equal(result.rows[1]?.[7], RESOLVED_CARRIER);
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
  return {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: "Master",
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
