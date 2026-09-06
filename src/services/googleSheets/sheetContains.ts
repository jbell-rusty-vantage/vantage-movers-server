import {
  getMasterBookedSheetContainerId,
  getMasterLeadsSheetContainerId,
  SHEET_SYNC_ACTIVE_JOB_STATUSES,
} from "../../config/domain";
import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { CancelledLead } from "../../models/CancelledLead";
import { FormLead } from "../../models/FormLead";
import type { SheetSyncEntry } from "../../models/schemaHelpers";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { escapeSheetTitleForRange } from "../../utils/googleSheets/ranges";
import { getSheetsClient } from "./auth";
import {
  planExpectedSheetTabs,
  uniqueSheetContainsTabs,
  type SheetContainsEntityModel,
  type SheetContainsRecordFlags,
  type SheetContainsSkipReason,
  type SheetContainsTabRef,
} from "./expectedSheetTabs";
import { getExistingSheetId } from "./tabs";
import { withSheetsRetry } from "./retry";

const SHEET_ROW_LOOKUP_END_COLUMN = "ZZ";

export type SheetContainsInput = {
  entity_model: SheetContainsEntityModel;
  ids: string[];
};

export type SheetContainsVerdict =
  | "found"
  | "missing"
  | "wrong_tab"
  | "not_expected"
  | "not_found";

export type SheetContainsEvidenceCell = {
  header: string;
  value: string;
};

export type SheetContainsLocation = {
  workbook: string;
  workbook_key: SheetContainsTabRef["workbook"];
  spreadsheet_id: string;
  tab_name: string;
  target: string;
  role: SheetContainsTabRef["role"];
  row_number: number;
  gid?: number;
  sheet_url?: string;
  evidence: SheetContainsEvidenceCell[];
};

export type SheetContainsHint = {
  target: string;
  tab_name: string;
  row_number?: number;
  status: string;
};

export type SheetContainsOpenJob = {
  job_id: string;
  status: string;
  resource: string;
};

export type SheetContainsItem = {
  id: string;
  entity_model: SheetContainsEntityModel;
  label: string;
  verdict: SheetContainsVerdict;
  expected_tabs: string[];
  missing_expected_tabs: string[];
  found: SheetContainsLocation[];
  reason?: SheetContainsSkipReason | "missing_from_mongo";
  sheet_sync_hint: SheetContainsHint[];
  open_job?: SheetContainsOpenJob;
};

export type SheetContainsResult = {
  entity_model: SheetContainsEntityModel;
  checked_at: string;
  items: SheetContainsItem[];
};

export type SheetContainsRowSnapshot = {
  rowNumber: number;
  cells: Record<string, string>;
};

export type SheetContainsTabRead = {
  spreadsheetId: string;
  gid?: number;
  rows: Map<string, SheetContainsRowSnapshot>;
};

export type SheetContainsLoadedRecord = SheetContainsRecordFlags & {
  id: string;
  label: string;
  sheet_sync?: SheetSyncEntry[];
};

export type SheetContainsDeps = {
  loadRecords: (
    entityModel: SheetContainsEntityModel,
    ids: string[],
  ) => Promise<SheetContainsLoadedRecord[]>;
  resolveSpreadsheetId: (workbook: SheetContainsTabRef["workbook"]) => string;
  readTab: (tab: SheetContainsTabRef, spreadsheetId: string) => Promise<SheetContainsTabRead>;
  loadOpenJobs: (
    entityModel: SheetContainsEntityModel,
    ids: string[],
  ) => Promise<Map<string, SheetContainsOpenJob>>;
  now?: () => Date;
};

export async function checkSheetContains(
  input: SheetContainsInput,
): Promise<SheetContainsResult> {
  return runSheetContainsCheck(input, createLiveSheetContainsDeps());
}

