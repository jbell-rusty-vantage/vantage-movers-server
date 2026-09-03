/**
 * Append the two parsed Granot Forms View tariff rows to TARIFF_SHEET_ID
 * and read them back. Append-only. No customer or job identifiers.
 *
 *   pnpm prove:tariff-append
 */
import {
  TARIFF_SHEET_HEADERS,
  TARIFF_SHEET_TAB_NAME,
  getTariffSheetId,
} from "../src/config/domain/tariff";
import { redactSpreadsheetId } from "../src/services/googleSheets/diagnostics";
import { getSheetsClient } from "../src/services/googleSheets/auth";
import {
  appendTariffAdjustmentRows,
  type TariffAdjustmentRow,
} from "../src/services/tariff";
import { escapeSheetTitleForRange } from "../src/utils/googleSheets/ranges";

const PROOF_ROWS: TariffAdjustmentRow[] = [
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

async function main(): Promise<void> {
  const spreadsheetId = getTariffSheetId();
  const sheets = getSheetsClient();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties.title",
  });
  const tabTitles =
    meta.data.sheets
      ?.map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title)) ?? [];

  console.log(
    JSON.stringify(
      {
        spreadsheet: redactSpreadsheetId(spreadsheetId),
        title: meta.data.properties?.title ?? null,
        existingTabs: tabTitles,
        writingTab: TARIFF_SHEET_TAB_NAME,
      },
      null,
      2,
    ),
  );

  const result = await appendTariffAdjustmentRows(PROOF_ROWS, {
    sheets,
    spreadsheetId,
  });

  const readBack = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(result.tabName)}!A1:H`,
  });
  const values = readBack.data.values ?? [];
  const header = values[0] ?? [];
  const written = values.slice(-2);

  console.log(
    JSON.stringify(
      {
        appended: result.appended,
        updatedRange: result.updatedRange ?? null,
        headers: header,
        expectedHeaders: [...TARIFF_SHEET_HEADERS],
        lastTwoRows: written,
        matchesProof: JSON.stringify(written) === JSON.stringify(result.rows),
      },
      null,
      2,
    ),
  );

  if (JSON.stringify(header) !== JSON.stringify([...TARIFF_SHEET_HEADERS])) {
    throw new Error("Tariff sheet header row does not match TARIFF_SHEET_HEADERS");
  }
  if (JSON.stringify(written) !== JSON.stringify(result.rows)) {
    throw new Error("Read-back of the last two tariff rows did not match the append");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
