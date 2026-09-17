import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import mongoose from "mongoose";
import {
  csiCommandSchema,
  csiPolicySchema,
} from "../../validation/v1/salesIntelligence";
import { defaultCsiPolicy } from "./policy";
import {
  signRunToken,
  verifyRunToken,
  assertTrustedActor,
  assertCurrentScope,
  type RunClaims,
  type ActiveRunScope,
} from "./auth";
import { validateEnvelopeEvidence } from "./evidence";
import { parseIntelligenceEnvelope } from "../../validation/intelligence/intelligenceEnvelope.validation";
import {
  multipleCommitmentsUndatedActionFixture,
  contactRestrictionFixture,
  ownerInstructionDisagreementFixture,
} from "../../validation/intelligence/fixtures";
import { getOutreachFollowupModel } from "../../models/OutreachFollowup";
import { CSI_MODEL_REGISTRY } from "../../models/salesIntelligence/registry";
import { matchesCsiServiceRouteTemplate } from "../../config/domain/salesIntelligence";
import {
  undatedFollowupFixture,
  ambiguousReviewFixture,
  closedReviewFixture,
  unknownCoverageFixture,
} from "./fixtures";
import { coverageDtoSchema } from "./dto";
const original = { ...process.env };
test("CSI route templates expand only the closed run paths and methods", () => {
  for (const [method, action] of [
    ["GET", "context"],
    ["POST", "read"],
    ["POST", "submit"],
    ["GET", "submission"],
  ]) {
    const template = `/api/v1/internal/sales-intelligence/runs/:id/${action}`;
    const path = template.replace(":id", "aaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(matchesCsiServiceRouteTemplate(method!, template, path), true);
    assert.equal(
      matchesCsiServiceRouteTemplate("DELETE", template, path),
      false,
    );
    assert.equal(
      matchesCsiServiceRouteTemplate(
        method!,
        template,
        path.replace("aaaaaaaaaaaaaaaaaaaaaaaa", "not-an-id"),
      ),
      false,
    );
  }
  assert.equal(
    matchesCsiServiceRouteTemplate("GET", "/api/v1/*", "/api/v1/form-leads"),
    false,
  );
});
test("Owner analysis commands bind exact output and source evidence", () => {
  const base = { expected_revision: 1 };
  const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(
    csiCommandSchema.safeParse({ ...base, command: "confirm_run" }).success,
    false,
  );
  assert.equal(
    csiCommandSchema.safeParse({
      ...base,
      command: "confirm_run",
      expected_output_digest: "synthetic-output-digest",
    }).success,
    true,
  );
  assert.equal(
    csiCommandSchema.safeParse({
      ...base,
      command: "apply_suggestion",
      run_id: id,
    }).success,
    false,
  );
  assert.equal(
    csiCommandSchema.safeParse({
      ...base,
      command: "apply_suggestion",
      run_id: id,
      suggestion_output_digest: "synthetic-suggestion",
      due_at: null,
      responsible_agent_id: id,
    }).success,
    true,
  );
  const reanalysis = {
    ...base,
    command: "reanalyze",
    mode: "original_evidence",
    owner_correction_ids: [id],
    reason: "Review correction",
  };
  assert.equal(csiCommandSchema.safeParse(reanalysis).success, false);
  assert.equal(
    csiCommandSchema.safeParse({ ...reanalysis, source_run_id: id }).success,
    true,
  );
  assert.equal(
    csiCommandSchema.safeParse({ ...reanalysis, mode: "current_context" })
      .success,
    true,
  );
});
afterEach(() => {
  process.env = { ...original };
});
test("published DTO fixtures preserve undated and review-only rows and unknown coverage", () => {
  assert.equal(undatedFollowupFixture.due_at, null);
  assert.equal(ambiguousReviewFixture.outreach, null);
  assert.equal(closedReviewFixture.outreach, null);
  assert.equal(
    coverageDtoSchema.parse(unknownCoverageFixture).known_through,
    null,
  );
});
test("accepted policy defaults and invalid schedules", () => {
  const p = defaultCsiPolicy();
  assert.equal(p.monthly_ceiling_cents, 8000);
  assert.equal(p.going_cold_staffed_minutes, 1440);
  assert.equal(p.first_action_due_staffed_minutes, 30);
  assert.equal(p.missed_callback_due_staffed_minutes, 15);
  assert.equal(p.staffed_hours.length, 6);
  assert.equal(
    csiPolicySchema.safeParse({
      ...p,
      staffed_hours: [...p.staffed_hours, p.staffed_hours[0]],
    }).success,
    false,
  );
  assert.equal(
    csiPolicySchema.safeParse({ ...p, monthly_ceiling_cents: -1 }).success,
    false,
  );
});
test("strict commands allow undated independent actions and reject operational injection", async () => {
  const action = {
    kind: "check_availability",
    description: "Check availability",
    due_at: null,
  };
  assert.equal(
    csiCommandSchema.safeParse({
      command: "create_followup",
      expected_revision: 1,
      outreach_record_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      action,
    }).success,
    true,
  );
  assert.equal(
    csiCommandSchema.safeParse({
      command: "mark_worked",
      expected_revision: 1,
      actor: "owner",
    }).success,
    false,
  );
  const Model = getOutreachFollowupModel();
  for (const key of ["one", "two"]) {
    const row = new Model({
      outreach_record_id: new mongoose.Types.ObjectId(),
      commitment_key: key,
      kind: action.kind,
      description: action.description,
      origin: "owner",
    });
    await row.validate();
    assert.equal(row.due_at, null);
  }
});
test("Grok review: empty channels/evidence and duplicate assessment are rejected; no locator gate", () => {
  const restriction = parseIntelligenceEnvelope(contactRestrictionFixture);
  const found = restriction.findings.find(
    (v) => v.kind === "contact_restriction",
  )!;
  assert.equal(
    parseIntelligenceEnvelope(restriction).findings.length > 0,
    true,
  );
  assert.throws(() =>
    parseIntelligenceEnvelope({
      ...restriction,
      findings: [{ ...found, value: { ...found.value, channels: [] } }],
    }),
  );
  assert.throws(() =>
    parseIntelligenceEnvelope({
      ...restriction,
      findings: [{ ...found, evidence: [] }],
    }),
  );
  const assessed = structuredClone(ownerInstructionDisagreementFixture);
  assert.throws(() =>
    parseIntelligenceEnvelope({
      ...assessed,
      owner_instruction_assessments: [
        ...assessed.owner_instruction_assessments,
        ...assessed.owner_instruction_assessments,
      ],
    }),
  );
  const envelope = parseIntelligenceEnvelope(
    multipleCommitmentsUndatedActionFixture,
  );
  assert.throws(
    () =>
      validateEnvelopeEvidence(envelope, {
        subject_key: "number:test",
        snapshots: [],
        instructions: [],
        allowed_followup_ids: [],
        speaker_refs: [],
      }),
    /EVIDENCE_SCOPE_INVALID/,
  );
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
test("signed run token requires scoped principal, live run, dataset, nonce, expiry, subject and tool", () => {
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_csiauth";
  process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "isolated";
  process.env.SALES_INTELLIGENCE_SCOPED_KEY_NAME = "csi-agent";
  process.env.SALES_INTELLIGENCE_RUN_TOKEN_SECRET =
    "synthetic-run-token-key-at-least-32-characters";
  const now = Date.now();
  const active: ActiveRunScope = {
    id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    subject_key: "number:test",
    deployment: "isolated",
    database: "testvantagemovers_csiauth",
    status: "running",
    token_nonce: "synthetic-nonce-123456",
    permitted_tools: ["get_lead"],
    lease_epoch: 2,
    leased_until: new Date(now + 60_000),
  };
  const claims: RunClaims = {
    version: "csi-run-token-v1",
    run_id: active.id,
    subject_key: active.subject_key,
    deployment: active.deployment,
    database: active.database,
    aud: "vantage-csi",
    nonce: active.token_nonce!,
    tools: ["get_lead"],
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 60,
    lease_epoch: 2,
  };
  const token = signRunToken(claims, active, now);
  const auth = {
    kind: "scoped_key" as const,
    scopedKeyName: "csi-agent",
    scopedKeyFingerprint: "synthetic",
  };
  assert.equal(
    verifyRunToken(token, auth, active, "get_lead", now).run_id,
    active.id,
  );
  for (const changed of [
    { subject_key: "another" },
    { deployment: "prod" },
    { database: "vantagemovers" },
    { token_nonce: "revoked" },
    { lease_epoch: 3 },
    { leased_until: new Date(now - 1) },
    { status: "completed" },
    { id: "bbbbbbbbbbbbbbbbbbbbbbbb" },
  ])
    assert.throws(
      () =>
        verifyRunToken(token, auth, { ...active, ...changed }, "get_lead", now),
      /RUN_SCOPE_DENIED/,
    );
  assert.throws(() =>
    verifyRunToken(token, { kind: "secret" }, active, "get_lead", now),
  );
  assert.throws(() =>
    verifyRunToken(
      token,
      {
        kind: "user",
        userId: "x",
        email: "owner@example.test",
        roles: ["owner"],
      },
      active,
      "get_lead",
      now,
    ),
  );
  assert.throws(() =>
    verifyRunToken(token, auth, active, "submit_intelligence_analysis", now),
  );
  assert.throws(() =>
    verifyRunToken(token, auth, active, "get_lead", now + 61_000),
  );
  assert.throws(() =>
    verifyRunToken(token + "x", auth, active, "get_lead", now),
  );
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
