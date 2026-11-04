import assert from "node:assert/strict";
import test from "node:test";
import { BEST_RELOCATION_TRACKER_ID } from "../../src/services/leads/externalSheetReview";
import type { RetirementSourcePlan, ReviewAction } from "./sourcePlan";
import { assertEquivalentReviewRevision, findEquivalentFrozenReview } from "./reviewAliases";

const runId = "600000000000000000000001";
const targetId = "600000000000000000000002";
function fixture() {
  const primary: ReviewAction = { dataset_key: "local_forms", stable_source_row_id: "lead:primary", lead_model: "FormLead", lead_id: targetId,
    expected_revision: 3, classification: "bad_form", row: 984,
    cell: { source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: 584355266, source_tab: "Local Forms",
      stable_source_row_id: "lead:primary", source_content_hash: "a".repeat(64), raw_value: "Duplicate Form" } };
  const alias: ReviewAction = { ...primary, stable_source_row_id: "lead:alias", row: 985,
    cell: { ...primary.cell, stable_source_row_id: "lead:alias", source_content_hash: "b".repeat(64) } };
  const plan = { review_actions: [primary, alias] } as RetirementSourcePlan;
  const current = { external_sheet_review: { kind: "bad_form", reason_code: "external_bad_form", raw_value: "Duplicate Form", normalized_value: "duplicate form",
    source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: 584355266, source_tab: "Local Forms", stable_source_row_id: "lead:primary",
    source_content_hash: "a".repeat(64), policy_version: "best-relocation-retirement-v1", ingestion_run_id: runId,
    source_row_receipt_id: "600000000000000000000003", applied_at: new Date("2026-11-04T04:00:00Z") } };
  return { primary, alias, plan, current };
}

test("two frozen Local Form rows can adopt their own run's identical prior review without a second canonical mutation", () => {
  const f = fixture(), before = structuredClone(f);
  // The first row has committed revision 3 -> 4. The second row's immutable
  // expected revision remains 3; changing that envelope would then hit namespace.
  assert.equal(findEquivalentFrozenReview(f.plan, f.alias, f.current, runId), f.primary);
  assert.doesNotThrow(() => assertEquivalentReviewRevision(f.alias, 4, 1));
  assert.deepEqual(f, before);
  assert.equal(findEquivalentFrozenReview(f.plan, f.primary, f.current, runId), null);
});

test("review alias refuses wrong run, source hash, sheet, annotation, target and changed plan order", () => {
  const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.current.external_sheet_review.ingestion_run_id = "another-run"; },
    f => { f.current.external_sheet_review.source_content_hash = "c".repeat(64); },
    f => { f.current.external_sheet_review.stable_source_row_id = "lead:unapproved"; },
    f => { f.current.external_sheet_review.source_sheet_id = 0; },
    f => { f.current.external_sheet_review.kind = "bad_call"; },
    f => { f.current.external_sheet_review.normalized_value = "other annotation"; },
    f => { f.alias.cell.source_sheet_id = 0; },
    f => { f.alias.cell.source_workbook_id = "foreign-workbook"; },
    f => { f.alias.cell.raw_value = "Bad Contact"; },
    f => { f.alias.cell.raw_value = " duplicate form "; },
    f => { f.alias.classification = "unchanged"; },
    f => { f.alias.lead_id = "600000000000000000000009"; },
    f => { f.alias.lead_model = "CallLead"; },
    f => { f.alias.expected_revision = 4; },
    f => { f.alias.conflict = "protected_field_conflict"; },
    f => { f.primary.conflict = "protected_field_conflict"; },
    f => { f.alias.lead_action_key = "created_lead_dependency"; },
    f => { f.plan.review_actions.reverse(); },
    f => { f.plan.review_actions.splice(0, 0, { ...f.primary }); },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.equal(findEquivalentFrozenReview(f.plan, f.alias, f.current, runId), null);
  }
  const missing = fixture(); delete missing.alias.lead_id;
  assert.equal(findEquivalentFrozenReview(missing.plan, missing.alias, missing.current, runId), null);
  const short = fixture(); short.primary.cell.raw_value = short.alias.cell.raw_value = "no";
  assert.equal(findEquivalentFrozenReview(short.plan, short.alias, short.current, runId), null);
  const formula = fixture(); formula.primary.cell.raw_value = formula.alias.cell.raw_value = "#REF!";
  assert.equal(findEquivalentFrozenReview(formula.plan, formula.alias, formula.current, runId), null);
});

test("review alias revision accounting refuses concurrent or unaccounted revisions", () => {
  const { alias } = fixture();
  assert.doesNotThrow(() => assertEquivalentReviewRevision(alias, 4, 1));
  for (const [revision, own] of [[5, 1], [3, 0], [4, 0], [4, 2], [4, -1], [4, 1.5], [NaN, 1], [4.5, 1]]) {
    assert.throws(() => assertEquivalentReviewRevision(alias, revision!, own!), /equivalent_review_revision_conflict/);
  }
  assert.throws(() => assertEquivalentReviewRevision({ ...alias, expected_revision: undefined }, 4, 1), /equivalent_review_revision_conflict/);
});
