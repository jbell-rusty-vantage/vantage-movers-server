import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contactRestrictionFixture,
  multipleCommitmentsUndatedActionFixture,
  ownerInstructionDisagreementFixture,
  repPromiseVsCustomerCallbackFixture,
  voicemailUnknownSpeakerFixture,
} from "./fixtures";
import {
  CSI_ENVELOPE_BOUNDS,
  CSI_ENVELOPE_SCHEMA_VERSION,
  parseIntelligenceEnvelope,
  safeParseIntelligenceEnvelope,
} from "./intelligenceEnvelope.validation";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function issuePaths(error: { issues: Array<{ path: PropertyKey[] }> }) {
  return error.issues.map((issue) => issue.path.join("."));
}

test("rep promise and customer callback request stay distinct kinds", () => {
  const parsed = parseIntelligenceEnvelope(repPromiseVsCustomerCallbackFixture);
  const kinds = parsed.findings.map((finding) => finding.kind).sort();

  assert.equal(parsed.schema_version, CSI_ENVELOPE_SCHEMA_VERSION);
  assert.deepEqual(kinds, [
    "customer_requested_callback",
    "promised_callback",
  ]);

  const promise = parsed.findings.find((finding) => finding.kind === "promised_callback");
  const request = parsed.findings.find(
    (finding) => finding.kind === "customer_requested_callback",
  );
  assert.ok(promise);
  assert.ok(request);
  assert.equal(promise.actor, "rep");
  assert.equal(promise.action_status, "promised");
  assert.equal(request.actor, "customer");
  assert.equal(request.action_status, "requested");
  assert.notEqual(promise.kind, request.kind);
});

test("multiple commitments accept an undated action without inventing a due date", () => {
  const parsed = parseIntelligenceEnvelope(multipleCommitmentsUndatedActionFixture);
  const actions = parsed.findings.filter(
    (finding) =>
      finding.kind === "promised_callback" || finding.kind === "next_step",
  );

  assert.equal(actions.length, 3);
  const undated = parsed.findings.find((finding) => finding.key === "undated_availability");
  assert.ok(undated);
  assert.equal(undated.kind, "next_step");
  if (undated.kind !== "next_step") return;
  assert.equal(undated.value.action_kind, "check_availability");
  assert.equal(undated.value.date_text, null);
  assert.equal(undated.value.timezone_text, null);
  assert.ok(parsed.next_step_suggestion);
  assert.equal(parsed.next_step_suggestion.action_kind, "review");
});

test("voicemail with unknown speaker is valid and is not human conversation", () => {
  const parsed = parseIntelligenceEnvelope(voicemailUnknownSpeakerFixture);
  const contact = parsed.findings[0];

  assert.equal(contact.kind, "contact_type");
  if (contact.kind !== "contact_type") return;
  assert.equal(contact.value.type, "voicemail");
  assert.equal(contact.value.voicemail_left_by, "unknown");
  assert.equal(contact.actor, "unknown");
  assert.equal(contact.speaker_ref, null);
  assert.notEqual(contact.value.type, "human_conversation");
});

test("contact restriction is schema-valid without closing Outreach", () => {
  const parsed = parseIntelligenceEnvelope(contactRestrictionFixture);
  const restriction = parsed.findings[0];

  assert.equal(restriction.kind, "contact_restriction");
  if (restriction.kind !== "contact_restriction") return;
  assert.deepEqual(restriction.value.channels, ["call"]);
  assert.equal(restriction.value.restriction, "until");
  assert.equal(restriction.value.until_text, "Friday");
  assert.equal("outreach_state" in parsed, false);
});

test("owner-instruction disagreement cites the exact instruction revision", () => {
  const parsed = parseIntelligenceEnvelope(ownerInstructionDisagreementFixture);
  assert.equal(parsed.owner_instruction_assessments.length, 1);
  assert.deepEqual(parsed.owner_instruction_assessments[0], {
    instruction_id: "instr_wait_001",
    instruction_revision: 3,
    assessment: "disagrees",
    reason: "Envelope records a Friday call promise against the Owner wait instruction.",
    finding_keys: ["rep_promised_friday"],
  });
});

