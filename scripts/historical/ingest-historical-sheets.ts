import mongoose, { type Model } from "mongoose";
import { connectMongo } from "../../api/db";
import { normalizePhoneNumberForMatch } from "../../api/utils/phone";
import {
  normalizeHistoricalAgentName,
  splitBinderAmountEvenly,
  splitHistoricalAgentNames,
} from "./historical-agent-allocation";
import { createGoogleSheetsClient, requiredEnv } from "../google_sheets/google-sheets-auth";
import { registerHistoricalModels } from "./models";
import { reconcileHistoricalRelationships } from "./reconcile-historical-leads";

type WorkbookKey = "top10" | "tbm" | "best_relocation" | "booked";
type TabKind = "form" | "call" | "booked" | "refund";
type SheetRow = Record<string, string>;

type TabConfig = {
  name: string;
  kind: TabKind;
  local?: boolean;
};

type WorkbookConfig = {
  key: WorkbookKey;
  label: string;
  envVar: string;
  sourceCompany?: "top10" | "tbm" | "best_relocation";
  tabs: readonly TabConfig[];
};

type SheetMeta = {
  title: string;
  rowCount: number;
  columnCount: number;
};

const WORKBOOKS: readonly WorkbookConfig[] = [
  {
    key: "top10",
    label: "Top 10",
    envVar: "BACKFILL_TOP10_SHEET_ID",
    sourceCompany: "top10",
    tabs: [
      { name: "Forms", kind: "form" },
      { name: "Calls", kind: "call" },
    ],
  },
  {
    key: "tbm",
    label: "TBM",
    envVar: "BACKFILL_TBM_SHEET_ID",
    sourceCompany: "tbm",
    tabs: [
      { name: "LeadsNew", kind: "form" },
      { name: "Calls", kind: "call" },
    ],
  },
  {
    key: "best_relocation",
    label: "Best Relocation",
    envVar: "BACKFILL_BEST_RELOCATION_SHEET_ID",
    sourceCompany: "best_relocation",
    tabs: [
      { name: "Forms", kind: "form" },
      { name: "Calls", kind: "call" },
      { name: "Local Forms", kind: "form", local: true },
      { name: "Local Calls", kind: "call", local: true },
    ],
  },
  {
    key: "booked",
    label: "Booked",
    envVar: "BACKFILL_BOOKED_SHEET_ID",
    tabs: [
      { name: "Booked Deals", kind: "booked" },
      { name: "Refunds", kind: "refund" },
    ],
  },
] as const;

type HistoricalModels = ReturnType<typeof registerHistoricalModels>;

function cell(value: unknown): string {
  return String(value ?? "").trim();
}

function isBlankRow(row: string[] | undefined): boolean {
  return !row || row.every((value) => cell(value) === "");
}

function normalizeName(value: string): string | undefined {
  return normalizeHistoricalAgentName(value);
}

function normalizeId(value: string): string | undefined {
  const normalized = value.trim();
  return normalized && normalized.toUpperCase() !== "FORMULAS"
    ? normalized
    : undefined;
}

function normalizeJobNo(value: string): string | undefined {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return normalized || undefined;
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "y", "booked", ">2k", ">4k"].includes(normalized);
}

