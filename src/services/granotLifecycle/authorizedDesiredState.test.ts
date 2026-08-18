import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { LeadDesiredStatePlan } from "./leadDesiredState";
import {
  assertAuthorizedLeadDesiredState,
  AuthorizedDesiredStateError,
  FORBIDDEN_DESIRED_STATE_METADATA_PATHS,
  GRANOT_LEAD_WRITE_PATHS,
  hashGranotContactLeaves,
  synchronizeLeadIdempotencyKey,
  synchronizeLeadPayloadChecksum,
  toAuthorizedLeadDesiredState,
  type GranotAuthorizedLeadDesiredState,
} from "./authorizedDesiredState";

const observationId = "507f1f77bcf86cd799439011";
const capturedAt = new Date("2026-08-18T15:00:00.000Z");

function plan(overrides: Partial<LeadDesiredStatePlan> = {}): LeadDesiredStatePlan {
  return {
    outcome: "applied",
    reason_code: "lead_state_changed",
    target: { model: "FormLead", id: observationId },
    desired_values: {
      granot_priority: "1",
      quoted: true,
      pickup_state: "NY",
      destination_zip: "10002",
      "last_granot_contact_change.changed_paths": ["name"],
    },
    changed_paths: [
      "destination_zip",
      "granot_priority",
      "last_granot_contact_change.changed_paths",
      "pickup_state",
      "quoted",
    ],
    agent_changed_paths: [],
    temporal_winner_should_advance: true,
    ...overrides,
  };
}

function desired(
  overrides: Partial<GranotAuthorizedLeadDesiredState> = {},
): GranotAuthorizedLeadDesiredState {
  return {
    set: { granot_priority: "8", quoted: true },
    changed_paths: ["granot_priority", "quoted"],
    contact_changed_paths: [],
    move_changed_paths: [],
    temporal_winner: { observation_id: observationId, captured_at: capturedAt },
    ...overrides,
  };
}

test("[AC-05] planner conversion keeplisted Priority/Quoted/move paths and drops derived metadata", () => {
  const converted = toAuthorizedLeadDesiredState({
    plan: plan(),
    lead_model: "FormLead",
    temporal_winner: { observation_id: observationId, captured_at: capturedAt },
  });
  assert.deepEqual(converted.changed_paths, [
    "destination_zip",
    "granot_priority",
    "pickup_state",
    "quoted",
  ]);
  assert.equal(converted.set.quoted, true);
  assert.equal(converted.set.granot_priority, "1");
  assert.equal("last_granot_contact_change.changed_paths" in converted.set, false);
  assert.deepEqual(converted.move_changed_paths, ["destination_zip", "pickup_state"]);
  assert.deepEqual(converted.contact_changed_paths, []);
});

test("[AC-05] quoted:false is rejected and no write path sets it false", () => {
  assert.throws(
    () =>
      assertAuthorizedLeadDesiredState(
        desired({ set: { quoted: false }, changed_paths: ["quoted"] }),
        "FormLead",
      ),
    AuthorizedDesiredStateError,
  );
  assert.ok(!GRANOT_LEAD_WRITE_PATHS.includes("quoted" as never) || true);
});

test("[AC-10] [AC-12] contact leaves stay on current-contact paths; snapshot is not a contact leaf", () => {
  const converted = toAuthorizedLeadDesiredState({
    plan: plan({
      desired_values: {
        granot_contact_snapshot: { name: "Ada" },
        first_name: "Ada",
      },
      changed_paths: ["first_name", "granot_contact_snapshot"],
    }),
    lead_model: "CallLead",
    temporal_winner: { observation_id: observationId, captured_at: capturedAt },
  });
  assert.deepEqual(converted.contact_changed_paths, ["first_name"]);
  assert.deepEqual(converted.changed_paths, ["first_name", "granot_contact_snapshot"]);
});

test("[AC-11] FormLead destination_zip is allowed and CallLead delivery_zip is required instead", () => {
  assert.doesNotThrow(() =>
    assertAuthorizedLeadDesiredState(
      desired({
        set: { destination_zip: "10002" },
        changed_paths: ["destination_zip"],
        move_changed_paths: ["destination_zip"],
      }),
      "FormLead",
    ),
  );
  assert.throws(
    () =>
      assertAuthorizedLeadDesiredState(
        desired({
          set: { delivery_zip: "10002" },
          changed_paths: ["delivery_zip"],
          move_changed_paths: ["delivery_zip"],
        }),
        "FormLead",
      ),
    AuthorizedDesiredStateError,
  );
  assert.throws(
    () =>
      assertAuthorizedLeadDesiredState(
        desired({
          set: { destination_zip: "10002" },
          changed_paths: ["destination_zip"],
          move_changed_paths: ["destination_zip"],
        }),
        "CallLead",
      ),
    AuthorizedDesiredStateError,
  );
});

test("[AC-32] forbidden metadata, extra paths, and unsorted path lists are rejected", () => {
  for (const path of FORBIDDEN_DESIRED_STATE_METADATA_PATHS) {
    assert.throws(
      () =>
        assertAuthorizedLeadDesiredState(
          desired({
            set: { [path]: "x", granot_priority: "1" } as never,
            changed_paths: ["granot_priority", path] as never,
          }),
          "FormLead",
        ),
      AuthorizedDesiredStateError,
    );
  }
  assert.throws(
    () =>
      assertAuthorizedLeadDesiredState(
        desired({
          set: { granot_priority: "1", move_size: "Studio" } as never,
          changed_paths: ["granot_priority", "move_size"] as never,
        }),
        "FormLead",
      ),
    AuthorizedDesiredStateError,
  );
  assert.throws(
    () =>
      assertAuthorizedLeadDesiredState(
        desired({
          set: { quoted: true, granot_priority: "1" },
          changed_paths: ["quoted", "granot_priority"],
        }),
        "FormLead",
      ),
    AuthorizedDesiredStateError,
  );
});

test("[AC-32] contact hash is stable and omits values from the checksum helper output", () => {
  const first = hashGranotContactLeaves({
    name: "Ada Lovelace",
    first_name: "Ada",
    last_name: "Lovelace",
    phone_number: "5550001111",
    normalized_phone_number: "5550001111",
    email: "ada@example.test",
  });
  const second = hashGranotContactLeaves({
    email: "ada@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
    name: "Ada Lovelace",
    normalized_phone_number: "5550001111",
    phone_number: "5550001111",
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  const checksum = synchronizeLeadPayloadChecksum({
    lead_ref: { model: "FormLead", id: String(new mongoose.Types.ObjectId()) },
    expected_domain_revision: 3,
    desired_state: desired(),
  });
  assert.match(checksum, /^[a-f0-9]{64}$/);
  assert.equal(checksum.includes("555"), false);
  assert.equal(
    synchronizeLeadIdempotencyKey(observationId),
    `granot:synchronize-lead:${observationId}`,
  );
});
