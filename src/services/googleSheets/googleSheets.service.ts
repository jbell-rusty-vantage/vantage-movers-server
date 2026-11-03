import { getCallLeadReportingDecision } from "../leads/callLeadReportingDisposition";
import { noSyncAppliesToNormalTabs } from "../sheetSync/noSyncLead";
import { assertLeadTabWritesAllowed } from "../sheetSync/writerFence";
import { allFormLeadTargets, callLeadTargets, hasFormBadProjection, CALL_REPORTING_TARGET_KEYS, FORM_REPORTING_TARGET_KEYS, staleCallTargetKeys } from "./leadReportingTargets";
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
  if (noSyncAppliesToNormalTabs(lead)) {
    const targets = getLeadTargets("master_forms", "source_forms", lead.source_company, SHEET_TAB_NAMES.forms, FORM_SHEET_HEADERS);
    const deleted = await deleteRowsFromTargets(lead, targets, ["master_forms", "source_forms"]);
    return deleted.map((target) => ({ target, status: "deleted" as const }));
  }
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
    hasFormBadProjection(lead) ? [...targets, masterBadLeadsTarget()] : targets,
    row,
  );
  if (!hasFormBadProjection(lead)) {
    const deletedTargets = await deleteRowsFromTargets(
      lead,
      allFormLeadTargets(lead.source_company).filter((target) => target.target.endsWith("bad_leads")),
      ["master_bad_leads", "source_bad_leads"],
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
  const decision = getCallLeadReportingDecision(lead);
  if (decision.disposition === "excluded") return [];
  const allTargets = callLeadTargets(lead, true);
  if (noSyncAppliesToNormalTabs(lead)) {
    const deleted = await deleteRowsFromTargets(lead, allTargets, CALL_REPORTING_TARGET_KEYS);
    return deleted.map((target) => ({ target, status: "deleted" as const }));
  }
  const targets = callLeadTargets(lead);
  const results: SheetSyncUpdateEntry[] = await syncRowToTargets(lead, targets, callLeadToRow(lead));
  // A failed destination never permits deleting the last good projection.
  if (results.some((result) => result.status !== "synced")) return results;
  const staleTargets = allTargets.filter((target) => !targets.some((desired) => desired.target === target.target));
  const deleted = await deleteRowsFromTargets(lead, staleTargets, staleCallTargetKeys(lead));
  results.push(...deleted.map((target) => ({ target, status: "deleted" as const })));
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
  const targets = allFormLeadTargets(lead.source_company);
  await deleteRowsFromTargets(lead, targets, FORM_REPORTING_TARGET_KEYS);
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
  const targets = callLeadTargets(lead, true);
  await deleteRowsFromTargets(lead, targets, CALL_REPORTING_TARGET_KEYS);
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
  await assertLeadTabWritesAllowed();
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
