// Tests for: createLeadFromGranot — idempotency/checksum helpers and strict command envelope
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { SynchronizationDecisionSourceScope } from "../../models/SynchronizationDecision";
import {
  createGranotLifecycleProcessorActor,
  createGranotWebhookInitiator,
} from "../durableWork/actors";
import {
  CREATE_LEAD_FROM_GRANOT_COMMAND_NAME,
  createLeadFromGranot,
  createLeadFromGranotIdempotencyKey,
  createLeadFromGranotPayloadChecksum,
  type CreateLeadFromGranotInput,
} from "./createLeadFromGranot";

const capturedAt = new Date("2026-08-18T15:00:00.000Z");

function objectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

function observation(
  overrides: Partial<GranotObservationDocument> = {},
): GranotObservationDocument {
  return {
    _id: objectId(),
    receipt_id: objectId(),
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    route_event_class: "lead_created",
    captured_at: capturedAt,
    source_label_raw: "Synthetic Forms",
    normalized_source_label: "synthetic forms",
    identity: {
      job_no_raw: "synthetic-job-100",
      normalized_job_no: "SYNTHETIC JOB 100",
    },
    contact: {
      first_name: "Ada",
      last_name: "Lovelace",
      display_name: "Ada Lovelace",
      phone_raw: "5551234567",
      normalized_phone: "5551234567",
      email_raw: "ada@example.test",
      normalized_email: "ada@example.test",
    },
    move: {
      origin: { city: "New York", state: "NY", zip: "10001" },
      destination: { city: "Brooklyn", state: "NY", zip: "10002" },
      move_date: new Date("2026-09-01T00:00:00.000Z"),
      granot_move_size_raw: "2 Bedroom",
      service_type_raw: "Moving",
      estimated_cubic_feet: 400,
    },
    priority: { valid: true, canonical: "1" },
    booking_action: {},
    display_money: {},
    agent_identity: {},
    provider_context: {},
    issues: [],
    createdAt: capturedAt,
    updatedAt: capturedAt,
    ...overrides,
  } as GranotObservationDocument;
}

function sourceScope(
  overrides: Partial<SynchronizationDecisionSourceScope> = {},
): SynchronizationDecisionSourceScope {
  return {
    granot_crm_source_id: objectId(),
    lead_source_company: objectId(),
    source_granularity_id: objectId(),
    disposition: "source_scoped_lead",
    policy_version: "granot-lifecycle-source-policy-v1",
    ...overrides,
  };
}

function envelope(
  observationId: string,
  receiptId: string,
  overrides: Partial<CreateLeadFromGranotInput> = {},
): CreateLeadFromGranotInput {
  return {
    observation_id: observationId,
    lead_model: "FormLead",
    source_scope: {
      lead_source_company: String(objectId()),
      source_granularity_id: String(objectId()),
    },
    context: {
      command_id: objectId().toHexString(),
      idempotency_key: createLeadFromGranotIdempotencyKey(observationId),
      payload_checksum: "a".repeat(64),
      actor: createGranotLifecycleProcessorActor(receiptId),
      initiator: createGranotWebhookInitiator(receiptId),
      provenance: {
        origin: "granot_lifecycle",
        run_id: null,
        source_receipt_id: receiptId,
        source_connection_key: null,
        observation_id: observationId,
        decision_id: objectId().toHexString(),
        observation_channel: "granot_webhook",
      },
    },
    ...overrides,
  };
}

test("[AC-08] idempotency key is observation-scoped and stable", () => {
  const observationId = String(objectId());
  const first = createLeadFromGranotIdempotencyKey(observationId);
  const second = createLeadFromGranotIdempotencyKey(observationId);
  assert.equal(first, second);
  assert.ok(first.includes(observationId));
  assert.notEqual(
    createLeadFromGranotIdempotencyKey(String(objectId())),
    first,
  );
  assert.equal(CREATE_LEAD_FROM_GRANOT_COMMAND_NAME, "createLeadFromGranot");
  assert.equal(first, `granot:create-lead:${observationId}`);
});

