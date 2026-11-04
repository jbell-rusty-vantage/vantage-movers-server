import type { RetirementSourcePlan, ReviewAction } from "./sourcePlan";
import { BEST_RELOCATION_TRACKER_ID, classifyExternalReview, externalSheetReviewSchema,
  REVIEW_SOURCE_TABS } from "../../src/services/leads/externalSheetReview";

function badFormAnnotation(action: ReviewAction) {
  if (action.lead_model !== "FormLead" || !action.lead_id || action.lead_action_key || action.conflict ||
      action.classification !== "bad_form" || !Number.isSafeInteger(action.expected_revision) || Number(action.expected_revision) < 0 ||
      action.cell.source_workbook_id !== BEST_RELOCATION_TRACKER_ID ||
      !["forms", "local_forms"].includes(action.dataset_key) ||
      action.cell.source_tab !== (action.dataset_key === "forms" ? "Forms" : "Local Forms") ||
      REVIEW_SOURCE_TABS[action.cell.source_tab as "Forms" | "Local Forms"] !== action.cell.source_sheet_id ||
      !action.stable_source_row_id.trim() || action.cell.stable_source_row_id !== action.stable_source_row_id ||
      !/^[a-f0-9]{64}$/.test(action.cell.source_content_hash)) return null;
  try {
    const annotation = classifyExternalReview(action.cell.raw_value, "FormLead");
    return annotation?.kind === "bad_form" ? annotation : null;
  } catch { return null; }
}

function frozenReviewKey(action: ReviewAction): string {
  return JSON.stringify([action.dataset_key, action.stable_source_row_id, action.lead_model, action.lead_id,
    action.lead_action_key, action.expected_revision, action.classification, action.conflict, action.row,
    action.cell.source_workbook_id, action.cell.source_sheet_id, action.cell.source_tab,
    action.cell.stable_source_row_id, action.cell.source_content_hash, action.cell.raw_value]);
}

/** Two approved existing Form source identities may describe the same bad
 * annotation on one canonical target. Keep the first immutable review stamp;
 * the operator records the later row's evidence as an adoption receipt only. */
export function findEquivalentFrozenReview(plan: RetirementSourcePlan, action: ReviewAction,
  currentRow: { external_sheet_review?: unknown }, runId: string): ReviewAction | null {
  const annotation = badFormAnnotation(action);
  const parsed = externalSheetReviewSchema.safeParse(currentRow.external_sheet_review);
  if (!annotation || !parsed.success || parsed.data.ingestion_run_id !== runId || parsed.data.kind !== "bad_form" ||
      parsed.data.reason_code !== annotation.reason_code || parsed.data.raw_value !== annotation.raw_value ||
      parsed.data.normalized_value !== annotation.normalized_value) return null;
  const actionKey = frozenReviewKey(action);
  const ownIndexes = plan.review_actions.flatMap((review, index) => frozenReviewKey(review) === actionKey ? [index] : []);
  if (ownIndexes.length !== 1) return null;
  const stamp = parsed.data;
  const primaries = plan.review_actions.slice(0, ownIndexes[0]).filter(primary => {
    const prior = badFormAnnotation(primary);
    return prior && primary.lead_id === action.lead_id && primary.expected_revision === action.expected_revision &&
      primary.stable_source_row_id !== action.stable_source_row_id &&
      prior.raw_value === annotation.raw_value && prior.normalized_value === annotation.normalized_value &&
      prior.kind === annotation.kind && prior.reason_code === annotation.reason_code &&
      primary.cell.source_workbook_id === action.cell.source_workbook_id && primary.cell.source_sheet_id === action.cell.source_sheet_id &&
      primary.cell.source_tab === action.cell.source_tab && stamp.source_workbook_id === primary.cell.source_workbook_id &&
      stamp.source_sheet_id === primary.cell.source_sheet_id && stamp.source_tab === primary.cell.source_tab &&
      stamp.stable_source_row_id === primary.stable_source_row_id && stamp.source_content_hash === primary.cell.source_content_hash;
  });
  return primaries.length === 1 ? primaries[0]! : null;
}

/** Only this run's recorded aggregate changes may explain the difference
 * between the frozen revision and the currently observed canonical revision. */
export function assertEquivalentReviewRevision(action: ReviewAction, currentRevision: number, ownRunEntityChangeCount: number): void {
  const base = action.expected_revision;
  if (!Number.isSafeInteger(base) || Number(base) < 0 || !Number.isSafeInteger(currentRevision) || currentRevision < 0 ||
      !Number.isSafeInteger(ownRunEntityChangeCount) || ownRunEntityChangeCount < 1 ||
      !Number.isSafeInteger(Number(base) + ownRunEntityChangeCount) || Number(base) + ownRunEntityChangeCount !== currentRevision) {
    throw new Error("equivalent_review_revision_conflict");
  }
}
