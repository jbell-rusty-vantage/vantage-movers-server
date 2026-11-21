/**
 * Pure placement logic for `pnpm vantage -- sheet-sync reconcile`.
 *
 * No IO lives here. Records come from MongoDB and tab identities come from the
 * Master Sheets through the read-only sources in `read-only-sources.ts`. The
 * expected tab of every record is the server's own rule (`planExpectedSheetTabs`,
 * the same function Admin Sheet Contains uses), so this tool never forks routing.
 */
import { ObjectId } from "mongodb";
import {
  BOOKED_SHEET_HEADERS,
  CALL_SHEET_HEADERS,
  CANCELLED_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  SHEET_TAB_NAMES,
} from "../../src/config/domain/sheets";
import { planExpectedSheetTabs, type SheetContainsRecordFlags } from "../../src/services/googleSheets/expectedSheetTabs";
import { getCallLeadReportingDecision } from "../../src/services/leads/callLeadReportingDisposition";

export type RecordModel = "FormLead" | "CallLead" | "BookedLead" | "CancelledLead";
export type WorkbookKey = "master_leads" | "master_booked";
export type TabPolicy = "repairable" | "owner_managed" | "owner_decision";

export const RECONCILE_TABS = [
  { tab: SHEET_TAB_NAMES.forms, workbook: "master_leads", headers: FORM_SHEET_HEADERS, model: "FormLead", policy: "repairable" },
  { tab: SHEET_TAB_NAMES.duplicates, workbook: "master_leads", headers: FORM_SHEET_HEADERS, model: "FormLead", policy: "repairable" },
  { tab: SHEET_TAB_NAMES.badLeads, workbook: "master_leads", headers: FORM_SHEET_HEADERS, model: "FormLead", policy: "repairable" },
  // Owner directive, November 20: no Calls-tab backfill, repair job or major change.
  { tab: SHEET_TAB_NAMES.calls, workbook: "master_leads", headers: CALL_SHEET_HEADERS, model: "CallLead", policy: "owner_managed" },
  { tab: SHEET_TAB_NAMES.duplicateCalls, workbook: "master_leads", headers: CALL_SHEET_HEADERS, model: "CallLead", policy: "owner_managed" },
  // A Call Lead re-delivery also removes Calls and Duplicate Calls rows, so it is the Owner's call too.
  { tab: SHEET_TAB_NAMES.badCalls, workbook: "master_leads", headers: CALL_SHEET_HEADERS, model: "CallLead", policy: "owner_decision" },
  { tab: SHEET_TAB_NAMES.bookedDeals, workbook: "master_booked", headers: BOOKED_SHEET_HEADERS, model: "BookedLead", policy: "repairable" },
  { tab: SHEET_TAB_NAMES.cancelledDeals, workbook: "master_booked", headers: CANCELLED_SHEET_HEADERS, model: "CancelledLead", policy: "repairable" },
] as const satisfies readonly { tab: string; workbook: WorkbookKey; headers: readonly string[]; model: RecordModel; policy: TabPolicy }[];
export type ReconcileTabName = (typeof RECONCILE_TABS)[number]["tab"];
export const RECONCILE_TAB_NAMES: readonly string[] = RECONCILE_TABS.map((definition) => definition.tab);
export const WORKBOOK_TITLES: Record<WorkbookKey, string> = { master_leads: "Master Leads", master_booked: "Master Booked" };

export const CATEGORIES = ["missing", "wrong_tab", "duplicate", "orphan", "excluded"] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULT_SAMPLE_LIMIT = 25;

/** One Lead, Booking or Cancellation with only the flags its routing reads. */
export type ReconcileRecord = { id: string; model: RecordModel; flags: SheetContainsRecordFlags; origin?: string | null };

/** The identity evidence of one tab: its header check and the Mongo ID column, row numbers 1-based. */
export type TabIdentity =
  | { tab: string; workbook: WorkbookKey; status: "read"; managedHeadersMatch: boolean; rows: { row: number; id: string }[]; blankRows: number }
  | { tab: string; workbook: WorkbookKey; status: "absent" | "identity_unreadable"; code: string };

