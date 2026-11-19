// Tests for: createLeadFromGranot — idempotency/checksum helpers and strict command envelope
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  createGranotLifecycleProcessorActor,
  createGranotWebhookInitiator,
} from "../durableWork/actors";
import {
  createLeadFromGranot,
  createLeadFromGranotIdempotencyKey,
  type CreateLeadFromGranotInput,
} from "./createLeadFromGranot";


function objectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
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

test("the command rejects an otherwise valid Granot Call create before any DB access", async () => {
  await assert.rejects(createLeadFromGranot(envelope(String(objectId()), String(objectId()), { lead_model: "CallLead" })), /policy race/);
});
