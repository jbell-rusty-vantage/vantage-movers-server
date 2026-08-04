import {
  MANAGED_ID_HEADER,
  isValidManagedIngestionId,
  managedId,
  newManagedIngestionId,
} from "./identity";
import {
  createSheetsClient,
  createWritableSheetsClient,
  readTab,
  resolveWorkbookIds,
  type SheetsClient,
} from "./sheets";
import type { IngestionInspection } from "../ingestion";
import type { SourceTab, TabReadResult } from "./types";
import { maskSpreadsheetId } from "../operationalWorkbooks";

const REQUIRED_HEADERS: Partial<Record<SourceTab, readonly string[]>> = {
  Forms: [
    "Time Stamp",
    "Name",
    "Pickup Zip",
    "Destination Zip",
    "Move Size",
    "Phone",
  ],
  "Local Forms": [
    "Time Stamp",
    "Name",
    "Pickup Zip",
    "Destination Zip",
    "Move Size",
    "Phone",
  ],
  Calls: ["PHONE NUMBER", "Date", "Time"],
  "Booked Deals": [
    "Timestamp",
    "Agent",
    "Book Date",
    "Job Number:",
    "Customer Name",
    "Binder Amount",
    "Deposit Amount",
    "Merchant",
    "Lead Source",
  ],
  Refunds: [
    "Refund Request Date",
    "Status",
    "Timestamp",
    "Job Number:",
    "Lead Source",
  ],
  // This tab is a formula matrix: row 1 names the report and row 2 contains
  // the amount buckets consumed by parseLidBestRelo.
  LID_BestRelo: ["BestRelo Booked Forms"],
};

export async function inspectBestRelocationSources(input: {
  repairIdentity: boolean;
  sheetsClient?: SheetsClient;
}): Promise<IngestionInspection> {
  const client =
    input.sheetsClient ??
    (input.repairIdentity
      ? createWritableSheetsClient()
      : createSheetsClient());
  const ids = resolveWorkbookIds();
  const tabs = await Promise.all([
    readTab(client, ids.leadsSheetId, "Forms"),
    readTab(client, ids.leadsSheetId, "Local Forms"),
    readTab(client, ids.leadsSheetId, "Calls"),
    readTab(client, ids.bookedSheetId, "Booked Deals"),
    readTab(client, ids.bookedSheetId, "Refunds"),
    readTab(client, ids.bookedSheetId, "LID_BestRelo"),
  ]);
  const checks: IngestionInspection["checks"] = [];
  for (const tab of tabs) {
    const missing = (REQUIRED_HEADERS[tab.tabName] ?? []).filter(
      (header) => !hasHeader(tab.headers, header),
    );
    checks.push({
      key: `schema:${tab.tabName}`,
      status: missing.length ? "blocking" : "healthy",
      summary: missing.length
        ? `Missing required headers in ${tab.tabName}`
        : `${tab.tabName} schema recognized`,
      ...(missing.length ? { details: { missing_headers: missing } } : {}),
    });
  }

  for (const tabName of ["Calls", "Refunds"] as const) {
    const tab = tabs.find((candidate) => candidate.tabName === tabName)!;
    const identity = await inspectOrRepairManagedIdentity(
      client,
      tab,
      input.repairIdentity,
    );
    checks.push(identity);
  }
  const lid = tabs.find((tab) => tab.tabName === "LID_BestRelo")!;
  const requiredBuckets = ["<1K", ">2K", ">4K"];
  const bucketHeaders = new Set(
    (lid.matrix[1] ?? []).map((value) => String(value ?? "").trim()),
  );
  const missingBuckets = requiredBuckets.filter(
    (bucket) => !bucketHeaders.has(bucket),
  );
  checks.push({
    key: "schema:LID_BestRelo:buckets",
    status: missingBuckets.length ? "blocking" : "healthy",
    summary: missingBuckets.length
      ? "LID_BestRelo is missing required amount buckets"
      : "LID_BestRelo amount buckets recognized",
    ...(missingBuckets.length
      ? { details: { missing_headers: missingBuckets } }
      : {}),
  });
  checks.push(await inspectLidFormulaHealth(client, lid));
  return {
    healthy: checks.every((check) => check.status !== "blocking"),
    checked_at: new Date().toISOString(),
    sources: [
      {
        role: "leads",
        title: tabs[0].spreadsheetTitle,
        masked_id: maskSpreadsheetId(ids.leadsSheetId),
      },
      {
        role: "booked",
        title: tabs[3].spreadsheetTitle,
        masked_id: maskSpreadsheetId(ids.bookedSheetId),
      },
    ],
    checks,
  };
}