function parseMoney(value: string): number | undefined {
  const numeric = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseNumber(value: string): number | undefined {
  const numeric = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseDate(value: string): Date | undefined {
  const raw = value.trim();
  if (!raw || raw.toUpperCase() === "FORMULAS") return undefined;
  const withoutWeekday = raw.replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+/i, "");
  const parsed = new Date(withoutWeekday);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseDateTime(dateValue: string, timeValue: string): Date | undefined {
  const date = dateValue.trim();
  const time = timeValue.trim();
  if (!date && !time) return undefined;
  return parseDate(`${date} ${time}`);
}

function inferLocal(raw: SheetRow, tab: TabConfig): string | undefined {
  if (tab.local) return "local";
  const autoLocal = raw["Auto Local Validation"]?.trim();
  if (autoLocal === "0") return "local";
  if (autoLocal === "1") return "long_distance";
  return undefined;
}

function sourceRowKey(
  workbook: WorkbookConfig,
  tab: TabConfig,
  sheetRow: number,
): string {
  return `${workbook.key}:${tab.name}:${sheetRow}`;
}

function leadSourceCompany(workbook: WorkbookConfig): string {
  if (!workbook.sourceCompany) {
    throw new Error(`Workbook ${workbook.key} does not define a lead source company.`);
  }

  return workbook.sourceCompany;
}

function getHeaderMap(headers: string[], cells: string[]): SheetRow {
  const raw: SheetRow = {};
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i] || `__col_${i + 1}`;
    raw[header] = cells[i] ?? "";
  }
  return raw;
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

function escapeSheetTitleForRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function upsertBySourceRow(
  model: Model<unknown>,
  source_row_key: string,
  doc: object,
) {
  await model.updateOne(
    { source_row_key },
    { $set: doc },
    { upsert: true, runValidators: true },
  );
}

async function ensureAgent(
  models: HistoricalModels,
  rawName: string,
  importBatchId: string,
) {
  const normalizedName = normalizeName(rawName);
  if (!normalizedName) return undefined;

  const existing = await models.Agent.findOne({
    normalized_name: normalizedName,
  });
  if (existing) return existing;

  return models.Agent.create({
    name: rawName.trim(),
    normalized_name: normalizedName,
    created_from: `historical_import:${importBatchId}`,
  });
}

async function buildAgentAllocations(
  models: HistoricalModels,
  rawName: string,
  binderAmount: number | undefined,
  importBatchId: string,
) {
  const agentNames = splitHistoricalAgentNames(rawName);
  const binderAmounts = splitBinderAmountEvenly(binderAmount, agentNames.length);
  const allocations: Array<{
    agent: mongoose.Types.ObjectId;
    agent_name_snapshot: string;
    binder_amount: number | undefined;
  }> = [];

  for (let index = 0; index < agentNames.length; index++) {
    const agentName = agentNames[index];
    const agent = await ensureAgent(models, agentName, importBatchId);
    if (!agent) continue;

    allocations.push({
      agent: agent._id,
      agent_name_snapshot: agentName,
      binder_amount: binderAmounts[index],
    });
  }

  return allocations;
}

async function ensureCustomer(models: HistoricalModels, rawName: string) {
  const normalizedName = normalizeName(rawName);
  if (!normalizedName) return undefined;

  const existing = await models.Customer.findOne({
    normalized_name: normalizedName,
  });
  if (existing) return existing;

  return models.Customer.create({
    full_name: rawName.trim(),
    normalized_name: normalizedName,
  });
}

function commonImportFields(
  workbook: WorkbookConfig,
  tab: TabConfig,
  sheetRow: number,
  raw: SheetRow,
  importBatchId: string,
) {
  return {
    source_row_key: sourceRowKey(workbook, tab, sheetRow),
    import_batch_id: importBatchId,
    source_workbook: workbook.key,
    source_tab: tab.name,
    source_row: sheetRow,
    raw_row: raw,
  };
}

async function ingestFormLead(
  models: HistoricalModels,
  workbook: WorkbookConfig,
  tab: TabConfig,
  sheetRow: number,
  raw: SheetRow,
  importBatchId: string,
  lidOwners: Map<string, string>,
) {
  const timestamp = parseDate(raw["Time Stamp"] ?? "");
  const moveDate = parseDate(raw["Move Date"] ?? "");
  const lid = normalizeId(raw["Lead ID"] ?? "");
  const refNo = normalizeId(raw["Ref No"] ?? "");
  const phone = cell(raw.Phone);
  const normalizedPhone = normalizePhoneNumberForMatch(phone);
  const key = sourceRowKey(workbook, tab, sheetRow);
  const lidOwner = lid ? lidOwners.get(lid) : undefined;
  const lidAlreadyOwnedByAnotherRow = Boolean(lidOwner && lidOwner !== key);

  await upsertBySourceRow(models.FormLead, key, {
    ...commonImportFields(workbook, tab, sheetRow, raw, importBatchId),
    source_company: leadSourceCompany(workbook),
    source_company_site: tab.name,
    name: cell(raw.Name),
    normalized_name: normalizeName(raw.Name ?? ""),
    timestamp,
    lid: lidAlreadyOwnedByAnotherRow ? undefined : lid,
    normalized_lid: lid,
    pickup_zip: cell(raw["Pickup Zip"]),
    destination_zip: cell(raw["Destination Zip"]),
    move_size: cell(raw["Move Size"]),
    move_date: moveDate,
    ref_no: refNo,
    normalized_ref_no: refNo ? (normalizeJobNo(refNo) ?? refNo) : undefined,
    sheet_booked: parseBoolean(raw.Booked ?? ""),
    over_2000: parseBoolean(raw[">2K"] ?? ""),
    over_4000: parseBoolean(raw[">4K"] ?? ""),
    local: inferLocal(raw, tab),
    phone_number: phone,
    normalized_phone_number: normalizedPhone,
  });
}

async function ingestCallLead(
  models: HistoricalModels,
  workbook: WorkbookConfig,
  tab: TabConfig,
  sheetRow: number,
  raw: SheetRow,
  importBatchId: string,
) {
  const phone = cell(raw["PHONE NUMBER"]);
  const timestamp = parseDateTime(raw.Date ?? "", raw.Time ?? "");

  await upsertBySourceRow(
    models.CallLead,
    sourceRowKey(workbook, tab, sheetRow),
    {
      ...commonImportFields(workbook, tab, sheetRow, raw, importBatchId),
      source_company: leadSourceCompany(workbook),
      source_company_site: tab.name,
      timestamp,
      start_time: timestamp,
      phone_number: phone,
      normalized_phone_number: normalizePhoneNumberForMatch(phone),
      sheet_booked: parseBoolean(raw.Booked ?? ""),
      over_2000: parseBoolean(raw["Over 2000"] ?? ""),
      over_4000: parseBoolean(raw["Over 4000"] ?? ""),
      local: tab.local ? "local" : undefined,
      cubic_feet: parseNumber(raw["Cubic Feet"] ?? ""),
    },
  );
}

async function ingestBookedLead(
  models: HistoricalModels,
  workbook: WorkbookConfig,
  tab: TabConfig,
  sheetRow: number,
  raw: SheetRow,
  importBatchId: string,
) {
  const agentName = cell(raw.Agent);
  const customer = await ensureCustomer(models, raw["Customer Name"] ?? "");
  const binderAmount = parseMoney(raw["Binder Amount"] ?? "");
  const lid = normalizeId(raw.LID ?? "");
  const agentAllocations = await buildAgentAllocations(
    models,
    agentName,
    binderAmount,
    importBatchId,
  );

  await upsertBySourceRow(
    models.BookedLead,
    sourceRowKey(workbook, tab, sheetRow),
    {
      ...commonImportFields(workbook, tab, sheetRow, raw, importBatchId),
      timestamp: parseDate(raw.Timestamp ?? ""),
      book_date: parseDate(raw["Book Date"] ?? ""),
      job_no: cell(raw["Job Number:"]),
      normalized_job_no: normalizeJobNo(raw["Job Number:"] ?? ""),
      customer: customer?._id,
      customer_name_snapshot: cell(raw["Customer Name"]),
      normalized_customer_name: normalizeName(raw["Customer Name"] ?? ""),
      agent_allocations: agentAllocations,
      total_binder_amount: binderAmount,
      deposit_amount: parseMoney(raw["Deposit Amount"] ?? ""),
      merchant: cell(raw.Merchant),
      source: cell(raw["Lead Source"]),
      submission_id: lid,
      normalized_lid: lid,
      payment_notes: cell(raw["Payment Notes"]),
    },
  );
}

async function ingestRefund(
  models: HistoricalModels,
  workbook: WorkbookConfig,
  tab: TabConfig,
  sheetRow: number,
  raw: SheetRow,
  importBatchId: string,
) {
  for (const agentName of splitHistoricalAgentNames(raw.Agent ?? "")) {
    await ensureAgent(models, agentName, importBatchId);
  }
  const customer = await ensureCustomer(models, raw["Customer Name"] ?? "");

  await upsertBySourceRow(
    models.CancelledLead,
    sourceRowKey(workbook, tab, sheetRow),
    {
      ...commonImportFields(workbook, tab, sheetRow, raw, importBatchId),
      timestamp: parseDate(raw.Timestamp ?? ""),
      cancel_date: parseDate(raw["Refund Request Date"] ?? ""),
      reason: cell(raw.Status),
      notes: cell(raw.Status),
      agent: cell(raw.Agent),
      book_date: parseDate(raw["Book Date"] ?? ""),
      job_no: cell(raw["Job Number:"]),
      normalized_job_no: normalizeJobNo(raw["Job Number:"] ?? ""),
      customer: customer?._id,
      customer_name: cell(raw["Customer Name"]),
      normalized_customer_name: normalizeName(raw["Customer Name"] ?? ""),
      refund_amount: parseMoney(raw.Status ?? ""),
      merchant: cell(raw.Merchant),
      source: cell(raw["Lead Source"]),
    },
  );
}

async function readTabRows(
  sheetsApi: ReturnType<typeof createGoogleSheetsClient>,
  spreadsheetId: string,
  tab: SheetMeta,
) {
  const endCol = columnToLetter(tab.columnCount || 26);
  const endRow = Math.max(tab.rowCount || 1, 1);
  const range = `${escapeSheetTitleForRange(tab.title)}!A1:${endCol}${endRow}`;
  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });

  return (data.values ?? []).map((row) =>
    Array.isArray(row) ? row.map(cell) : [],
  );
}

