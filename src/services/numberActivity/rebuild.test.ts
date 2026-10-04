import assert from "node:assert/strict";
import { test } from "node:test";
import { at, inboundQueueAnsweredDeliveries, outboundUnansweredDeliveries, syntheticDirectory, SYNTHETIC_ACCOUNT_ID } from "./fixtures";
import { fromWebhookParties } from "./interactionProjection";
import { normalizeWebhookPartyObservations } from "./observeWebhookEvents";
import { earlierOf } from "./persistInteraction";
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
    number: { first_observed_at: at(5000), last_activity_at: at(5000) },
    interactions: [outboundProjection, inboundProjection, human],
    attachments: [
      { state: "attached", lead_snapshot: { name: "Jane Customer", job_no: "J-1001", receiver_agent_name: "Alex Agent" } },
      { state: "candidate", lead_snapshot: { name: "Jane Customer", job_no: null, receiver_agent_name: null } },
      { state: "ambiguous", lead_snapshot: null },
      { state: "rejected", lead_snapshot: { name: "Wrong Person", job_no: "J-9", receiver_agent_name: null } },
    ],
  });

  assert.equal(rebuilt.rollups.interactions_total, 3, "each canonical interaction counted once");
  assert.equal(rebuilt.rollups.inbound_total, 2);
  assert.equal(rebuilt.rollups.outbound_total, 1);
  assert.equal(rebuilt.rollups.human_conversations_total, 1);
  assert.equal(rebuilt.rollups.last_inbound_at?.toISOString(), at(900).toISOString());
  assert.equal(rebuilt.rollups.last_outbound_at?.toISOString(), at(500).toISOString());
  assert.equal(rebuilt.rollups.last_human_conversation_at?.toISOString(), at(900).toISOString());
  assert.equal(rebuilt.rollups.attached_lead_count, 1);
  assert.equal(rebuilt.rollups.candidate_lead_count, 2, "candidate + ambiguous");
  assert.deepEqual(rebuilt.provider_names, ["Synthetic Customer"]);
  assert.deepEqual([...rebuilt.search_terms].sort(), ["alex agent", "j-1001", "jane customer", "synthetic customer"], "rejected attachment terms are not searchable");
  assert.equal(rebuilt.first_observed_at.toISOString(), inboundProjection.started_at.toISOString(), "activity bounds come from evidence, not the stale row");
  assert.equal(rebuilt.last_activity_at.toISOString(), at(900).toISOString());

  const empty = recountNumber({
    number: { first_observed_at: at(1), last_activity_at: at(2) },
    interactions: [],
    attachments: [],
  });
  assert.equal(empty.rollups.interactions_total, 0);
  assert.equal(empty.first_observed_at.toISOString(), at(1).toISOString(), "no evidence keeps the stored bounds");
  assert.deepEqual(empty.search_terms, []);
});

