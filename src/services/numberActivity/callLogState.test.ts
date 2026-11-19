import assert from "node:assert/strict";
import { test } from "node:test";
import {
  internalSnapshotFixtures,
  internalSnapshotRecord,
  liveFinalRecord,
  liveSnapshotRecord,
  settledFixtures,
} from "./callLogStateFixtures";
import {
  at,
  callLogRecord,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_COMPANY_DID,
  syntheticDirectory,
} from "./fixtures";
import {
  classifyCallLogRecordState,
  fromCallLogRecord,
  provisionalCallLogRule,
} from "./interactionProjection";
import type { InteractionProjection } from "./types";

const directory = syntheticDirectory();
const minutes = (n: number) => n * 60_000;
/** Two minutes after the record's own `lastModifiedTime`: well inside the horizon. */
const soonAfter = (record: Record<string, unknown>) =>
  new Date(new Date(String(record.lastModifiedTime)).getTime() + minutes(2));
const classify = (record: Record<string, unknown>, now = soonAfter(record), settleHorizonMinutes?: number) =>
  classifyCallLogRecordState(record, directory, { now, settleHorizonMinutes });
const project = (existing: InteractionProjection | null, record: Record<string, unknown>, now = soonAfter(record), settleHorizonMinutes?: number) =>
  fromCallLogRecord(existing, record, directory, SYNTHETIC_ACCOUNT_ID, { now, settleHorizonMinutes });

test("each of the 24 Internal snapshots is provisional, and would still be under P-b alone", () => {
  for (const { name, record } of internalSnapshotFixtures()) {
    assert.equal(classify(record), "provisional", name);
    assert.equal(provisionalCallLogRule(record, directory), "P-a", name);
    // Spec: 24/27 snapshots also match P-b; prove the shape rule on its own.
    assert.equal(provisionalCallLogRule({ ...record, result: "Unknown" }, directory), "P-b", `${name} (P-b)`);
    // The projection agrees they are Internal, which is what froze them in production.
    assert.equal(project(null, record).next.direction, "Internal", name);
  }
});

test("every settled fixture is settled and matches no provisional rule", () => {
  for (const { name, record } of settledFixtures()) {
    assert.equal(provisionalCallLogRule(record, directory), null, name);
    assert.equal(classify(record), "settled", name);
  }
});

// ---------------------------------------------------------------------------
// Projection semantics
// ---------------------------------------------------------------------------

/** The final version of snapshot 1: same record id, Inbound, answered, recorded. */
function finalVersionOf(snapshot: Record<string, unknown>, sessionId: string) {
  const caller = String((snapshot.legs as Array<{ from: { phoneNumber: string } }>)[0]!.from.phoneNumber);
  return callLogRecord({
    id: String(snapshot.id),
    telephonySessionId: sessionId,
    direction: "Inbound",
    result: "Accepted",
    startTime: new Date(String(snapshot.startTime)),
    duration: 1424,
    from: { phoneNumber: caller },
    to: { phoneNumber: SYNTHETIC_COMPANY_DID },
    recording: { id: `rec-${sessionId}-1` },
    legs: [
      { startTime: String(snapshot.startTime), duration: 1424, direction: "Inbound", action: "Phone Call", result: "Accepted", legType: "Accept", master: true, from: { phoneNumber: caller }, to: { phoneNumber: SYNTHETIC_COMPANY_DID }, recording: { id: `rec-${sessionId}-1`, type: "Automatic" } },
      ...(snapshot.legs as Record<string, unknown>[]),
    ],
    lastModifiedTime: new Date(new Date(String(snapshot.startTime)).getTime() + 1424_000 + 20_000),
  });
}

test("provisional Internal snapshot -> settled Inbound: direction, external number and end are set once", () => {
  const snapshot = internalSnapshotRecord(0, { sessionId: "s-proj-2" });
  const first = project(null, snapshot).next;
  const final = finalVersionOf(snapshot, "s-proj-2");
  const settled = project(first, final);
  assert.equal(settled.changed, true);
  assert.equal(settled.newly_settled, true);
  assert.equal(settled.newly_terminal, true);
  assert.equal(settled.next.call_log_state, "settled");
  assert.equal(settled.next.direction, "Inbound");
  assert.equal(settled.next.external_endpoint_kind, "external");
  assert.equal(settled.next.external_e164, "+15550100300");
  assert.equal(settled.next.terminal, true);
  assert.equal(settled.next.duration_seconds, 1424);
  assert.ok(settled.next.ended_at);
  assert.deepEqual(settled.new_recording_ids, ["rec-s-proj-2-1"]);
  // A replay of the final version is a no-op.
  assert.equal(project(settled.next, final).changed, false);
});

test("settled never regresses: a stale snapshot or a newer provisional-looking record keeps the row settled", () => {
  const snapshot = internalSnapshotRecord(3, { sessionId: "s-proj-4" });
  const final = finalVersionOf(snapshot, "s-proj-4");
  const settled = project(null, final).next;
  assert.equal(settled.call_log_state, "settled");
  const stale = project(settled, snapshot, soonAfter(final));
  assert.equal(stale.stale_call_log, true);
  assert.equal(stale.next.call_log_state, "settled");
  assert.equal(stale.next.terminal, true);
  assert.equal(stale.next.direction, "Inbound");
  assert.equal(stale.next.duration_seconds, 1424);
  const newerSnapshot = { ...snapshot, lastModifiedTime: new Date(new Date(String(final.lastModifiedTime)).getTime() + 60_000).toISOString() };
  const newer = project(settled, newerSnapshot, soonAfter(newerSnapshot));
  assert.equal(newer.next.call_log_state, "settled");
  assert.equal(newer.next.terminal, true);
});

test("live shape: Outbound snapshot -> Inbound final is the allowed settle transition, start time corrected", () => {
  const snapshot = liveSnapshotRecord(1, "s-live-proj");
  const first = project(null, snapshot);
  assert.equal(first.next.call_log_state, "provisional");
  assert.equal(first.next.direction, "Outbound", "the snapshot's own direction, as observed");
  assert.equal(first.next.terminal, false);
  assert.equal(first.next.duration_seconds, null);
  const final = liveFinalRecord(1, "s-live-proj");
  const settled = project(first.next, final);
  assert.equal(settled.newly_settled, true);
  assert.equal(settled.next.call_log_state, "settled");
  assert.equal(settled.next.direction, "Inbound");
  assert.equal(settled.next.external_endpoint_kind, "external");
  assert.equal(settled.next.external_e164, "+15550100351");
  assert.equal(settled.next.started_at.toISOString(), at(0).toISOString(), "the final start time wins");
  assert.equal(settled.next.duration_seconds, 139);
  assert.equal(settled.next.terminal, true);
  // The final version adds the Accept and connected leg ids; the record id is stable.
  assert.ok(settled.next.call_log_ids.includes(String(snapshot.id)));
});
