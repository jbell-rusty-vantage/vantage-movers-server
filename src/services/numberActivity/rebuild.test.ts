import assert from "node:assert/strict";
import { test } from "node:test";
import { at, inboundQueueAnsweredDeliveries, outboundUnansweredDeliveries, syntheticDirectory, SYNTHETIC_ACCOUNT_ID } from "./fixtures";
import { fromWebhookParties } from "./interactionProjection";
import { normalizeWebhookPartyObservations } from "./observeWebhookEvents";
import { recountNumber, sameRebuiltFields, rebuildDedupeKey, type RebuiltFields } from "./rebuild";
import type { InteractionProjection } from "./types";

const directory = syntheticDirectory();
const noRoute = () => null;

function project(deliveries: unknown[], observedAt: Date): InteractionProjection {
  let existing: InteractionProjection | null = null;
  for (const delivery of deliveries) {
    const events = normalizeWebhookPartyObservations(delivery, observedAt);
    existing = fromWebhookParties(existing, events, directory, SYNTHETIC_ACCOUNT_ID, { now: observedAt, resolveRoute: noRoute }).next;
  }
  return existing!;
}

test("recount replays stored canonical interactions through the CSI-02 counting rules and derives search terms from evidence only", () => {
  const inbound = inboundQueueAnsweredDeliveries("s-rb-1");
  const inboundProjection = project([inbound.ringing, inbound.repRinging, inbound.answered, inbound.disconnected], at(100));
  const outbound = outboundUnansweredDeliveries("s-rb-2");
  const outboundProjection = { ...project([outbound.setup, outbound.proceeding, outbound.disconnected], at(200)), started_at: at(500) };
  const human: InteractionProjection = { ...inboundProjection, started_at: at(900), contact_type: "human_conversation", contact_type_basis: "owner" };

  const rebuilt = recountNumber({
    number: { first_observed_at: at(5000), last_activity_at: at(5000), rollups: { last_meaningful_contact_at: at(42) } },
    interactions: [outboundProjection, inboundProjection, human],
    attachments: [
      { state: "attached", lead_snapshot: { name: "Jane Customer", job_no: "J-1001", receiver_agent_name: "Alex Agent" } },
      { state: "candidate", lead_snapshot: { name: "Jane Customer", job_no: null, receiver_agent_name: null } },
      { state: "ambiguous", lead_snapshot: null },
      { state: "rejected", lead_snapshot: { name: "Wrong Person", job_no: "J-9", receiver_agent_name: null } },
    ],
    open_outreach_count: 2,
  });

  assert.equal(rebuilt.rollups.interactions_total, 3, "each canonical interaction counted once");
  assert.equal(rebuilt.rollups.inbound_total, 2);
  assert.equal(rebuilt.rollups.outbound_total, 1);
  assert.equal(rebuilt.rollups.human_conversations_total, 1);
  assert.equal(rebuilt.rollups.last_inbound_at?.toISOString(), at(900).toISOString());
  assert.equal(rebuilt.rollups.last_outbound_at?.toISOString(), at(500).toISOString());
  assert.equal(rebuilt.rollups.last_human_conversation_at?.toISOString(), at(900).toISOString());
  assert.equal(rebuilt.rollups.last_meaningful_contact_at?.toISOString(), at(42).toISOString(), "Team C fact preserved, never derived");
  assert.equal(rebuilt.rollups.attached_lead_count, 1);
  assert.equal(rebuilt.rollups.candidate_lead_count, 2, "candidate + ambiguous");
  assert.equal(rebuilt.rollups.open_outreach_count, 2);
  assert.deepEqual(rebuilt.provider_names, ["Synthetic Customer"]);
  assert.deepEqual([...rebuilt.search_terms].sort(), ["alex agent", "j-1001", "jane customer", "synthetic customer"], "rejected attachment terms are not searchable");
  assert.equal(rebuilt.first_observed_at.toISOString(), inboundProjection.started_at.toISOString(), "activity bounds come from evidence, not the stale row");
  assert.equal(rebuilt.last_activity_at.toISOString(), at(900).toISOString());

  const empty = recountNumber({
    number: { first_observed_at: at(1), last_activity_at: at(2), rollups: { last_meaningful_contact_at: null } },
    interactions: [],
    attachments: [],
    open_outreach_count: 0,
  });
  assert.equal(empty.rollups.interactions_total, 0);
  assert.equal(empty.first_observed_at.toISOString(), at(1).toISOString(), "no evidence keeps the stored bounds");
  assert.deepEqual(empty.search_terms, []);
});

test("recount is idempotent: recounting the rebuilt fields yields the same fields; a fresh recount equals incremental rollups", () => {
  const inbound = inboundQueueAnsweredDeliveries("s-rb-3");
  const projection = project([inbound.ringing, inbound.answered, inbound.disconnected], at(10));
  const first = recountNumber({
    number: { first_observed_at: at(0), last_activity_at: at(0), rollups: { last_meaningful_contact_at: null } },
    interactions: [projection],
    attachments: [],
    open_outreach_count: 0,
  });
  const second = recountNumber({
    number: { first_observed_at: first.first_observed_at, last_activity_at: first.last_activity_at, rollups: first.rollups },
    interactions: [projection],
    attachments: [],
    open_outreach_count: 0,
  });
  assert.equal(sameRebuiltFields(first, second), true);
  // Incremental CSI-02 rollup for one inbound interaction (persistInteraction.rollupsFor semantics).
  const incremental: RebuiltFields = {
    rollups: {
      interactions_total: 1,
      inbound_total: 1,
      outbound_total: 0,
      human_conversations_total: 0,
      last_inbound_at: projection.started_at,
      last_outbound_at: null,
      last_human_conversation_at: null,
      last_meaningful_contact_at: null,
      attached_lead_count: 0,
      candidate_lead_count: 0,
      open_outreach_count: 0,
    },
    provider_names: ["Synthetic Customer"],
    search_terms: ["synthetic customer"],
    first_observed_at: projection.started_at,
    last_activity_at: projection.started_at,
  };
  assert.equal(sameRebuiltFields(incremental, first), true, "rebuild matches what capture wrote incrementally");
  assert.equal(sameRebuiltFields(incremental, { ...first, rollups: { ...first.rollups, inbound_total: 2 } }), false);
  assert.equal(rebuildDedupeKey("a".repeat(24), "b".repeat(24)), `csi:rebuild:number:${"a".repeat(24)}:cmd:${"b".repeat(24)}`);
});