async function getFormLidOwners(
  models: HistoricalModels,
  workbook: WorkbookConfig,
  tab: TabConfig,
  rows: string[][],
  headers: string[],
) {
  const lids = new Set<string>();
  const owners = new Map<string, string>();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex];
    if (isBlankRow(cells)) continue;

    const raw = getHeaderMap(headers, cells);
    if (raw["Time Stamp"]?.toUpperCase() === "FORMULAS") continue;

    const lid = normalizeId(raw["Lead ID"] ?? "");
    if (lid) lids.add(lid);
  }

  if (lids.size > 0) {
    const existing = await models.FormLead.find({
      lid: { $in: [...lids] },
      source_row_key: { $exists: true },
    })
      .select("lid source_row_key")
      .lean();

    for (const doc of existing) {
      if (doc.lid && doc.source_row_key) {
        owners.set(doc.lid, doc.source_row_key);
      }
    }
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex];
    if (isBlankRow(cells)) continue;

    const raw = getHeaderMap(headers, cells);
    if (raw["Time Stamp"]?.toUpperCase() === "FORMULAS") continue;

    const lid = normalizeId(raw["Lead ID"] ?? "");
    if (lid && !owners.has(lid)) {
      owners.set(lid, sourceRowKey(workbook, tab, rowIndex + 1));
    }
  }

  return owners;
}

