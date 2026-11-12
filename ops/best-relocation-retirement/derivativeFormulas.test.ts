import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { sheets_v4 } from "googleapis";
import { applyDerivativeFormulas, inspectDerivativeFormulas, rewriteDerivativeFormula, verifyDerivativeFormulas, type DerivativeConfiguration } from "./derivativeFormulas";
import { BEST_RELOCATION_TRACKER_ID } from "../../src/services/leads/externalSheetReview";

const originalWriteSetting = process.env.WRITE_SOURCE_LEAD_SHEETS;
afterEach(() => { if (originalWriteSetting === undefined) delete process.env.WRITE_SOURCE_LEAD_SHEETS; else process.env.WRITE_SOURCE_LEAD_SHEETS = originalWriteSetting; });
const configuration: DerivativeConfiguration = { masterSpreadsheetId: "master", sourceWritesEnabled: false, sources: [{ sourceCompany: "best_relocation_leads", spreadsheetId: "derivative" }] };
const rename = new Map([["Duplicates", "Duplicate Forms"], ["Bad Leads", "Bad Form Leads"]]);
const rewrite = (formula: string) => rewriteDerivativeFormula(formula, { masterSpreadsheetId: "master", workbookId: "derivative", importRenames: new Map([["master", rename]]), localRenames: rename });

test("only literal intended workbook ranges and local tokens change; QUERY text and unrelated imports remain intact", () => {
 const formula = '=QUERY(IMPORTRANGE("https://docs.google.com/spreadsheets/d/master/edit", "\'Bad Leads\'!A1:ZZ"),"select * label Col1 \'Duplicates!\'",1)&"Duplicates!"&SUM(\'Duplicates\'!A1:A3)&IMPORTRANGE("other","Duplicates!A:A")';
 const result = rewrite(formula);
 assert.equal(result.formula, '=QUERY(IMPORTRANGE("https://docs.google.com/spreadsheets/d/master/edit","\'Bad Form Leads\'!A1:ZZ"),"select * label Col1 \'Duplicates!\'",1)&"Duplicates!"&SUM(\'Duplicate Forms\'!A1:A3)&IMPORTRANGE("other","Duplicates!A:A")');
 assert.equal(rewrite("=Sub.Duplicates!A1").formula,"=Sub.Duplicates!A1");
 assert.equal(rewrite('=MY.IMPORTRANGE("master","Duplicates!A:A")').formula,'=MY.IMPORTRANGE("master","Duplicates!A:A")');
 assert.equal(result.masterReference, true); assert.deepEqual(result.conflicts, []);
 assert.equal(rewrite('=IMPORTRANGE("master";"Duplicates!A:Z")').formula, '=IMPORTRANGE("master";"\'Duplicate Forms\'!A:Z")');
 assert.deepEqual(rewrite('=IMPORTRANGE("master",A1)').conflicts, ["dynamic_import_range_requires_review"]);
 assert.deepEqual(rewrite('=IMPORTRANGE(C1,"\'Duplicates\'!A:A")').conflicts, ["dynamic_import_source_requires_review"]);
 assert.equal(rewrite('="IMPORTRANGE(""master"",""Duplicates!A:A"")"').formula, '="IMPORTRANGE(""master"",""Duplicates!A:A"")"');
});

