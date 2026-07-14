import {
  BOOKED_SHEET_HEADERS,
  CALL_SHEET_HEADERS,
  CANCELLED_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  getMasterBookedSheetContainerId,
  getMasterLeadsSheetContainerId,
  getSourceLeadSheetContainerId,
  SHEET_TAB_NAMES,
  shouldWriteSourceLeadSheets,
  SOURCE_COMPANY_CONFIGS,
  type SourceCompany,
} from "../../config/domain";
import type { SheetTabConfig, SyncableDocument, SyncTarget } from "./types";

export function getLeadTargets(
  masterTarget: string,
  sourceTarget: string,
  sourceCompany: SourceCompany | string,
  tabName: string,
  headers: readonly string[],
): SyncTarget[] {
  const targets: SyncTarget[] = [
    {
      target: masterTarget,
      spreadsheetId: getMasterLeadsSheetContainerId(),
      tabName,
      headers,
      ensureTabs: getMasterLeadsTabs(),
    },
  ];
  // Source-company-specific sheets are derivatives of the Master Leads sheet
  // via spreadsheet formulas, so writes only go to master unless this flag is
  // explicitly enabled. The source-target plumbing below is retained so dual
  // writes can be restored without code changes.
  const sourceSpreadsheetId = shouldWriteSourceLeadSheets()
    ? getSourceLeadSheetContainerId(sourceCompany)
    : undefined;
  if (sourceSpreadsheetId) {
    targets.push({
      target: sourceTarget,
      spreadsheetId: sourceSpreadsheetId,
      tabName,
      headers,
      ensureTabs: getSourceLeadTabs(sourceCompany),
    });
  }

  return targets;
}

export function getDeleteTargets(
  document: SyncableDocument,
  fallbackTargets: SyncTarget[],
  syncedTargets: readonly string[],
): (SyncTarget & { knownRowNumber?: number })[] {
  const byKey = new Map<string, SyncTarget & { knownRowNumber?: number }>();
  for (const target of fallbackTargets) {
    const existingSync = document.sheet_sync?.find((entry) => entry.target === target.target);
    byKey.set(deleteTargetKey(target.spreadsheetId, target.tabName), {
      ...target,
      knownRowNumber: existingSync?.row_number,
    });
  }

  for (const entry of document.sheet_sync ?? []) {
    if (!syncedTargets.includes(entry.target)) {
      continue;
    }
    const headers = getHeadersForSyncTarget(entry.target);
    if (!headers) {
      continue;
    }
    byKey.set(deleteTargetKey(entry.spreadsheet_id, entry.tab_name), {
      target: entry.target,
      spreadsheetId: entry.spreadsheet_id,
      tabName: entry.tab_name,
      headers,
      ensureTabs: getEnsureTabsForSyncTarget(entry.target),
      knownRowNumber: entry.row_number,
    });
  }

  return [...byKey.values()];
}

export function deleteTargetKey(spreadsheetId: string, tabName: string): string {
  return `${spreadsheetId}:${tabName}`;
}

export function getHeadersForSyncTarget(target: string): readonly string[] | undefined {
  switch (target) {
    case "master_forms":
    case "source_forms":
    case "master_duplicates":
    case "source_duplicates":
    case "master_bad_leads":
      return FORM_SHEET_HEADERS;
    case "master_calls":
    case "source_calls":
    case "master_duplicate_calls":
    case "source_duplicate_calls":
      return CALL_SHEET_HEADERS;
    case "master_booked":
      return BOOKED_SHEET_HEADERS;
    case "master_cancelled":
      return CANCELLED_SHEET_HEADERS;
    default:
      return undefined;
  }
}

export function getEnsureTabsForSyncTarget(target: string): SheetTabConfig[] {
  switch (target) {
    case "master_forms":
    case "master_calls":
    case "master_duplicates":
    case "master_duplicate_calls":
    case "master_bad_leads":
      return getMasterLeadsTabs();
    case "source_forms":
    case "source_calls":
    case "source_duplicates":
    case "source_duplicate_calls":
      return [
        { tabName: SHEET_TAB_NAMES.forms, headers: FORM_SHEET_HEADERS },
        { tabName: SHEET_TAB_NAMES.calls, headers: CALL_SHEET_HEADERS },
        { tabName: SHEET_TAB_NAMES.duplicates, headers: FORM_SHEET_HEADERS },
        { tabName: SHEET_TAB_NAMES.duplicateCalls, headers: CALL_SHEET_HEADERS },
        { tabName: SHEET_TAB_NAMES.badLeads, headers: FORM_SHEET_HEADERS },
        { tabName: SHEET_TAB_NAMES.badCalls, headers: CALL_SHEET_HEADERS },
      ];
    case "master_booked":
    case "master_cancelled":
      return getMasterBookedTabs();
    default:
      return [];
  }
}

export function getMasterLeadsTabs(): SheetTabConfig[] {
  return [
    { tabName: SHEET_TAB_NAMES.forms, headers: FORM_SHEET_HEADERS },
    { tabName: SHEET_TAB_NAMES.calls, headers: CALL_SHEET_HEADERS },
    { tabName: SHEET_TAB_NAMES.duplicates, headers: FORM_SHEET_HEADERS },
    { tabName: SHEET_TAB_NAMES.duplicateCalls, headers: CALL_SHEET_HEADERS },
    { tabName: SHEET_TAB_NAMES.badLeads, headers: FORM_SHEET_HEADERS },
  ];
}

export function getMasterBookedTabs(
  bookedHeaders: readonly string[] = BOOKED_SHEET_HEADERS,
): SheetTabConfig[] {
  return [
    { tabName: SHEET_TAB_NAMES.bookedDeals, headers: bookedHeaders },
    { tabName: SHEET_TAB_NAMES.cancelledDeals, headers: CANCELLED_SHEET_HEADERS },
  ];
}

export function getSourceLeadTabs(sourceCompany: SourceCompany | string): SheetTabConfig[] {
  const tabs = getMasterLeadsTabs();
  const config =
    SOURCE_COMPANY_CONFIGS[sourceCompany as keyof typeof SOURCE_COMPANY_CONFIGS];
  if (config?.hasBadTabs) {
    tabs.push(
      { tabName: SHEET_TAB_NAMES.badLeads, headers: FORM_SHEET_HEADERS },
      { tabName: SHEET_TAB_NAMES.badCalls, headers: CALL_SHEET_HEADERS },
    );
  }

  return tabs;
}