export type Sample = { id: string; model?: RecordModel; rows?: number[]; expected?: string[]; reasons?: string[]; origin?: string | null; created_at?: string | null };
export type CategoryResult = { count: number | null; breakdown: Record<string, number>; samples: Sample[]; more: boolean; repair: string | null };
export type TabReport = {
  tab: string; workbook: string; policy: TabPolicy; owner_managed: boolean; label: string | null;
  status: TabIdentity["status"]; code?: string; managed_headers_match?: boolean;
  rows_with_id: number; blank_id_rows: number; distinct_ids: number; expected_records: number; placed: number;
  categories: Record<Category, CategoryResult>;
};

const OWNER_MANAGED_LABEL = "Owner-managed tab (Owner directive, November 20): report only. No backfill, repair job or major change.";
const OWNER_DECISION_LABEL = "Report to the Owner. A Call Lead re-delivery also removes Calls and Duplicate Calls rows, so it falls under the Owner's Calls-tab rule.";
const REDELIVER = "With Owner approval only: queue an ordinary re-delivery with enqueueSheetSyncJob(..., { createdBy: \"script\" })";
const REPAIR_HINTS: Record<RecordModel, Record<Category, string>> = {
  FormLead: {
    missing: `${REDELIVER} ({ resource: "source_lead", leadModel: "FormLead" }). The drainer appends the row from Mongo.`,
    wrong_tab: `${REDELIVER} for the Form Lead. The drainer upserts its expected tab, then removes this row after that succeeds.`,
    duplicate: `${REDELIVER} for the Form Lead whose destination this is. Duplicate-row repair removes the extra rows after the upsert.`,
    orphan: "No record holds this Mongo ID, so no Sheet Sync path removes the row. An exact-row delete with an identity check needs Owner approval.",
    excluded: `${REDELIVER} for the No-Sync Form Lead. Its plan deletes its rows from every Form tab.`,
  },
  CallLead: {
    missing: OWNER_DECISION_LABEL, wrong_tab: OWNER_DECISION_LABEL, duplicate: OWNER_DECISION_LABEL, orphan: OWNER_DECISION_LABEL, excluded: OWNER_DECISION_LABEL,
  },
  BookedLead: {
    missing: `${REDELIVER} ({ resource: "booked_lead", bookingId }). It rewrites the Booked Deals row only.`,
    wrong_tab: "A Booking belongs only on Booked Deals. Report the row to the Owner; no Sheet Sync path moves it.",
    duplicate: `${REDELIVER} ({ resource: "booked_lead", bookingId }). Duplicate-row repair removes the extra rows after the upsert.`,
    orphan: "No record holds this Mongo ID, so no Sheet Sync path removes the row. An exact-row delete with an identity check needs Owner approval.",
    excluded: "Bookings are never excluded; report this to the Owner.",
  },
  CancelledLead: {
    missing: `${REDELIVER} ({ resource: "cancellation_chain", cancellationId }). The chain also re-delivers the Booking and its Lead; if that Lead is a Call Lead, it touches the Call tabs and needs the Owner's decision.`,
    wrong_tab: "A Cancellation belongs only on Cancelled Deals. Report the row to the Owner; no Sheet Sync path moves it.",
    duplicate: `${REDELIVER} ({ resource: "cancellation_chain", cancellationId }), subject to the Call-tab caveat for missing rows.`,
    orphan: "No record holds this Mongo ID, so no Sheet Sync path removes the row. An exact-row delete with an identity check needs Owner approval.",
    excluded: "Cancellations are never excluded; report this to the Owner.",
  },
};

/** Mirrors `buildTabRowMap`: exactly one `Mongo ID` header, a one-cell identity column, exact string IDs. */
export function parseTabIdentity(
  definition: { tab: string; workbook: WorkbookKey; headers: readonly string[] },
  header: unknown,
  identityColumn: unknown,
): TabIdentity {
  const refuse = (code: string): TabIdentity => ({ tab: definition.tab, workbook: definition.workbook, status: "identity_unreadable", code });
  if (!Array.isArray(header) || header.filter((value) => value === "Mongo ID").length !== 1) return refuse("sheet_identity_header_invalid");
  if (!Array.isArray(identityColumn) || !Array.isArray(identityColumn[0]) || identityColumn[0][0] !== "Mongo ID") return refuse("sheet_identity_rows_invalid");
  const rows: { row: number; id: string }[] = [];
  let blankRows = 0;
  for (let index = 1; index < identityColumn.length; index += 1) {
    const cells = identityColumn[index];
    if (!Array.isArray(cells) || cells.length > 1) return refuse("sheet_identity_rows_invalid");
    const value = cells[0];
    if (typeof value === "string" && value.length > 0) rows.push({ row: index + 1, id: value });
    else blankRows += 1;
  }
  return {
    tab: definition.tab, workbook: definition.workbook, status: "read",
    managedHeadersMatch: definition.headers.every((label, index) => header[index] === label), rows, blankRows,
  };
}

