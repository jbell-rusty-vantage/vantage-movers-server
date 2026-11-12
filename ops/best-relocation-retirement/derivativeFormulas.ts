import { createHash } from "node:crypto";
import type { sheets_v4 } from "googleapis";
import { SOURCE_COMPANIES, getMasterLeadsSheetContainerId, getSourceLeadSheetContainerId, shouldWriteSourceLeadSheets, CALL_SHEET_HEADERS } from "../../src/config/domain";
import { escapeSheetTitleForRange } from "../../src/utils/googleSheets/ranges";
import { BEST_RELOCATION_TRACKER_ID } from "../../src/services/leads/externalSheetReview";
import { withSheetsRetry } from "../../src/services/googleSheets/retry";

const VERSION = "derivative-formulas/v1";
const PROTECTED_EXTERNAL_IDS = new Set([BEST_RELOCATION_TRACKER_ID, "1M5fzPdvtbj9LvcaXxE_qdHBJcOdhmtNfhZlv13hgaXk"]);
const RENAMES = [{ oldTitle: "Duplicates", title: "Duplicate Forms" }, { oldTitle: "Bad Leads", title: "Bad Form Leads" }, { oldTitle: "Bad Calls", title: "Bad Call Leads" }] as const;
const MASTER_RENAMES = new Map(RENAMES.map((rename) => [rename.oldTitle as string, rename.title as string]));
const MAX_ROWS = 100_000, MAX_COLUMNS = 702, MAX_WORKBOOK_CELLS = 5_000_000, PAGE_CELLS = 40_000, MAX_FORMULAS = 10_000;
type LeaseCheck = () => Promise<void>;
export type DerivativeConfiguration = { masterSpreadsheetId: string; sourceWritesEnabled: boolean;
  sources: Array<{ sourceCompany: string; spreadsheetId: string }>; unconfiguredSources?: string[] };
export type DerivativeTab = { sheetId: number; title: string; rows: number; columns: number };
export type DerivativeFormulaCell = { sheetId: number; row: number; column: number; before: string; afterLocalRename: string; after: string; masterReference: boolean };
export type DerivativeWorkbook = { spreadsheetId: string; sourceCompanies: string[]; tabs: DerivativeTab[];
  renames: Array<{ sheetId: number; oldTitle: string; title: string }>; createBadCalls: boolean; formulas: DerivativeFormulaCell[]; conflicts: string[] };
export type DerivativeFormulaPlan = { version: typeof VERSION; configuration: DerivativeConfiguration; workbooks: DerivativeWorkbook[]; conflicts: string[]; checksum: string };
export type DerivativeVerification = { complete: boolean; checkedCells: number; changedCells: number;
  errors: Array<{ spreadsheetId: string; sheetId: number; row?: number; column?: number; code: string }>; attempts: number };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function derivativeFormulaPlanChecksum(plan: Omit<DerivativeFormulaPlan, "checksum"> | DerivativeFormulaPlan): string {
  const { version, configuration, workbooks, conflicts } = plan; return digest({ version, configuration, workbooks, conflicts });
}