type Tab = { sheetId: number; title: string; rows: number; columns: number };
function fixture(tabs: Tab[] = [{ sheetId: 1, title: "Duplicates", rows: 3, columns: 3 }, { sheetId: 2, title: "Bad Leads", rows: 3, columns: 3 }]) {
 const formulas = new Map<string, string>([["1:0:0", '=QUERY(IMPORTRANGE("master","Duplicates!A:Z"),"select *",1)'], ["2:0:0", '=IMPORTRANGE("master","\'Bad Leads\'!A:Z")'], ["1:1:0", '=SUM(\'Bad Leads\'!A1:A3)&"Bad Leads!"']]);
 const headers = new Map<string, string[]>(), calls: string[] = [], mutations: string[] = [];
 let effectiveError = false, pendingEffective = false, leaseChecks = 0;
 const position = (range: string) => {
  const match = /^'((?:[^']|'')+)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range); assert.ok(match, range);
  const tab = tabs.find(item => item.title === match[1]!.replaceAll("''", "'")); assert.ok(tab, range);
  const column = (text: string) => [...text].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  return { tab, row: Number(match[3]) - 1, column: column(match[2]!), endRow: Number(match[5] ?? match[3]) - 1, endColumn: column(match[4] ?? match[2]!) };
 };
 const sheets = { spreadsheets: {
  get: async (input: { spreadsheetId: string; ranges?: string[]; fields?: string }) => {
   calls.push(input.spreadsheetId);
   if (!input.ranges) return { data: { sheets: tabs.map(tab => ({ properties: { sheetId: tab.sheetId, title: tab.title, gridProperties: { rowCount: tab.rows, columnCount: tab.columns } } })) } };
   return { data: { sheets: input.ranges.map(range => {
    const p = position(range);
    return { properties: { sheetId: p.tab.sheetId }, data: [{ startRow: p.row, startColumn: p.column, rowData: Array.from({ length: p.endRow-p.row+1 }, (_, r) => ({ values: Array.from({length:p.endColumn-p.column+1}, (_, c) => {
     const formula = formulas.get(`${p.tab.sheetId}:${p.row+r}:${p.column+c}`); if (!formula) return {};
     return { userEnteredValue: { formulaValue: formula }, ...(pendingEffective ? {} : { effectiveValue: effectiveError ? { errorValue: { type: "REF" } } : { stringValue: "synthetic calculated result" } }) };
    }) })) }] };
   }) } };
  },
  batchUpdate: async (input: { spreadsheetId: string; requestBody: { requests: sheets_v4.Schema$Request[] } }) => {
   mutations.push(input.spreadsheetId);
   for (const request of input.requestBody.requests) {
    const rename = request.updateSheetProperties?.properties;
    if (rename) {
     const tab = tabs.find(item => item.sheetId === rename.sheetId)!; const old = tab.title; tab.title = rename.title!;
     for (const [key, formula] of formulas) formulas.set(key, formula.replaceAll(`'${old}'!`, `'${tab.title}'!`));
    }
    if (request.addSheet) tabs.push({ sheetId: 9, title: request.addSheet.properties!.title!, rows: 1000, columns: 26 });
   }
   return { data: {} };
  },
  values: {
   batchGet: async (input: { ranges: string[] }) => ({ data: { valueRanges: input.ranges.map(range => { const p = position(range); return { values: [[formulas.get(`${p.tab.sheetId}:${p.row}:${p.column}`)]] }; }) } }),
   batchUpdate: async (input: { spreadsheetId: string; requestBody: { valueInputOption: string; data: sheets_v4.Schema$ValueRange[] } }) => {
    assert.equal(input.requestBody.valueInputOption, "USER_ENTERED"); mutations.push(input.spreadsheetId);
    for (const cell of input.requestBody.data) { const p = position(cell.range!); formulas.set(`${p.tab.sheetId}:${p.row}:${p.column}`, String(cell.values![0]![0])); } return { data: {} };
   },
   get: async (input: { range: string }) => ({ data: { values: [headers.get(input.range.split("!")[0]!) ?? []] } }),
   update: async (input: { spreadsheetId: string; range: string; valueInputOption: string; requestBody: { values: string[][] } }) => { assert.equal(input.valueInputOption, "RAW"); mutations.push(input.spreadsheetId); headers.set(input.range.split("!")[0]!, input.requestBody.values[0]!); return { data: {} }; },
  },
 } } as unknown as sheets_v4.Sheets;
 return { sheets, formulas, tabs, calls, mutations, headers, lease: async () => { leaseChecks++; }, leaseChecks: () => leaseChecks,
 error: (value: boolean) => { effectiveError = value; }, pending: (value: boolean) => { pendingEffective = value; } };
}

