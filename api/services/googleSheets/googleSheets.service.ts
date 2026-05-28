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
): Promise<SheetSyncEntry[]> {
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
  return syncRowToTargets(lead, targets, formLeadToRow(lead));
}

export async function syncCallLeadToSheets(
  lead: CallLeadSheetSource,
): Promise<SheetSyncEntry[]> {
  const targets = getLeadTargets(
    "master_calls",
    "source_calls",
    lead.source_company,
    SHEET_TAB_NAMES.calls,
    CALL_SHEET_HEADERS,
  );
  return syncRowToTargets(lead, targets, callLeadToRow(lead));
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
  lead: SyncableDocument & { source_company: SourceCompany; duplicate?: boolean | null },
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
    [targetBase.masterTarget, targetBase.sourceTarget],
  );
}

export async function deleteCallLeadFromSheets(
  lead: SyncableDocument & { source_company: SourceCompany },
): Promise<void> {
  await deleteRowsFromTargets(
    lead,
    getLeadTargets(
      "master_calls",
      "source_calls",
      lead.source_company,
      SHEET_TAB_NAMES.calls,
      CALL_SHEET_HEADERS,
    ),
    ["master_calls", "source_calls"],
  );
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