/** Missing optional source destinations are recorded; credentials and env values never enter logs. */
export function configuredDerivativeSources(): DerivativeConfiguration {
  const sources: DerivativeConfiguration["sources"] = [], unconfiguredSources: string[] = [];
  for (const sourceCompany of SOURCE_COMPANIES) {
    try { const spreadsheetId = getSourceLeadSheetContainerId(sourceCompany); if (spreadsheetId) sources.push({ sourceCompany, spreadsheetId }); }
    catch (error) { if (error instanceof Error && error.message.endsWith(" is not set")) unconfiguredSources.push(sourceCompany); else throw error; }
  }
  return { masterSpreadsheetId: getMasterLeadsSheetContainerId(), sourceWritesEnabled: shouldWriteSourceLeadSheets(), sources, unconfiguredSources };
}
function columnName(index: number): string { let result = ""; for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result; return result; }
const cellRange = (title: string, row: number, column: number) => `${escapeSheetTitleForRange(title)}!${columnName(column)}${row + 1}`;
async function request<T>(name: string, lease: LeaseCheck | undefined, operation: () => Promise<T>): Promise<T> {
  return withSheetsRetry(`derivativeFormulas.${name}`, async () => { await lease?.(); return operation(); });
}
async function readTabs(sheets: sheets_v4.Sheets, spreadsheetId: string, lease?: LeaseCheck): Promise<DerivativeTab[]> {
  const response = await request("metadata", lease, () => sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))" }));
  const tabs = (response.data.sheets ?? []).map((sheet) => {
    const p = sheet.properties;
    if (p?.sheetId == null || !p.title || !p.gridProperties?.rowCount || !p.gridProperties.columnCount) throw new Error("derivative_metadata_incomplete");
    return { sheetId: p.sheetId, title: p.title, rows: p.gridProperties.rowCount, columns: p.gridProperties.columnCount };
  }).sort((a, b) => a.sheetId - b.sheetId);
  if (!tabs.length) throw new Error("derivative_metadata_has_no_tabs");
  if (new Set(tabs.map((tab) => tab.sheetId)).size !== tabs.length || new Set(tabs.map((tab) => tab.title)).size !== tabs.length) throw new Error("derivative_duplicate_tab_identity");
  if (tabs.some((tab) => tab.rows > MAX_ROWS || tab.columns > MAX_COLUMNS) || tabs.reduce((total, tab) => total + tab.rows * tab.columns, 0) > MAX_WORKBOOK_CELLS) throw new Error("derivative_grid_exceeds_reviewed_bound");
  return tabs;
}
type ReadFormula = { sheetId: number; row: number; column: number; formula: string; error?: string };
async function readFormulas(sheets: sheets_v4.Sheets, spreadsheetId: string, tabs: DerivativeTab[], lease?: LeaseCheck): Promise<ReadFormula[]> {
  const result: ReadFormula[] = [];
  for (const tab of tabs) {
    const pageRows = Math.max(1, Math.floor(PAGE_CELLS / tab.columns));
    for (let start = 0; start < tab.rows; start += pageRows) {
      const end = Math.min(tab.rows, start + pageRows);
      const response = await request("formulaPage", lease, () => sheets.spreadsheets.get({ spreadsheetId,
        ranges: [`${escapeSheetTitleForRange(tab.title)}!A${start + 1}:${columnName(tab.columns - 1)}${end}`], includeGridData: true,
        fields: "sheets(data(startRow,startColumn,rowData(values(userEnteredValue/formulaValue,effectiveValue/errorValue))))" }));
      for (const sheet of response.data.sheets ?? []) for (const data of sheet.data ?? []) {
        for (let r = 0; r < (data.rowData ?? []).length; r++) for (let c = 0; c < (data.rowData![r]!.values ?? []).length; c++) {
          const cell = data.rowData![r]!.values![c]!, formula = cell.userEnteredValue?.formulaValue;
          if (!formula) continue;
          result.push({ sheetId: tab.sheetId, row: (data.startRow ?? start) + r, column: (data.startColumn ?? 0) + c, formula,
            ...(cell.effectiveValue?.errorValue ? { error: cell.effectiveValue.errorValue.type ?? "UNKNOWN_ERROR" } : {}) });
          if (result.length > MAX_FORMULAS) throw new Error("derivative_formula_count_exceeds_reviewed_bound");
        }
      }
    }
  }
  return result.sort((a, b) => a.sheetId - b.sheetId || a.row - b.row || a.column - b.column);
}

