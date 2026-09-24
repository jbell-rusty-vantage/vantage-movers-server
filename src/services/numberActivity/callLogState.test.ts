import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_DIRECTORY_LOOKUP } from "./directory";
import {
  acceptedSnapshotFixtures,
  internalSnapshotFixtures,
  internalSnapshotRecord,
  liveFinalRecord,
  liveSnapshotFixtures,
  liveSnapshotRecord,
  settledFixtures,
} from "./callLogStateFixtures";
import {
  at,
  callLogRecord,
  inboundConnectedCallLog,
  inboundQueueAnsweredDeliveries,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_COMPANY_DID,
  syntheticDirectory,
} from "./fixtures";
import {
  classifyCallLogRecordState,
  DEFAULT_SETTLE_HORIZON_MINUTES,
  fromCallLogRecord,
  fromWebhookParties,
  mergeProjections,
  provisionalCallLogRule,
  sameProjection,
  settleStoredProjection,
} from "./interactionProjection";
import { normalizeWebhookPartyObservations } from "./observeWebhookEvents";
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

// ---------------------------------------------------------------------------
// Fixture corpus
// ---------------------------------------------------------------------------

test("fixture corpus: 24 Internal snapshots, 3 Accepted snapshots, at least 30 settled records", () => {
  assert.equal(internalSnapshotFixtures().length, 24);
  assert.equal(acceptedSnapshotFixtures().length, 3);
  assert.ok(settledFixtures().length >= 30, `settled fixtures: ${settledFixtures().length}`);
  // Every observed settled result family is represented.
  const results = new Set(settledFixtures().map((f) => f.record.result));
  for (const family of ["Call connected", "Accepted", "Missed", "Voicemail", "Hang Up", "Call Failed", "Wrong Number", "Busy", "Rejected", "No Answer"]) {
    assert.ok(results.has(family), `settled family ${family}`);
  }
});

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

test("the live-watch snapshots (Outbound, PSTN from, extension to, ring-outs only) are provisional under P-a and P-b", () => {
  for (const { name, record } of liveSnapshotFixtures()) {
    assert.equal(classify(record), "provisional", name);
    assert.equal(provisionalCallLogRule({ ...record, result: "Unknown" }, directory), "P-b", `${name} (P-b)`);
  }
});

test("the 3 Accepted snapshots are deliberately settled (indistinguishable from a short answered call)", () => {
  for (const { name, record } of acceptedSnapshotFixtures()) {
    assert.equal(classify(record), "settled", name);
    assert.equal(provisionalCallLogRule(record, directory), null, name);
  }
});

test("every settled fixture is settled and matches no provisional rule", () => {
  for (const { name, record } of settledFixtures()) {
    assert.equal(provisionalCallLogRule(record, directory), null, name);
    assert.equal(classify(record), "settled", name);
  }
});

test("genuine extension-to-extension calls stay settled even with a non-final-looking result", () => {
  const internal = settledFixtures().filter((f) => f.name.startsWith("internal extension-to-extension"));
  assert.ok(internal.length >= 3);
  for (const { name, record } of internal) {
    // Only P-a (the result) could gate them: the ring-out shape without PSTN evidence is not P-b.
    assert.equal(provisionalCallLogRule({ ...record, result: "Unknown" }, directory), null, name);
  }
});

// ---------------------------------------------------------------------------
// Rules and horizon
// ---------------------------------------------------------------------------

test("P-a: every provisional top-level result, including In Progress", () => {
  for (const result of ["Stopped", "IP Phone Offline", "In Progress"]) {
    const record = inboundConnectedCallLog("s-pa", { result });
    assert.equal(provisionalCallLogRule(record, directory), "P-a", result);
    assert.equal(classify(record), "provisional", result);
  }
  // A leg-level Stopped is ordinary ring-out evidence, never P-a.
  assert.equal(classify(settledFixtures().find((f) => f.name.includes("Missed 24 s"))!.record), "settled");
});

