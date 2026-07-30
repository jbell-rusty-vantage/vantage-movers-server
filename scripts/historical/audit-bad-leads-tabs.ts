import fs from "node:fs/promises";
import path from "node:path";
import { createGoogleSheetsClient } from "./google-sheets-auth";
import { cell, isBlankRow } from "./sheet-read-utils";
import { normalizePhoneNumberForMatch } from "../../src/utils/phone";

type WorkbookConfig = {
  key: string;
  label: string;
  spreadsheetId: string;
  mainTab: string;
  badTab: string;
};

type FormRow = {
  sheetRow: number;
  leadId: string;
  phone: string;
  bookedCell: string;
};

const OUTPUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "historical",
  "reports",
);

const WORKBOOKS: readonly WorkbookConfig[] = [
  {
    key: "tbm",
    label: "TBM Leads",
    spreadsheetId: "1yR9xsnSfdniod2bdmb03HdvXAfI1U3i0nh1t5fHGnLU",
    mainTab: "LeadsNew",
    badTab: "Bad_Leads",
  },
  {
    key: "tbm_primes",
    label: "TBM Primes",
    spreadsheetId: "1sDXK2-R8WhIloeNOoXCW4-BmdskWqHLQVWziPesbW00",
    mainTab: "Leads",
    badTab: "Bad_Leads",
  },
] as const;

function escapeSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function normalizeLeadId(value: unknown): string {
  return cell(value).toUpperCase().replace(/\s+/g, "");
}

function parseFormRows(matrix: string[][]): FormRow[] {
  const rows: FormRow[] = [];
  for (let index = 1; index < matrix.length; index++) {
    const row = matrix[index] ?? [];
    if (isBlankRow(row)) {
      continue;
    }
    if (cell(row[0]).toUpperCase() === "FORMULAS") {
      continue;
    }
    rows.push({
      sheetRow: index + 1,
      leadId: normalizeLeadId(row[7]),
      phone: normalizePhoneNumberForMatch(cell(row[6])) ?? "",
      bookedCell: cell(row[9]),
    });
  }
  return rows;
}

