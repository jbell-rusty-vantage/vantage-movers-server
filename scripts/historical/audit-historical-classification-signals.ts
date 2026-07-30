import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createGoogleSheetsClient } from "./google-sheets-auth";
import { cell, isBlankRow } from "./sheet-read-utils";
import { normalizePhoneNumberForMatch } from "../../src/utils/phone";

type WorkbookConfig = {
  key: string;
  label: string;
  spreadsheetId: string;
  formTabs: readonly string[];
  callTabs: readonly string[];
};

type TabMatrix = {
  headers: string[];
  formattedRows: string[][];
  formulaRows: string[][];
};

type CallTabAudit = {
  tab: string;
  rows: number;
  rows_with_phone: number;
  checker_column_present: boolean;
  checker_formula_cells: number;
  checker_static_cells: number;
  checker_blank_cells: number;
  distinct_formula_shapes: number;
  formatted_true: number;
  formatted_false: number;
  formatted_unclassified: number;
  recomputed_phone_intersection_true: number;
  comparable_rows: number;
  agreements: number;
  mismatches: number;
  mismatch_source_rows: number[];
};

const OUTPUT_DIR = path.join(process.cwd(), "scripts", "historical", "reports");
const MAX_SOURCE_ROWS = 100;

function configs(): readonly WorkbookConfig[] {
  return [
    {
      key: "top10",
      label: "Top 10 Leads",
      spreadsheetId: "1aZavJvIt9RGHOsE1mlcTGlIHdW0yCk7MsAy5MGLaYhQ",
      formTabs: ["Forms"],
      callTabs: ["Calls"],
    },
    {
      key: "tbm",
      label: "TBM Leads",
      spreadsheetId: "1yR9xsnSfdniod2bdmb03HdvXAfI1U3i0nh1t5fHGnLU",
      formTabs: ["LeadsNew"],
      callTabs: ["Calls"],
    },
    {
      key: "tbm_primes",
      label: "TBM Primes",
      spreadsheetId: "1sDXK2-R8WhIloeNOoXCW4-BmdskWqHLQVWziPesbW00",
      formTabs: ["Leads"],
      callTabs: ["Calls"],
    },
    {
      key: "best_relocation",
      label: "Best Relocation",
      spreadsheetId: "13mp2vRyVKerAWBFfRvmEMjftDJE_QIbf14pzdKxsODg",
      formTabs: ["Forms", "Local Forms"],
      callTabs: ["Calls"],
    },
  ];
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headerIndex(headers: string[], ...aliases: string[]): number {
  const normalizedAliases = new Set(aliases.map(normalizedHeader));
  return headers.findIndex((header) =>
    normalizedAliases.has(normalizedHeader(header)),
  );
}

function escapeSheetTitleForRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function readMatrix(
  spreadsheetId: string,
  tabName: string,
): Promise<TabMatrix> {
  const sheets = createGoogleSheetsClient();
  const range = `${escapeSheetTitleForRange(tabName)}!A:ZZ`;
  const [formatted, formulas] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      majorDimension: "ROWS",
      valueRenderOption: "FORMATTED_VALUE",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      majorDimension: "ROWS",
      valueRenderOption: "FORMULA",
    }),
  ]);
  const formattedMatrix = (formatted.data.values ?? []).map((row) =>
    Array.isArray(row) ? row.map((value) => cell(value)) : [],
  );
  const formulaMatrix = (formulas.data.values ?? []).map((row) =>
    Array.isArray(row) ? row.map((value) => cell(value)) : [],
  );
  const headers = formattedMatrix[0] ?? [];
  return {
    headers,
    formattedRows: formattedMatrix.slice(1),
    formulaRows: formulaMatrix.slice(1),
  };
}

function checkerBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return false;
  if (["true", "yes", "y", "1", "formfill", "x"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return undefined;
}

function formulaShapeHash(formula: string): string {
  const shape = formula
    .replace(/\$?[A-Z]{1,3}\$?\d+/g, "CELL")
    .replace(/\s+/g, "")
    .toUpperCase();
  return crypto.createHash("sha256").update(shape).digest("hex");
}

async function formPhoneSet(config: WorkbookConfig): Promise<Set<string>> {
  const phones = new Set<string>();
  for (const tabName of config.formTabs) {
    const matrix = await readMatrix(config.spreadsheetId, tabName);
    const phoneIndex = headerIndex(
      matrix.headers,
      "Phone",
      "Phone Number",
      "PHONE NUMBER",
    );
    if (phoneIndex < 0) continue;
    for (const row of matrix.formattedRows) {
      const phone = normalizePhoneNumberForMatch(row[phoneIndex]);
      if (phone) phones.add(phone);
    }
  }
  return phones;
}

async function auditCallTab(
  config: WorkbookConfig,
  tabName: string,
  formPhones: Set<string>,
): Promise<CallTabAudit> {
  const matrix = await readMatrix(config.spreadsheetId, tabName);
  const phoneIndex = headerIndex(
    matrix.headers,
    "Phone",
    "Phone Number",
    "PHONE NUMBER",
  );
  const checkerIndex = headerIndex(matrix.headers, "Form Fill Checker", "FormFill");
  const formulaShapes = new Set<string>();
  const audit: CallTabAudit = {
    tab: tabName,
    rows: 0,
    rows_with_phone: 0,
    checker_column_present: checkerIndex >= 0,
    checker_formula_cells: 0,
    checker_static_cells: 0,
    checker_blank_cells: 0,
    distinct_formula_shapes: 0,
    formatted_true: 0,
    formatted_false: 0,
    formatted_unclassified: 0,
    recomputed_phone_intersection_true: 0,
    comparable_rows: 0,
    agreements: 0,
    mismatches: 0,
    mismatch_source_rows: [],
  };

  for (
    let index = 0;
    index < Math.max(matrix.formattedRows.length, matrix.formulaRows.length);
    index++
  ) {
    const formattedRow = matrix.formattedRows[index] ?? [];
    const formulaRow = matrix.formulaRows[index] ?? [];
    if (isBlankRow(formattedRow) && isBlankRow(formulaRow)) continue;
    audit.rows += 1;
    const phone = phoneIndex >= 0
      ? normalizePhoneNumberForMatch(formattedRow[phoneIndex])
      : undefined;
    if (phone) audit.rows_with_phone += 1;
    const recomputed = Boolean(phone && formPhones.has(phone));
    if (recomputed) audit.recomputed_phone_intersection_true += 1;

    if (checkerIndex < 0) continue;
    const formattedValue = cell(formattedRow[checkerIndex]);
    const formulaValue = cell(formulaRow[checkerIndex]);
    const hasFormula = formulaValue.startsWith("=");
    if (hasFormula) {
      audit.checker_formula_cells += 1;
      formulaShapes.add(formulaShapeHash(formulaValue));
    } else if (formattedValue) {
      audit.checker_static_cells += 1;
    } else {
      audit.checker_blank_cells += 1;
    }

    const classified = checkerBoolean(formattedValue);
    if (classified === true) audit.formatted_true += 1;
    else if (classified === false) audit.formatted_false += 1;
    else audit.formatted_unclassified += 1;

    if (classified !== undefined && phone) {
      audit.comparable_rows += 1;
      if (classified === recomputed) {
        audit.agreements += 1;
      } else {
        audit.mismatches += 1;
        if (audit.mismatch_source_rows.length < MAX_SOURCE_ROWS) {
          audit.mismatch_source_rows.push(index + 2);
        }
      }
    }
  }

  audit.distinct_formula_shapes = formulaShapes.size;
  return audit;
}

function markdownReport(report: {
  generated_at: string;
  workbooks: {
    key: string;
    label: string;
    distinct_form_phones: number;
    calls: CallTabAudit[];
  }[];
}): string {
  const lines = [
    "# Historical Form Fill source-signal audit",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "Read-only aggregate audit. It compares formatted Form Fill Checker results with same-workbook normalized phone intersection. It excludes phone numbers, names, and formula text.",
    "",
    "| Workbook | Call tab | Rows | Formula cells | Static cells | Checker true | Phone-intersection true | Comparable | Agreements | Mismatches |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const workbook of report.workbooks) {
    for (const call of workbook.calls) {
      lines.push(
        `| ${workbook.label} | ${call.tab} | ${call.rows} | ${call.checker_formula_cells} | ${call.checker_static_cells} | ${call.formatted_true} | ${call.recomputed_phone_intersection_true} | ${call.comparable_rows} | ${call.agreements} | ${call.mismatches} |`,
      );
    }
  }
  lines.push("", "## Detail", "");
  for (const workbook of report.workbooks) {
    lines.push(
      `### ${workbook.label}`,
      "",
      `- Distinct normalized phones across configured Form tabs: ${workbook.distinct_form_phones}`,
    );
    for (const call of workbook.calls) {
      lines.push(
        `- ${call.tab}: checker column=${call.checker_column_present}, formula shapes=${call.distinct_formula_shapes}, blank cells=${call.checker_blank_cells}, unclassified formatted values=${call.formatted_unclassified}, mismatch source rows (capped)=${call.mismatch_source_rows.join(", ") || "(none)"}`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Interpretation",
    "",
    "- Phone intersection is only a comparison baseline. Final Form Fill derives after Form Duplicate Lead classification and production-overlap collapse.",
    "- Sheet checker outputs and formulas are source annotations, not authoritative migration fields.",
    "- A mismatch is a reconciliation signal, not permission to overwrite a canonical classification.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const workbooks = [];
  for (const config of configs()) {
    const formPhones = await formPhoneSet(config);
    const calls = [];
    for (const tabName of config.callTabs) {
      calls.push(await auditCallTab(config, tabName, formPhones));
    }
    workbooks.push({
      key: config.key,
      label: config.label,
      distinct_form_phones: formPhones.size,
      calls,
    });
  }
  const report = {
    generated_at: new Date().toISOString(),
    mode: "read-only",
    pii_policy: "aggregate-and-source-row-ids-only",
    workbooks,
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, "classification-signal-audit.json");
  const markdownPath = path.join(OUTPUT_DIR, "classification-signal-audit.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, markdownReport(report));
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
