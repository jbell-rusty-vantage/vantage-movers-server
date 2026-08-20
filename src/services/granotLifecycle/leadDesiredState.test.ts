import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { LeadIdentityResult } from "./identity";
import {
  evaluateMinimumCreationData,
  planLeadDesiredState,
  type LeadDesiredStateProjection,
} from "./leadDesiredState";
import type { SourcePolicySnapshot } from "./sourcePolicy";

const capturedAt = new Date("2026-08-17T15:00:00.000Z");
const now = new Date("2026-08-17T15:00:05.000Z");

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

test("[AC-05] all listed Priority forms canonicalize into desired state; only 1/5 enrich and set quoted true", () => {
  const lead = wordpressLead();
  for (const canonical of ["0", "1", "5", "8"]) {
    const result = plan({
      observation: observation({ priority: { valid: true, canonical } }),
      lead,
    });
    assert.equal(result.desired_values.granot_priority, canonical);
    if (canonical === "1" || canonical === "5") {
      assert.equal(result.desired_values.quoted, true);
      assert.ok(result.changed_paths.includes("granot_contact_snapshot"));
      assert.ok(result.changed_paths.includes("pickup_state"));
    } else {
      assert.equal(result.desired_values.quoted, undefined);
      assert.equal(result.changed_paths.includes("granot_contact_snapshot"), false);
      assert.equal(result.changed_paths.includes("quoted"), false);
    }
  }
});

test("[AC-05] leading-zero canonical 5 enriches; no Priority plans quoted false", () => {
  const lead = wordpressLead({ quoted: true, granot_priority: "1" });
  const stored = plan({
    observation: observation({ priority: { valid: true, canonical: "5" } }),
    lead,
  });
  assert.equal(stored.desired_values.granot_priority, "5");
  assert.equal(stored.desired_values.quoted, undefined);
  const zero = plan({
    observation: observation({ priority: { valid: true, canonical: "0" } }),
    lead,
  });
  assert.equal(zero.desired_values.quoted, undefined);
  assert.equal(zero.changed_paths.includes("quoted"), false);
});

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

test("[AC-06] malformed Priority on Lead Created/Booked/Release skips Priority and continues", () => {
  const lead = wordpressLead();
  for (const route_event_class of ["lead_created", "booking_status_changed"] as const) {
    const result = plan({
      observation: observation({
        route_event_class,
        normalization_result: "valid_with_issues",
        issues: [{ code: "invalid_priority", severity: "error" }],
        priority: { valid: false },
      }),
      lead,
    });
    assert.notEqual(result.outcome, "invalid");
    assert.equal(result.desired_values.granot_priority, undefined);
    assert.equal(result.desired_values.quoted, undefined);
    assert.equal(result.target?.model, "FormLead");
  }
});

