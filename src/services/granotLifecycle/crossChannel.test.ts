import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { hashCredentialRedactedPayload } from "./receiptEvidence";
import {
  extractNormalizationStatement,
  normalizeGranotReceipt,
} from "./normalization";
import { processGranotObservation, type GranotLifecycleProcessorDeps } from "./processor";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { SynchronizationDecisionDocument } from "../../models/SynchronizationDecision";
import type { LeadIdentityResult } from "./identity";
import type { SourcePolicyStore } from "./sourcePolicy";

const capturedAt = new Date("2026-08-18T16:00:00.000Z");
const companyId = new mongoose.Types.ObjectId();
const granularityId = new mongoose.Types.ObjectId();

const statement = {
  source: "Synthetic Forms",
  job_no: "567632",
  ref_no: "synthetic-ref",
  priority: "1",
  user: "MIKE",
  rep: "SALES",
  phone: "5550001111",
  from_state: "NY",
  from_zip: "10001",
  to_state: "NY",
  to_zip: "10002",
};

function reviewedStore(): SourcePolicyStore {
  return {
    async findByNormalizedLabel() {
      return [
        {
          id: String(companyId),
          enabled: true,
          lifecycle_enabled: true,
          lifecycle_disposition: "source_scoped_lead",
          lead_created_policy: "link_only",
          lead_source_company: String(companyId),
          lifecycle_routes: [
            {
              route_key: "form_any",
              lead_model: "FormLead",
              move_type: "any",
              source_granularity_id: String(granularityId),
            },
          ],
          lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
          normalized_granot_label: "synthetic forms",
        },
      ];
    },
    async findCompany() {
      return { id: String(companyId), active: true };
    },
    async findGranularity() {
      return {
        id: String(granularityId),
        source_company_id: String(companyId),
        active: true,
        channel: "form",
      };
    },
  };
}

function identity(): LeadIdentityResult {
  return {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: "form_ref_no_exact",
    target: { model: "FormLead", id: "507f1f77bcf86cd799439011" },
    candidates: [],
  };
}

function observation(receiptId: mongoose.Types.ObjectId): GranotObservationDocument {
  return {
    _id: new mongoose.Types.ObjectId(),
    receipt_id: receiptId,
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    captured_at: capturedAt,
    source_label_raw: "Synthetic Forms",
    normalized_source_label: "synthetic forms",
    identity: {
      job_no_raw: "567632",
      normalized_job_no: "567632",
      form_ref_raw: "synthetic-ref",
    },
    contact: {},
    move: {
      origin: { state: "NY", zip: "10001" },
      destination: { state: "NY", zip: "10002" },
    },
    priority: { raw: "1", canonical: "1", valid: true },
    booking_action: {},
    display_money: {},
    agent_identity: { user_raw: "MIKE", rep_raw: "SALES" },
    provider_context: {},
    issues: [],
    createdAt: capturedAt,
    updatedAt: capturedAt,
  } as unknown as GranotObservationDocument;
}

function memoryDeps(observationDoc: GranotObservationDocument): GranotLifecycleProcessorDeps & {
  decisions: SynchronizationDecisionDocument[];
} {
  const decisions: SynchronizationDecisionDocument[] = [];
  return {
    decisions,
    now: () => capturedAt,
    flags: GRANOT_LIFECYCLE_FLAG_DEFAULTS,
    sourcePolicyStore: reviewedStore(),
    loadReceipt: async () => ({
      _id: observationDoc.receipt_id,
      observation_channel: "browser_extension",
      captured_at: capturedAt,
      processing: { match_attempt: 0 },
    }),
    upsertObservation: async () => observationDoc,
    loadActivation: async () => null,
    findDecision: async () => null,
    findActiveLink: async () => null,
    resolveIdentity: async () => identity(),
    loadLeadProjection: async () => ({
      model: "FormLead",
      id: "507f1f77bcf86cd799439011",
      job_no: "567632",
      quoted: true,
      granot_priority: "1",
      receiver_agent: undefined,
      last_accepted_granot_observation: undefined,
    }),
    persistDecisionOnly: async (decision) => {
      decisions.push(decision);
    },
    persistDecisionAndLink: async ({ decision }) => {
      decisions.push(decision);
    },
    withTransaction: async (fn) => fn({} as never),
  };
}

test("[AC-33] equivalent webhook and extension statements normalize to the same identity and Priority", () => {
  const webhook = normalizeGranotReceipt({
    observation_channel: "granot_webhook",
    captured_at: capturedAt,
    route_event_class: "priority_updated",
    payload: { event_type: "priority_updated", ...statement },
  });
  const extension = normalizeGranotReceipt({
    observation_channel: "browser_extension",
    captured_at: capturedAt,
    channel_operation_kind: "lead_snapshot_apply",
    channel_operation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    payload: {
      operation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      operation_kind: "lead_snapshot_apply",
      granot_statement: statement,
    },
  });
  assert.equal(webhook.identity.form_ref_raw, extension.identity.form_ref_raw);
  assert.equal(webhook.identity.normalized_job_no, extension.identity.normalized_job_no);
  assert.equal(webhook.priority.canonical, extension.priority.canonical);
  assert.equal(webhook.priority.raw, "1");
  assert.equal(extension.priority.raw, "1");
  assert.equal(webhook.agent_identity.user_raw, "MIKE");
  assert.equal(extension.agent_identity.user_raw, "MIKE");
  assert.equal(webhook.agent_identity.rep_raw, "SALES");
  assert.equal(extension.agent_identity.rep_raw, "SALES");
  assert.notEqual(webhook.normalized_source_label, undefined);
  assert.equal(webhook.normalized_source_label, extension.normalized_source_label);
});

test("[AC-33] equivalent shadow processor outcomes match and produce zero changed paths", async () => {
  const webhookObs = observation(new mongoose.Types.ObjectId());
  const extensionObs = observation(new mongoose.Types.ObjectId());
  const webhookDeps = memoryDeps(webhookObs);
  webhookDeps.loadReceipt = async () => ({
    _id: webhookObs.receipt_id,
    observation_channel: "granot_webhook",
    captured_at: capturedAt,
    processing: { match_attempt: 0 },
  });
  const extensionDeps = memoryDeps(extensionObs);
  const webhookResult = await processGranotObservation(
    { receipt_id: String(webhookObs.receipt_id) },
    webhookDeps,
  );
  const extensionResult = await processGranotObservation(
    { receipt_id: String(extensionObs.receipt_id) },
    extensionDeps,
  );
  assert.equal(webhookResult.outcome, extensionResult.outcome);
  assert.deepEqual(
    webhookResult.effects.flatMap((effect) => effect.changed_paths ?? []),
    [],
  );
  assert.deepEqual(
    extensionResult.effects.flatMap((effect) => effect.changed_paths ?? []),
    [],
  );
});

test("[AC-02][AC-33] apply-item envelope unwraps to the statement without a second policy", () => {
  const payload = {
    operation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    operation_kind: "lead_snapshot_apply",
    granot_statement: statement,
    expected_target: { model: "FormLead", id: "507f1f77bcf86cd799439011" },
  };
  assert.deepEqual(extractNormalizationStatement(payload), statement);
  const hashed = hashCredentialRedactedPayload(payload);
  const drifted = hashCredentialRedactedPayload({
    ...payload,
    expected_target: { model: "FormLead", id: "507f1f77bcf86cd799439099" },
  });
  assert.notEqual(hashed.payload_sha256, drifted.payload_sha256);
});
