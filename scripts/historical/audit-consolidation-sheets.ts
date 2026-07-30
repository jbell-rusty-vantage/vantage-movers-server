import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { createGoogleSheetsClient } from "./google-sheets-auth";
import {
  cell,
  getHeaderMap,
  isBlankRow,
  parseDate,
  parseDateTime,
  type ParsedSheetRow,
  type SheetRow,
} from "./sheet-read-utils";
import { normalizeJobNo } from "../../src/services/bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../src/utils/phone";

type TabKind = "form" | "call" | "booked" | "refund" | "bad_leads";

type WorkbookConfig = {
  key: string;
  label: string;
  spreadsheetId: string;
  tabs: readonly {
    name: string;
    kind: TabKind;
  }[];
};

type DuplicateMetric = {
  populated: number;
  duplicate_values: number;
  duplicate_rows: number;
  max_rows_per_value: number;
};

type TabAudit = {
  tab: string;
  kind: TabKind;
  headers: string[];
  rows: number;
  date_field: string;
  dated_rows: number;
  invalid_date_rows: number;
  earliest: string | null;
  latest: string | null;
  key_coverage: Record<string, number>;
  duplicates: Record<string, DuplicateMetric>;
};

type WorkbookAudit = {
  key: string;
  label: string;
  spreadsheet_id: string;
  spreadsheet_title: string;
  actual_tabs: string[];
  configured_tabs: TabAudit[];
  missing_configured_tabs: string[];
};

const OUTPUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "historical",
  "reports",
);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function workbookConfigs(): readonly WorkbookConfig[] {
  return [
    {
      key: "top10",
      label: "Top 10 Leads",
      spreadsheetId: "1aZavJvIt9RGHOsE1mlcTGlIHdW0yCk7MsAy5MGLaYhQ",
      tabs: [
        { name: "Forms", kind: "form" },
        { name: "Calls", kind: "call" },
      ],
    },
    {
      key: "tbm",
      label: "TBM Leads",
      spreadsheetId: "1yR9xsnSfdniod2bdmb03HdvXAfI1U3i0nh1t5fHGnLU",
      tabs: [
        { name: "LeadsNew", kind: "form" },
        { name: "Calls", kind: "call" },
        { name: "Bad_Leads", kind: "bad_leads" },
      ],
    },
    {
      key: "tbm_primes",
      label: "TBM Primes",
      spreadsheetId: "1sDXK2-R8WhIloeNOoXCW4-BmdskWqHLQVWziPesbW00",
      tabs: [
        { name: "Leads", kind: "form" },
        { name: "Calls", kind: "call" },
        { name: "Bad_Leads", kind: "bad_leads" },
      ],
    },
    {
      key: "best_relocation",
      label: "Best Relocation",
      spreadsheetId: "13mp2vRyVKerAWBFfRvmEMjftDJE_QIbf14pzdKxsODg",
      tabs: [
        { name: "Forms", kind: "form" },
        { name: "Calls", kind: "call" },
        { name: "Local Forms", kind: "form" },
      ],
    },
    {
      key: "booked_responses",
      label: "Booked Deal Form Responses",
      spreadsheetId: requiredEnv("BACKFILL_BOOKED_SHEET_ID"),
      tabs: [
        { name: "Booked Deals", kind: "booked" },
        { name: "Refunds", kind: "refund" },
      ],
    },
  ] as const;
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valueFrom(row: SheetRow, ...aliases: string[]): string {
  const valuesByHeader = new Map(
    Object.entries(row).map(([header, value]) => [
      normalizedHeader(header),
      cell(value),
    ]),
  );
  for (const alias of aliases) {
    const value = valuesByHeader.get(normalizedHeader(alias));
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizedName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function rowDate(
  row: SheetRow,
  kind: TabKind,
): { label: string; value: Date | undefined } {
  if (kind === "call") {
    const timestamp = valueFrom(row, "Timestamp", "Time Stamp");
    if (timestamp) {
      return { label: "Timestamp", value: parseDate(timestamp) };
    }
    const date = valueFrom(row, "Date");
    const time = valueFrom(row, "Time");
    return {
      label: time ? "Date + Time" : "Date",
      value: time ? parseDateTime(date, time) : parseDate(date),
    };
  }

  if (kind === "refund") {
    const timestamp = valueFrom(row, "Timestamp", "Time Stamp");
    const refundDate = valueFrom(
      row,
      "Refund Request Date",
      "Cancel Date",
      "Cancellation Date",
    );
    return {
      label: timestamp ? "Timestamp" : "Refund Request Date",
      value: parseDate(timestamp || refundDate),
    };
  }

  const timestamp = valueFrom(row, "Timestamp", "Time Stamp", "Date");
  return { label: "Timestamp", value: parseDate(timestamp) };
}

function duplicateMetric(values: string[]): DuplicateMetric {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const duplicateCounts = [...counts.values()].filter((count) => count > 1);
  return {
    populated: values.filter(Boolean).length,
    duplicate_values: duplicateCounts.length,
    duplicate_rows: duplicateCounts.reduce((sum, count) => sum + count, 0),
    max_rows_per_value:
      duplicateCounts.length > 0 ? Math.max(...duplicateCounts) : 0,
  };
}

function keyValues(
  rows: ParsedSheetRow[],
  kind: TabKind,
): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  const add = (name: string, value: string) => {
    (values[name] ??= []).push(value);
  };

  for (const { raw } of rows) {
    const phone = normalizePhoneNumberForMatch(
      valueFrom(raw, "Phone", "Phone Number", "PHONE NUMBER"),
    );
    const name = normalizedName(
      valueFrom(raw, "Name", "Customer Name", "Customer"),
    );
    const lid = normalizeIdentifier(
      valueFrom(raw, "Lead ID", "LID", "Submission ID"),
    );
    const job = normalizeJobNo(
      valueFrom(raw, "Job Number:", "Job Number", "Job No", "Ref No"),
    );
    const date = rowDate(raw, kind).value?.toISOString() ?? "";

    if (kind === "form" || kind === "bad_leads") {
      add("lid", lid);
      add("ref_or_job_no", job ?? "");
      add("phone", phone ?? "");
      add("name", name);
      add("phone_timestamp", phone && date ? `${phone}|${date}` : "");
    } else if (kind === "call") {
      add("job_no", job ?? "");
      add("phone", phone ?? "");
      add("phone_timestamp", phone && date ? `${phone}|${date}` : "");
    } else if (kind === "booked") {
      add("job_no", job ?? "");
      add("lid", lid);
      add("customer_name", name);
    } else {
      add("job_no", job ?? "");
      add("customer_name", name);
    }
  }

  return values;
}

function auditTab(
  tabName: string,
  kind: TabKind,
  headers: string[],
  rows: ParsedSheetRow[],
): TabAudit {
  const parsedDates = rows.map(({ raw }) => rowDate(raw, kind));
  const dates = parsedDates
    .map(({ value }) => value)
    .filter((value): value is Date => value instanceof Date);
  const rawDateRows = rows.filter(({ raw }, index) => {
    const label = parsedDates[index]?.label;
    if (label === "Date + Time" || label === "Date") {
      return Boolean(valueFrom(raw, "Date"));
    }
    if (label === "Refund Request Date") {
      return Boolean(
        valueFrom(
          raw,
          "Refund Request Date",
          "Cancel Date",
          "Cancellation Date",
        ),
      );
    }
    return Boolean(valueFrom(raw, "Timestamp", "Time Stamp", "Date"));
  }).length;
  const values = keyValues(rows, kind);
  const keyCoverage = Object.fromEntries(
    Object.entries(values).map(([key, entries]) => [
      key,
      entries.filter(Boolean).length,
    ]),
  );
  const duplicates = Object.fromEntries(
    Object.entries(values).map(([key, entries]) => [
      key,
      duplicateMetric(entries),
    ]),
  );

  return {
    tab: tabName,
    kind,
    headers,
    rows: rows.length,
    date_field: parsedDates.find(({ value }) => value)?.label ?? "unresolved",
    dated_rows: dates.length,
    invalid_date_rows: Math.max(0, rawDateRows - dates.length),
    earliest:
      dates.length > 0
        ? new Date(Math.min(...dates.map((value) => value.getTime()))).toISOString()
        : null,
    latest:
      dates.length > 0
        ? new Date(Math.max(...dates.map((value) => value.getTime()))).toISOString()
        : null,
    key_coverage: keyCoverage,
    duplicates,
  };
}

function escapeSheetTitleForRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function readUsedTab(
  spreadsheetId: string,
  tabName: string,
): Promise<{ headers: string[]; rows: ParsedSheetRow[] }> {
  const sheets = createGoogleSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A:ZZ`,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });
  const matrix = (data.values ?? []).map((row) =>
    Array.isArray(row) ? row.map((value) => cell(value)) : [],
  );
  const headerRow = matrix[0] ?? [];
  const lastHeaderIndex = headerRow.reduce(
    (max, header, index) => (header.length > 0 ? index : max),
    -1,
  );
  const headers =
    lastHeaderIndex >= 0 ? headerRow.slice(0, lastHeaderIndex + 1) : [];
  const rows: ParsedSheetRow[] = [];
  for (let index = 1; index < matrix.length; index++) {
    const row = matrix[index];
    if (isBlankRow(row)) {
      continue;
    }
    rows.push({
      sheetRow: index + 1,
      raw: getHeaderMap(headers, row),
    });
  }
  return { headers, rows };
}

async function auditWorkbook(
  config: WorkbookConfig,
): Promise<WorkbookAudit> {
  const sheets = createGoogleSheetsClient();
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId: config.spreadsheetId,
    fields: "properties.title,sheets(properties.title)",
  });
  const actualTabs = (data.sheets ?? [])
    .map((sheet) => sheet.properties?.title?.trim())
    .filter((title): title is string => Boolean(title));
  const configuredTabs: TabAudit[] = [];
  const missingConfiguredTabs: string[] = [];

  for (const tab of config.tabs) {
    if (!actualTabs.includes(tab.name)) {
      missingConfiguredTabs.push(tab.name);
      continue;
    }
    const result = await readUsedTab(config.spreadsheetId, tab.name);
    configuredTabs.push(
      auditTab(tab.name, tab.kind, result.headers, result.rows),
    );
  }

  return {
    key: config.key,
    label: config.label,
    spreadsheet_id: config.spreadsheetId,
    spreadsheet_title: data.properties?.title ?? "(untitled)",
    actual_tabs: actualTabs,
    configured_tabs: configuredTabs,
    missing_configured_tabs: missingConfiguredTabs,
  };
}

function markdownReport(
  generatedAt: string,
  workbooks: WorkbookAudit[],
): string {
  const lines = [
    "# Historical consolidation sheet audit",
    "",
    `Generated: ${generatedAt}`,
    "",
    "This is a read-only, aggregate audit. It intentionally excludes customer row values.",
    "",
    "| Workbook | Tab | Kind | Rows | Dated | Earliest | Latest |",
    "|---|---|---:|---:|---:|---|---|",
  ];

  for (const workbook of workbooks) {
    for (const tab of workbook.configured_tabs) {
      lines.push(
        `| ${workbook.label} | ${tab.tab} | ${tab.kind} | ${tab.rows} | ${tab.dated_rows} | ${tab.earliest ?? ""} | ${tab.latest ?? ""} |`,
      );
    }
  }

  lines.push("", "## Workbook and tab inventory", "");
  for (const workbook of workbooks) {
    lines.push(
      `### ${workbook.label}`,
      "",
      `- Spreadsheet title: ${workbook.spreadsheet_title}`,
      `- Actual tabs: ${workbook.actual_tabs.join(", ") || "(none)"}`,
      `- Missing configured tabs: ${workbook.missing_configured_tabs.join(", ") || "(none)"}`,
      "",
    );
    for (const tab of workbook.configured_tabs) {
      lines.push(
        `#### ${tab.tab}`,
        "",
        `- Headers: ${tab.headers.join(" | ")}`,
        `- Key coverage: ${Object.entries(tab.key_coverage)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}`,
        `- Duplicate rows by populated key: ${Object.entries(tab.duplicates)
          .map(([key, value]) => `${key}=${value.duplicate_rows}`)
          .join(", ")}`,
        "",
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const workbooks: WorkbookAudit[] = [];

  for (const config of workbookConfigs()) {
    console.log(`Auditing ${config.label}...`);
    workbooks.push(await auditWorkbook(config));
  }

  const report = {
    generated_at: generatedAt,
    mode: "read-only",
    pii_policy: "aggregate-only",
    workbooks,
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, "sheet-audit.json");
  const markdownPath = path.join(OUTPUT_DIR, "sheet-audit.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(
    markdownPath,
    markdownReport(generatedAt, workbooks),
  );
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
