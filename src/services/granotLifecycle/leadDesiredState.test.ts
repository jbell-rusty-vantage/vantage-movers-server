import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { LeadIdentityResult } from "./identity";
import {
  planLeadDesiredState,
  type LeadDesiredStateProjection,
} from "./leadDesiredState";
import type { SourcePolicySnapshot } from "./sourcePolicy";

const capturedAt = new Date("2026-08-17T15:00:00.000Z");
const now = new Date("2026-08-17T15:00:05.000Z");

test("Call Lead accepted move dates persist independently of broad contact enrichment", () => {
  const lead: LeadDesiredStateProjection = { model: "CallLead", id: String(objectId()), job_no: "synthetic-job-100", normalized_job_no: "SYNTHETIC JOB 100", ingestion_origin: "ringcentral" };
  const identity = { ...matchedIdentity(lead.id), target: { model: "CallLead" as const, id: lead.id } };
  for (const canonical of ["0", "1", "2", "3", "9"]) {
    const result = plan({ lead, identity, observation: observation({ priority: { valid: true, canonical } }) });
    assert.deepEqual(result.desired_values.move_date, new Date("2026-09-01T00:00:00.000Z"));
    if (canonical !== "1") assert.equal(result.changed_paths.includes("granot_contact_snapshot"), false);
  }
  assert.equal(plan({ lead, identity: { ...identity, target_eligibility: "priority_only" } }).desired_values.move_date, undefined);
  const dated = { ...lead, move_date: new Date("2026-09-01T00:00:00.000Z") };
  assert.equal(plan({ lead: dated, identity, observation: observation({ move: {} }) }).desired_values.move_date, undefined, "missing date never clears a known date");
});

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
      normalized_email: "ada@example.test",
    },
    move: {
      origin: { state: "NY", zip: "10001", city: "New York" },
      destination: { state: "NY", zip: "10002", city: "Brooklyn" },
      move_date: new Date("2026-09-01T00:00:00.000Z"),
      estimated_cubic_feet: 400,
      granot_move_size_raw: "2 Bedroom",
      service_type_raw: "Moving",
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

function policy(overrides: Partial<SourcePolicySnapshot> = {}): SourcePolicySnapshot {
  return {
    granot_crm_source_id: String(objectId()),
    lead_source_company_id: String(objectId()),
    source_granularity_id: String(objectId()),
    selected_route_key: "form_local",
    selected_lead_model: "FormLead",
    selected_move_type: "local",
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    ...overrides,
  };
}

function matchedIdentity(targetId = String(objectId())): LeadIdentityResult {
  return {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: "form_ref_no_exact",
    target: { model: "FormLead", id: targetId },
    target_eligibility: "full",
    candidates: [{ target: { model: "FormLead", id: targetId }, reason_codes: ["form_ref_no_exact"] }],
    agent_assertion: "empty",
  };
}

function pendingIdentity(): LeadIdentityResult {
  return {
    outcome: "pending_match",
    reason_code: "pending_source_scoped_match",
    candidates: [],
  };
}


function callCreatePolicy(overrides: Partial<SourcePolicySnapshot> = {}): SourcePolicySnapshot {
  return policy({
    selected_route_key: "call_any",
    selected_lead_model: "CallLead",
    selected_move_type: "any",
    lead_created_policy: "create_if_missing",
    ...overrides,
  });
}

function wordpressLead(
  overrides: Partial<LeadDesiredStateProjection> = {},
): LeadDesiredStateProjection {
  const id = String(objectId());
  return {
    model: "FormLead",
    id,
    ingestion_origin: "wordpress_form",
    name: "Ada Lovelace",
    first_name: "Ada",
    last_name: "Lovelace",
    phone_number: "5551234567",
    normalized_phone_number: "5551234567",
    email: "ada@example.test",
    quoted: false,
    move_size: "Studio",
    pickup_state: "NJ",
    delivery_state: "NJ",
    local: "local",
    ...overrides,
  };
}

function plan(input: {
  observation?: GranotObservationDocument;
  identity?: LeadIdentityResult;
  lead?: LeadDesiredStateProjection | null;
  policy?: SourcePolicySnapshot;
  now?: Date;
  attempt?: number;
}) {
  const obs = input.observation ?? observation();
  return planLeadDesiredState({
    observation: obs,
    identity: input.identity ?? matchedIdentity(input.lead?.id),
    lead: input.lead,
    policy: input.policy ?? policy(),
    now: input.now ?? now,
    attempt: input.attempt ?? 1,
  });
}

test("[AC-06] malformed Priority Update is invalid and plans nothing", () => {
  const result = plan({
    observation: observation({
      route_event_class: "priority_updated",
      normalization_result: "invalid",
      issues: [{ code: "invalid_priority", severity: "error" }],
      priority: { valid: false },
    }),
    lead: wordpressLead(),
  });
  assert.equal(result.outcome, "invalid");
  assert.equal(result.reason_code, "invalid_priority_update");
  assert.deepEqual(result.desired_values, {});
  assert.deepEqual(result.changed_paths, []);
});

test("[AC-08] create_if_missing with minimum data authorizes the gated creation command", () => {
  const result = plan({
    identity: pendingIdentity(),
    policy: policy({ lead_created_policy: "create_if_missing" }),
  });
  assert.equal(result.creation_eligibility, "eligible");
  assert.equal(result.creation_model, "FormLead");
  assert.equal(result.outcome, "created");
  assert.equal(result.reason_code, "lead_created_authorized");
  assert.equal(result.target, undefined);
  assert.deepEqual(result.desired_values, {});
});

test("[AC-10] WordPress primary contact and immutable snapshot never enter changed paths", () => {
  const lead = wordpressLead();
  const result = plan({ lead });
  assert.equal(result.changed_paths.includes("name"), false);
  assert.equal(result.changed_paths.includes("phone_number"), false);
  assert.equal(result.changed_paths.includes("email"), false);
  assert.equal(result.changed_paths.includes("ingested_contact_snapshot"), false);
  assert.ok(result.changed_paths.includes("granot_contact_snapshot"));
  assert.equal(result.desired_values.name, undefined);
});

test("[AC-30] link_only pending match persists the next offset and becomes unmatched at 24h", () => {
  const pending = plan({
    identity: pendingIdentity(),
    attempt: 1,
  });
  assert.equal(pending.outcome, "pending_match");
  assert.equal(pending.reason_code, "pending_source_scoped_match");
  assert.equal(
    pending.next_match_attempt_at?.toISOString(),
    new Date(capturedAt.getTime() + 60_000).toISOString(),
  );

  const expired = plan({
    identity: pendingIdentity(),
    now: new Date(capturedAt.getTime() + 24 * 60 * 60 * 1000),
    attempt: 9,
  });
  assert.equal(expired.outcome, "unmatched");
  assert.equal(expired.reason_code, "match_window_expired");
  assert.equal(expired.next_match_attempt_at, undefined);
});

test("Call Lead snapshot formatting-only Granot contact does not remanufacture a change", () => {
  const lead: LeadDesiredStateProjection = {
    model: "CallLead",
    id: String(objectId()),
    ingestion_origin: "ringcentral",
    granot_priority: "1",
    quoted: true,
    name: "Original Caller",
    phone_number: "5550000000",
    normalized_phone_number: "5550000000",
    granot_contact_snapshot: {
      first_name: "ADA",
      last_name: "lovelace",
      name: "Ada  Lovelace",
      phone_number: "+15551234567",
      normalized_phone_number: "5551234567",
      email: "Ada@Example.Test",
    },
    pickup_city: "New York",
    pickup_zip: "10001",
    pickup_state: "NY",
    delivery_city: "Brooklyn",
    delivery_zip: "10002",
    delivery_state: "NY",
    move_date: new Date("2026-09-01T00:00:00.000Z"),
    cubic_feet: 400,
    local: "local",
    granot_move_size: "2 Bedroom",
    granot_service_type: "Moving",
    normalized_job_no: "SYNTHETIC JOB 100",
    job_no: "synthetic-job-100",
  };
  const result = plan({
    identity: {
      ...matchedIdentity(lead.id),
      target: { model: "CallLead", id: lead.id },
    },
    lead,
  });
  assert.equal(result.changed_paths.includes("granot_contact_snapshot"), false);
});

test("[AC-32] older temporal winner is stale and plans no desired-state effect", () => {
  const lead = wordpressLead({
    last_accepted_granot_observation: {
      captured_at: new Date("2026-08-17T18:00:00.000Z"),
      observation_id: String(objectId()),
    },
  });
  const result = plan({ lead });
  assert.equal(result.outcome, "stale");
  assert.equal(result.reason_code, "older_than_temporal_winner");
  assert.deepEqual(result.desired_values, {});
  assert.equal(result.temporal_winner_should_advance, false);
});

test("Bad exact Form target plans only valid Priority; Duplicate has no target", () => {
  const lead = wordpressLead();
  const bad = plan({
    identity: {
      outcome: "linked",
      reason_code: "bad_form_lead_priority_only",
      match_method: "form_ref_no_exact",
      target: { model: "FormLead", id: lead.id },
      target_eligibility: "priority_only",
      candidates: [],
    },
    lead,
  });
  assert.equal(bad.desired_values.granot_priority, "1");
  assert.equal(bad.desired_values.quoted, undefined);
  assert.equal(bad.changed_paths.includes("granot_contact_snapshot"), false);

  const duplicate = plan({
    identity: {
      outcome: "unmatched",
      reason_code: "duplicate_form_lead_ineligible",
      candidates: [{ target: { model: "FormLead", id: lead.id }, reason_codes: ["duplicate_form_lead_ineligible"] }],
    },
    lead,
  });
  assert.equal(duplicate.outcome, "unmatched");
  assert.equal(duplicate.reason_code, "duplicate_form_lead_ineligible");
  assert.equal(duplicate.target, undefined);
  assert.deepEqual(duplicate.desired_values, {});
});

test("equivalent formatting does not manufacture a Job Number change", () => {
  const lead = wordpressLead({
    granot_priority: "1",
    quoted: true,
    normalized_job_no: "SYNTHETIC JOB 100",
    job_no: "synthetic-job-100",
  });
  const result = plan({
    observation: observation({
      identity: {
        job_no_raw: "  synthetic-job-100 ",
        normalized_job_no: "SYNTHETIC JOB 100",
      },
      priority: { valid: true, canonical: "8" },
    }),
    lead,
  });
  assert.equal(result.changed_paths.includes("normalized_job_no"), false);
  assert.equal(result.changed_paths.includes("job_no"), false);
});

test("a stale Call create_if_missing policy cannot plan creation", () => {
  const result = plan({
    observation: observation({ route_event_class: "lead_created" }),
    identity: pendingIdentity(),
    policy: callCreatePolicy(),
  });
  assert.notEqual(result.creation_eligibility, "eligible");
  assert.notEqual(result.outcome, "created");
});

test("Form create_if_missing + lead_created stays eligible", () => {
  const result = plan({
    identity: pendingIdentity(),
    policy: policy({ lead_created_policy: "create_if_missing" }),
  });
  assert.equal(result.creation_eligibility, "eligible");
  assert.equal(result.creation_model, "FormLead");
  assert.equal(result.outcome, "created");
  assert.equal(result.reason_code, "lead_created_authorized");
});