export async function inspectOrRepairManagedIdentity(
  client: SheetsClient,
  tab: TabReadResult,
  repair: boolean,
): Promise<IngestionInspection["checks"][number]> {
  let columnIndex = tab.headers.findIndex((header) =>
    /^vantage[ _]ingestion[ _]id$/i.test(header.trim()),
  );
  if (columnIndex < 0 && repair) {
    // Some operational tabs carry an intentionally unlabeled trailing LID
    // column. Append after every populated source column, not merely after the
    // last named header, so managed identity setup cannot claim source data.
    columnIndex = Math.max(
      tab.headers.length,
      ...tab.matrix.map((row) => row.length),
    );
    await client.spreadsheets.values.update({
      spreadsheetId: tab.spreadsheetId,
      range: `'${escapeTab(tab.tabName)}'!${columnLetter(columnIndex + 1)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [[MANAGED_ID_HEADER]] },
    });
  }
  if (columnIndex < 0) {
    return {
      key: `identity:${tab.tabName}`,
      status: "blocking",
      summary: `${tab.tabName} is missing ${MANAGED_ID_HEADER}`,
    };
  }
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  const missingRows: number[] = [];
  for (let index = 1; index < tab.matrix.length; index += 1) {
    const cells = tab.matrix[index] ?? [];
    if (cells.every((value) => !String(value ?? "").trim())) continue;
    const value = String(cells[columnIndex] ?? "").trim();
    if (!value) {
      missingRows.push(index + 1);
    } else if (!isValidManagedIngestionId(value)) {
      return {
        key: `identity:${tab.tabName}`,
        status: "blocking",
        summary: `${tab.tabName} contains malformed managed identities`,
        details: { malformed_count: 1 },
      };
    } else if (seen.has(value.toLowerCase())) {
      duplicateIds.add(value);
    } else {
      seen.add(value.toLowerCase());
    }
  }
  if (duplicateIds.size) {
    return {
      key: `identity:${tab.tabName}`,
      status: "blocking",
      summary: `${tab.tabName} contains duplicate managed identities`,
      details: { duplicate_count: duplicateIds.size },
    };
  }
  if (missingRows.length && !repair) {
    return {
      key: `identity:${tab.tabName}`,
      status: "blocking",
      summary: `${tab.tabName} has rows requiring managed identity repair`,
      details: { missing_count: missingRows.length },
    };
  }
  const candidateRepairs = missingRows.map((rowNumber) => ({
    range: `'${escapeTab(tab.tabName)}'!${columnLetter(columnIndex + 1)}${rowNumber}`,
    id: newManagedIngestionId(),
    rowNumber,
  }));
  const repairs: typeof candidateRepairs = [];
  if (candidateRepairs.length) {
    const current = await client.spreadsheets.values.batchGet({
      spreadsheetId: tab.spreadsheetId,
      ranges: candidateRepairs.map((repair) => repair.range),
      valueRenderOption: "FORMATTED_VALUE",
    });
    for (let index = 0; index < candidateRepairs.length; index += 1) {
      const repair = candidateRepairs[index];
      const actual = String(
        current.data.valueRanges?.[index]?.values?.[0]?.[0] ?? "",
      ).trim();
      if (!actual) {
        repairs.push(repair);
        continue;
      }
      if (
        !isValidManagedIngestionId(actual) ||
        seen.has(actual.toLowerCase())
      ) {
        return {
          key: `identity:${tab.tabName}`,
          status: "blocking",
          summary: `${tab.tabName} changed during managed identity repair`,
          details: { conflicted_row_count: 1 },
        };
      }
      seen.add(actual.toLowerCase());
    }
  }
  let repairedCount = 0;
  if (repairs.length) {
    if (tab.tabId === undefined) {
      throw new Error(`Missing numeric sheet ID for ${tab.tabName}`);
    }
    const write = await client.spreadsheets.batchUpdate({
      spreadsheetId: tab.spreadsheetId,
      requestBody: {
        requests: repairs.map((repair) => ({
          findReplace: {
            range: {
              sheetId: tab.tabId,
              startRowIndex: repair.rowNumber - 1,
              endRowIndex: repair.rowNumber,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            },
            find: "^$",
            replacement: repair.id,
            matchCase: true,
            searchByRegex: true,
            includeFormulas: true,
          },
        })),
      },
    });
    const readBack = await client.spreadsheets.values.batchGet({
      spreadsheetId: tab.spreadsheetId,
      ranges: repairs.map((repair) => repair.range),
      valueRenderOption: "FORMATTED_VALUE",
    });
    for (let index = 0; index < repairs.length; index += 1) {
      const changed =
        write.data.replies?.[index]?.findReplace?.occurrencesChanged ?? 0;
      const actual = String(
        readBack.data.valueRanges?.[index]?.values?.[0]?.[0] ?? "",
      ).trim();
      if (changed === 1 && actual === repairs[index].id) {
        repairedCount += 1;
        continue;
      }
      if (
        changed === 0 &&
        isValidManagedIngestionId(actual) &&
        !seen.has(actual.toLowerCase())
      ) {
        seen.add(actual.toLowerCase());
        continue;
      }
      throw new Error(
        `Atomic managed identity repair was not applied for ${tab.tabName}; refusing an unconditional fallback write`,
      );
    }
  }
  return {
    key: `identity:${tab.tabName}`,
    status: "healthy",
    summary: repairedCount
      ? `Repaired ${repairedCount} managed identities in ${tab.tabName}`
      : `${tab.tabName} managed identities are healthy`,
  };
}

async function inspectLidFormulaHealth(
  client: SheetsClient,
  tab: TabReadResult,
): Promise<IngestionInspection["checks"][number]> {
  const response = await client.spreadsheets.values.get({
    spreadsheetId: tab.spreadsheetId,
    range: tab.rangeRead,
    valueRenderOption: "FORMULA",
    majorDimension: "ROWS",
  });
  const rows = response.data.values ?? [];
  const populated = rows.slice(1).filter((row) =>
    row.some((value) => String(value ?? "").trim()),
  );
  const formulaRows = populated.filter((row) =>
    row.some((value) => String(value ?? "").trim().startsWith("=")),
  );
  const healthy = populated.length === 0 || formulaRows.length > 0;
  return {
    key: "formula:LID_BestRelo",
    status: healthy ? "healthy" : "blocking",
    summary: healthy
      ? "LID_BestRelo formula evidence is present"
      : "LID_BestRelo has populated rows but no formulas",
    details: {
      populated_rows: populated.length,
      formula_rows: formulaRows.length,
    },
  };
}

function hasHeader(headers: string[], expected: string): boolean {
  const normalized = normalizeHeader(expected);
  return headers.some((header) => normalizeHeader(header) === normalized);
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function escapeTab(tab: string): string {
  return tab.replace(/'/g, "''");
}

function columnLetter(value: number): string {
  let current = value;
  let output = "";
  while (current > 0) {
    output = String.fromCharCode(65 + ((current - 1) % 26)) + output;
    current = Math.floor((current - 1) / 26);
  }
  return output;
}
