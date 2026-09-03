import {
  BOOKED_SHEET_HEADERS,
  CALL_SHEET_HEADERS,
  CANCELLED_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  SHEET_CONTAINS_MAX_IDS,
  SHEET_SYNC_ENTITY_MODELS,
  SHEET_TAB_NAMES,
} from "../../config/domain";

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

export type SheetContainsSkipReason = "created_on_unmatched";

export type SheetContainsTabPlan = {
  expected: SheetContainsTabRef[];
  siblings: SheetContainsTabRef[];
  skipReason?: SheetContainsSkipReason;
};

export type SheetContainsRecordFlags = {
  duplicate?: boolean | null;
  bad_lead?: string | null;
  created_on_unmatched?: boolean | null;
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

function callPrimary(duplicate?: boolean | null): SheetContainsTabRef {
  return duplicate
    ? masterLeadsTab(
        "master_duplicate_calls",
        SHEET_TAB_NAMES.duplicateCalls,
        CALL_SHEET_HEADERS,
        CALL_EVIDENCE_HEADERS,
        "expected",
      )
    : masterLeadsTab(
        "master_calls",
        SHEET_TAB_NAMES.calls,
        CALL_SHEET_HEADERS,
        CALL_EVIDENCE_HEADERS,
        "expected",
      );
}

/**
 * Maps a Mongo entity onto the live Master Sheet tabs Sheet Sync would write
 * right now. Tab titles match the production workbooks: Forms, Duplicates,
 * Calls, Duplicate Calls, Bad Leads, Booked Deals, Cancelled Deals.
 */
export function planExpectedSheetTabs(
  entityModel: SheetContainsEntityModel,
  flags: SheetContainsRecordFlags = {},
): SheetContainsTabPlan {
  switch (entityModel) {
    case "FormLead": {
      const expected = [formPrimary(flags.duplicate)];
      const siblings = [formOpposite(flags.duplicate)];
      if (flags.bad_lead) {
        expected.push(formBadLeads("expected"));
      } else {
        siblings.push(formBadLeads("sibling"));
      }
      return { expected, siblings };
    }
    case "CallLead": {
      if (flags.created_on_unmatched) {
        return { expected: [], siblings: [], skipReason: "created_on_unmatched" };
      }
      return {
        expected: [callPrimary(flags.duplicate)],
        siblings: [{ ...callPrimary(!flags.duplicate), role: "sibling" }],
      };
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