async function readMatrix(
  spreadsheetId: string,
  tab: string,
): Promise<string[][]> {
  const sheets = createGoogleSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTitle(tab)}!A:O`,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });
  return (data.values ?? []).map((row) =>
    Array.isArray(row) ? row.map((value) => cell(value)) : [],
  );
}

function indexRows(
  rows: FormRow[],
  key: (row: FormRow) => string,
): Map<string, FormRow[]> {
  const index = new Map<string, FormRow[]>();
  for (const row of rows) {
    const value = key(row);
    if (!value) {
      continue;
    }
    index.set(value, [...(index.get(value) ?? []), row]);
  }
  return index;
}

function colorComponent(value: unknown): number {
  return typeof value === "number" ? Math.round(value * 255) : 0;
}

function colorKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const color = value as {
    red?: number | null;
    green?: number | null;
    blue?: number | null;
    alpha?: number | null;
  };
  const alpha = color.alpha ?? 1;
  if (
    color.red === undefined &&
    color.green === undefined &&
    color.blue === undefined
  ) {
    return undefined;
  }
  return [
    colorComponent(color.red),
    colorComponent(color.green),
    colorComponent(color.blue),
    colorComponent(alpha),
  ].join(",");
}

function userEnteredColorKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const cellData = value as {
    userEnteredFormat?: {
      backgroundColor?: unknown;
      backgroundColorStyle?: {
        rgbColor?: unknown;
        themeColor?: string | null;
      };
    };
  };
  const format = cellData.userEnteredFormat;
  const rgb =
    colorKey(format?.backgroundColorStyle?.rgbColor) ??
    colorKey(format?.backgroundColor);
  if (rgb) {
    return `rgba:${rgb}`;
  }
  const theme = format?.backgroundColorStyle?.themeColor;
  return theme ? `theme:${theme}` : undefined;
}

async function readManualRowColors(
  config: WorkbookConfig,
  rowCount: number,
): Promise<{
  rows_with_manual_color: number;
  rows_without_manual_color: number;
  row_color_signatures: Record<string, number>;
  multi_color_rows: number;
}> {
  const sheets = createGoogleSheetsClient();
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId: config.spreadsheetId,
    ranges: [
      `${escapeSheetTitle(config.badTab)}!A2:O${Math.max(2, rowCount + 1)}`,
    ],
    includeGridData: true,
    fields:
      "sheets(data(rowData(values(userEnteredFormat(backgroundColor,backgroundColorStyle)))))",
  });
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  const signatures = new Map<string, number>();
  let withColor = 0;
  let withoutColor = 0;
  let multiColorRows = 0;

  for (let index = 0; index < rowCount; index++) {
    const colors = new Set(
      (rowData[index]?.values ?? [])
        .slice(0, 15)
        .map((value) => userEnteredColorKey(value))
        .filter((value): value is string => Boolean(value)),
    );
    if (colors.size === 0) {
      withoutColor++;
      continue;
    }
    withColor++;
    if (colors.size > 1) {
      multiColorRows++;
    }
    const signature = [...colors].sort().join("|");
    signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
  }

  return {
    rows_with_manual_color: withColor,
    rows_without_manual_color: withoutColor,
    row_color_signatures: Object.fromEntries(
      [...signatures.entries()].sort((left, right) => right[1] - left[1]),
    ),
    multi_color_rows: multiColorRows,
  };
}

async function auditWorkbook(config: WorkbookConfig) {
  const [mainMatrix, badMatrix] = await Promise.all([
    readMatrix(config.spreadsheetId, config.mainTab),
    readMatrix(config.spreadsheetId, config.badTab),
  ]);
  const mainRows = parseFormRows(mainMatrix);
  const badRows = parseFormRows(badMatrix);
  const mainByLeadId = indexRows(mainRows, (row) => row.leadId);
  const mainByPhone = indexRows(mainRows, (row) => row.phone);
  const colorAudit = await readManualRowColors(config, badRows.length);

  let leadIdUnique = 0;
  let leadIdAmbiguous = 0;
  let phoneUnique = 0;
  let phoneAmbiguous = 0;
  let orphan = 0;
  let missingLeadId = 0;
  let missingPhone = 0;
  const orphanRows: number[] = [];

  for (const row of badRows) {
    if (!row.leadId) {
      missingLeadId++;
    }
    if (!row.phone) {
      missingPhone++;
    }
    const leadIdMatches = row.leadId
      ? (mainByLeadId.get(row.leadId) ?? [])
      : [];
    if (leadIdMatches.length === 1) {
      leadIdUnique++;
      continue;
    }
    if (leadIdMatches.length > 1) {
      leadIdAmbiguous++;
      continue;
    }
    const phoneMatches = row.phone ? (mainByPhone.get(row.phone) ?? []) : [];
    if (phoneMatches.length === 1) {
      phoneUnique++;
    } else if (phoneMatches.length > 1) {
      phoneAmbiguous++;
    } else {
      orphan++;
      orphanRows.push(row.sheetRow);
    }
  }

  return {
    key: config.key,
    label: config.label,
    spreadsheet_id: config.spreadsheetId,
    main_tab: config.mainTab,
    bad_tab: config.badTab,
    headers: {
      main: mainMatrix[0] ?? [],
      bad: badMatrix[0] ?? [],
    },
    counts: {
      main_rows: mainRows.length,
      bad_rows: badRows.length,
      matched_main_by_lead_id_unique: leadIdUnique,
      matched_main_by_lead_id_ambiguous: leadIdAmbiguous,
      matched_main_by_phone_unique: phoneUnique,
      matched_main_by_phone_ambiguous: phoneAmbiguous,
      orphan_bad_rows: orphan,
      missing_lead_id: missingLeadId,
      missing_phone: missingPhone,
      bad_rows_with_literal_booked_column_j: badRows.filter((row) =>
        /^booked$/i.test(row.bookedCell),
      ).length,
    },
    orphan_sheet_rows: orphanRows,
    formatting: colorAudit,
    interpretation: {
      bad_tab_membership_is_only_reliable_disposition: true,
      per_row_reason_available: false,
      manual_color_is_complete_reason_taxonomy: false,
      manual_color_reason_mapping_blocker:
        "No documented color-to-reason legend exists; white/red coverage alone is not a reason taxonomy.",
      migration_policy:
        "match to the main form lead by unique Lead ID, then unique phone; annotate matched leads and create only orphan rows",
    },
  };
}

function markdownReport(
  generatedAt: string,
  audits: Awaited<ReturnType<typeof auditWorkbook>>[],
): string {
  const lines = [
    "# Historical Bad_Leads audit",
    "",
    `Generated: ${generatedAt}`,
    "",
    "Read-only aggregate audit. Customer values are excluded; only source sheet row numbers are retained for orphan review.",
    "",
    "| Workbook | Bad rows | Match by Lead ID | Match by phone | Ambiguous | Orphans | Manually colored |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const audit of audits) {
    lines.push(
      `| ${audit.label} | ${audit.counts.bad_rows} | ${audit.counts.matched_main_by_lead_id_unique} | ${audit.counts.matched_main_by_phone_unique} | ${audit.counts.matched_main_by_lead_id_ambiguous + audit.counts.matched_main_by_phone_ambiguous} | ${audit.counts.orphan_bad_rows} | ${audit.formatting.rows_with_manual_color} |`,
    );
  }
  lines.push(
    "",
    "## Interpretation",
    "",
    "- `Bad_Leads` has the form-lead identity columns but no bad-reason column.",
    "- Match a Bad_Leads row to the main form tab by unique Lead ID first, then unique normalized phone.",
    "- A matched row annotates the existing form lead; it must not create a second lead.",
    "- An orphan row is a real missing form-lead candidate and needs its own deterministic source-row identity.",
    "- Literal `Booked` values copied into the unheaded column J are stale and are not booking authority.",
    "- Manual color can only map to a reason if it covers every row and a documented color legend exists; the JSON report records actual color coverage/signatures.",
    "",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const audits = [];
  for (const workbook of WORKBOOKS) {
    console.log(`Auditing ${workbook.label} ${workbook.badTab}...`);
    audits.push(await auditWorkbook(workbook));
  }
  const generatedAt = new Date().toISOString();
  const report = {
    generated_at: generatedAt,
    mode: "read-only",
    pii_policy: "aggregate-only",
    audits,
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, "bad-leads-audit.json");
  const markdownPath = path.join(OUTPUT_DIR, "bad-leads-audit.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, markdownReport(generatedAt, audits));
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
