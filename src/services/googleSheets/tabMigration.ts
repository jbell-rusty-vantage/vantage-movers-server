import { createHash } from "node:crypto";
import type { sheets_v4 } from "googleapis";
import { SHEET_TAB_NAMES } from "../../config/domain";
import { escapeSheetTitleForRange } from "../../utils/googleSheets/ranges";
import { withSheetsRetry } from "./retry";
import { getMasterLeadsTabs } from "./targets";
import { ensureTabsAndHeaders, RENAMED_FORM_TABS, resetEnsuredTabsCache } from "./tabs";

export type TabIdentity = { sheetId: number; title: string };
export type LeadTabMigrationPlan = {
  spreadsheetId: string;
  before: TabIdentity[];
  renames: { sheetId: number; oldTitle: string; title: string }[];
  creates: string[];
  conflicts: string[];
  checksum: string;
};

/** Pure, reviewable topology plan. No row or formula changes are implied. */
export function planLeadTabMigration(spreadsheetId: string, tabs: readonly TabIdentity[]): LeadTabMigrationPlan {
  const before = tabs.map(({ sheetId, title }) => ({ sheetId, title })).sort((a, b) => a.sheetId - b.sheetId);
  const renames: LeadTabMigrationPlan["renames"] = [];
  const creates: string[] = [];
  const conflicts: string[] = [];
  if (new Set(before.map((tab) => tab.sheetId)).size !== before.length) conflicts.push("duplicate_numeric_sheet_id");
  if (new Set(before.map((tab) => tab.title)).size !== before.length) conflicts.push("duplicate_sheet_title");
  for (const rename of [...RENAMED_FORM_TABS, { oldTitle: "Bad Calls", title: SHEET_TAB_NAMES.badCalls }]) {
    const old = before.find((tab) => tab.title === rename.oldTitle);
    const current = before.find((tab) => tab.title === rename.title);
    if (old && current) conflicts.push(`both_titles_exist:${old.sheetId}:${current.sheetId}:${rename.oldTitle}:${rename.title}`);
    else if (old) renames.push({ sheetId: old.sheetId, ...rename });
    else if (!current) {
      if (rename.title === SHEET_TAB_NAMES.badCalls) creates.push(rename.title);
      else conflicts.push(`missing_form_tab:${rename.title}`);
    }
  }
  for (const title of [SHEET_TAB_NAMES.forms, SHEET_TAB_NAMES.calls, SHEET_TAB_NAMES.duplicateCalls]) {
    if (!before.some((tab) => tab.title === title)) conflicts.push(`missing_required_tab:${title}`);
  }
  const payload = { spreadsheetId, before, renames, creates, conflicts };
  return { ...payload, checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}

export async function inspectLeadTabMigration(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<LeadTabMigrationPlan> {
  const response = await withSheetsRetry("spreadsheets.get.tabMigration", () => sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" }));
  const tabs = (response.data.sheets ?? []).flatMap((sheet) => sheet.properties?.sheetId != null && sheet.properties.title
    ? [{ sheetId: sheet.properties.sheetId, title: sheet.properties.title }] : []);
  return planLeadTabMigration(spreadsheetId, tabs);
}

/** The caller owns writer fencing and derivative formula review. This helper
 * refuses ambiguous topology or a changed plan, and renames by numeric ID. */
export async function applyLeadTabMigration(sheets: sheets_v4.Sheets, plan: LeadTabMigrationPlan, options: { writersFenced: boolean; assertLease?: () => Promise<void> }): Promise<LeadTabMigrationPlan> {
  if (!options.writersFenced) throw new Error("sheet_writers_must_be_fenced");
  const validated = planLeadTabMigration(plan.spreadsheetId, plan.before);
  if (validated.checksum !== plan.checksum || JSON.stringify(validated) !== JSON.stringify(plan)) throw new Error("tab_migration_plan_checksum_mismatch");
  if (plan.conflicts.length) throw new Error(`tab_migration_conflicts:${plan.conflicts.join(";")}`);
  await options.assertLease?.();
  const current = await inspectLeadTabMigration(sheets, plan.spreadsheetId);
  if (current.conflicts.length) throw new Error(`tab_migration_conflicts:${current.conflicts.join(";")}`);
  if (current.checksum !== plan.checksum) {
    const alreadyApplied = !current.renames.length && !current.creates.length && plan.renames.every((rename) => current.before.some((tab) => tab.sheetId === rename.sheetId && tab.title === rename.title));
    if (!alreadyApplied) throw new Error("tab_migration_topology_changed");
  } else {
    const requests: sheets_v4.Schema$Request[] = [
      ...plan.renames.map((rename) => ({ updateSheetProperties: { properties: { sheetId: rename.sheetId, title: rename.title }, fields: "title" } })),
      ...plan.creates.map((title) => ({ addSheet: { properties: { title } } })),
    ];
    await options.assertLease?.();
    if (requests.length) await withSheetsRetry("batchUpdate.leadTabMigration", () => sheets.spreadsheets.batchUpdate({ spreadsheetId: plan.spreadsheetId, requestBody: { requests } }));
  }
  await options.assertLease?.();
  const tabs = getMasterLeadsTabs();
  const headers = await withSheetsRetry("values.batchGet.tabMigrationHeaders", () => sheets.spreadsheets.values.batchGet({ spreadsheetId: plan.spreadsheetId, ranges: tabs.map((tab) => `${escapeSheetTitleForRange(tab.tabName)}!A1:ZZ1`) }));
  const repair = tabs.filter((tab, index) => JSON.stringify(headers.data.valueRanges?.[index]?.values?.[0] ?? []) !== JSON.stringify(tab.headers));
  resetEnsuredTabsCache();
  await options.assertLease?.();
  if (repair.length) await ensureTabsAndHeaders(sheets, plan.spreadsheetId, repair);
  await options.assertLease?.();
  const after = await inspectLeadTabMigration(sheets, plan.spreadsheetId);
  if (after.conflicts.length || after.renames.length || after.creates.length) throw new Error("tab_migration_readback_incomplete");
  return after;
}