test("[AC-07] matched Lead Created selects one target and never plans a second Lead", () => {
  const lead = wordpressLead();
  const result = plan({
    observation: observation({ route_event_class: "lead_created" }),
    identity: matchedIdentity(lead.id),
    lead,
  });
  assert.equal(result.target?.id, lead.id);
  assert.equal(result.creation_eligibility ?? "not_applicable", "not_applicable");
  assert.equal(result.outcome, "applied");
  assert.equal(JSON.stringify(result.desired_values).includes("created"), false);
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

test("[AC-08] incomplete create_if_missing is exact insufficient_creation_data", () => {
  const missingJob = plan({
    observation: observation({ identity: {} }),
    identity: pendingIdentity(),
    policy: policy({ lead_created_policy: "create_if_missing" }),
  });
  assert.equal(missingJob.outcome, "insufficient_creation_data");
  assert.equal(missingJob.reason_code, "missing_creation_job_number");
  assert.equal(missingJob.next_match_attempt_at, undefined);

  const missingContact = plan({
    observation: observation({ contact: {} }),
    identity: pendingIdentity(),
    policy: policy({ lead_created_policy: "create_if_missing" }),
  });
  assert.equal(missingContact.reason_code, "missing_creation_contact");
});

test("[AC-09] Local vs long-distance route result controls Form minimum-data eligibility", () => {
  const local = evaluateMinimumCreationData({
    observation: observation({
      move: {
        origin: { state: "NY", zip: "10001" },
        destination: { state: "NY", zip: "10002" },
      },
    }),
    policy: policy({ selected_move_type: "local" }),
  });
  assert.equal(local.eligibility, "eligible");

  const longDistance = evaluateMinimumCreationData({
    observation: observation({
      move: {
        origin: { state: "NY", zip: "10001" },
        destination: { state: "CA", zip: "94105" },
      },
    }),
    policy: policy({ selected_move_type: "long_distance", selected_route_key: "form_long" }),
  });
  assert.equal(longDistance.eligibility, "eligible");

  const invalid = evaluateMinimumCreationData({
    observation: observation({
      move: {
        origin: { state: "XX", zip: "10001" },
        destination: { state: "NY", zip: "10002" },
      },
    }),
    policy: policy(),
  });
  assert.equal(invalid.eligibility, "insufficient");
  if (invalid.eligibility === "insufficient") {
    assert.equal(invalid.reason_code, "missing_creation_route_data");
  }
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

test("[AC-11] WordPress immutable move snapshot and Vantage move_size stay unchanged", () => {
  const lead = wordpressLead({
    move_size: "Studio",
    pickup_state: "NJ",
    delivery_state: "CA",
    local: "long_distance",
  });
  const result = plan({ lead });
  assert.equal(result.changed_paths.includes("ingested_move_snapshot"), false);
  assert.equal(result.changed_paths.includes("move_size"), false);
  assert.equal(result.desired_values.move_size, undefined);
  assert.equal(result.desired_values.pickup_state, "NY");
  assert.equal(result.desired_values.local, "local");
  assert.equal(result.desired_values.cubic_feet, 400);
});

test("[AC-12] Call/Granot-created qualified contact plans current fields and a bounded summary", () => {
  const lead: LeadDesiredStateProjection = {
    model: "CallLead",
    id: String(objectId()),
    ingestion_origin: "ringcentral",
    quoted: false,
    name: "Original Caller",
    phone_number: "5550000000",
    normalized_phone_number: "5550000000",
  };
  const result = plan({
    identity: {
      ...matchedIdentity(lead.id),
      target: { model: "CallLead", id: lead.id },
    },
    lead,
  });
  assert.equal(result.desired_values.name, "Ada Lovelace");
  assert.equal(result.desired_values.normalized_phone_number, "5551234567");
  assert.deepEqual(result.desired_values["last_granot_contact_change.changed_paths"], [
    "email",
    "first_name",
    "last_name",
    "name",
    "normalized_phone_number",
    "phone_number",
  ]);
  assert.equal(result.changed_paths.includes("ingested_contact_snapshot"), false);
});

test("[AC-13] empty receiver fills from one active Agent at a non-1/5 Priority", () => {
  const lead = wordpressLead({ quoted: false });
  const agentId = String(objectId());
  const result = plan({
    observation: observation({ priority: { valid: true, canonical: "8" } }),
    identity: {
      ...matchedIdentity(lead.id),
      agent: {
        target: { model: "Agent", id: agentId },
        normalized_username: "synthetic.agent",
      },
      agent_assertion: "single",
    },
    lead,
  });
  assert.equal(result.desired_values.receiver_agent, agentId);
  assert.equal(result.desired_values.receiver_agent_source, "granot_username_match");
  assert.deepEqual(result.agent_changed_paths, [
    "receiver_agent",
    "receiver_agent_source",
    "receiver_agent_source_value",
  ]);
  assert.equal(result.desired_values.quoted, undefined);
});

test("[AC-13] Agent conflict or existing receiver never overwrites", () => {
  const lead = wordpressLead({ receiver_agent: String(objectId()) });
  const conflict = plan({
    observation: observation({ priority: { valid: true, canonical: "8" } }),
    identity: {
      ...matchedIdentity(lead.id),
      agent_assertion: "conflict",
    },
    lead: wordpressLead(),
  });
  assert.equal(conflict.desired_values.receiver_agent, undefined);

  const existing = plan({
    observation: observation({ priority: { valid: true, canonical: "8" } }),
    identity: {
      ...matchedIdentity(lead.id),
      agent: {
        target: { model: "Agent", id: String(objectId()) },
        normalized_username: "synthetic.agent",
      },
      agent_assertion: "single",
    },
    lead,
  });
  assert.equal(existing.desired_values.receiver_agent, undefined);
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

test("[AC-30] incomplete creation data is never scheduled as pending match", () => {
  const result = plan({
    observation: observation({ identity: {}, contact: {} }),
    identity: pendingIdentity(),
  });
  assert.equal(result.outcome, "insufficient_creation_data");
  assert.equal(result.next_match_attempt_at, undefined);
});

test("[AC-32] no-op desired state creates no changed paths", () => {
  const lead = wordpressLead({
    granot_priority: "1",
    quoted: true,
    granot_contact_snapshot: {
      first_name: "Ada",
      last_name: "Lovelace",
      name: "Ada Lovelace",
      phone_number: "5551234567",
      normalized_phone_number: "5551234567",
      email: "ada@example.test",
    },
    pickup_city: "New York",
    pickup_zip: "10001",
    pickup_state: "NY",
    delivery_city: "Brooklyn",
    destination_zip: "10002",
    delivery_state: "NY",
    move_date: new Date("2026-09-01T00:00:00.000Z"),
    cubic_feet: 400,
    local: "local",
    granot_move_size: "2 Bedroom",
    granot_service_type: "Moving",
    normalized_job_no: "SYNTHETIC JOB 100",
    job_no: "synthetic-job-100",
  });
  const result = plan({ lead });
  assert.equal(result.outcome, "already_current");
  assert.equal(result.reason_code, "desired_state_already_current");
  assert.deepEqual(result.changed_paths, []);
  assert.equal(result.temporal_winner_should_advance, true);
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

test("letter-prefixed Lead Job matches Granot digits and does not conflict", () => {
  const lead = wordpressLead({
    normalized_job_no: "P5562366",
    job_no: "P5562366",
    granot_priority: "1",
  });
  const matched = plan({
    observation: observation({
      identity: { job_no_raw: "5562366", normalized_job_no: "5562366" },
      priority: { valid: true, canonical: "1" },
    }),
    lead,
  });
  assert.notEqual(matched.outcome, "conflict");
  assert.notEqual(matched.reason_code, "job_number_conflict");

  const differentDigits = plan({
    observation: observation({
      identity: { job_no_raw: "5562365", normalized_job_no: "5562365" },
    }),
    lead,
  });
  assert.equal(differentDigits.outcome, "conflict");
  assert.equal(differentDigits.reason_code, "job_number_conflict");
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

test("observation_only policy stays evidence-only", () => {
  const result = plan({
    identity: pendingIdentity(),
    policy: policy({ lead_created_policy: "observation_only" }),
  });
  assert.equal(result.outcome, "policy_blocked");
  assert.equal(result.reason_code, "creation_policy_observation_only");
  assert.equal(result.next_match_attempt_at, undefined);
});