async function ingestTab(
  models: HistoricalModels,
  sheetsApi: ReturnType<typeof createGoogleSheetsClient>,
  workbook: WorkbookConfig,
  tab: TabConfig,
  spreadsheetId: string,
  sheetMeta: SheetMeta,
  importBatchId: string,
) {
  const rows = await readTabRows(sheetsApi, spreadsheetId, sheetMeta);
  const headers = rows[0] ?? [];
  const lidOwners =
    tab.kind === "form"
      ? await getFormLidOwners(models, workbook, tab, rows, headers)
      : new Map<string, string>();
  let imported = 0;
  let skipped = 0;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex];
    const sheetRow = rowIndex + 1;
    if (isBlankRow(cells)) {
      skipped++;
      continue;
    }

    const raw = getHeaderMap(headers, cells);
    if (
      raw["Time Stamp"]?.toUpperCase() === "FORMULAS" ||
      raw.Timestamp?.toUpperCase() === "FORMULAS"
    ) {
      skipped++;
      continue;
    }

    if (tab.kind === "form") {
      await ingestFormLead(
        models,
        workbook,
        tab,
        sheetRow,
        raw,
        importBatchId,
        lidOwners,
      );
    } else if (tab.kind === "call") {
      await ingestCallLead(models, workbook, tab, sheetRow, raw, importBatchId);
    } else if (tab.kind === "booked") {
      await ingestBookedLead(
        models,
        workbook,
        tab,
        sheetRow,
        raw,
        importBatchId,
      );
    } else {
      await ingestRefund(models, workbook, tab, sheetRow, raw, importBatchId);
    }
    imported++;
    if (imported % 500 === 0) {
      console.log(`    ${tab.name}: ${imported} rows imported...`);
    }
  }

  return { imported, skipped };
}

async function main(): Promise<void> {
  const importBatchId =
    process.env.HISTORICAL_IMPORT_BATCH_ID?.trim() ?? new Date().toISOString();

  await connectMongo();
  const models = registerHistoricalModels();
  const sheetsApi = createGoogleSheetsClient();

  console.log(`Historical import batch: ${importBatchId}`);

  for (const workbook of WORKBOOKS) {
    const spreadsheetId = requiredEnv(workbook.envVar);
    const { data: meta } = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields:
        "properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)))",
    });

    const title = meta.properties?.title ?? workbook.label;
    const sheetMetas: SheetMeta[] =
      meta.sheets?.map((sheet) => ({
        title: sheet.properties?.title?.trim() ?? "",
        rowCount: sheet.properties?.gridProperties?.rowCount ?? 1,
        columnCount: sheet.properties?.gridProperties?.columnCount ?? 26,
      })) ?? [];

    console.log(`\n${workbook.label}: ${title}`);

    for (const tab of workbook.tabs) {
      const sheetMeta = sheetMetas.find((sheet) => sheet.title === tab.name);
      if (!sheetMeta) {
        console.warn(`  Missing tab: ${tab.name}`);
        continue;
      }

      const result = await ingestTab(
        models,
        sheetsApi,
        workbook,
        tab,
        spreadsheetId,
        sheetMeta,
        importBatchId,
      );
      console.log(
        `  ${tab.name}: imported ${result.imported}, skipped ${result.skipped}`,
      );
    }
  }

  if (
    process.env.HISTORICAL_IMPORT_RECONCILE?.trim().toLowerCase() !== "false"
  ) {
    console.log("\nRunning deferred reconciliation...");
    await reconcileHistoricalRelationships(models);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