test("P-b needs a provider direction, a company-side to, ring-out legs only and PSTN evidence", () => {
  const snapshot = { ...internalSnapshotRecord(0), result: "Unknown" };
  assert.equal(provisionalCallLogRule(snapshot, directory), "P-b");
  assert.equal(provisionalCallLogRule({ ...snapshot, direction: "Internal" }, directory), null, "no provider Inbound/Outbound");
  assert.equal(provisionalCallLogRule({ ...snapshot, legs: [] }, directory), null, "no legs");
  const legs = snapshot.legs as Record<string, unknown>[];
  assert.equal(
    provisionalCallLogRule({ ...snapshot, legs: [...legs, { ...legs[0], legType: "Accept" }] }, directory),
    null,
    "an Accept leg is not a ring-out",
  );
  assert.equal(
    provisionalCallLogRule({ ...snapshot, to: { phoneNumber: "+15550100399" } }, directory),
    null,
    "an external top-level to",
  );
  // The caller id on `from` (no extension id), as seen live, still matches.
  assert.equal(provisionalCallLogRule({ ...snapshot, from: { phoneNumber: "+15550100399" } }, directory), "P-b");
  assert.equal(
    provisionalCallLogRule({ ...snapshot, legs: legs.map((leg) => ({ ...leg, direction: "Inbound" })) }, directory),
    null,
    "an Inbound PstnToSip leg is the caller's leg, not a ring-out",
  );
  // A SipToSip ring-out carrying a caller id that is not a company DID is PSTN evidence.
  const sipOnly = legs.map((leg) => ({ ...leg, legType: "SipToSip" }));
  assert.equal(provisionalCallLogRule({ ...snapshot, legs: sipOnly }, directory), "P-b");
  // Without a directory the company DID is unknown, so P-b cannot fire; P-a still gates.
  assert.equal(provisionalCallLogRule(snapshot, EMPTY_DIRECTORY_LOOKUP), null);
  assert.equal(provisionalCallLogRule(internalSnapshotRecord(0), EMPTY_DIRECTORY_LOOKUP), "P-a");
});