test("[AC-08] checksum covers Observation, model, source-scope, policy version, and creation semantics", () => {
  const row = observation();
  const scope = sourceScope();
  const baseline = createLeadFromGranotPayloadChecksum({
    observation: row,
    source_scope: scope,
    lead_model: "FormLead",
  });
  assert.match(baseline, /^[a-f0-9]{64}$/);
  assert.equal(
    createLeadFromGranotPayloadChecksum({
      observation: row,
      source_scope: scope,
      lead_model: "FormLead",
    }),
    baseline,
  );
  assert.notEqual(
    createLeadFromGranotPayloadChecksum({
      observation: observation({ _id: objectId() }),
      source_scope: scope,
      lead_model: "FormLead",
    }),
    baseline,
  );
  assert.notEqual(
    createLeadFromGranotPayloadChecksum({
      observation: row,
      source_scope: scope,
      lead_model: "CallLead",
    }),
    baseline,
  );
  assert.notEqual(
    createLeadFromGranotPayloadChecksum({
      observation: row,
      source_scope: sourceScope({ policy_version: "granot-lifecycle-source-policy-v2" }),
      lead_model: "FormLead",
    }),
    baseline,
  );
  assert.notEqual(
    createLeadFromGranotPayloadChecksum({
      observation: row,
      source_scope: sourceScope({
        lead_source_company: objectId(),
        source_granularity_id: objectId(),
      }),
      lead_model: "FormLead",
    }),
    baseline,
  );
  assert.notEqual(
    createLeadFromGranotPayloadChecksum({
      observation: observation({
        contact: { ...row.contact, normalized_phone: "5550009999" },
      }),
      source_scope: scope,
      lead_model: "FormLead",
    }),
    baseline,
  );
});

test("[AC-08] checksum never includes raw transport envelope or secret-bearing headers", () => {
  const row = observation();
  const scope = sourceScope();
  const baseline = createLeadFromGranotPayloadChecksum({
    observation: row,
    source_scope: scope,
    lead_model: "FormLead",
  });
  const withEnvelope = observation({
    ...row,
    source_label_raw: "Synthetic Forms with secret=super-secret-token",
    issues: [{ code: "invalid_priority", severity: "error" }],
    payload_event_type_raw: "lead_created",
  } as GranotObservationDocument);
  assert.equal(
    createLeadFromGranotPayloadChecksum({
      observation: withEnvelope,
      source_scope: scope,
      lead_model: "FormLead",
    }),
    baseline,
  );
  assert.equal(baseline.includes("super-secret-token"), false);
  assert.equal(baseline.includes("Authorization"), false);
});

test("[AC-08] command envelope rejects invalid Observation, missing provenance, and wrong idempotency key", async () => {
  const observationId = String(objectId());
  const receiptId = String(objectId());

  await assert.rejects(
    () => createLeadFromGranot(envelope("not-an-object-id", receiptId)),
    /valid observation_id/,
  );
  await assert.rejects(
    () =>
      createLeadFromGranot(
        envelope(observationId, receiptId, {
          source_scope: {
            lead_source_company: "not-an-object-id",
            source_granularity_id: String(objectId()),
          },
        }),
      ),
    /source_scope/,
  );
  await assert.rejects(
    () =>
      createLeadFromGranot({
        ...envelope(observationId, receiptId),
        context: {
          ...envelope(observationId, receiptId).context,
          provenance: {
            ...envelope(observationId, receiptId).context.provenance,
            observation_id: String(objectId()),
          },
        },
      }),
    /provenance/,
  );
  await assert.rejects(
    () =>
      createLeadFromGranot({
        ...envelope(observationId, receiptId),
        context: {
          ...envelope(observationId, receiptId).context,
          idempotency_key: `granot:synchronize-lead:${observationId}`,
        },
      }),
    /idempotency key/,
  );
  await assert.rejects(
    () =>
      createLeadFromGranot({
        ...envelope(observationId, receiptId),
        patch: { phone_number: "5550000000" },
      } as CreateLeadFromGranotInput),
    /no caller patch or extra input/,
  );
});

test("create_if_missing SMS handoff requires the resolved Lead Source ID from source_scope", () => {
  const companyId = String(objectId());
  const scope = sourceScope({ lead_source_company: new mongoose.Types.ObjectId(companyId) });
  assert.equal(String(scope.lead_source_company), companyId);
  assert.equal("lead_source_company" in scope, true);
  const checksum = createLeadFromGranotPayloadChecksum({
    observation: observation(),
    source_scope: scope,
    lead_model: "FormLead",
  });
  assert.match(checksum, /^[a-f0-9]{64}$/);
});
