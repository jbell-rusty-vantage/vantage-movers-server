import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import {
  createGranotLifecycleProcessorActor,
  createGranotWebhookInitiator,
} from "../durableWork/actors";
import { DomainCommandContextError } from "../domainCommands/types";
import type { GranotAuthorizedLeadDesiredState } from "./authorizedDesiredState";
import {
  synchronizeLeadFromGranot,
  type SynchronizeLeadFromGranotInput,
} from "./synchronizeLeadFromGranot";
import type { SynchronizeLeadExecution } from "./synchronizeLeadTypes";
import type { GranotObservationDocument } from "../../models/GranotObservation";

const observationId = new mongoose.Types.ObjectId();
const receiptId = new mongoose.Types.ObjectId();
const leadId = new mongoose.Types.ObjectId();
const capturedAt = new Date("2026-08-18T15:00:00.000Z");

function desired(): GranotAuthorizedLeadDesiredState {
  return {
    set: { granot_priority: "1", quoted: true },
    changed_paths: ["granot_priority", "quoted"],
    contact_changed_paths: [],
    move_changed_paths: [],
    temporal_winner: { observation_id: String(observationId), captured_at: capturedAt },
  };
}

function execution(
  overrides: Partial<SynchronizeLeadExecution> = {},
): SynchronizeLeadExecution {
  return {
    observation: {
      _id: observationId,
      receipt_id: receiptId,
      captured_at: capturedAt,
    } as GranotObservationDocument,
    identity: {
      outcome: "linked",
      reason_code: "record_link_confirmed",
      match_method: "form_ref_no_exact",
      target: { model: "FormLead", id: String(leadId) },
      target_eligibility: "full",
      candidates: [],
    },
    receipt_id: receiptId,
    attempt: 1,
    execution_mode: "live",
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      lead_writes_enabled: true,
    },
    evaluated_gates: [
      "global_effect_flag",
      "post_activation_live_mode",
      "operational_enabled",
      "lifecycle_enabled",
      "disposition_permits_effect",
      "source_company_active",
      "source_granularity_active",
      "policy_permits_effect",
    ].map((gate) => ({ gate, allowed: true })),
    match_method: "form_ref_no_exact",
    candidates: [],
    decided_at: capturedAt,
    target: { model: "FormLead", id: String(leadId) },
    ...overrides,
  };
}

function input(
  overrides: Partial<SynchronizeLeadFromGranotInput> = {},
): SynchronizeLeadFromGranotInput {
  const receipt = String(receiptId);
  return {
    lead_ref: { model: "FormLead", id: String(leadId) },
    expected_domain_revision: 1,
    desired_state: desired(),
    context: {
      command_id: new mongoose.Types.ObjectId().toHexString(),
      idempotency_key: `granot:synchronize-lead:${String(observationId)}`,
      payload_checksum: "a".repeat(64),
      actor: createGranotLifecycleProcessorActor(receipt),
      initiator: createGranotWebhookInitiator(receipt),
      provenance: {
        origin: "granot_lifecycle",
        run_id: null,
        source_receipt_id: receipt,
        source_connection_key: null,
        observation_id: String(observationId),
        decision_id: new mongoose.Types.ObjectId().toHexString(),
        observation_channel: "granot_webhook",
      },
    },
    execution: execution(),
    ...overrides,
  };
}

test("[AC-32] command refuses shadow or disabled Lead writes before the executor", async () => {
  await assert.rejects(
    () =>
      synchronizeLeadFromGranot(
        input({ execution: execution({ execution_mode: "live_shadow" }) }),
      ),
    /live mode and Lead writes enabled/,
  );
  await assert.rejects(
    () =>
      synchronizeLeadFromGranot(
        input({
          execution: execution({
            flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, lead_writes_enabled: false },
          }),
        }),
      ),
    /live mode and Lead writes enabled/,
  );
});

test("[AC-32] command refuses a failed gate snapshot before the executor", async () => {
  await assert.rejects(
    () =>
      synchronizeLeadFromGranot(
        input({
          execution: execution({
            evaluated_gates: [
              { gate: "global_effect_flag", allowed: false },
              { gate: "post_activation_live_mode", allowed: true },
              { gate: "operational_enabled", allowed: true },
              { gate: "lifecycle_enabled", allowed: true },
              { gate: "disposition_permits_effect", allowed: true },
              { gate: "source_company_active", allowed: true },
              { gate: "source_granularity_active", allowed: true },
              { gate: "policy_permits_effect", allowed: true },
            ],
          }),
        }),
      ),
    /all eight effect gates/,
  );
});

test("[AC-32] Granot command context requires the processor actor and webhook initiator", async () => {
  const payload = input();
  payload.context.actor = {
    ...payload.context.actor,
    actor_id: "not-the-processor",
  };
  await assert.rejects(
    () => synchronizeLeadFromGranot(payload),
    DomainCommandContextError,
  );
});
