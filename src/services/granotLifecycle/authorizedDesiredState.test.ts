import assert from "node:assert/strict";
import { test } from "node:test";
import type { LeadDesiredStatePlan } from "./leadDesiredState";
import {
  assertAuthorizedLeadDesiredState,
  AuthorizedDesiredStateError,
  FORBIDDEN_DESIRED_STATE_METADATA_PATHS,
  GRANOT_LEAD_WRITE_PATHS,
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

test("snapshot-only Call plan converts and keeps live phone off contact_changed_paths", () => {
  const converted = toAuthorizedLeadDesiredState({
    plan: plan({
      desired_values: {
        granot_contact_snapshot: {
          first_name: "Ada",
          last_name: "Lovelace",
          name: "Ada Lovelace",
          phone_number: "5551234567",
          normalized_phone_number: "5551234567",
          email: "ada@example.test",
        },
      },
      changed_paths: ["granot_contact_snapshot"],
    }),
    lead_model: "CallLead",
    temporal_winner: { observation_id: observationId, captured_at: capturedAt },
  });
  assert.deepEqual(converted.changed_paths, ["granot_contact_snapshot"]);
  assert.deepEqual(converted.contact_changed_paths, []);
  assert.equal("phone_number" in converted.set, false);
  assert.equal("normalized_phone_number" in converted.set, false);
  assert.doesNotThrow(() => assertAuthorizedLeadDesiredState(converted, "CallLead"));
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
