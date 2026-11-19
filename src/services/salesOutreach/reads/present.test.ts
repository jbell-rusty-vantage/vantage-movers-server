import assert from "node:assert/strict";
import { test } from "node:test";
import { QUEUE_KEY_FAR_FUTURE } from "../evaluation/projection";
import { matchesOverdue, mongoOverdueFilter } from "./deskStore";
import { deriveChannelAt, PENDING_CHANNEL, type StoredChannel } from "./present";

/**
 * olr A2 — the one read-time verification rule (`deriveChannelAt`), the live channel coverage block and
 * the stored-key twin the overdue counts use (`overdueCutoffs` / `matchesOverdue` / `mongoOverdueFilter`).
 */

const at = (iso: string) => new Date(iso);
// 12:05 New York (EDT): a Day 2 noon call (16:00Z) has just passed.
const AS_OF = at("2026-10-06T16:05:00.000Z");
const NOON = at("2026-10-06T16:00:00.000Z");

const channel = (status: StoredChannel["status"], due: Date | null, oldest: Date | null = null): StoredChannel => ({
  ...PENDING_CHANNEL,
  required: 1,
  verified_completed: 0,
  remaining: 1,
  status,
  completion_kind: null,
  due_at: due,
  oldest_actionable_due_at: oldest,
});

test("a passed deadline coverage cannot prove yet (C < D) reads due/unverified since the deadline", () => {
  const coverage = at("2026-10-06T15:48:00.000Z");
  const c = deriveChannelAt(channel("due", NOON), AS_OF, coverage);
  assert.equal(c.status, "due");
  assert.equal(c.oldest_actionable_due_at, null);
  assert.deepEqual(c.verification, { state: "unverified", verified_through: coverage, unverified_since: NOON });
});

test("no coverage at all (C null) reads unverified with no 'known through'", () => {
  const c = deriveChannelAt(channel("due", NOON), AS_OF, null);
  assert.deepEqual([c.status, c.verification], ["due", { state: "unverified", verified_through: null, unverified_since: NOON }]);
});

test("the stored-key twin of the rule: each channel against its own cutoff; a pre-A2 row (no sms_due) falls back to urgency_due vs the earlier cutoff", () => {
  const cut = { call: at("2026-10-07T00:03:00.000Z"), sms: at("2026-10-07T00:01:00.000Z") };
  const row = (call: Date, sms: Date | null, urgency: Date, status = "active") => ({ subject_status: status, queue_keys: { call_due: call, sms_due: sms, urgency_due: urgency } });
  const far = QUEUE_KEY_FAR_FUTURE;
  const eight = at("2026-10-07T00:00:00.000Z"); // 20:00 ET
  assert.equal(matchesOverdue(row(eight, far, eight), cut), true, "call deadline proven");
  assert.equal(matchesOverdue(row(at("2026-10-07T00:04:00.000Z"), far, at("2026-10-07T00:04:00.000Z")), cut), false, "call deadline beyond call coverage");
  assert.equal(matchesOverdue(row(far, eight, eight), cut), true, "SMS deadline proven by SMS coverage");
  assert.equal(matchesOverdue(row(far, at("2026-10-07T00:02:00.000Z"), at("2026-10-07T00:02:00.000Z")), cut), false, "SMS deadline beyond SMS coverage (although within call coverage)");
  assert.equal(matchesOverdue(row(far, eight, eight), { ...cut, sms: null }), false, "SMS without coverage proves nothing");
  assert.equal(matchesOverdue(row(far, null, eight), cut), true, "pre-A2 row: urgency_due ≤ min(call, sms)");
  assert.equal(matchesOverdue(row(far, null, at("2026-10-07T00:02:00.000Z")), cut), false, "pre-A2 row beyond the earlier cutoff");
  assert.equal(matchesOverdue(row(far, null, eight), { ...cut, sms: null }), false, "pre-A2 row needs both coverages");
  assert.equal(matchesOverdue(row(eight, far, eight, "review"), cut), false, "only active subjects");
  // The Mongo translation names the same branches.
  assert.deepEqual(mongoOverdueFilter(cut), {
    subject_status: "active",
    $or: [
      { "queue_keys.call_due": { $lte: cut.call } },
      { "queue_keys.sms_due": { $lte: cut.sms } },
      { "queue_keys.sms_due": { $exists: false }, "queue_keys.urgency_due": { $lte: cut.sms } },
    ],
  });
  assert.deepEqual(mongoOverdueFilter({ call: cut.call, sms: null }), { subject_status: "active", $or: [{ "queue_keys.call_due": { $lte: cut.call } }] });
});