export async function runSheetContainsCheck(
  input: SheetContainsInput,
  deps: SheetContainsDeps,
): Promise<SheetContainsResult> {
  const ids = uniquePreserveOrder(input.ids);
  const records = await deps.loadRecords(input.entity_model, ids);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const openJobs = await deps.loadOpenJobs(input.entity_model, ids);
  const tabReads = new Map<string, SheetContainsTabRead>();

  async function readTab(tab: SheetContainsTabRef): Promise<SheetContainsTabRead> {
    const spreadsheetId = deps.resolveSpreadsheetId(tab.workbook);
    const key = `${spreadsheetId}:${tab.tabName}`;
    const cached = tabReads.get(key);
    if (cached) {
      return cached;
    }
    const read = await deps.readTab(tab, spreadsheetId);
    tabReads.set(key, read);
    return read;
  }

  const items: SheetContainsItem[] = [];
  for (const id of ids) {
    const record = recordsById.get(id);
    if (!record) {
      items.push({
        id,
        entity_model: input.entity_model,
        label: id,
        verdict: "not_found",
        expected_tabs: [],
        missing_expected_tabs: [],
        found: [],
        reason: "missing_from_mongo",
        sheet_sync_hint: [],
        open_job: openJobs.get(id),
      });
      continue;
    }

    const plan = planExpectedSheetTabs(input.entity_model, record);
    if (plan.skipReason) {
      items.push({
        id,
        entity_model: input.entity_model,
        label: record.label,
        verdict: "not_expected",
        expected_tabs: [],
        missing_expected_tabs: [],
        found: [],
        reason: plan.skipReason,
        sheet_sync_hint: hintsFromSheetSync(record.sheet_sync),
        open_job: openJobs.get(id),
      });
      continue;
    }

    const found: SheetContainsLocation[] = [];
    for (const tab of uniqueSheetContainsTabs(plan)) {
      const read = await readTab(tab);
      const row = read.rows.get(id);
      if (!row) {
        continue;
      }
      found.push(locationFromRow(tab, read, row, id));
    }

    const expectedTabNames = plan.expected.map((tab) => tab.tabName);
    const foundExpected = new Set(
      found.filter((location) => location.role === "expected").map((location) => location.tab_name),
    );
    const foundSibling = found.some((location) => location.role === "sibling");
    const missingExpected = expectedTabNames.filter((tabName) => !foundExpected.has(tabName));

    let verdict: SheetContainsVerdict = "missing";
    if (missingExpected.length === 0 && expectedTabNames.length > 0) {
      verdict = "found";
    } else if (foundExpected.size > 0) {
      verdict = "found";
    } else if (foundSibling) {
      verdict = "wrong_tab";
    }

    items.push({
      id,
      entity_model: input.entity_model,
      label: record.label,
      verdict,
      expected_tabs: expectedTabNames,
      missing_expected_tabs: missingExpected,
      found,
      sheet_sync_hint: hintsFromSheetSync(record.sheet_sync),
      open_job: openJobs.get(id),
    });
  }

  return {
    entity_model: input.entity_model,
    checked_at: (deps.now ?? (() => new Date()))().toISOString(),
    items,
  };
}

export function createLiveSheetContainsDeps(): SheetContainsDeps {
  const gidCache = new Map<string, Promise<number | undefined>>();

  return {
    loadRecords: loadSheetContainsRecords,
    resolveSpreadsheetId(workbook) {
      return workbook === "master_leads"
        ? getMasterLeadsSheetContainerId()
        : getMasterBookedSheetContainerId();
    },
    async readTab(tab, spreadsheetId) {
      return readLiveSheetContainsTab(tab, spreadsheetId, gidCache);
    },
    loadOpenJobs: loadOpenSheetContainsJobs,
  };
}

async function loadSheetContainsRecords(
  entityModel: SheetContainsEntityModel,
  ids: string[],
): Promise<SheetContainsLoadedRecord[]> {
  const docs = await loadDocuments(entityModel, ids);
  return docs.map((record) => ({
    id: record._id.toString(),
    label: labelFor(entityModel, record),
    duplicate: record.duplicate,
    bad_lead: record.bad_lead,
    created_on_unmatched: record.created_on_unmatched,
    no_sync: record.no_sync,
    sheet_sync: record.sheet_sync,
  }));
}

type LeanContainsDoc = {
  _id: { toString(): string };
  name?: string | null;
  job_no?: string | null;
  customer_name?: string | null;
  phone_number?: string | null;
  duplicate?: boolean | null;
  bad_lead?: string | null;
  created_on_unmatched?: boolean | null;
  no_sync?: boolean | null;
  sheet_sync?: SheetSyncEntry[];
};

async function loadDocuments(
  entityModel: SheetContainsEntityModel,
  ids: string[],
): Promise<LeanContainsDoc[]> {
  const filter = { _id: { $in: ids } };
  switch (entityModel) {
    case "FormLead":
      return (await FormLead.find(filter).lean()) as LeanContainsDoc[];
    case "CallLead":
      return (await CallLead.find(filter).lean()) as LeanContainsDoc[];
    case "BookedLead":
      return (await BookedLead.find(filter).lean()) as LeanContainsDoc[];
    case "CancelledLead":
      return (await CancelledLead.find(filter).lean()) as LeanContainsDoc[];
  }
}

async function loadOpenSheetContainsJobs(
  entityModel: SheetContainsEntityModel,
  ids: string[],
): Promise<Map<string, SheetContainsOpenJob>> {
  const jobs = await SheetSyncJob.find({
    entity_model: entityModel,
    entity_id: { $in: ids },
    status: { $in: [...SHEET_SYNC_ACTIVE_JOB_STATUSES] },
  })
    .sort({ due_at: 1, createdAt: 1 })
    .lean();

  const byId = new Map<string, SheetContainsOpenJob>();
  for (const job of jobs) {
    const entityId = String(job.entity_id ?? "");
    if (!entityId || byId.has(entityId)) {
      continue;
    }
    byId.set(entityId, {
      job_id: String(job._id),
      status: String(job.status),
      resource: String(job.resource),
    });
  }
  return byId;
}