test("rejects extra operational fields on the envelope and nested objects", () => {
  const withAttentionBand = {
    ...clone(repPromiseVsCustomerCallbackFixture),
    attention_band: "promised_callbacks_overdue",
  };
  const attentionResult = safeParseIntelligenceEnvelope(withAttentionBand);
  assert.equal(attentionResult.success, false);
  if (!attentionResult.success) {
    assert.ok(
      attentionResult.error.issues.some(
        (issue) =>
          issue.code === "unrecognized_keys" ||
          issue.path.includes("attention_band") ||
          issue.message.includes("attention_band"),
      ),
    );
  }

  const withOutreachState = {
    ...clone(voicemailUnknownSpeakerFixture),
    outreach_state: "open",
  };
  const outreachResult = safeParseIntelligenceEnvelope(withOutreachState);
  assert.equal(outreachResult.success, false);

  const withNestedDbPath = clone(contactRestrictionFixture);
  Object.assign(withNestedDbPath.findings[0] as object, {
    "outreach_records.0.state": "closed",
  });
  const nestedResult = safeParseIntelligenceEnvelope(withNestedDbPath);
  assert.equal(nestedResult.success, false);
});

test("rejects malformed evidence references", () => {
  const missingSnapshot = clone(voicemailUnknownSpeakerFixture);
  const missingEvidence = (missingSnapshot.findings[0] as { evidence: Array<Record<string, unknown>> })
    .evidence[0];
  delete missingEvidence.snapshot_id;
  const missingResult = safeParseIntelligenceEnvelope(missingSnapshot);
  assert.equal(missingResult.success, false);
  if (!missingResult.success) {
    assert.ok(
      issuePaths(missingResult.error).some((path) => path.includes("evidence.0")),
    );
  }

  const extraEvidenceField = clone(voicemailUnknownSpeakerFixture);
  Object.assign(
    (extraEvidenceField.findings[0] as { evidence: Array<Record<string, unknown>> }).evidence[0],
    { record_id: "lead_should_not_be_here", outreach_state: "open" },
  );
  const extraResult = safeParseIntelligenceEnvelope(extraEvidenceField);
  assert.equal(extraResult.success, false);

  const stringSegments = clone(repPromiseVsCustomerCallbackFixture);
  (
    stringSegments.findings[0] as { evidence: Array<{ segment_ids: unknown }> }
  ).evidence[0].segment_ids = ["4"];
  const segmentResult = safeParseIntelligenceEnvelope(stringSegments);
  assert.equal(segmentResult.success, false);

  const unknownSource = clone(contactRestrictionFixture);
  (
    unknownSource.findings[0] as { evidence: Array<Record<string, unknown>> }
  ).evidence[0] = {
    source: "call_log",
    snapshot_id: "snap_transcript_001",
    conversation_id: "conv_synthetic_001",
    transcript_version: "transcript_v1",
    segment_ids: [3],
    quote: "Don't call me before Friday.",
  };
  const sourceResult = safeParseIntelligenceEnvelope(unknownSource);
  assert.equal(sourceResult.success, false);

  const mixedRecord = clone(ownerInstructionDisagreementFixture);
  (
    mixedRecord.findings[0] as { evidence: Array<Record<string, unknown>> }
  ).evidence[1] = {
    source: "vantage_record",
    snapshot_id: "snap_owner_instruction_003",
    record_type: "owner_instruction",
    record_id: "instr_wait_001",
    field_paths: ["instruction_text"],
    segment_ids: [0],
  };
  const mixedResult = safeParseIntelligenceEnvelope(mixedRecord);
  assert.equal(mixedResult.success, false);
});

test("rejects unknown finding kinds, duplicate keys, and dangling finding_keys", () => {
  const unknownKind = clone(voicemailUnknownSpeakerFixture);
  (unknownKind.findings[0] as { kind: string }).kind = "lead_score";
  assert.equal(safeParseIntelligenceEnvelope(unknownKind).success, false);

  const duplicateKeys = clone(repPromiseVsCustomerCallbackFixture);
  (duplicateKeys.findings[1] as { key: string }).key = "rep_promised_friday";
  const duplicateResult = safeParseIntelligenceEnvelope(duplicateKeys);
  assert.equal(duplicateResult.success, false);
  if (!duplicateResult.success) {
    assert.ok(
      duplicateResult.error.issues.some((issue) =>
        issue.message.includes("unique"),
      ),
    );
  }

  const dangling = clone(ownerInstructionDisagreementFixture);
  dangling.summary.finding_keys = ["missing_finding"];
  const danglingResult = safeParseIntelligenceEnvelope(dangling);
  assert.equal(danglingResult.success, false);
});

