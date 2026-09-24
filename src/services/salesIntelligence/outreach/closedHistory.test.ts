import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { CsiError } from "../auth";
import {
  closedHistoryDigest, closedHistoryFilter, closedHistoryQuerySchema, closedRowMatches, decodeClosedHistoryCursor, effectiveAgents,
  encodeClosedHistoryCursor, keysetMongoPredicate, outcomeMongoPredicate, priorityMongoPredicate,
} from "./closedHistory";

const A = "a".repeat(24), B = "b".repeat(24);
const keys = (over: Record<string, unknown> = {}) => ({ band: null, needs_review: false, state: "closed" as const, agents: [A], attachment: "lead" as const, priority: "7",
  has_recording: false, has_assessment: false, newer_call: false, ti: null, ml: null, received_at: null, move_date: null, outcome: "crm_dead" as const,
  closed_at: "2026-03-08T15:00:00.000Z", ...over });
const outcome = (over: Record<string, unknown> = {}) => ({ reason: "crm_dead" as const, origin: "crm_disposition" as const, closed_at: "2026-03-08T15:00:00.000Z",
  time_to_close_ms: 1, calls_total: 0, booking: null, cancellation: null, priority: { code: "7", label: "CRM dead" }, note: null, ...over });

test("S7-CLOSED cursor: round-trips the keyset, binds the filters and the forced scope, rejects tampering", () => {
  const query = closedHistoryQuerySchema.parse({ outcome: "booked,cancelled", priority: ["7"], limit: "10" });
  const { cursor: _c, limit: _l, ...filters } = query;
  const digest = closedHistoryDigest(filters, null);
  const cursor = encodeClosedHistoryCursor({ closed_at: "2026-03-08T15:00:00.000Z", id: A }, digest);
  assert.deepEqual(decodeClosedHistoryCursor(cursor, digest), { closed_at: "2026-03-08T15:00:00.000Z", id: A });
  // Same filters in another order/spelling hash the same (the schema sorts and dedupes repeated params).
  const again = closedHistoryQuerySchema.parse({ outcome: ["cancelled", "booked", "booked"], priority: "7", limit: 10 });
  const { cursor: _c2, limit: _l2, ...filters2 } = again;
  assert.equal(closedHistoryDigest(filters2, null), digest);
  assert.notEqual(closedHistoryDigest(filters, { agent_id: B }), digest, "a forced rep scope is part of the cursor binding");
  assert.throws(() => decodeClosedHistoryCursor(cursor, closedHistoryDigest({ ...filters, outcome: ["booked"] }, null)), (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT");
  assert.throws(() => decodeClosedHistoryCursor("not-a-cursor", digest), (e: unknown) => e instanceof CsiError);
  assert.throws(() => closedHistoryQuerySchema.parse({ limit: 51 }), "limit is at most 50");
  assert.throws(() => closedHistoryQuerySchema.parse({ view: "closed" }), "unknown params are rejected");
  assert.throws(() => closedHistoryQuerySchema.parse({ outcome: "lost" }), "outcome is the Closed view's enum");
});

test("S7-CLOSED keyset predicate: strictly older in (closed_at desc, _id desc)", () => {
  const at = new Date("2026-03-08T15:00:00.000Z");
  const predicate = keysetMongoPredicate({ closed_at: at.toISOString(), id: A }) as { $or: [{ closed_at: { $lt: Date } }, { closed_at: Date; _id: { $lt: mongoose.Types.ObjectId } }] };
  assert.equal(+predicate.$or[0].closed_at.$lt, +at);
  assert.equal(+predicate.$or[1].closed_at, +at);
  assert.equal(String(predicate.$or[1]._id.$lt), A);
  assert.equal(keysetMongoPredicate(null), null);
});

test("S7-CLOSED Mongo narrowing mirrors outcomeReason and filter_keys.priority", () => {
  const all = outcomeMongoPredicate(undefined) as { $or: Record<string, unknown>[] };
  assert.ok(all.$or.some(p => p.closure_origin === "owner"));
  assert.ok(all.$or.some(p => p.closure_origin === "official" && p.closed_reason === "booked"));
  assert.ok(!all.$or.some(p => p.closed_reason === "lead_context_available"), "non-outcome closures never match");
  assert.deepEqual(outcomeMongoPredicate(["crm_dead"]), { $or: [{ closure_origin: "crm_disposition", closed_reason: "granot_dead_opportunity" }] });
  assert.deepEqual(priorityMongoPredicate(["no_lead", "not_set", "0"]), { $or: [
    { "subject.kind": { $ne: "lead" } },
    { "subject.kind": "lead", "lead_progress.granot_priority": null },
    { "subject.kind": "lead", "lead_progress.granot_priority": "0" },
  ] });
  assert.equal(priorityMongoPredicate(undefined), null);
  const query = closedHistoryQuerySchema.parse({ closed_before: "2026-06-01T00:00:00.000Z", closed_from: "2026-01-01T00:00:00-05:00" });
  const filter = closedHistoryFilter(query, null, [new mongoose.Types.ObjectId(B)], [A]) as { state: string; purged_at: null; closed_at: { $gte: Date; $lt: Date }; $and: unknown[] };
  assert.equal(filter.state, "closed");
  assert.equal(filter.purged_at, null);
  assert.equal(filter.closed_at.$gte.toISOString(), "2026-01-01T05:00:00.000Z");
  assert.equal(filter.closed_at.$lt.toISOString(), "2026-06-01T00:00:00.000Z");
  assert.equal(filter.$and.length, 2, "outcome + agent (no priority, no keyset)");
});

test("S7-CLOSED row predicate: the Closed view's filters over the built row; a forced scope wins over params", () => {
  const row = { filter_keys: keys(), outcome: outcome() };
  const q = (raw: Record<string, unknown>) => closedHistoryQuerySchema.parse(raw);
  assert.equal(closedRowMatches(row, q({}), null), true);
  assert.equal(closedRowMatches(row, q({ outcome: "crm_dead" }), null), true);
  assert.equal(closedRowMatches(row, q({ outcome: "booked" }), null), false);
  assert.equal(closedRowMatches(row, q({ priority: "7,8" }), null), true);
  assert.equal(closedRowMatches(row, q({ priority: "not_set" }), null), false);
  assert.equal(closedRowMatches({ filter_keys: keys({ priority: null }), outcome: outcome() }, q({ priority: "not_set" }), null), true, "a Lead without a code is Not set");
  assert.equal(closedRowMatches({ filter_keys: keys({ priority: "no_lead", attachment: "none" }), outcome: outcome() }, q({ priority: "no_lead" }), null), true);
  assert.equal(closedRowMatches(row, q({}), [A]), true);
  assert.equal(closedRowMatches(row, q({}), [B]), false);
  assert.equal(closedRowMatches(row, q({ closed_before: "2026-03-08T15:00:00.000Z" }), null), false, "closed_before is exclusive");
  assert.equal(closedRowMatches(row, q({ closed_from: "2026-03-08T15:00:00.000Z" }), null), true, "closed_from is inclusive");
  assert.equal(closedRowMatches({ filter_keys: keys(), outcome: null }, q({}), null), false, "a closure that is no outcome is never a row");
  assert.deepEqual(effectiveAgents(q({ agent_id: B }), { agent_id: A }), [A], "S8-REP: the forced agent replaces the client's");
  assert.deepEqual(effectiveAgents(q({ agent_id: B }), null), [B]);
  assert.equal(effectiveAgents(q({}), null), null);
});