test("inspect reads configured derivative formulas only; apply preserves IDs, verifies calculated errors and resumes without repeated writes", async () => {
 process.env.WRITE_SOURCE_LEAD_SHEETS = "false";
 const f = fixture(), plan = await inspectDerivativeFormulas(f.sheets, { configuration });
 assert.equal(f.mutations.length, 0); assert.equal(plan.workbooks[0]!.formulas.length, 3); assert.equal(plan.workbooks[0]!.createBadCalls, false);
 assert.deepEqual(plan.workbooks[0]!.renames.map(tab => tab.sheetId), [1,2]);
 const result = await applyDerivativeFormulas(f.sheets, plan, { writersFenced: true, assertLease: f.lease });
 assert.equal(result.complete, true); assert.equal(result.checkedCells, 3); assert.ok(f.leaseChecks() > 8);
 assert.deepEqual(f.tabs.map(tab => [tab.sheetId,tab.title]), [[1,"Duplicate Forms"],[2,"Bad Form Leads"]]);
 const writes = f.mutations.length;
 await applyDerivativeFormulas(f.sheets, plan, { writersFenced: true, assertLease: f.lease });
 assert.equal(f.mutations.length, writes);
 f.error(true);
 const broken = await verifyDerivativeFormulas(f.sheets, plan, { recalculationAttempts: 2, retryDelayMs: 0 });
 assert.equal(broken.complete, false); assert.equal(broken.attempts, 2); assert.ok(broken.errors.every(error => error.code === "REF"));
 f.error(false); f.pending(true);
 assert.equal((await verifyDerivativeFormulas(f.sheets, plan, { recalculationAttempts: 1 })).complete, false);
});

test("checksum tampering and owner formula edits fail before the first mutation", async () => {
 process.env.WRITE_SOURCE_LEAD_SHEETS = "false";
 const f = fixture(), plan = await inspectDerivativeFormulas(f.sheets, { configuration });
 await assert.rejects(applyDerivativeFormulas(f.sheets, {...plan, checksum:"wrong"}, {writersFenced:true,assertLease:f.lease}), /checksum/);
 f.formulas.set("1:0:0", '=IMPORTRANGE("owner-other","Duplicates!A:A")');
 await assert.rejects(applyDerivativeFormulas(f.sheets, plan, {writersFenced:true,assertLease:f.lease}), /changed_since_plan/);
 assert.equal(f.mutations.length, 0);
});

test("ambiguous local titles, protected tracker destinations and oversized grids fail closed", async () => {
 const f = fixture(); f.tabs.push({sheetId:3,title:"Duplicate Forms",rows:3,columns:3});
 const plan = await inspectDerivativeFormulas(f.sheets,{configuration}); assert.ok(plan.conflicts.length);
 await assert.rejects(applyDerivativeFormulas(f.sheets,plan,{writersFenced:true,assertLease:f.lease}),/conflicts/);
 const external = await inspectDerivativeFormulas(f.sheets,{configuration:{...configuration,sources:[{sourceCompany:"misconfigured",spreadsheetId:BEST_RELOCATION_TRACKER_ID}]}});
 assert.ok(external.conflicts.length); assert.ok(!f.calls.includes(BEST_RELOCATION_TRACKER_ID));
 f.tabs[0]!.rows = 100001;
 await assert.rejects(inspectDerivativeFormulas(f.sheets,{configuration}),/grid_exceeds/);
 assert.equal(f.mutations.length,0);
});

test("bad-call source provisioning requires the unchanged enabled direct-write setting", async () => {
 process.env.WRITE_SOURCE_LEAD_SHEETS = "true";
 const f = fixture(), plan = await inspectDerivativeFormulas(f.sheets,{configuration:{...configuration,sourceWritesEnabled:true}});
 assert.equal(plan.workbooks[0]!.createBadCalls,true);
 assert.equal((await applyDerivativeFormulas(f.sheets,plan,{writersFenced:true,assertLease:f.lease})).complete,true);
 assert.ok(f.tabs.some(tab=>tab.title === "Bad Call Leads")); assert.ok(f.headers.get("'Bad Call Leads'")?.includes("Mongo ID"));
 process.env.WRITE_SOURCE_LEAD_SHEETS = "false";
 await assert.rejects(applyDerivativeFormulas(f.sheets,plan,{writersFenced:true,assertLease:f.lease}),/setting_changed/);
});

test("a crash after provider tab renames resumes from intermediate local-reference formulas", async () => {
 process.env.WRITE_SOURCE_LEAD_SHEETS = "false";
 const f = fixture(), plan = await inspectDerivativeFormulas(f.sheets,{configuration});
 for (const book of plan.workbooks) for (const rename of book.renames) {
  f.tabs.find(tab => tab.sheetId === rename.sheetId)!.title = rename.title;
 }
 for (const cell of plan.workbooks[0]!.formulas) f.formulas.set(`${cell.sheetId}:${cell.row}:${cell.column}`,cell.afterLocalRename);
 const result = await applyDerivativeFormulas(f.sheets,plan,{writersFenced:true,assertLease:f.lease});
 assert.equal(result.complete,true);
});