test("horizon override: a record quiet for the settle horizon is settled, whatever its shape", () => {
  const record = internalSnapshotRecord(1);
  const modified = new Date(String(record.lastModifiedTime));
  const after = (m: number) => new Date(modified.getTime() + minutes(m));
  assert.equal(DEFAULT_SETTLE_HORIZON_MINUTES, 240);
  assert.equal(classify(record, after(239)), "provisional");
  assert.equal(classify(record, after(240)), "settled");
  assert.equal(classify(record, after(59), 60), "provisional");
  assert.equal(classify(record, after(60), 60), "settled");
  // Without lastModifiedTime the start time is the quiet-since bound.
  const { lastModifiedTime: _drop, ...noModified } = record;
  void _drop;
  const started = new Date(String(record.startTime));
  assert.equal(classifyCallLogRecordState(noModified, directory, { now: new Date(started.getTime() + minutes(10)) }), "provisional");
  assert.equal(classifyCallLogRecordState(noModified, directory, { now: new Date(started.getTime() + minutes(240)) }), "settled");
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

test("a provisional snapshot projects no end: terminal false, no ended_at or duration, no external number", () => {
  const snapshot = internalSnapshotRecord(0, { sessionId: "s-proj-1" });
  const outcome = project(null, snapshot);
  assert.equal(outcome.next.call_log_state, "provisional");
  assert.equal(outcome.next.terminal, false);
  assert.equal(outcome.newly_terminal, false);
  assert.equal(outcome.newly_settled, false);
  assert.equal(outcome.next.ended_at, null);
  assert.equal(outcome.next.duration_seconds, null);
  assert.equal(outcome.next.direction, "Internal");
  assert.equal(outcome.next.external_e164, null);
  assert.equal(outcome.next.provider_result, "Stopped", "raw observation kept");
  assert.ok(outcome.next.legs.length > 0, "legs stored as observed");
  // The same snapshot again inside the horizon is a semantic no-op.
  assert.equal(project(outcome.next, snapshot).changed, false);
});

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

test("a settled Internal row never becomes external; only a provisional row may", () => {
  const snapshot = internalSnapshotRecord(2, { sessionId: "s-proj-3" });
  // Settled by the horizon with its last observed (Internal) values.
  const modified = new Date(String(snapshot.lastModifiedTime));
  const settledInternal = project(null, snapshot, new Date(modified.getTime() + minutes(300))).next;
  assert.equal(settledInternal.call_log_state, "settled");
  assert.equal(settledInternal.direction, "Internal");
  const later = project(settledInternal, finalVersionOf(snapshot, "s-proj-3"), new Date(modified.getTime() + minutes(301)));
  assert.equal(later.next.direction, "Internal");
  assert.equal(later.next.external_e164, null);
  assert.equal(later.next.call_log_state, "settled");
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

test("a provisional row past the horizon settles on re-apply of the same record, with its last observed values", () => {
  const snapshot = internalSnapshotRecord(4, { sessionId: "s-proj-5" });
  const provisional = project(null, snapshot).next;
  const modified = new Date(String(snapshot.lastModifiedTime));
  const reapplied = project(provisional, snapshot, new Date(modified.getTime() + minutes(DEFAULT_SETTLE_HORIZON_MINUTES)));
  assert.equal(reapplied.changed, true);
  assert.equal(reapplied.newly_settled, true);
  assert.equal(reapplied.next.call_log_state, "settled");
  assert.equal(reapplied.next.terminal, true);
  assert.equal(reapplied.next.direction, "Internal");
  assert.equal(reapplied.next.duration_seconds, 2, "the snapshot's own duration, now accepted as final");
  // A stale older record on a provisional row past the horizon settles it as well.
  const older = { ...snapshot, lastModifiedTime: new Date(modified.getTime() - 30_000).toISOString() };
  const viaStale = project(provisional, older, new Date(modified.getTime() + minutes(DEFAULT_SETTLE_HORIZON_MINUTES)));
  assert.equal(viaStale.stale_call_log, true);
  assert.equal(viaStale.next.call_log_state, "settled");
  // ...but not inside the horizon.
  assert.equal(project(provisional, older, soonAfter(snapshot)).next.call_log_state, "provisional");
});

test("a provisional record keeps terminal facts another source already proved", () => {
  const snapshot = internalSnapshotRecord(5, { sessionId: "s-proj-6" });
  const first = project(null, snapshot).next;
  const terminalFromElsewhere: InteractionProjection = { ...first, terminal: true, ended_at: at(900), duration_seconds: 890 };
  const again = project(terminalFromElsewhere, { ...snapshot, lastModifiedTime: at(50).toISOString() }, at(60));
  assert.equal(again.next.terminal, true);
  assert.equal(again.next.ended_at?.toISOString(), at(900).toISOString());
  assert.equal(again.next.duration_seconds, 890);
});

test("webhook projection never sets call_log_state: provisional stays provisional, null stays null", () => {
  const d = inboundQueueAnsweredDeliveries("s-proj-7");
  const events = normalizeWebhookPartyObservations(d.disconnected, at(96));
  const onNull = fromWebhookParties(null, events, directory, SYNTHETIC_ACCOUNT_ID, { now: at(96) });
  assert.equal(onNull.next.call_log_state, null);
  const provisional: InteractionProjection = { ...onNull.next, call_log_state: "provisional" };
  const after = fromWebhookParties(provisional, normalizeWebhookPartyObservations(d.answered, at(97)), directory, SYNTHETIC_ACCOUNT_ID, { now: at(97) });
  assert.equal(after.next.call_log_state, "provisional");
});

test("sameProjection and mergeProjections account for call_log_state", () => {
  const base = project(null, inboundConnectedCallLog("s-proj-8")).next;
  assert.equal(base.call_log_state, "settled");
  assert.equal(sameProjection(base, { ...base, call_log_state: "provisional" }), false);
  assert.equal(sameProjection(base, { ...base, call_log_state: null }), false);
  const other = { ...base, telephony_session_id: "s-proj-8b", call_log_ids: ["cl-other"] };
  assert.equal(mergeProjections({ ...base, call_log_state: "provisional" }, other).call_log_state, "settled");
  assert.equal(mergeProjections({ ...base, call_log_state: "provisional" }, { ...other, call_log_state: null }).call_log_state, "provisional");
  assert.equal(mergeProjections({ ...base, call_log_state: null }, { ...other, call_log_state: null }).call_log_state, null);
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

test("a terminal row never moves to provisional: a snapshot read during the rewrite lag only adds evidence", () => {
  // Webhook capture ended the session: terminal, external, Call Log state null.
  const d = inboundQueueAnsweredDeliveries("s-lag-1");
  let row = fromWebhookParties(null, normalizeWebhookPartyObservations(d.ringing, at(1)), directory, SYNTHETIC_ACCOUNT_ID, { now: at(1) }).next;
  for (const delivery of [d.answered, d.disconnected]) {
    row = fromWebhookParties(row, normalizeWebhookPartyObservations(delivery, at(96)), directory, SYNTHETIC_ACCOUNT_ID, { now: at(96) }).next;
  }
  assert.equal(row.terminal, true);
  assert.equal(row.call_log_state, null);
  assert.equal(row.direction, "Inbound");
  const external = row.external_e164;
  assert.ok(external);
  const snapshot = internalSnapshotRecord(0, { sessionId: "s-lag-1" });
  assert.equal(classify(snapshot), "provisional", "the record itself is a mid-call snapshot");
  const after = project(row, snapshot);
  assert.equal(after.next.call_log_state, null, "never provisional");
  assert.equal(after.next.terminal, true);
  assert.equal(after.next.direction, "Inbound", "direction is not rewritten to Internal");
  assert.equal(after.next.external_e164, external, "the Contact Number keeps its interaction");
  assert.equal(after.next.provider_last_modified_at, null, "a snapshot is not an authoritative Call Log version");
  assert.ok(after.next.call_log_ids.includes(String(snapshot.id)), "ids and legs are still added");
  assert.ok(after.next.legs.length > 0);
  assert.equal(after.newly_settled, false);

  // The final version later settles the row normally.
  const final = finalVersionOf(snapshot, "s-lag-1");
  const settled = project(after.next, final);
  assert.equal(settled.next.call_log_state, "settled");
  assert.equal(settled.next.duration_seconds, 1424);

  // A settled Inbound row given a newer snapshot keeps its direction and values too.
  const newer = { ...snapshot, lastModifiedTime: new Date(new Date(String(final.lastModifiedTime)).getTime() + 60_000).toISOString() };
  const kept = project(settled.next, newer, soonAfter(newer));
  assert.equal(kept.next.direction, "Inbound");
  assert.equal(kept.next.duration_seconds, 1424);
  assert.equal(kept.next.call_log_state, "settled");
});

test("settleStoredProjection: a provisional row quiet past the horizon settles with its stored values; anything else is unchanged", () => {
  const snapshot = internalSnapshotRecord(6, { sessionId: "s-store-1" });
  const provisional = project(null, snapshot).next;
  assert.equal(provisional.call_log_state, "provisional");
  const modified = new Date(String(snapshot.lastModifiedTime));
  const early = settleStoredProjection(provisional, { now: soonAfter(snapshot) });
  assert.equal(early.changed, false, "inside the horizon nothing happens");
  const late = settleStoredProjection(provisional, { now: new Date(modified.getTime() + minutes(DEFAULT_SETTLE_HORIZON_MINUTES)) });
  assert.equal(late.changed, true);
  assert.equal(late.newly_settled, true);
  assert.equal(late.newly_terminal, true);
  assert.equal(late.next.call_log_state, "settled");
  assert.equal(late.next.direction, provisional.direction);
  assert.equal(late.next.provider_last_modified_at?.toISOString(), modified.toISOString());
  // The same result as the stale-record settle.
  const older = { ...snapshot, lastModifiedTime: new Date(modified.getTime() - 30_000).toISOString() };
  const viaStale = project(provisional, older, new Date(modified.getTime() + minutes(DEFAULT_SETTLE_HORIZON_MINUTES)));
  assert.equal(sameProjection(viaStale.next, { ...late.next, sources: viaStale.next.sources, call_log_ids: viaStale.next.call_log_ids, legs: viaStale.next.legs, recordings: viaStale.next.recordings }), true);
  const settled = settleStoredProjection(late.next, { now: new Date(modified.getTime() + minutes(2 * DEFAULT_SETTLE_HORIZON_MINUTES)) });
  assert.equal(settled.changed, false, "a settled row is a no-op");
});

test("a pre-CC-04 row (call_log_state null) re-read from its unchanged settled record is not a change", () => {
  const record = liveFinalRecord(2, "s-legacy");
  const now = soonAfter(record);
  const stored = project(null, record, now).next;
  assert.equal(stored.call_log_state, "settled");
  const legacy: InteractionProjection = { ...stored, call_log_state: null };
  const again = project(legacy, record, now);
  assert.equal(again.changed, false, "the label alone must not write a revision");
  assert.equal(again.newly_settled, false);
  // A real change on the same legacy row still writes, and settles it.
  const later = project(legacy, { ...record, duration: Number(record.duration) + 60, lastModifiedTime: new Date(now.getTime() + minutes(1)).toISOString() }, now);
  assert.equal(later.changed, true);
  assert.equal(later.next.call_log_state, "settled");
});
