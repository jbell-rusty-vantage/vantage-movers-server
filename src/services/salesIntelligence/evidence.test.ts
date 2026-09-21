import assert from "node:assert/strict";
import { test } from "node:test";
import { CsiError } from "./auth";
import { validateEnvelopeEvidence, type EvidenceManifestEntry } from "./evidence";
import type { IntelligenceEnvelope } from "../../validation/intelligence/intelligenceEnvelope.validation";

const snapshot: EvidenceManifestEntry = {
  snapshot_id: "captured-1", subject_key: "number:1", source: "vantage_record",
  conversation_id: null, transcript_version: null,
  record_type: "lead", record_id: "lead-1", field_paths: ["status", "booked"],
};
const scope = { subject_key: "number:1", snapshots: [snapshot], allowed_followup_ids: ["followup-1"],
  instructions: [{ id: "instruction-1", revision: 2 }], speaker_refs: ["speaker-1"] };

function envelope(overrides: Partial<IntelligenceEnvelope> = {}): IntelligenceEnvelope {
  return {
    schema_version: "csi-envelope-v1",
    summary: { overview: "", customer_wanted: "", money_and_dates: "", outcome: "", commitments: "", discrepancies: "", finding_keys: [] },
    findings: [], next_step_suggestion: null, owner_instruction_assessments: [], ...overrides,
  } as IntelligenceEnvelope;
}
function finding(evidence: unknown[], extra: Record<string, unknown> = {}) {
  return { key: "k1", claim: "c", basis: "vantage_record", actor: "rep", speaker_ref: null, action_status: null,
    clarity: "clear", confidence: null, kind: "intent", value: { intent: "unknown" }, evidence, ...extra } as unknown;
}
const ref = (overrides: Record<string, unknown> = {}) => ({ source: "vantage_record", snapshot_id: "captured-1",
  record_type: "lead", record_id: "lead-1", field_paths: ["status"], ...overrides });

function issuesOf(value: IntelligenceEnvelope) {
  try { validateEnvelopeEvidence(value, scope); return null; }
  catch (error) {
    assert(error instanceof CsiError);
    assert.equal(error.code, "EVIDENCE_SCOPE_INVALID");
    return error.issues?.map(issue => `${issue.path}:${issue.code}`) ?? [];
  }
}

test("an authorized citation passes and raises nothing", () => {
  assert.equal(issuesOf(envelope({ findings: [finding([ref()])] as IntelligenceEnvelope["findings"] })), null);
});

test("every citation refusal names the position and the reason, and never echoes the submitted id", () => {
  // Without these paths the refusal reached the model as a bare code, so its
  // one repair allowance could not be spent on the citation (22 §4.4).
  const cases: Array<[string, IntelligenceEnvelope, string]> = [
    ["unknown snapshot", envelope({ findings: [finding([ref({ snapshot_id: "invented-9" })])] as IntelligenceEnvelope["findings"] }),
      "findings.0.evidence.0.snapshot_id:snapshot_not_captured"],
    ["record not on that snapshot", envelope({ findings: [finding([ref({ record_id: "lead-other" })])] as IntelligenceEnvelope["findings"] }),
      "findings.0.evidence.0.snapshot_id:citation_not_on_snapshot"],
    ["field path not exposed", envelope({ findings: [finding([ref({ field_paths: ["fields.status"] })])] as IntelligenceEnvelope["findings"] }),
      "findings.0.evidence.0.field_paths:field_path_not_exposed"],
    ["speaker not listed", envelope({ findings: [finding([ref()], { speaker_ref: "speaker-9" })] as IntelligenceEnvelope["findings"] }),
      "findings.0.speaker_ref:speaker_ref_not_listed"],
    ["follow-up not allowed", envelope({ findings: [finding([ref()], { kind: "next_step",
      value: { action_kind: "call", description: "d", date_text: null, timezone_text: null, target_followup_id: "followup-9" } })] as IntelligenceEnvelope["findings"] }),
      "findings.0.value.target_followup_id:followup_not_allowed"],
    ["instruction revision not observed", envelope({ owner_instruction_assessments: [
      { instruction_id: "instruction-1", instruction_revision: 5, assessment: "agrees", reason: "r", finding_keys: [] }] }),
      "owner_instruction_assessments.0.instruction_id:instruction_revision_not_observed"],
  ];
  for (const [name, value, expected] of cases) {
    const issues = issuesOf(value);
    assert.deepEqual(issues, [expected], name);
    assert.equal(JSON.stringify(issues).includes("invented-9"), false, name);
    assert.equal(JSON.stringify(issues).includes("speaker-9"), false, name);
  }
});

test("several refusals are reported together and bounded", () => {
  const findings = Array.from({ length: 30 }, (_, index) =>
    finding([ref({ snapshot_id: `invented-${index}` })], { key: `k${index}` }));
  const issues = issuesOf(envelope({ findings: findings as IntelligenceEnvelope["findings"] }));
  assert(issues && issues.length > 1, "one repair needs to see more than the first mistake");
  assert(issues.length <= 16, `unbounded issue list: ${issues.length}`);
});
