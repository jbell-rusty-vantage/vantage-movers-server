import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import {
  csiCommandSchema,
  csiPolicySchema,
} from "../../validation/v1/salesIntelligence";
import { defaultCsiPolicy } from "./policy";
import { assertTrustedActor, assertCurrentScope } from "./auth";
import { CSI_MODEL_REGISTRY } from "../../models/salesIntelligence/registry";
import { coverageDtoSchema } from "./coverageDto";
const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});
test("unknown coverage stays unknown", () => {
  assert.equal(
    coverageDtoSchema.parse({ known_through: null, gaps: [], capabilities: { call_log: "unknown", webhook: "unknown" } }).known_through,
    null,
  );
});
test("accepted policy defaults and invalid schedules", () => {
  const p = defaultCsiPolicy();
  assert.equal(p.timezone, "America/New_York");
  assert.equal(p.staffed_hours.length, 6);
  assert.deepEqual(p.enabled_capabilities, []);
  assert.deepEqual(p.retention, { audit_days: 730 });
  assert.equal(
    csiPolicySchema.safeParse({
      ...p,
      staffed_hours: [...p.staffed_hours, p.staffed_hours[0]],
    }).success,
    false,
  );
  assert.equal(csiPolicySchema.safeParse({ ...p, retention: { audit_days: 0 } }).success, false);
});
test("strict commands accept only the retained Numbers commands and reject operational injection", () => {
  const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(csiCommandSchema.safeParse({ command: "rebuild_number", expected_revision: 1, reason: "Recount" }).success, true);
  assert.equal(csiCommandSchema.safeParse({ command: "attach_lead", expected_revision: 1, contact_number_id: id,
    lead_ref: { model: "FormLead", id }, reason: "Same caller" }).success, true);
  assert.equal(csiCommandSchema.safeParse({ command: "rebuild_number", expected_revision: 1, reason: "Recount", actor: "owner" }).success, false);
  for (const retired of ["mark_worked", "assign", "create_followup", "complete_followup", "close", "reopen", "confirm_run", "reanalyze",
    "resolve_review", "resolve_restriction", "set_contact_type", "classify_number", "open_number_review", "process_conversation", "retry_job"]) {
    assert.equal(csiCommandSchema.safeParse({ command: retired, expected_revision: 1, reason: "x" }).success, false, retired);
  }
  assert.equal(csiCommandSchema.safeParse({ command: "detach_attachment", expected_revision: 1, reason: "x",
    expected_revisions: [{ target: "outreach", id, revision: 1 }] }).success, false);
});
test("all CSI model accessors honor isolated database routing without suffix collections", () => {
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_csiunit";
  for (const entry of CSI_MODEL_REGISTRY) {
    assert.equal(entry.model().db.name, "testvantagemovers_csiunit");
    assert.equal(entry.model().schema.options.autoIndex, false);
    assert.equal(
      entry.model().collection.collectionName.endsWith("_test"),
      false,
    );
  }
});
test("the model registry holds no retired collection", () => {
  const collections = CSI_MODEL_REGISTRY.map((entry) => entry.model().collection.collectionName);
  for (const retired of ["outreach_records", "outreach_followups", "outreach_band_transitions", "outreach_rep_days",
    "sales_intelligence_attention_snapshots", "sales_intelligence_attention_artifacts", "sales_intelligence_ai_budget",
    "sales_intelligence_ai_reservations", "intelligence_runs", "lead_conversations", "move_assessment_artifacts"]) {
    assert.equal(collections.includes(retired), false, retired);
  }
});
test("forged actors and non-production scopes are refused", () => {
  assert.throws(() =>
    assertTrustedActor({
      kind: "owner",
      id: "forged",
      request_id: "x",
      run_id: null,
    }),
  );
  assert.throws(() => assertCurrentScope("combined"));
  assert.throws(() => assertCurrentScope("production", "historical"));
});