function stringEnd(formula: string, start: number): number {
  for (let i = start + 1; i < formula.length; i++) if (formula[i] === '"') { if (formula[i + 1] === '"') i++; else return i + 1; }
  throw new Error("derivative_unterminated_formula_string");
}
function literal(argument: string): string | null { const match = /^\s*"((?:[^"]|"")*)"\s*$/.exec(argument); return match ? match[1]!.replaceAll('""', '"') : null; }
function sourceId(value: string): string | null {
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:[/?#].*)?$/.exec(value)?.[1] ?? null;
}
function rewriteRange(value: string, names: ReadonlyMap<string, string>): string {
  for (const [oldTitle, title] of names) {
    for (const prefix of [`'${oldTitle}'!`, `${oldTitle}!`]) {
      if (value.startsWith(prefix) && /^\$?[A-Z]+(?:\$?\d+)?(?::\$?[A-Z]+(?:\$?\d+)?)?$/i.test(value.slice(prefix.length))) return `'${title}'!${value.slice(prefix.length)}`;
    }
  }
  return value;
}
/** Only literal IMPORTRANGE source/range arguments are rewritten. QUERY SQL and labels stay byte-for-byte. */
export function rewriteDerivativeFormula(formula: string, input: {
  masterSpreadsheetId: string; workbookId: string; importRenames: ReadonlyMap<string, ReadonlyMap<string, string>>; localRenames: ReadonlyMap<string, string>;
}): { formula: string; afterLocalRename: string; masterReference: boolean; conflicts: string[] } {
  let local = "", cursor = 0;
  // Direct local sheet-reference tokens outside every string literal.
  while (cursor < formula.length) {
    if (formula[cursor] === '"') { const end = stringEnd(formula, cursor); local += formula.slice(cursor, end); cursor = end; continue; }
    let matched = false;
    for (const [oldTitle, title] of input.localRenames) {
      for (const token of [`'${oldTitle}'!`, `${oldTitle}!`]) {
        if (formula.startsWith(token, cursor) && (cursor === 0 || /[=+\-*/^&(<>,;:\s{}]/.test(formula[cursor - 1]!))) {
          local += `'${title}'!`; cursor += token.length; matched = true; break;
        }
      }
      if (matched) break;
    }
    if (!matched) local += formula[cursor++];
  }
  const replacements: Array<{ start: number; end: number; value: string }> = [], conflicts: string[] = [];
  let masterReference = false;
  for (let i = 0; i < local.length; i++) {
    if (local[i] === '"') { i = stringEnd(local, i) - 1; continue; }
    if (i > 0 && !/[=+\-*/^&(<>,;:\s{}]/.test(local[i - 1]!)) continue;
    const call = /^IMPORTRANGE\s*\(/i.exec(local.slice(i)); if (!call) continue;
    const start = i + call[0].length, args: Array<{ start: number; end: number }> = []; let depth = 1, argStart = start, end = start;
    for (; end < local.length; end++) {
      if (local[end] === '"') { end = stringEnd(local, end) - 1; continue; }
      if (local[end] === '(') depth++;
      if (local[end] === ')') { depth--; if (!depth) { args.push({ start: argStart, end }); break; } }
      if (depth === 1 && [',', ';'].includes(local[end]!)) { args.push({ start: argStart, end }); argStart = end + 1; }
    }
    if (depth || args.length !== 2) { conflicts.push("unsupported_importrange_arguments"); continue; }
    const first = args[0]!, second = args[1]!, workbook = literal(local.slice(first.start, first.end)), range = literal(local.slice(second.start, second.end));
    const id = workbook == null ? null : sourceId(workbook), names = id ? input.importRenames.get(id) : undefined;
    if (id === input.masterSpreadsheetId) masterReference = true;
    if (!id && /(?:Duplicates|Bad Leads|Bad Calls)'?!/.test(local.slice(second.start, second.end))) conflicts.push("dynamic_import_source_requires_review");
    if (names?.size && range == null) conflicts.push("dynamic_import_range_requires_review");
    if (names?.size && range != null) {
      const next = rewriteRange(range, names);
      if (next !== range) replacements.push({ start: second.start, end: second.end, value: `"${next.replaceAll('"', '""')}"` });
      else if ([...names.keys()].some(name => range.startsWith(`${name}!`) || range.startsWith(`'${name}'!`))) conflicts.push("unsupported_import_range_requires_review");
    }
    i += call[0].length - 1;
  }
  let after = local;
  for (const change of replacements.sort((a, b) => b.start - a.start)) after = after.slice(0, change.start) + change.value + after.slice(change.end);
  return { formula: after, afterLocalRename: local, masterReference, conflicts };
}

export async function inspectDerivativeFormulas(sheets: sheets_v4.Sheets, options: { configuration?: DerivativeConfiguration; assertLease?: LeaseCheck } = {}): Promise<DerivativeFormulaPlan> {
  const configuration = options.configuration ?? configuredDerivativeSources(), workbooks: DerivativeWorkbook[] = [], conflicts: string[] = [];
  if (PROTECTED_EXTERNAL_IDS.has(configuration.masterSpreadsheetId)) throw new Error("derivative_master_is_external_source");
  const groups = new Map<string, string[]>();
  for (const source of configuration.sources) {
    if (PROTECTED_EXTERNAL_IDS.has(source.spreadsheetId) || source.spreadsheetId === configuration.masterSpreadsheetId) { conflicts.push(`protected_destination:${source.sourceCompany}`); continue; }
    groups.set(source.spreadsheetId, [...(groups.get(source.spreadsheetId) ?? []), source.sourceCompany]);
  }
  for (const [spreadsheetId, sourceCompanies] of groups) {
    const tabs = await readTabs(sheets, spreadsheetId, options.assertLease), renames: DerivativeWorkbook["renames"] = [], tabConflicts: string[] = [];
    for (const rename of RENAMES) {
      const old = tabs.find(tab => tab.title === rename.oldTitle), current = tabs.find(tab => tab.title === rename.title);
      if (old && current) tabConflicts.push(`both_titles_exist:${old.sheetId}:${current.sheetId}`);
      else if (old) renames.push({ sheetId: old.sheetId, ...rename });
    }
    workbooks.push({ spreadsheetId, sourceCompanies, tabs, renames, createBadCalls: configuration.sourceWritesEnabled && !tabs.some(tab => ["Bad Call Leads", "Bad Calls"].includes(tab.title)), formulas: [], conflicts: tabConflicts });
  }
  const namesForWorkbook = (book: DerivativeWorkbook) => new Map(RENAMES.filter(rename => book.tabs.some(tab => tab.title === rename.oldTitle || tab.title === rename.title)).map(rename => [rename.oldTitle as string, rename.title as string]));
  const imports = new Map<string, ReadonlyMap<string, string>>([[configuration.masterSpreadsheetId, MASTER_RENAMES], ...workbooks.map(book => [book.spreadsheetId, namesForWorkbook(book)] as const)]);
  for (const workbook of workbooks) {
    const formulas = await readFormulas(sheets, workbook.spreadsheetId, workbook.tabs, options.assertLease);
    const localRenames = namesForWorkbook(workbook);
    for (const cell of formulas) {
      const changed = rewriteDerivativeFormula(cell.formula, { masterSpreadsheetId: configuration.masterSpreadsheetId, workbookId: workbook.spreadsheetId, importRenames: imports, localRenames });
      workbook.formulas.push({ sheetId: cell.sheetId, row: cell.row, column: cell.column, before: cell.formula, afterLocalRename: changed.afterLocalRename, after: changed.formula, masterReference: changed.masterReference });
      workbook.conflicts.push(...changed.conflicts.map(code => `${code}:${cell.sheetId}:${cell.row}:${cell.column}`));
    }
    conflicts.push(...workbook.conflicts.map(code => `${workbook.spreadsheetId}:${code}`));
  }
  const payload: Omit<DerivativeFormulaPlan, "checksum"> = { version: VERSION, configuration, workbooks, conflicts }; return { ...payload, checksum: derivativeFormulaPlanChecksum(payload) };
}
function validatePlan(plan: DerivativeFormulaPlan) {
  if (PROTECTED_EXTERNAL_IDS.has(plan.configuration.masterSpreadsheetId)) throw new Error("derivative_master_is_external_source");
  if (plan.version !== VERSION || derivativeFormulaPlanChecksum(plan) !== plan.checksum) throw new Error("derivative_plan_checksum_mismatch");
  if (plan.conflicts.length || plan.workbooks.some(book => book.conflicts.length)) throw new Error("derivative_plan_has_conflicts");
  if (plan.workbooks.some(book => PROTECTED_EXTERNAL_IDS.has(book.spreadsheetId) || book.spreadsheetId === plan.configuration.masterSpreadsheetId)) throw new Error("derivative_protected_destination");
}
function currentTitle(book: DerivativeWorkbook, tabs: DerivativeTab[], sheetId: number): string {
  const tab = tabs.find(item => item.sheetId === sheetId); if (!tab) throw new Error("derivative_sheet_id_missing"); return tab.title;
}
function validateTopology(book: DerivativeWorkbook, tabs: DerivativeTab[]) {
  for (const before of book.tabs) {
    const tab = tabs.find(item => item.sheetId === before.sheetId), rename = book.renames.find(item => item.sheetId === before.sheetId);
    if (!tab || ![before.title, rename?.title].includes(tab.title)) throw new Error("derivative_topology_changed");
    if (rename && tabs.some(item => item.sheetId !== rename.sheetId && [rename.oldTitle, rename.title].includes(item.title))) throw new Error("derivative_both_titles_exist");
  }
  if (tabs.some(tab => !book.tabs.some(before => before.sheetId === tab.sheetId) && !(book.createBadCalls && tab.title === "Bad Call Leads"))) throw new Error("derivative_unplanned_tab");
}
export async function applyDerivativeFormulas(sheets: sheets_v4.Sheets, plan: DerivativeFormulaPlan,
  options: { writersFenced: boolean; assertLease: LeaseCheck }): Promise<DerivativeVerification> {
  validatePlan(plan); if (!options.writersFenced || typeof options.assertLease !== "function") throw new Error("derivative_writers_must_be_fenced");
  if (plan.configuration.sourceWritesEnabled !== shouldWriteSourceLeadSheets()) throw new Error("source_write_setting_changed_since_derivative_plan");
  // Preflight every workbook before the first write; current values can be original or already applied after a crash.
  for (const book of plan.workbooks) {
    const tabs = await readTabs(sheets, book.spreadsheetId, options.assertLease); validateTopology(book, tabs);
    const current = await readFormulas(sheets, book.spreadsheetId, tabs, options.assertLease);
    if (current.length !== book.formulas.length) throw new Error("derivative_formula_inventory_changed");
    const byCell = new Map(current.map(cell => [`${cell.sheetId}:${cell.row}:${cell.column}`, cell]));
    for (const cell of book.formulas) {
      const present = byCell.get(`${cell.sheetId}:${cell.row}:${cell.column}`);
      if (!present || ![cell.before, cell.afterLocalRename, cell.after].includes(present.formula)) throw new Error("derivative_formula_changed_since_plan");
    }
  }
  for (const book of plan.workbooks) {
    let tabs = await readTabs(sheets, book.spreadsheetId, options.assertLease);
    const requests: sheets_v4.Schema$Request[] = book.renames.filter(rename => tabs.find(tab => tab.sheetId === rename.sheetId)?.title === rename.oldTitle)
      .map(rename => ({ updateSheetProperties: { properties: { sheetId: rename.sheetId, title: rename.title }, fields: "title" } }));
    if (book.createBadCalls && !tabs.some(tab => tab.title === "Bad Call Leads")) requests.push({ addSheet: { properties: { title: "Bad Call Leads" } } });
    if (requests.length) await request("renameTabs", options.assertLease, () => sheets.spreadsheets.batchUpdate({ spreadsheetId: book.spreadsheetId, requestBody: { requests } }));
    tabs = await readTabs(sheets, book.spreadsheetId, options.assertLease);
    const changes = book.formulas.filter(cell => cell.before !== cell.after);
    for (let start = 0; start < changes.length; start += 100) {
      const page = changes.slice(start, start + 100), ranges = page.map(cell => cellRange(currentTitle(book, tabs, cell.sheetId), cell.row, cell.column));
      const current = await request("beforeWrite", options.assertLease, () => sheets.spreadsheets.values.batchGet({ spreadsheetId: book.spreadsheetId, ranges, valueRenderOption: "FORMULA" }));
      const data: sheets_v4.Schema$ValueRange[] = [];
      for (let index = 0; index < page.length; index++) {
        const cell = page[index]!, value = current.data.valueRanges?.[index]?.values?.[0]?.[0];
        if (value === cell.after) continue;
        if (![cell.before, cell.afterLocalRename].includes(String(value))) throw new Error("derivative_formula_changed_before_write");
        data.push({ range: ranges[index], values: [[cell.after]] });
      }
      if (data.length) await request("writeFormula", options.assertLease, () => sheets.spreadsheets.values.batchUpdate({ spreadsheetId: book.spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data } }));
    }
    if (book.createBadCalls) {
      const range = `${escapeSheetTitleForRange("Bad Call Leads")}!A1:ZZ1`;
      const headers = await request("badCallsHeader", options.assertLease, () => sheets.spreadsheets.values.get({ spreadsheetId: book.spreadsheetId, range }));
      const row = headers.data.values?.[0] ?? [];
      if (row.length && JSON.stringify(row) !== JSON.stringify(CALL_SHEET_HEADERS)) throw new Error("derivative_bad_calls_header_conflict");
      if (!row.length) await request("writeBadCallsHeader", options.assertLease, () => sheets.spreadsheets.values.update({ spreadsheetId: book.spreadsheetId,
        range: `${escapeSheetTitleForRange("Bad Call Leads")}!A1`, valueInputOption: "RAW", requestBody: { values: [[...CALL_SHEET_HEADERS]] } }));
    }
  }
  return verifyDerivativeFormulas(sheets, plan, { assertLease: options.assertLease });
}

/** Effective errorValue is the provider's recalculated result; formula text alone is never success proof. */
export async function verifyDerivativeFormulas(sheets: sheets_v4.Sheets, plan: DerivativeFormulaPlan,
  options: { assertLease?: LeaseCheck; recalculationAttempts?: number; retryDelayMs?: number } = {}): Promise<DerivativeVerification> {
  validatePlan(plan);
  const attempts = Math.min(6, Math.max(1, options.recalculationAttempts ?? 3));
  let errors: DerivativeVerification["errors"] = [], checkedCells = 0;
  const changedCells = plan.workbooks.reduce((total, book) => total + book.formulas.filter(cell => cell.before !== cell.after).length, 0);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    errors = []; checkedCells = 0;
    for (const book of plan.workbooks) {
      const tabs = await readTabs(sheets, book.spreadsheetId, options.assertLease); validateTopology(book, tabs);
      for (const rename of book.renames) if (tabs.find(tab => tab.sheetId === rename.sheetId)?.title !== rename.title) errors.push({ spreadsheetId: book.spreadsheetId, sheetId: rename.sheetId, code: "tab_not_renamed" });
      if (book.createBadCalls && !tabs.some(tab => tab.title === "Bad Call Leads")) errors.push({ spreadsheetId: book.spreadsheetId, sheetId: -1, code: "bad_calls_tab_missing" });
      const affected = book.formulas.filter(cell => cell.before !== cell.after || cell.masterReference);
      for (let start = 0; start < affected.length; start += 100) {
        const page = affected.slice(start, start + 100), ranges = page.map(cell => cellRange(currentTitle(book, tabs, cell.sheetId), cell.row, cell.column));
        const response = await request("verifyEffectiveCells", options.assertLease, () => sheets.spreadsheets.get({ spreadsheetId: book.spreadsheetId, ranges, includeGridData: true,
          fields: "sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue/formulaValue,effectiveValue))))" }));
        const actual = new Map<string, sheets_v4.Schema$CellData>();
        for (const sheet of response.data.sheets ?? []) for (const grid of sheet.data ?? []) for (let r = 0; r < (grid.rowData ?? []).length; r++) for (let c = 0; c < (grid.rowData![r]!.values ?? []).length; c++) actual.set(`${sheet.properties?.sheetId}:${(grid.startRow ?? 0) + r}:${(grid.startColumn ?? 0) + c}`, grid.rowData![r]!.values![c]!);
        for (const cell of page) {
          checkedCells++;
          const value = actual.get(`${cell.sheetId}:${cell.row}:${cell.column}`), code = value?.effectiveValue?.errorValue?.type;
          if (value?.userEnteredValue?.formulaValue !== cell.after || code || !value?.effectiveValue) errors.push({ spreadsheetId: book.spreadsheetId, sheetId: cell.sheetId, row: cell.row, column: cell.column,
            code: code ?? (value?.userEnteredValue?.formulaValue !== cell.after ? "formula_readback_mismatch" : "effective_value_pending") });
        }
      }
    }
    if (!errors.length) return { complete: true, checkedCells, changedCells, errors, attempts: attempt };
    if (attempt < attempts) { await options.assertLease?.(); await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(0, options.retryDelayMs ?? 1000)))); }
  }
  return { complete: false, checkedCells, changedCells, errors, attempts };
}
