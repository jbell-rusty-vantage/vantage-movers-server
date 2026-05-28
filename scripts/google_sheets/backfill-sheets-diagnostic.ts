/**
 * Diagnostic preview for BACKFILL_* Google Sheets (Top10, TBM, Best Relocation).
 *
 * Run: pnpm run sheets:backfill-diagnostic
 *
 * Output: scripts/docs/backfill-sheets/ (markdown + JSON per tab, plus index — gitignored)
 *
 * Optional env:
 * - BACKFILL_SAMPLE_ROWS — non-blank data rows to include per tab (default: 5)
 * - BACKFILL_MAX_SCAN_ROWS — max rows to read per tab from row 1 (default: 5000)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createGoogleSheetsClient, requiredEnv } from "./google-sheets-auth";

type WorkbookKey = "top10" | "tbm" | "best_relocation" | "booked";

type WorkbookConfig = {
  key: WorkbookKey;
  label: string;
  envVar: string;
  expectedTabs: readonly string[];
};

const WORKBOOKS: readonly WorkbookConfig[] = [
  {
    key: "top10",
    label: "Top 10",
    envVar: "BACKFILL_TOP10_SHEET_ID",
    expectedTabs: ["Forms", "Calls"],
  },
  {
    key: "tbm",
    label: "TBM",
    envVar: "BACKFILL_TBM_SHEET_ID",
    expectedTabs: ["LeadsNew", "Calls"],
  },
  {
    key: "best_relocation",
    label: "Best Relocation",
    envVar: "BACKFILL_BEST_RELOCATION_SHEET_ID",
    expectedTabs: ["Forms", "Calls", "Local Forms", "Local Calls"],
  },
  {
    key: "booked",
    label: "Booked",
    envVar: "BACKFILL_BOOKED_SHEET_ID",
    expectedTabs: ["Booked Deals", "Refunds"],
  },
] as const;

function parsePositiveInt(
  name: string,
  fallback: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    console.warn(`Ignoring invalid ${name}=${JSON.stringify(raw)}; using ${fallback}.`);
    return fallback;
  }
  return Math.floor(n);
}

function escapeSheetTitleForRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isBlankRow(row: string[] | undefined): boolean {
  if (!row || row.length === 0) return true;
  return row.every((c) => String(c ?? "").trim() === "");
}

function cellStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

type TabDiagnostic = {
  tabName: string;
  found: boolean;
  rangeRead: string | null;
  headerRow: string[];
  columnCount: number;
  totalRowsInRange: number;
  dataRowCount: number;
  nonBlankDataRowCount: number;
  sampleRows: { sheetRow: number; values: Record<string, string> }[];
  warnings: string[];
};

type WorkbookDiagnostic = {
  key: WorkbookKey;
  label: string;
  envVar: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  allTabNames: string[];
  expectedTabs: string[];
  missingExpectedTabs: string[];
  extraTabs: string[];
  tabs: TabDiagnostic[];
};

async function diagnoseTab(
  sheetsApi: ReturnType<typeof createGoogleSheetsClient>,
  spreadsheetId: string,
  tabName: string,
  rowCount: number,
  columnCount: number,
  sampleRowsLimit: number,
  maxScanRows: number,
): Promise<TabDiagnostic> {
  const warnings: string[] = [];
  const endRow = Math.min(rowCount, maxScanRows);
  const endCol = columnCount > 0 ? columnToLetter(columnCount) : "ZZ";
  const range = `${escapeSheetTitleForRange(tabName)}!A1:${endCol}${endRow}`;

  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });

  const rows = (data.values ?? []).map((r) =>
    Array.isArray(r) ? r.map((c) => cellStr(c)) : [],
  );

  if (rows.length === 0) {
    return {
      tabName,
      found: true,
      rangeRead: range,
      headerRow: [],
      columnCount: 0,
      totalRowsInRange: 0,
      dataRowCount: 0,
      nonBlankDataRowCount: 0,
      sampleRows: [],
      warnings: ["Tab exists but returned no rows in range."],
    };
  }

  const headerRow = rows[0];
  const lastHeaderIndex = headerRow.reduce(
    (max, h, i) => (h.length > 0 ? i : max),
    -1,
  );
  const effectiveHeaders =
    lastHeaderIndex >= 0 ? headerRow.slice(0, lastHeaderIndex + 1) : headerRow;

  if (effectiveHeaders.every((h) => h === "")) {
    warnings.push("Row 1 has no non-empty header cells.");
  }

  const duplicateHeaders = findDuplicateHeaders(effectiveHeaders);
  if (duplicateHeaders.length > 0) {
    warnings.push(`Duplicate header names: ${duplicateHeaders.join(", ")}`);
  }

  const dataRows = rows.slice(1);
  const nonBlankDataRows: { sheetRow: number; cells: string[] }[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!isBlankRow(row)) {
      nonBlankDataRows.push({ sheetRow: i + 2, cells: row });
    }
  }

  const sampleRows: TabDiagnostic["sampleRows"] = [];
  for (const { sheetRow, cells } of nonBlankDataRows.slice(0, sampleRowsLimit)) {
    const values: Record<string, string> = {};
    for (let c = 0; c < effectiveHeaders.length; c++) {
      const key = effectiveHeaders[c] || `__col_${c + 1}`;
      values[key] = cells[c] ?? "";
    }
    sampleRows.push({ sheetRow, values });
  }

  return {
    tabName,
    found: true,
    rangeRead: range,
    headerRow: effectiveHeaders,
    columnCount: effectiveHeaders.length,
    totalRowsInRange: rows.length,
    dataRowCount: dataRows.length,
    nonBlankDataRowCount: nonBlankDataRows.length,
    sampleRows,
    warnings,
  };
}

function findDuplicateHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  const dups = new Set<string>();
  for (const h of headers) {
    const norm = h.trim().toLowerCase();
    if (!norm) continue;
    const count = (seen.get(norm) ?? 0) + 1;
    seen.set(norm, count);
    if (count === 2) dups.add(h);
  }
  return [...dups];
}

function columnToLetter(n: number): string {
  let col = n;
  let s = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s || "A";
}

function renderTabMarkdown(
  workbook: WorkbookDiagnostic,
  tab: TabDiagnostic,
): string {
  const lines: string[] = [
    `<!-- Generated by scripts/google_sheets/backfill-sheets-diagnostic.ts -->`,
    "",
    `# ${workbook.label} — \`${tab.tabName}\``,
    "",
    `- **Spreadsheet**: ${workbook.spreadsheetTitle}`,
    `- **Spreadsheet ID**: \`${workbook.spreadsheetId}\``,
    `- **Tab found**: ${tab.found ? "yes" : "no"}`,
  ];
  if (tab.rangeRead) {
    lines.push(`- **Range read**: \`${tab.rangeRead}\``);
  }
  lines.push(
    `- **Columns (header row)**: ${tab.columnCount}`,
    `- **Rows in range**: ${tab.totalRowsInRange} (including header)`,
    `- **Data rows scanned**: ${tab.dataRowCount}`,
    `- **Non-blank data rows**: ${tab.nonBlankDataRowCount}`,
    "",
  );

  if (tab.warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const w of tab.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  lines.push("## Column headers (row 1)", "");
  if (tab.headerRow.length === 0) {
    lines.push("*(none)*", "");
  } else {
    lines.push("| # | Column |");
    lines.push("|---:|---|");
    tab.headerRow.forEach((h, i) => {
      lines.push(`| ${i + 1} | ${h || "*(empty)*"} |`);
    });
    lines.push("");
  }

  lines.push("## Sample rows", "");
  if (tab.sampleRows.length === 0) {
    lines.push("*(no non-blank data rows in scanned range)*", "");
  } else {
    for (const sample of tab.sampleRows) {
      lines.push(`### Sheet row ${sample.sheetRow}`, "");
      lines.push("```json");
      lines.push(JSON.stringify(sample.values, null, 2));
      lines.push("```", "");
    }
  }

  return lines.join("\n");
}

function renderIndexMarkdown(workbooks: WorkbookDiagnostic[]): string {
  const lines: string[] = [
    "<!-- Generated by scripts/google_sheets/backfill-sheets-diagnostic.ts -->",
    "",
    "# Backfill Google Sheets diagnostic",
    "",
    "Preview of tabs and columns for mimic-database backfill sources.",
    "",
    "## Workbooks",
    "",
  ];

  for (const wb of workbooks) {
    lines.push(`### ${wb.label}`, "");
    lines.push(`- **Env**: \`${wb.envVar}\``);
    lines.push(`- **ID**: \`${wb.spreadsheetId}\``);
    lines.push(`- **Title**: ${wb.spreadsheetTitle}`);
    lines.push(`- **All tabs (${wb.allTabNames.length})**: ${wb.allTabNames.map((t) => `\`${t}\``).join(", ") || "*(none)*"}`);
    if (wb.missingExpectedTabs.length > 0) {
      lines.push(`- **Missing expected tabs**: ${wb.missingExpectedTabs.map((t) => `\`${t}\``).join(", ")}`);
    }
    if (wb.extraTabs.length > 0) {
      lines.push(`- **Tabs not in expected list**: ${wb.extraTabs.map((t) => `\`${t}\``).join(", ")}`);
    }
    lines.push("");
    lines.push("| Tab | Columns | Non-blank rows | Report |");
    lines.push("|-----|--------:|---------------:|--------|");
    for (const tab of wb.tabs) {
      const rel = `${wb.key}/${slugify(tab.tabName)}.md`;
      lines.push(
        `| \`${tab.tabName}\` | ${tab.columnCount} | ${tab.nonBlankDataRowCount} | [${rel}](./${rel}) |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const sampleRowsLimit = parsePositiveInt("BACKFILL_SAMPLE_ROWS", 5);
  const maxScanRows = parsePositiveInt("BACKFILL_MAX_SCAN_ROWS", 5000);

  const sheetsApi = createGoogleSheetsClient();

  const outRoot = path.join(process.cwd(), "scripts", "docs", "backfill-sheets");
  mkdirSync(outRoot, { recursive: true });

  const workbookResults: WorkbookDiagnostic[] = [];

  for (const cfg of WORKBOOKS) {
    const spreadsheetId = requiredEnv(cfg.envVar);
    console.log(`\n=== ${cfg.label} (${spreadsheetId}) ===`);

    const { data: meta } = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields:
        "properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)))",
    });

    const spreadsheetTitle = meta.properties?.title ?? "(untitled)";
    const sheetMetas =
      meta.sheets?.map((s) => ({
        title: s.properties?.title?.trim() ?? "",
        rowCount: s.properties?.gridProperties?.rowCount ?? 1000,
        columnCount: s.properties?.gridProperties?.columnCount ?? 26,
      })) ?? [];

    const allTabNames = sheetMetas
      .map((s) => s.title)
      .filter((t) => t.length > 0);

    console.log(`Title: ${spreadsheetTitle}`);
    console.log(`Tabs (${allTabNames.length}): ${allTabNames.join(", ")}`);

    const expectedSet = new Set(cfg.expectedTabs);
    const actualSet = new Set(allTabNames);
    const missingExpectedTabs = cfg.expectedTabs.filter((t) => !actualSet.has(t));
    const extraTabs = allTabNames.filter((t) => !expectedSet.has(t));

    if (missingExpectedTabs.length > 0) {
      console.warn(`Missing expected tabs: ${missingExpectedTabs.join(", ")}`);
    }

    const wbDir = path.join(outRoot, cfg.key);
    mkdirSync(wbDir, { recursive: true });

    const tabs: TabDiagnostic[] = [];

    for (const tabName of cfg.expectedTabs) {
      const sheetMeta = sheetMetas.find((s) => s.title === tabName);
      if (!sheetMeta) {
        const missing: TabDiagnostic = {
          tabName,
          found: false,
          rangeRead: null,
          headerRow: [],
          columnCount: 0,
          totalRowsInRange: 0,
          dataRowCount: 0,
          nonBlankDataRowCount: 0,
          sampleRows: [],
          warnings: ["Tab not found in spreadsheet."],
        };
        tabs.push(missing);
        const mdPath = path.join(wbDir, `${slugify(tabName)}.md`);
        writeFileSync(
          mdPath,
          renderTabMarkdown(
            {
              key: cfg.key,
              label: cfg.label,
              envVar: cfg.envVar,
              spreadsheetId,
              spreadsheetTitle,
              allTabNames,
              expectedTabs: [...cfg.expectedTabs],
              missingExpectedTabs,
              extraTabs,
              tabs: [],
            },
            missing,
          ),
          "utf8",
        );
        console.log(`  [missing] ${tabName} -> ${path.relative(process.cwd(), mdPath)}`);
        continue;
      }

      console.log(`  Reading ${tabName}…`);
      const diag = await diagnoseTab(
        sheetsApi,
        spreadsheetId,
        tabName,
        sheetMeta.rowCount,
        sheetMeta.columnCount,
        sampleRowsLimit,
        maxScanRows,
      );
      tabs.push(diag);

      const wbPartial: WorkbookDiagnostic = {
        key: cfg.key,
        label: cfg.label,
        envVar: cfg.envVar,
        spreadsheetId,
        spreadsheetTitle,
        allTabNames,
        expectedTabs: [...cfg.expectedTabs],
        missingExpectedTabs,
        extraTabs,
        tabs,
      };

      const mdPath = path.join(wbDir, `${slugify(tabName)}.md`);
      const jsonPath = path.join(wbDir, `${slugify(tabName)}.json`);
      writeFileSync(mdPath, renderTabMarkdown(wbPartial, diag), "utf8");
      writeFileSync(jsonPath, JSON.stringify(diag, null, 2), "utf8");
      console.log(
        `  ${tabName}: ${diag.columnCount} cols, ${diag.nonBlankDataRowCount} non-blank rows`,
      );
      console.log(`    -> ${path.relative(process.cwd(), mdPath)}`);
      console.log(`    -> ${path.relative(process.cwd(), jsonPath)}`);
    }

    const summary = {
      key: cfg.key,
      label: cfg.label,
      envVar: cfg.envVar,
      spreadsheetId,
      spreadsheetTitle,
      allTabNames,
      expectedTabs: [...cfg.expectedTabs],
      missingExpectedTabs,
      extraTabs,
      tabs,
    };
    writeFileSync(
      path.join(wbDir, "_workbook.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );

    workbookResults.push({
      key: cfg.key,
      label: cfg.label,
      envVar: cfg.envVar,
      spreadsheetId,
      spreadsheetTitle,
      allTabNames,
      expectedTabs: [...cfg.expectedTabs],
      missingExpectedTabs,
      extraTabs,
      tabs,
    });
  }

  const indexMd = path.join(outRoot, "README.md");
  const indexJson = path.join(outRoot, "_index.json");
  writeFileSync(indexMd, renderIndexMarkdown(workbookResults), "utf8");
  writeFileSync(indexJson, JSON.stringify(workbookResults, null, 2), "utf8");

  console.log(`\nWrote index: ${path.relative(process.cwd(), indexMd)}`);
  console.log(`Wrote index: ${path.relative(process.cwd(), indexJson)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
