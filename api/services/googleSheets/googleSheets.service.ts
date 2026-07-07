import {
  BOOKED_SHEET_HEADERS,
  CALL_SHEET_HEADERS,
  CANCELLED_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  getMasterBookedSheetContainerId,
  getMasterLeadsSheetContainerId,
  getSourceLeadSheetContainerId,
  SHEET_TAB_NAMES,
  SOURCE_COMPANY_CONFIGS,
  type SourceCompany,
} from "../../config/domain";
import type { SheetSyncEntry } from "../../models/schemaHelpers";
import type { SheetSyncUpdateEntry } from "../sheetSync/sheetSyncPersistence";
import { getSheetsClient } from "./auth";
import { deleteRowsFromTargets } from "./deleteRows";
import { bookedLeadToRow } from "./projections/bookedLeadRow";
import { callLeadToRow } from "./projections/callLeadRow";
import { cancelledLeadToRow } from "./projections/cancelledLeadRow";
import { formLeadToRow } from "./projections/formLeadRow";
import { syncRowToTargets } from "./syncRows";
import {
  getLeadTargets,
  getMasterBookedTabs,
  getMasterLeadsTabs,
  getSourceLeadTabs,
} from "./targets";
import { ensureTabsAndHeaders } from "./tabs";
import type {
  BookedLeadSheetSource,
  CallLeadSheetSource,
  CancelledLeadSheetSource,
  FormLeadSheetSource,
  SyncableDocument,
} from "./types";

export async function syncFormLeadToSheets(
  lead: FormLeadSheetSource,
): Promise<SheetSyncUpdateEntry[]> {
  const targetBase = lead.duplicate
    ? {
        masterTarget: "master_duplicates",
        sourceTarget: "source_duplicates",
        tabName: SHEET_TAB_NAMES.duplicates,
      }
    : {
        masterTarget: "master_forms",
        sourceTarget: "source_forms",
        tabName: SHEET_TAB_NAMES.forms,
      };
  const targets = getLeadTargets(
    targetBase.masterTarget,
    targetBase.sourceTarget,
    lead.source_company,
    targetBase.tabName,
    FORM_SHEET_HEADERS,
  );
  const row = formLeadToRow(lead);
  const results: SheetSyncUpdateEntry[] = await syncRowToTargets(
    lead,
    lead.bad_lead ? [...targets, masterBadLeadsTarget()] : targets,
    row,
  );
  if (!lead.bad_lead) {
    const deletedTargets = await deleteRowsFromTargets(
      lead,
      [masterBadLeadsTarget()],
      ["master_bad_leads"],
    );
    results.push(
      ...deletedTargets.map((target) => ({ target, status: "deleted" as const })),
    );
  }
  return results;
}

export async function syncCallLeadToSheets(
  lead: CallLeadSheetSource,
): Promise<SheetSyncUpdateEntry[]> {
  const targetBase = callLeadTargetBase(lead.duplicate);
  const staleTargetBase = callLeadTargetBase(!lead.duplicate);
  const targets = getLeadTargets(
    targetBase.masterTarget,
    targetBase.sourceTarget,
    lead.source_company,
    targetBase.tabName,
    CALL_SHEET_HEADERS,
  );
  const results: SheetSyncUpdateEntry[] = await syncRowToTargets(lead, targets, callLeadToRow(lead));
  const staleTargets = getLeadTargets(
    staleTargetBase.masterTarget,
    staleTargetBase.sourceTarget,
    lead.source_company,
    staleTargetBase.tabName,
    CALL_SHEET_HEADERS,
  );
  const deletedTargets = await deleteRowsFromTargets(
    lead,
    staleTargets,
    [staleTargetBase.masterTarget, staleTargetBase.sourceTarget],
  );
  results.push(
    ...deletedTargets.map((target) => ({ target, status: "deleted" as const })),
  );
  return results;
}

export async function syncBookedLeadToSheets(
  booking: BookedLeadSheetSource,
): Promise<SheetSyncEntry[]> {
  const targets = [
    {
      target: "master_booked",
      spreadsheetId: getMasterBookedSheetContainerId(),
      tabName: SHEET_TAB_NAMES.bookedDeals,
      headers: BOOKED_SHEET_HEADERS,
      ensureTabs: getMasterBookedTabs(),
    },
  ];
  return syncRowToTargets(booking, targets, bookedLeadToRow(booking));
}