async function readLiveSheetContainsTab(
  tab: SheetContainsTabRef,
  spreadsheetId: string,
  gidCache: Map<string, Promise<number | undefined>>,
): Promise<SheetContainsTabRead> {
  const sheets = getSheetsClient();
  const gidKey = `${spreadsheetId}:${tab.tabName}`;
  let gidPromise = gidCache.get(gidKey);
  if (!gidPromise) {
    gidPromise = getExistingSheetId(sheets, spreadsheetId, tab.tabName).catch(() => undefined);
    gidCache.set(gidKey, gidPromise);
  }

  try {
    const [response, gid] = await Promise.all([
      withSheetsRetry("values.get.sheetContains", () =>
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${escapeSheetTitleForRange(tab.tabName)}!A:${SHEET_ROW_LOOKUP_END_COLUMN}`,
        }),
      ),
      gidPromise,
    ]);
    return {
      spreadsheetId,
      gid,
      rows: rowsFromValues(response.data.values ?? [], tab.headers),
    };
  } catch {
    return {
      spreadsheetId,
      gid: await gidPromise,
      rows: new Map(),
    };
  }
}

export function rowsFromValues(
  values: unknown[][],
  headers: readonly string[],
): Map<string, SheetContainsRowSnapshot> {
  const rows = new Map<string, SheetContainsRowSnapshot>();
  const headerRow = (values[0] ?? []).map((cell) => String(cell ?? ""));
  const mongoIdIndex = headerRow.indexOf("Mongo ID");
  const effectiveHeaders = headerRow.length > 0 ? headerRow : [...headers];

  for (let index = 1; index < values.length; index += 1) {
    const raw = values[index] ?? [];
    const cells: Record<string, string> = {};
    for (let column = 0; column < effectiveHeaders.length; column += 1) {
      const header = effectiveHeaders[column];
      if (!header) {
        continue;
      }
      cells[header] = String(raw[column] ?? "");
    }

    const mongoId = extractMongoId(raw, mongoIdIndex);
    if (!mongoId || rows.has(mongoId)) {
      continue;
    }
    rows.set(mongoId, { rowNumber: index + 1, cells });
  }

  return rows;
}

function extractMongoId(row: unknown[], mongoIdIndex: number): string | undefined {
  if (mongoIdIndex >= 0) {
    const candidate = row[mongoIdIndex];
    if (typeof candidate === "string" && /^[a-f0-9]{24}$/i.test(candidate)) {
      return candidate;
    }
  }
  for (const cell of row) {
    if (typeof cell === "string" && /^[a-f0-9]{24}$/i.test(cell)) {
      return cell;
    }
  }
  return undefined;
}

function locationFromRow(
  tab: SheetContainsTabRef,
  read: SheetContainsTabRead,
  row: SheetContainsRowSnapshot,
  mongoId: string,
): SheetContainsLocation {
  return {
    workbook: tab.workbookTitle,
    workbook_key: tab.workbook,
    spreadsheet_id: read.spreadsheetId,
    tab_name: tab.tabName,
    target: tab.target,
    role: tab.role,
    row_number: row.rowNumber,
    gid: read.gid,
    sheet_url: sheetUrl(read.spreadsheetId, read.gid, row.rowNumber),
    evidence: evidenceFromCells(tab.evidenceHeaders, row.cells, mongoId),
  };
}

function evidenceFromCells(
  headers: readonly string[],
  cells: Record<string, string>,
  mongoId: string,
): SheetContainsEvidenceCell[] {
  const evidence: SheetContainsEvidenceCell[] = [
    { header: "Mongo ID", value: mongoId },
  ];
  for (const header of headers) {
    const raw = cells[header] ?? "";
    evidence.push({
      header,
      value: header === "Phone Number" ? lastFourDigits(raw) : raw,
    });
  }
  return evidence;
}

function lastFourDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return digits.slice(-4);
}

function sheetUrl(spreadsheetId: string, gid: number | undefined, rowNumber: number): string | undefined {
  if (!spreadsheetId) {
    return undefined;
  }
  const gidPart = gid == null ? "" : `#gid=${gid}&range=A${rowNumber}`;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${gidPart}`;
}

function hintsFromSheetSync(entries?: SheetSyncEntry[]): SheetContainsHint[] {
  return (entries ?? []).map((entry) => ({
    target: entry.target,
    tab_name: entry.tab_name,
    row_number: entry.row_number,
    status: entry.status,
  }));
}

function labelFor(
  entityModel: SheetContainsEntityModel,
  record: {
    name?: string | null;
    job_no?: string | null;
    customer_name?: string | null;
    phone_number?: string | null;
  },
): string {
  if (entityModel === "FormLead") {
    return record.name?.trim() || "Form Lead";
  }
  if (entityModel === "CallLead") {
    return record.job_no?.trim() || record.phone_number?.trim() || "Call Lead";
  }
  return record.customer_name?.trim() || record.job_no?.trim() || entityModel;
}

function uniquePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(id);
  }
  return unique;
}