test("recount is idempotent: recounting the rebuilt fields yields the same fields; a fresh recount equals incremental rollups", () => {
  const inbound = inboundQueueAnsweredDeliveries("s-rb-3");
  const projection = project([inbound.ringing, inbound.answered, inbound.disconnected], at(10));
  const first = recountNumber({
    number: { first_observed_at: at(0), last_activity_at: at(0) },
    interactions: [projection],
    attachments: [],
  });
  const second = recountNumber({
    number: { first_observed_at: first.first_observed_at, last_activity_at: first.last_activity_at },
    interactions: [projection],
    attachments: [],
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
      attached_lead_count: 0,
      candidate_lead_count: 0,
      recordings_total: projection.recordings.length,
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

test("LP-06 earlierOf lowers only; capture keeps first_observed_at at the earliest call however calls arrive", () => {
  assert.equal(earlierOf(at(10), at(5))?.toISOString(), at(5).toISOString());
  assert.equal(earlierOf(at(5), at(10))?.toISOString(), at(5).toISOString());
  assert.equal(earlierOf(null, at(10))?.toISOString(), at(10).toISOString());
  assert.equal(earlierOf(at(10), null)?.toISOString(), at(10).toISOString());
  assert.equal(earlierOf(undefined, undefined), null);
  // Out-of-order ingestion: the later call is processed first.
  const arrivals = [at(9_000), at(1_000), at(5_000)];
  let first: Date | null = null;
  for (const started of arrivals) first = earlierOf(first, started);
  assert.equal(first?.toISOString(), at(1_000).toISOString());
});

test("LP-06 recount repairs a late first_observed_at from calls ingested out of order and ignores merged rows", () => {
  const inbound = inboundQueueAnsweredDeliveries("s-rb-lp06");
  const base = project([inbound.ringing, inbound.answered, inbound.disconnected], at(10));
  const later = { ...base, started_at: at(9_000) };
  const earliest = { ...base, started_at: at(1_000) };
  const middle = { ...base, started_at: at(5_000) };
  // Stored row as the old create path left it: first_observed_at is the first *processed* call.
  const stored = { first_observed_at: later.started_at, last_activity_at: later.started_at };
  const repaired = recountNumber({ number: stored, interactions: [later, earliest, middle], attachments: [] });
  assert.equal(repaired.first_observed_at.toISOString(), at(1_000).toISOString(), "lowered to the earliest canonical interaction");
  assert.equal(repaired.last_activity_at.toISOString(), at(9_000).toISOString(), "last activity stays the latest call");
  // `loadRebuildEvidence` passes canonical rows only (`merged_into_id: null`); with the earliest row merged away the value is raised.
  const raised = recountNumber({
    number: { ...stored, first_observed_at: at(1_000) },
    interactions: [later, middle],
    attachments: [],
  });
  assert.equal(raised.first_observed_at.toISOString(), at(5_000).toISOString(), "raised when the earliest evidence is no longer canonical");
  assert.equal(
    sameRebuiltFields({ ...raised, first_observed_at: at(1_000) }, raised),
    false,
    "a first_observed_at difference alone is a change the rebuild writes",
  );
});

test("recount: provider recordings come from canonical interactions; a stored retired rollup field is a change the rebuild drops", () => {
  const inbound = inboundQueueAnsweredDeliveries("s-rb-s1");
  const base = project([inbound.ringing, inbound.answered, inbound.disconnected], at(10));
  const withRecordings = (n: number): InteractionProjection => ({ ...base, recordings: Array.from({ length: n }, (_, i) => ({
    provider_recording_id: `r-${n}-${i}`, recording_type: null, observed_at: at(0) })) });
  const rebuilt = recountNumber({
    number: { first_observed_at: at(0), last_activity_at: at(0) },
    interactions: [withRecordings(0), withRecordings(1), withRecordings(2)],
    attachments: [],
  });
  assert.equal(rebuilt.rollups.recordings_total, 3, "0 + 1 + 2");
  assert.deepEqual(Object.keys(rebuilt.rollups).sort(), ["attached_lead_count", "candidate_lead_count", "human_conversations_total", "inbound_total",
    "interactions_total", "last_human_conversation_at", "last_inbound_at", "last_outbound_at", "outbound_total", "recordings_total"]);
  assert.equal(sameRebuiltFields(rebuilt, { ...rebuilt, rollups: { ...rebuilt.rollups } }), true);
  assert.equal(sameRebuiltFields({ ...rebuilt, rollups: { ...rebuilt.rollups, recordings_total: 4 } }, rebuilt), false);
  // A Number stored before the slimming still carries Outreach/analysis rollups: the rebuild rewrites `rollups` without them.
  for (const field of ["open_outreach_count", "conversations_analyzed_total", "last_analyzed_at", "outreach_records_total", "last_meaningful_contact_at"]) {
    assert.equal(sameRebuiltFields({ ...rebuilt, rollups: { ...rebuilt.rollups, [field]: 0 } as never }, rebuilt), false, field);
  }
  // A Number stored before `recordings_total` existed lacks it: the rebuild writes it once, even when it is zero.
  const empty = recountNumber({ number: { first_observed_at: at(0), last_activity_at: at(0) }, interactions: [], attachments: [] });
  const { recordings_total: _r, ...legacyRollups } = empty.rollups;
  assert.equal(sameRebuiltFields({ ...empty, rollups: legacyRollups as never }, empty), false);
});