type Expectation = { record: ReconcileRecord; expected: Set<string>; reasons: string[] };

/** The server's routing, per record. An empty set means no row is expected anywhere. */
export function expectedPlacement(record: ReconcileRecord): Expectation {
  const plan = planExpectedSheetTabs(record.model, record.flags);
  const expected = new Set(plan.expected.map((tab) => tab.tabName));
  let reasons: string[] = [];
  if (!expected.size) {
    reasons = record.model === "CallLead" ? getCallLeadReportingDecision(record.flags).reason_codes : [];
    if (plan.skipReason === "no_sync") reasons = ["no_sync", ...reasons];
    if (!reasons.length) reasons = [plan.skipReason ?? "no_expected_tab"];
  }
  return { record, expected, reasons };
}

function createdAt(id: string): string | null {
  return ObjectId.isValid(id) && /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id).getTimestamp().toISOString() : null;
}

class Bucket {
  private readonly items: Sample[] = [];
  private readonly counts = new Map<string, number>();
  constructor(private readonly limit: number) {}
  add(key: string, sample: Sample) {
    this.items.push(sample);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
  result(repair: string | null, evaluated = true): CategoryResult {
    const sorted = [...this.items].sort((a, b) => a.id.localeCompare(b.id));
    return {
      count: evaluated ? sorted.length : null,
      breakdown: Object.fromEntries([...this.counts].sort(([a], [b]) => a.localeCompare(b))),
      samples: sorted.slice(0, this.limit), more: sorted.length > this.limit, repair,
    };
  }
}

export type ReconcileOptions = { tab?: string; sampleLimit?: number };

/**
 * Two-way placement: every record that should have a row is on exactly its
 * expected tab, and every tab row resolves to a record that belongs there.
 * Unreadable tabs never prove absence: their missing count is `null`.
 */
export function reconcilePlacement(records: readonly ReconcileRecord[], tabs: readonly TabIdentity[], options: ReconcileOptions = {}): TabReport[] {
  const limit = options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
  const index = new Map<string, Expectation>();
  for (const record of records) if (!index.has(record.id)) index.set(record.id, expectedPlacement(record));
  const definitions = RECONCILE_TABS.filter((definition) => !options.tab || definition.tab === options.tab);
  return definitions.map((definition) => {
    const identity = tabs.find((tab) => tab.tab === definition.tab && tab.workbook === definition.workbook)
      ?? { tab: definition.tab, workbook: definition.workbook, status: "absent", code: "tab_not_read" } as TabIdentity;
    const buckets = Object.fromEntries(CATEGORIES.map((category) => [category, new Bucket(limit)])) as Record<Category, Bucket>;
    const expectedHere = [...index.values()].filter((entry) => entry.expected.has(definition.tab));
    const ownerManaged = definition.policy === "owner_managed";
    // Hints follow the tab's family. Calls and Duplicate Calls carry none (Owner directive, November 20).
    const repairFor = (category: Category) => ownerManaged ? null : REPAIR_HINTS[definition.model][category];
    let placed = 0;
    const seen = new Map<string, number[]>();
    if (identity.status === "read") {
      for (const { row, id } of identity.rows) seen.set(id, [...(seen.get(id) ?? []), row]);
      for (const [id, rows] of seen) {
        const entry = index.get(id);
        const base = { id, rows, created_at: createdAt(id) };
        if (rows.length > 1) buckets.duplicate.add(`rows:${rows.length}`, { ...base, model: entry?.record.model });
        if (!entry) buckets.orphan.add(/^[0-9a-f]{24}$/i.test(id) ? "no_record" : "invalid_mongo_id", base);
        else if (!entry.expected.size) {
          buckets.excluded.add(`${entry.record.model}:${entry.reasons.join("+")}`, { ...base, model: entry.record.model, reasons: entry.reasons, origin: entry.record.origin ?? null });
        } else if (!entry.expected.has(definition.tab)) {
          const expected = [...entry.expected];
          buckets.wrong_tab.add(`${entry.record.model}->${expected.join("+")}`, { ...base, model: entry.record.model, expected, origin: entry.record.origin ?? null });
        } else placed += 1;
      }
      for (const entry of expectedHere) {
        if (seen.has(entry.record.id)) continue;
        buckets.missing.add(`${entry.record.model}:${entry.record.origin ?? "unknown_origin"}`, {
          id: entry.record.id, model: entry.record.model, origin: entry.record.origin ?? null, created_at: createdAt(entry.record.id),
        });
      }
    }
    const evaluated = identity.status === "read";
    const categories = Object.fromEntries(CATEGORIES.map((category) =>
      [category, buckets[category].result(repairFor(category), evaluated)])) as Record<Category, CategoryResult>;
    return {
      tab: definition.tab, workbook: WORKBOOK_TITLES[definition.workbook], policy: definition.policy, owner_managed: ownerManaged,
      label: ownerManaged ? OWNER_MANAGED_LABEL : definition.policy === "owner_decision" ? OWNER_DECISION_LABEL : null,
      status: identity.status, ...(identity.status !== "read" ? { code: identity.code } : { managed_headers_match: identity.managedHeadersMatch }),
      rows_with_id: identity.status === "read" ? identity.rows.length : 0,
      blank_id_rows: identity.status === "read" ? identity.blankRows : 0,
      distinct_ids: seen.size, expected_records: expectedHere.length, placed, categories,
    };
  });
}

export function totals(report: readonly TabReport[]): Record<Category, number> {
  return Object.fromEntries(CATEGORIES.map((category) => [category,
    report.reduce((sum, tab) => sum + (tab.categories[category].count ?? 0), 0)])) as Record<Category, number>;
}

const pad = (value: string | number, width: number) => String(value).padStart(width);

/** Human summary. It carries only tab names, counts, Mongo IDs, row numbers and reason codes. */
export function formatReconcileSummary(result: { target: string; database: string; observed_at: string; tabs: readonly TabReport[]; limitations: readonly string[] }, samplesPerCategory = 5): string {
  const lines = [
    `Sheet Sync reconcile (read-only) target=${result.target} database=${result.database} observed_at=${result.observed_at}`,
    "",
    `${"Tab".padEnd(17)}${pad("Rows", 7)}${pad("Expected", 9)}${pad("Placed", 8)}${pad("Missing", 8)}${pad("Wrong", 7)}${pad("Dup", 5)}${pad("Orphan", 7)}${pad("Excl", 6)}  Status`,
  ];
  for (const tab of result.tabs) {
    const count = (category: Category) => tab.categories[category].count ?? "n/a";
    const status = tab.status === "read" ? (tab.managed_headers_match ? "read" : "read, managed headers differ") : `${tab.status} (${tab.code})`;
    lines.push(`${tab.tab.padEnd(17)}${pad(tab.rows_with_id, 7)}${pad(tab.expected_records, 9)}${pad(tab.placed, 8)}${pad(count("missing"), 8)}${pad(count("wrong_tab"), 7)}${pad(count("duplicate"), 5)}${pad(count("orphan"), 7)}${pad(count("excluded"), 6)}  ${status}${tab.owner_managed ? ", Owner-managed" : ""}`);
  }
  for (const tab of result.tabs) {
    const nonzero = CATEGORIES.filter((category) => (tab.categories[category].count ?? 0) > 0);
    if (!nonzero.length) continue;
    lines.push("", `${tab.tab}${tab.label ? ` — ${tab.label}` : ""}`);
    for (const category of nonzero) {
      const entry = tab.categories[category];
      const breakdown = Object.entries(entry.breakdown).map(([key, value]) => `${key}=${value}`).join(", ");
      lines.push(`  ${category}: ${entry.count} (${breakdown})`);
      for (const sample of entry.samples.slice(0, samplesPerCategory)) {
        const parts = [sample.id, sample.model, sample.rows?.length ? `rows ${sample.rows.join(",")}` : null,
          sample.expected ? `expected ${sample.expected.join("+")}` : null, sample.reasons ? sample.reasons.join("+") : null, sample.origin ?? null].filter(Boolean);
        lines.push(`    ${parts.join("  ")}`);
      }
      if (entry.count! > samplesPerCategory) lines.push(`    … ${entry.count! - samplesPerCategory} more (use --json)`);
      if (entry.repair) lines.push(`    next step: ${entry.repair}`);
    }
  }
  lines.push("", ...result.limitations.map((limitation) => `- ${limitation}`));
  return `${lines.join("\n")}\n`;
}