test("schema validation does not authorize evidence or apply business effects", () => {
  const unauthorized = clone(repPromiseVsCustomerCallbackFixture);
  (
    unauthorized.findings[0] as { evidence: Array<{ snapshot_id: string }> }
  ).evidence[0].snapshot_id = "snap_not_in_any_run_manifest";
  (
    unauthorized.findings[0] as { value: { target_followup_id: string | null } }
  ).value.target_followup_id = "followup_not_in_this_run_evidence";

  const parsed = parseIntelligenceEnvelope(unauthorized);
  assert.equal(
    parsed.findings[0].evidence[0].snapshot_id,
    "snap_not_in_any_run_manifest",
  );
  assert.equal(
    parsed.findings[0].kind === "promised_callback"
      ? parsed.findings[0].value.target_followup_id
      : null,
    "followup_not_in_this_run_evidence",
  );

  const restriction = parseIntelligenceEnvelope(contactRestrictionFixture);
  assert.equal(
    "applied_effects" in restriction,
    false,
    "validator must not invent or require effect-ledger fields",
  );
});

test("enforces document 10 engineering bounds", () => {
  const tooManyFindings = clone(voicemailUnknownSpeakerFixture);
  const template = tooManyFindings.findings[0] as { key: string };
  tooManyFindings.findings = Array.from(
    { length: CSI_ENVELOPE_BOUNDS.max_findings + 1 },
    (_, index) => ({ ...clone(template), key: `finding_${index}` }),
  );
  tooManyFindings.summary.finding_keys = tooManyFindings.findings.map(
    (finding) => (finding as { key: string }).key,
  );
  assert.equal(safeParseIntelligenceEnvelope(tooManyFindings).success, false);

  const longClaim = clone(voicemailUnknownSpeakerFixture);
  (longClaim.findings[0] as { claim: string }).claim = "x".repeat(
    CSI_ENVELOPE_BOUNDS.max_claim_or_description_chars + 1,
  );
  assert.equal(safeParseIntelligenceEnvelope(longClaim).success, false);

  const longDate = clone(repPromiseVsCustomerCallbackFixture);
  (longDate.findings[0] as { value: { date_text: string } }).value.date_text =
    "x".repeat(CSI_ENVELOPE_BOUNDS.max_date_wording_chars + 1);
  assert.equal(safeParseIntelligenceEnvelope(longDate).success, false);

  const longSummary = clone(voicemailUnknownSpeakerFixture);
  longSummary.summary.overview = "x".repeat(
    CSI_ENVELOPE_BOUNDS.max_summary_total_chars + 1,
  );
  const summaryResult = safeParseIntelligenceEnvelope(longSummary);
  assert.equal(summaryResult.success, false);
});

test("prior-finding relations and story discrepancies are additive: absent stays valid, present is bounded to this envelope", () => {
  const base = parseIntelligenceEnvelope(clone(repPromiseVsCustomerCallbackFixture));
  assert.equal("prior_finding_relations" in base, false);
  const evidence = base.findings[0].evidence;
  const valid = { ...clone(base), prior_finding_relations: [{ prior_finding_id: "prior-1", relation: "superseded", by_finding_key: base.findings[0].key, evidence, note: null }],
    story_discrepancies: [{ story_event_id: "lead_message_sent:abc", claim: "Customer says no text arrived", evidence }] };
  assert.equal(safeParseIntelligenceEnvelope(valid).success, true);
  const unknownKey = safeParseIntelligenceEnvelope({ ...valid, prior_finding_relations: [{ ...valid.prior_finding_relations[0], by_finding_key: "invented" }] });
  assert.equal(unknownKey.success, false);
  if (!unknownKey.success) assert(issuePaths(unknownKey.error).includes("prior_finding_relations.0.by_finding_key"));
  const noEvidence = safeParseIntelligenceEnvelope({ ...valid, prior_finding_relations: [{ ...valid.prior_finding_relations[0], evidence: [] }] });
  assert.equal(noEvidence.success, false);
  assert.equal(safeParseIntelligenceEnvelope({ ...valid, prior_finding_relations: [{ ...valid.prior_finding_relations[0], relation: "cannot_determine", by_finding_key: null, evidence: [] }] }).success, true);
  const duplicate = safeParseIntelligenceEnvelope({ ...valid, prior_finding_relations: [valid.prior_finding_relations[0], valid.prior_finding_relations[0]] });
  assert.equal(duplicate.success, false);
  assert.equal(safeParseIntelligenceEnvelope({ ...valid, story_discrepancies: [{ ...valid.story_discrepancies[0], evidence: [] }] }).success, false);
});