export async function syncCancelledLeadToSheets(
  cancellation: CancelledLeadSheetSource,
): Promise<SheetSyncEntry[]> {
  const targets = [
    {
      target: "master_cancelled",
      spreadsheetId: getMasterBookedSheetContainerId(),
      tabName: SHEET_TAB_NAMES.cancelledDeals,
      headers: CANCELLED_SHEET_HEADERS,
      ensureTabs: getMasterBookedTabs(),
    },
  ];
  return syncRowToTargets(cancellation, targets, cancelledLeadToRow(cancellation));
}

export async function deleteFormLeadFromSheets(
  lead: SyncableDocument & { source_company: SourceCompany | string; duplicate?: boolean | null },
): Promise<void> {
  const targetBase = lead.duplicate
    ? {
        masterTarget: "master_duplicates",
        sourceTarget: "source_duplicates",
        tabName: SHEET_TAB_NAMES.duplicates,
      }
    : {
        masterTarget: "master_forms",
        sourceTarget: "source_forms",
        tabName: SHEET_TAB_NAMES.forms,
      };
  await deleteRowsFromTargets(
    lead,
    getLeadTargets(
      targetBase.masterTarget,
      targetBase.sourceTarget,
      lead.source_company,
      targetBase.tabName,
      FORM_SHEET_HEADERS,
    ),
    [targetBase.masterTarget, targetBase.sourceTarget, "master_bad_leads"],
  );
}

function masterBadLeadsTarget() {
  return {
    target: "master_bad_leads",
    spreadsheetId: getMasterLeadsSheetContainerId(),
    tabName: SHEET_TAB_NAMES.badLeads,
    headers: FORM_SHEET_HEADERS,
    ensureTabs: getMasterLeadsTabs(),
  };
}

export async function deleteCallLeadFromSheets(
  lead: SyncableDocument & { source_company: SourceCompany | string; duplicate?: boolean | null },
): Promise<void> {
  const targetBase = callLeadTargetBase(lead.duplicate);
  await deleteRowsFromTargets(
    lead,
    getLeadTargets(
      targetBase.masterTarget,
      targetBase.sourceTarget,
      lead.source_company,
      targetBase.tabName,
      CALL_SHEET_HEADERS,
    ),
    [targetBase.masterTarget, targetBase.sourceTarget],
  );
}

/**
 * Routes a call lead to the right Master Leads tab. Duplicates go to the
 * dedicated "Duplicate Calls" tab (same headers/values as the Calls tab) so
 * the owner can exclude them from lead spend without polluting the Calls tab.
 */
function callLeadTargetBase(duplicate?: boolean | null): {
  masterTarget: string;
  sourceTarget: string;
  tabName: string;
} {
  return duplicate
    ? {
        masterTarget: "master_duplicate_calls",
        sourceTarget: "source_duplicate_calls",
        tabName: SHEET_TAB_NAMES.duplicateCalls,
      }
    : {
        masterTarget: "master_calls",
        sourceTarget: "source_calls",
        tabName: SHEET_TAB_NAMES.calls,
      };
}

export async function deleteBookedLeadFromSheets(booking: SyncableDocument): Promise<void> {
  await deleteRowsFromTargets(
    booking,
    [
      {
        target: "master_booked",
        spreadsheetId: getMasterBookedSheetContainerId(),
        tabName: SHEET_TAB_NAMES.bookedDeals,
        headers: BOOKED_SHEET_HEADERS,
        ensureTabs: getMasterBookedTabs(),
      },
    ],
    ["master_booked"],
  );
}

export async function deleteCancelledLeadFromSheets(cancellation: SyncableDocument): Promise<void> {
  await deleteRowsFromTargets(
    cancellation,
    [
      {
        target: "master_cancelled",
        spreadsheetId: getMasterBookedSheetContainerId(),
        tabName: SHEET_TAB_NAMES.cancelledDeals,
        headers: CANCELLED_SHEET_HEADERS,
        ensureTabs: getMasterBookedTabs(),
      },
    ],
    ["master_cancelled"],
  );
}

export async function ensureAllConfiguredSheetTabs(): Promise<void> {
  const sheets = getSheetsClient();
  await ensureTabsAndHeaders(sheets, getMasterLeadsSheetContainerId(), getMasterLeadsTabs());
  await ensureTabsAndHeaders(sheets, getMasterBookedSheetContainerId(), getMasterBookedTabs());

  for (const source of Object.values(SOURCE_COMPANY_CONFIGS)) {
    if (!source.leadSheetEnvVar) {
      continue;
    }
    const sourceLeadSheetContainerId = getSourceLeadSheetContainerId(source.slug);
    if (!sourceLeadSheetContainerId) {
      continue;
    }
    await ensureTabsAndHeaders(sheets, sourceLeadSheetContainerId, getSourceLeadTabs(source.slug));
  }
}
