import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import {
  createGranotLifecycleProcessorActor,
  createGranotWebhookInitiator,
} from "../durableWork/actors";
import { DomainCommandContextError } from "../domainCommands/types";
import {
  toAuthorizedLeadDesiredState,
  type GranotAuthorizedLeadDesiredState,
} from "./authorizedDesiredState";
import {
  planLeadDesiredState,
  type LeadDesiredStateProjection,
} from "./leadDesiredState";
import {
  granotSnapshotDiffersFromIngested,
  receiverAgentCatalogStamps,
  synchronizeLeadFromGranot,
  type SynchronizeLeadFromGranotInput,
} from "./synchronizeLeadFromGranot";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { LeadIdentityResult } from "./identity";
import type { SourcePolicySnapshot } from "./sourcePolicy";
import type { SynchronizeLeadExecution } from "./synchronizeLeadTypes";

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

test("receiver fill derives catalog name snapshot and set_at off the planner", () => {
  const now = new Date("2026-08-21T17:00:00.000Z");
  assert.deepEqual(receiverAgentCatalogStamps("Synthetic Mike", now), {
    receiver_agent_name_snapshot: "Synthetic Mike",
    receiver_agent_set_at: now,
  });
});

const ingestedKellie = {
  first_name: "Kellie",
  last_name: "Boone",
  name: "Kellie Boone",
  phone_number: "5089899090",
  normalized_phone_number: "5089899090",
  email: "kfboone127@gmail.com",
};

test("Changed in Granot ignores US country-code phone formatting", () => {
  assert.equal(
    granotSnapshotDiffersFromIngested(ingestedKellie, {
      ...ingestedKellie,
      phone_number: "+15089899090",
    }),
    false,
  );
});

test("Changed in Granot ignores email case and name capitalization", () => {
  assert.equal(
    granotSnapshotDiffersFromIngested(ingestedKellie, {
      first_name: "kellie",
      last_name: "BOONE",
      name: "Kellie  Boone",
      phone_number: "(508) 989-9090",
      normalized_phone_number: "5089899090",
      email: "KFBoone127@Gmail.com",
    }),
    false,
  );
});

test("Changed in Granot ignores Granot first/last split of a name-only form submit", () => {
  assert.equal(
    granotSnapshotDiffersFromIngested(
      {
        name: "Andrew dillon",
        phone_number: "7723415290",
        normalized_phone_number: "7723415290",
        email: "dillonandrew996@gmail.com",
      },
      {
        first_name: "Andrew",
        last_name: "Dillon",
        name: "Andrew Dillon",
        phone_number: "7723415290",
        normalized_phone_number: "7723415290",
        email: "dillonandrew996@gmail.com",
      },
    ),
    false,
  );
});

test("Changed in Granot stays true when Granot last name adds another person", () => {
  assert.equal(
    granotSnapshotDiffersFromIngested(
      {
        name: "Bailey Thompson",
        phone_number: "7045168418",
        normalized_phone_number: "7045168418",
        email: "bailey@example.test",
      },
      {
        first_name: "Bailey",
        last_name: "Thompson / Sebastian Perez Ramirez",
        name: "Bailey Thompson / Sebastian Perez Ramirez",
        phone_number: "7045168418",
        normalized_phone_number: "7045168418",
        email: "bailey@example.test",
      },
    ),
    true,
  );
});

test("Changed in Granot stays true for a different person or reach path", () => {
  assert.equal(
    granotSnapshotDiffersFromIngested(ingestedKellie, {
      ...ingestedKellie,
      first_name: "Kelly",
      name: "Kelly Boone",
    }),
    true,
  );
  assert.equal(
    granotSnapshotDiffersFromIngested(ingestedKellie, {
      ...ingestedKellie,
      phone_number: "+15089899091",
      normalized_phone_number: "5089899091",
    }),
    true,
  );
  assert.equal(
    granotSnapshotDiffersFromIngested(ingestedKellie, {
      ...ingestedKellie,
      email: "other@example.test",
    }),
    true,
  );
});

test("Call Lead synchronize persists Granot Contact Snapshot and leaves live phone unchanged", () => {
  const callLeadId = String(leadId);
  const ingested = {
    first_name: "Original",
    last_name: "Caller",
    name: "Original Caller",
    phone_number: "5550000000",
    normalized_phone_number: "5550000000",
    email: "caller@example.test",
  };
  const incomingSnapshot = {
    first_name: "Ada",
    last_name: "Lovelace",
    name: "Ada Lovelace",
    phone_number: "5551234567",
    normalized_phone_number: "5551234567",
    email: "ada@example.test",
  };
  const observation = {
    _id: observationId,
    receipt_id: receiptId,
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    route_event_class: "lead_created",
    captured_at: capturedAt,
    source_label_raw: "Synthetic Inbounds",
    normalized_source_label: "synthetic inbounds",
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
      normalized_email: "ada@example.test",
    },
    move: {},
    priority: { valid: true, canonical: "1" },
    booking_action: {},
    display_money: {},
    agent_identity: {},
    provider_context: {},
    issues: [],
    createdAt: capturedAt,
    updatedAt: capturedAt,
  } as GranotObservationDocument;
  const lead: LeadDesiredStateProjection = {
    model: "CallLead",
    id: callLeadId,
    ingestion_origin: "ringcentral",
    quoted: true,
    granot_priority: "1",
    name: ingested.name,
    first_name: ingested.first_name,
    last_name: ingested.last_name,
    phone_number: ingested.phone_number,
    normalized_phone_number: ingested.normalized_phone_number,
    email: ingested.email,
    ingested_contact_snapshot: ingested,
    job_no: "synthetic-job-100",
    normalized_job_no: "SYNTHETIC JOB 100",
  };
  const identity: LeadIdentityResult = {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: "call_job_no_exact",
    target: { model: "CallLead", id: callLeadId },
    target_eligibility: "full",
    candidates: [{ target: { model: "CallLead", id: callLeadId }, reason_codes: ["call_job_no_exact"] }],
    agent_assertion: "empty",
  };
  const policy: SourcePolicySnapshot = {
    granot_crm_source_id: String(new mongoose.Types.ObjectId()),
    lead_source_company_id: String(new mongoose.Types.ObjectId()),
    source_granularity_id: String(new mongoose.Types.ObjectId()),
    selected_route_key: "call_any",
    selected_lead_model: "CallLead",
    selected_move_type: "any",
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
  };
  const planned = planLeadDesiredState({
    observation,
    identity,
    lead,
    policy,
    now: capturedAt,
    attempt: 1,
  });
  const authorized = toAuthorizedLeadDesiredState({
    plan: planned,
    lead_model: "CallLead",
    temporal_winner: { observation_id: String(observationId), captured_at: capturedAt },
  });
  assert.ok(authorized.changed_paths.includes("granot_contact_snapshot"));
  assert.deepEqual(authorized.set.granot_contact_snapshot, incomingSnapshot);
  assert.equal(authorized.changed_paths.includes("phone_number"), false);
  assert.equal(authorized.changed_paths.includes("normalized_phone_number"), false);
  assert.equal(authorized.changed_paths.includes("name"), false);
  assert.deepEqual(authorized.contact_changed_paths, []);
  assert.equal(granotSnapshotDiffersFromIngested(ingested, incomingSnapshot), true);
});
