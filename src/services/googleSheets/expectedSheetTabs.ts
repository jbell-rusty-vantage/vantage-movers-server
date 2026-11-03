import { getCallLeadReportingDecision } from "../leads/callLeadReportingDisposition";
import { CALL_REPORTING_TARGETS, hasFormBadProjection } from "./leadReportingTargets";
import {
  BOOKED_SHEET_HEADERS,
  CALL_SHEET_HEADERS,
  CANCELLED_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  SHEET_CONTAINS_MAX_IDS,
  SHEET_SYNC_ENTITY_MODELS,
  SHEET_TAB_NAMES,
} from "../../config/domain";
import { noSyncAppliesToNormalTabs } from "../sheetSync/noSyncLead";

export const SHEET_CONTAINS_ENTITY_MODELS = SHEET_SYNC_ENTITY_MODELS;
export type SheetContainsEntityModel = (typeof SHEET_CONTAINS_ENTITY_MODELS)[number];

export { SHEET_CONTAINS_MAX_IDS };

export const SHEET_CONTAINS_WORKBOOKS = {
  masterLeads: {
    key: "master_leads",
    title: "Master Leads",
  },
  masterBooked: {
    key: "master_booked",
    title: "Master Booked",
  },
} as const;

export type SheetContainsWorkbookKey =
  (typeof SHEET_CONTAINS_WORKBOOKS)[keyof typeof SHEET_CONTAINS_WORKBOOKS]["key"];

export type SheetContainsTabRef = {
  workbook: SheetContainsWorkbookKey;
  workbookTitle: string;
  target: string;
  tabName: string;
  headers: readonly string[];
  evidenceHeaders: readonly string[];
  role: "expected" | "sibling";
};

export type SheetContainsSkipReason = "created_on_unmatched" | "no_sync" | "missing_call_qualification";

export type SheetContainsTabPlan = {
  expected: SheetContainsTabRef[];
  siblings: SheetContainsTabRef[];
  skipReason?: SheetContainsSkipReason;
};

export type SheetContainsRecordFlags = {
  _id?: unknown;
  ringcentral?: unknown;
  external_call_admission?: unknown;
  source_company?: unknown;
  lead_source_company?: unknown;
  source_granularity_id?: unknown;
  timestamp?: unknown;
  form_fill?: boolean | null;
  external_sheet_review?: unknown;
  duplicate?: boolean | null;
  bad_lead?: string | null;
  created_on_unmatched?: boolean | null;
  no_sync?: boolean | null;
};

const FORM_EVIDENCE_HEADERS = ["Name", "Ref No", "Source Company", "Phone Number"] as const;
const CALL_EVIDENCE_HEADERS = ["Job No", "Source Company", "Phone Number"] as const;
const BOOKED_EVIDENCE_HEADERS = ["Job No", "Customer Name", "Mongo Lead ID"] as const;
const CANCELLED_EVIDENCE_HEADERS = ["Job No", "Customer Name"] as const;

function masterLeadsTab(
  target: string,
  tabName: string,
  headers: readonly string[],
  evidenceHeaders: readonly string[],
  role: SheetContainsTabRef["role"],
): SheetContainsTabRef {
  return {
    workbook: SHEET_CONTAINS_WORKBOOKS.masterLeads.key,
    workbookTitle: SHEET_CONTAINS_WORKBOOKS.masterLeads.title,
    target,
    tabName,
    headers,
    evidenceHeaders,
    role,
  };
}

function masterBookedTab(
  target: string,
  tabName: string,
  headers: readonly string[],
  evidenceHeaders: readonly string[],
): SheetContainsTabRef {
  return {
    workbook: SHEET_CONTAINS_WORKBOOKS.masterBooked.key,
    workbookTitle: SHEET_CONTAINS_WORKBOOKS.masterBooked.title,
    target,
    tabName,
    headers,
    evidenceHeaders,
    role: "expected",
  };
}

function formPrimary(duplicate?: boolean | null): SheetContainsTabRef {
  return duplicate
    ? masterLeadsTab(
        "master_duplicates",
        SHEET_TAB_NAMES.duplicates,
        FORM_SHEET_HEADERS,
        FORM_EVIDENCE_HEADERS,
        "expected",
      )
    : masterLeadsTab(
        "master_forms",
        SHEET_TAB_NAMES.forms,
        FORM_SHEET_HEADERS,
        FORM_EVIDENCE_HEADERS,
        "expected",
      );
}

function formOpposite(duplicate?: boolean | null): SheetContainsTabRef {
  return {
    ...formPrimary(!duplicate),
    role: "sibling",
  };
}

function formBadLeads(role: SheetContainsTabRef["role"]): SheetContainsTabRef {
  return masterLeadsTab(
    "master_bad_leads",
    SHEET_TAB_NAMES.badLeads,
    FORM_SHEET_HEADERS,
    FORM_EVIDENCE_HEADERS,
    role,
  );
}

export function planExpectedSheetTabs(
  entityModel: SheetContainsEntityModel,
  flags: SheetContainsRecordFlags = {},
): SheetContainsTabPlan {
  if (entityModel === "FormLead" || entityModel === "CallLead") {
    if (noSyncAppliesToNormalTabs(flags)) {
      return { expected: [], siblings: [], skipReason: "no_sync" };
    }
  }
  switch (entityModel) {
    case "FormLead": {
      if (hasFormBadProjection(flags)) {
        return { expected: [formBadLeads("expected")], siblings: [
          { ...formPrimary(false), role: "sibling" },
          { ...formPrimary(true), role: "sibling" },
        ] };
      }
      const expected = [formPrimary(flags.duplicate)];
      const siblings = [formOpposite(flags.duplicate)];
      siblings.push(formBadLeads("sibling"));
      return { expected, siblings };
    }
    case "CallLead": {
      if (flags.created_on_unmatched) {
        return { expected: [], siblings: [], skipReason: "created_on_unmatched" };
      }
      const decision = getCallLeadReportingDecision(flags);
      if (decision.disposition === "excluded") {
        return { expected: [], siblings: [], skipReason: "missing_call_qualification" };
      }
      const tabs = CALL_REPORTING_TARGETS.map((base) => masterLeadsTab(
        base.masterTarget, base.tabName, CALL_SHEET_HEADERS, CALL_EVIDENCE_HEADERS,
        base.disposition === decision.disposition ? "expected" : "sibling",
      ));
      return { expected: tabs.filter((tab) => tab.role === "expected"), siblings: tabs.filter((tab) => tab.role === "sibling") };
    }

    case "BookedLead":
      return {
        expected: [
          masterBookedTab(
            "master_booked",
            SHEET_TAB_NAMES.bookedDeals,
            BOOKED_SHEET_HEADERS,
            BOOKED_EVIDENCE_HEADERS,
          ),
        ],
        siblings: [],
      };
    case "CancelledLead":
      return {
        expected: [
          masterBookedTab(
            "master_cancelled",
            SHEET_TAB_NAMES.cancelledDeals,
            CANCELLED_SHEET_HEADERS,
            CANCELLED_EVIDENCE_HEADERS,
          ),
        ],
        siblings: [],
      };
  }
}

export function uniqueSheetContainsTabs(plan: SheetContainsTabPlan): SheetContainsTabRef[] {
  const byKey = new Map<string, SheetContainsTabRef>();
  for (const tab of [...plan.expected, ...plan.siblings]) {
    const key = `${tab.workbook}:${tab.tabName}`;
    if (!byKey.has(key)) {
      byKey.set(key, tab);
    }
  }
  return [...byKey.values()];
}
