import assert from "node:assert/strict";
import { test } from "node:test";
import { decideAnalysisEligibility, type EligibilityInputs } from "./eligibility";
const base: EligibilityInputs = { direction: "Inbound", company: false, nonCustomer: false, leads: [], ambiguous: false, ownerNumberReview: false, mappedSalesInbound: false, reviewedRepOutbound: false, missingInputs: [] };
test("eligibility: all five accepted contexts, both Lead models, exclusions and absent upstream inputs", () => {
  for (const [change, reason, scope] of [
    [{ leads: [{ model: "FormLead", id: "f" }] }, "form_linked", "lead"],
    [{ leads: [{ model: "CallLead", id: "c" }] }, "call_linked", "lead"],
    [{ ownerNumberReview: true }, "number_review", "number"],
    [{ mappedSalesInbound: true }, "mapped_sales_inbound", "number"],
    [{ direction: "Outbound", reviewedRepOutbound: true }, "reviewed_rep_outbound", "number"],
    [{ ambiguous: true }, "ambiguous_lead_context", "number"],
  ] as Array<[Partial<EligibilityInputs>, string, string]>) {
    const result = decideAnalysisEligibility({ ...base, ...change });
    assert.equal(result.eligible, true); assert.ok(result.reasons.includes(reason)); assert.equal(result.scope, scope);
    assert.equal(result.policy_version, "csi-policy-v1");
  }
  for (const change of [{ direction: "Internal" }, { company: true }, { nonCustomer: true }]) {
    assert.equal(decideAnalysisEligibility({ ...base, mappedSalesInbound: true, ...change }).status, "excluded");
  }
  const unknown = decideAnalysisEligibility({ ...base, missingInputs: ["csi05_attachment_context", "csi10_reviewed_rep_mapping"] });
  assert.equal(unknown.eligible, null); assert.equal(unknown.status, "undetermined"); assert.equal(unknown.missing_inputs.length, 2);
  assert.deepEqual(decideAnalysisEligibility(base).reasons, ["no_sales_context"]);
});
