import { createHash } from "node:crypto";
import { createSheetsClient, readTab, resolveWorkbookIds, BEST_RELOCATION_CUTOFF } from "../../src/services/bestRelocationSheetIngest/sheets";
import { parseFormRows, parseCallRows, parseBookedDealRows, parseRefundRows, parseLidBestRelo } from "../../src/services/bestRelocationSheetIngest/parsing";
import { managedId } from "../../src/services/bestRelocationSheetIngest/identity";
import { selectBestRelocationRefundObservations } from "../../src/services/bestRelocationSheetIngest/matching";
import type { TabReadResult, SourceTab, ParsedWorkbookData } from "../../src/services/bestRelocationSheetIngest/types";
import { BEST_RELOCATION_TRACKER_ID, EXTERNAL_REVIEW_POLICY_VERSION } from "../../src/services/leads/externalSheetReview";

export const BOOKED_SOURCE_ID = "1M5fzPdvtbj9LvcaXxE_qdHBJcOdhmtNfhZlv13hgaXk";
const REQUIRED_SOURCE_HEADERS: Record<string, string[]> = {
  Forms: ["Time Stamp", "Name", "Phone", "Pickup Zip", "Destination Zip", "Move Size", "Bad Lead Checker"],
  "Local Forms": ["Time Stamp", "Name", "Phone", "Pickup Zip", "Destination Zip", "Move Size", "Bad Lead Checker"],
  Calls: ["PHONE NUMBER", "Date", "Time", "Form Fill Checker"],
  "Booked Deals": ["Timestamp", "Agent", "Book Date", "Job Number:", "Customer Name", "Binder Amount", "Deposit Amount", "Merchant", "Lead Source"],
  Refunds: ["Refund Request Date", "Status", "Timestamp", "Job Number:", "Lead Source"],
};
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type FrozenSourceSnapshot = {
  version: string; captured_at: string; through: string; final_capture: boolean;
  workbooks: Array<{ id: string; title: string; timezone: string }>;
  tabs: TabReadResult[];
  sidecar: Array<{ workbook_id: string; sheet_id: number; fingerprint: string; managed_id: string; original_identity: string[] }>;
};
/** Deterministic v4-shaped sidecar ID; source cells remain untouched. */
export function sidecarManagedId(fingerprint: string): string {
  const chars = fingerprint.slice(0, 32).split(""); chars[12] = "4"; chars[16] = "89ab"[parseInt(chars[16]!, 16) % 4]!;
  const hex = chars.join(""); return `vantage:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function captureSourceSnapshot(finalCapture = false): Promise<FrozenSourceSnapshot> {
  const ids = resolveWorkbookIds({ leadsSheetId: BEST_RELOCATION_TRACKER_ID, bookedSheetId: BOOKED_SOURCE_ID });
  if (ids.leadsSheetId !== BEST_RELOCATION_TRACKER_ID || ids.bookedSheetId !== BOOKED_SOURCE_ID) throw new Error("source_workbook_configuration_mismatch");
  const client = createSheetsClient();
  const workbooks = [];
  for (const id of [ids.leadsSheetId, ids.bookedSheetId]) {
    const meta = await client.spreadsheets.get({ spreadsheetId: id, fields: "properties(title,timeZone)" });
    if (!meta.data.properties?.timeZone) throw new Error("missing_source_workbook_timezone");
    workbooks.push({ id, title: meta.data.properties.title!, timezone: meta.data.properties.timeZone });
  }
  const tabs: TabReadResult[] = [];
  for (const name of ["Forms", "Local Forms", "Calls", "Local Calls", "Booked Deals", "Refunds", "LID_BestRelo"]) {
    const tab = await readTab(client, name === "Booked Deals" || name === "Refunds" || name === "LID_BestRelo" ? ids.bookedSheetId : ids.leadsSheetId, name as SourceTab, { preserveCellText: true });
    const meta = await client.spreadsheets.get({ spreadsheetId: tab.spreadsheetId, fields: "sheets.properties(sheetId,gridProperties)" });
    const grid = meta.data.sheets?.find(s => s.properties?.sheetId === tab.tabId)?.properties?.gridProperties;
    if (!grid?.rowCount || grid.rowCount > 100000 || (grid.columnCount ?? 0) > 702) throw new Error("source_grid_exceeds_reviewed_capture_bounds");
    for (let start = 10001; start <= grid.rowCount; start += 5000) {
      const page = await client.spreadsheets.values.get({ spreadsheetId: tab.spreadsheetId,
        range: `'${name}'!A${start}:ZZ${Math.min(start + 4999, grid.rowCount)}`, valueRenderOption: "FORMATTED_VALUE" });
      const rows = page.data.values ?? [];
      if (rows.length) { while (tab.matrix.length < start - 1) tab.matrix.push([]); tab.matrix.push(...rows.map(row => row.map(v => String(v ?? "")))); }
    }
    tabs.push(tab);
  }
  const at = new Date().toISOString();
  const snapshot: FrozenSourceSnapshot = { version: EXTERNAL_REVIEW_POLICY_VERSION, captured_at: at, through: at, final_capture: finalCapture, workbooks, tabs, sidecar: [] };
  attachSidecar(snapshot);
  return snapshot;
}
export function attachSidecar(snapshot: FrozenSourceSnapshot): void {
  const localCalls = snapshot.tabs.find(tab => (tab.tabName as string) === "Local Calls");
  if (!localCalls || localCalls.matrix.slice(1).some(row => row.some(cell => cell.trim()))) throw new Error("local_calls_scope_discrepancy");
  const sidecar = new Map(snapshot.sidecar.map(row => [row.fingerprint, row]));
  for (const tab of snapshot.tabs.filter(t => ["Calls", "Refunds"].includes(t.tabName))) {
    const headers = [...tab.headers];
    const managedIndex = headers.findIndex(h => h === "vantage_ingestion_id");
    const identityColumns = tab.tabName === "Calls" ? ["PHONE NUMBER", "Date", "Time"] : ["Job Number:", "Refund Request Date", "Timestamp", "Agent", "Lead Source"];
    if (identityColumns.some(name => !headers.includes(name))) throw new Error("missing_source_identity_column");
    for (const row of tab.matrix.slice(1)) {
      if (!row.some(v => v.trim())) continue;
      const raw = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]));
      const existing = managedId(raw);
      const original = identityColumns.map(name => raw[name] ?? "");
      const fingerprint = hash([tab.spreadsheetId, tab.tabId, original]);
      // Retain repeated/copied/malformed identities. Planning quarantines every
      // member of the conflicting cohort; capture must not discard other rows.
      const identity = existing ?? sidecar.get(fingerprint)?.managed_id ?? sidecarManagedId(fingerprint);
      if (!existing) sidecar.set(fingerprint, { workbook_id: tab.spreadsheetId, sheet_id: tab.tabId!, fingerprint, managed_id: identity, original_identity: original });
      const index = managedIndex >= 0 ? managedIndex : headers.length;
      row[index] = identity;
    }
    if (managedIndex < 0) { tab.headers.push("vantage_ingestion_id"); tab.matrix[0] = [...tab.headers]; }
  }
  snapshot.sidecar = [...sidecar.values()];
}
export function parseFrozenSnapshot(snapshot: FrozenSourceSnapshot): { data: ParsedWorkbookData; inventory: Record<string, { parsed: number; in_window: number; older: number; invalid_time: number; after_through: number; out_of_scope: number }> } {
  if (snapshot.version !== EXTERNAL_REVIEW_POLICY_VERSION || !/(?:Z|[+-]\d\d:\d\d)$/.test(snapshot.through) || !/(?:Z|[+-]\d\d:\d\d)$/.test(snapshot.captured_at) || !Number.isFinite(Date.parse(snapshot.through)) ||
      !Number.isFinite(Date.parse(snapshot.captured_at)) || Date.parse(snapshot.through) > Date.parse(snapshot.captured_at)) throw new Error("invalid_frozen_snapshot_watermark");
  if (new Set(snapshot.tabs.map(tab => tab.tabName)).size !== snapshot.tabs.length) throw new Error("duplicate_snapshot_source_tab");
  if (new Set(snapshot.workbooks.map(workbook => workbook.id)).size !== snapshot.workbooks.length) throw new Error("duplicate_snapshot_source_workbook");
  for (const sourceTab of snapshot.tabs) {
    const expectedWorkbook = ["Booked Deals", "Refunds", "LID_BestRelo"].includes(sourceTab.tabName) ? BOOKED_SOURCE_ID : BEST_RELOCATION_TRACKER_ID;
    if (sourceTab.spreadsheetId !== expectedWorkbook || !Number.isInteger(sourceTab.tabId)) throw new Error("snapshot_tab_source_identity_mismatch");
    const nonempty = sourceTab.headers.filter(Boolean);
    if (new Set(nonempty).size !== nonempty.length || (REQUIRED_SOURCE_HEADERS[sourceTab.tabName] ?? []).some(header => !sourceTab.headers.includes(header))) throw new Error(`snapshot_schema_drift:${sourceTab.tabName}`);
  }
  const localCalls = snapshot.tabs.find(tab => (tab.tabName as string) === "Local Calls");
  if (!localCalls || localCalls.matrix.slice(1).some(row => row.some(cell => cell.trim()))) throw new Error("local_calls_scope_discrepancy");
  const tab = (name: SourceTab) => { const found = snapshot.tabs.find(t => t.tabName === name); if (!found) throw new Error("missing_source_tab"); return found; };
  const zone = (id: string) => { const value = snapshot.workbooks.find(w => w.id === id)?.timezone; if (!value) throw new Error("missing_timezone"); return value; };
  const leads = snapshot.workbooks.find(w => w.id === BEST_RELOCATION_TRACKER_ID)!, booked = snapshot.workbooks.find(w => w.id === BOOKED_SOURCE_ID)!;
  if (!leads || !booked) throw new Error("snapshot_source_mismatch");
  const all = { forms: parseFormRows(tab("Forms"), "Forms", zone(leads.id)), localForms: parseFormRows(tab("Local Forms"), "Local Forms", zone(leads.id)), calls: parseCallRows(tab("Calls"), zone(leads.id)), booked: parseBookedDealRows(tab("Booked Deals"), zone(booked.id)), refunds: parseRefundRows(tab("Refunds"), zone(booked.id)) };
  const relevantRefundRows = new Set(selectBestRelocationRefundObservations(all.refunds.filter(row => row.is_best_relocation_source || !row.lead_source.trim()), all.booked).map(row => row.sheet_row));
  const inventory: ReturnType<typeof parseFrozenSnapshot>["inventory"] = {};
  const filtered = Object.fromEntries(Object.entries(all).map(([key, rows]) => {
    const scoped = rows.filter(row => key === "booked" ? (row as typeof all.booked[number]).is_best_relocation_source : key === "refunds" ? relevantRefundRows.has(row.sheet_row) : true);
    const inWindow = scoped.filter(row => row.timestamp && Date.parse(row.timestamp) >= +BEST_RELOCATION_CUTOFF && Date.parse(row.timestamp) < Date.parse(snapshot.through));
    inventory[key] = { parsed: rows.length, in_window: inWindow.length, older: scoped.filter(row => row.timestamp && Date.parse(row.timestamp) < +BEST_RELOCATION_CUTOFF).length,
      invalid_time: scoped.filter(row => !row.timestamp).length, after_through: scoped.filter(row => row.timestamp && Date.parse(row.timestamp) >= Date.parse(snapshot.through)).length,
      out_of_scope: rows.length - scoped.length };
    return [key, inWindow];
  })) as typeof all;
  return { data: { leadsWorkbook: { id: leads.id, title: leads.title }, bookedWorkbook: { id: booked.id, title: booked.title }, ...filtered, lidBestRelo: parseLidBestRelo(tab("LID_BestRelo")) }, inventory };
}
