import assert from "node:assert/strict";
import { test } from "node:test";
import { planEngagementEffects, type EngagementPlanInput, type StoredEngagement } from "./engagement";
import type { EvidenceRef } from "./contract";

const LATEST = "2026-09-20T15:00:00.000Z", EARLIER = "2026-09-10T15:00:00.000Z";
const call = (at: string, id = "e1"): EvidenceRef => ({ id, kind: "said_on_call", speaker: "rep", call_at: at, lineage: [],
  locator: { source: "summary_artifact", snapshot_id: "s1", content_digest: "d1", conversation_id: "c1", transcript_version: "v1", section: "said_on_call.0" } });
const engagement = (over: Partial<StoredEngagement> = {}): StoredEngagement => ({
  work_status: "worked_with_next_step", rationale: "Rep spoke with the customer.", evidence_ids: ["e1"], evidence: [call(LATEST)],
  promised_callbacks: [{ by: "rep", raw_text: "I'll call you Friday", date: "2026-09-25", time_text: null, status: "pending", evidence_ids: ["e1"], evidence: [call(LATEST)] }],
  next_steps: [{ action: "send_estimate", owner: "rep", description: "Send the written estimate", date: null, date_text: "tomorrow", status: "planned", evidence_ids: ["e1"], evidence: [call(LATEST)] }],
  ...over });
const input = (over: Partial<EngagementPlanInput> = {}): EngagementPlanInput => ({
  artifact_id: "a1", engagement: engagement(), latest_conversation_at: LATEST, record: { state: "unworked" }, open_actions: [],
  existing_keys: new Set(), later_outbound_attempt: false, owner_protected: false, ...over });

test("a pending rep callback and a planned rep step become follow-ups and an unworked record is marked worked", () => {
  const plan = planEngagementEffects(input());
  assert.equal(plan.mark_worked, true);
  assert.deepEqual(plan.followups.map(f => [f.kind, f.origin, f.requested_by, f.date, f.date_text, f.commitment_key, f.anchor]), [
    ["call", "rep_promise", "rep", "2026-09-25", null, "assessment:a1:promised_callback:0", LATEST],
    ["send_estimate", "rep_promise", "rep", null, "tomorrow", "assessment:a1:next_step:0", LATEST],
  ]);
  assert.deepEqual(plan.skipped, []);
  assert.equal(plan.blocked, null);
});

test("a customer who will call back becomes a wait action; customer-owned steps wait too", () => {
  const plan = planEngagementEffects(input({ engagement: engagement({
    promised_callbacks: [{ by: "customer", raw_text: "I'll call you Monday", date: "2026-09-22", time_text: null, status: "pending", evidence_ids: ["e1"], evidence: [call(LATEST)] }],
    next_steps: [{ action: "other", owner: "customer", description: "Send photos of the garage", date: null, date_text: null, status: "planned", evidence_ids: ["e1"], evidence: [call(LATEST)] }] }) }));
  assert.deepEqual(plan.followups.map(f => [f.kind, f.origin, f.requested_by]), [["wait", "customer_wait", "customer"]]);
  // Second customer step is the same kind (wait): one open action per kind.
  assert.deepEqual(plan.skipped, [{ source: "next_step", index: 0, reason: "open_action_exists" }]);
});

test("commitments from an earlier call are superseded by the later contact", () => {
  const plan = planEngagementEffects(input({ engagement: engagement({
    promised_callbacks: [{ by: "rep", raw_text: "I'll call you back", date: null, time_text: null, status: "pending", evidence_ids: ["e0"], evidence: [call(EARLIER, "e0")] }],
    next_steps: [] }) }));
  assert.deepEqual(plan.followups, []);
  assert.deepEqual(plan.skipped, [{ source: "promised_callback", index: 0, reason: "superseded_by_later_call" }]);
  assert.equal(plan.mark_worked, true);
});

test("a rep promise followed by an attributable outbound attempt was acted on; fulfilled, cancelled and conditional items never apply", () => {
  const acted = planEngagementEffects(input({ later_outbound_attempt: true }));
  assert.deepEqual(acted.followups.map(f => f.kind), ["send_estimate"]);
  assert.deepEqual(acted.skipped, [{ source: "promised_callback", index: 0, reason: "fulfilled_by_later_attempt" }]);
  const settled = planEngagementEffects(input({ engagement: engagement({
    promised_callbacks: [{ by: "rep", raw_text: "x", date: null, time_text: null, status: "fulfilled", evidence_ids: ["e1"], evidence: [call(LATEST)] },
      { by: "rep", raw_text: "y", date: null, time_text: null, status: "cancelled", evidence_ids: ["e1"], evidence: [call(LATEST)] }],
    next_steps: [{ action: "call", owner: "rep", description: "Call once the house closes", date: null, date_text: null, status: "conditional", evidence_ids: ["e1"], evidence: [call(LATEST)] }] }) }));
  assert.deepEqual(settled.followups, []);
  assert.deepEqual(settled.skipped.map(s => s.reason), ["status_fulfilled", "status_cancelled", "status_conditional"]);
});

test("existing open actions of the same kind win, and a republish is idempotent", () => {
  const existing = planEngagementEffects(input({ open_actions: [{ kind: "call" }] }));
  assert.deepEqual(existing.followups.map(f => f.kind), ["send_estimate"]);
  assert.deepEqual(existing.skipped, [{ source: "promised_callback", index: 0, reason: "open_action_exists" }]);
  const again = planEngagementEffects(input({ existing_keys: new Set(["assessment:a1:promised_callback:0", "assessment:a1:next_step:0"]) }));
  assert.deepEqual(again.followups, []);
  assert.deepEqual(again.skipped.map(s => s.reason), ["already_created", "already_created"]);
});

test("closed, identity-review and Owner-protected records are never touched", () => {
  for (const [state, protectedByOwner, blocked] of [["closed", false, "record_closed"], ["identity_review", false, "record_identity_review"], ["unworked", true, "owner_instruction"]] as const) {
    const plan = planEngagementEffects(input({ record: { state }, owner_protected: protectedByOwner }));
    assert.equal(plan.blocked, blocked);
    assert.equal(plan.mark_worked, false);
    assert.deepEqual(plan.followups, []);
    assert.deepEqual(plan.skipped.map(s => s.reason), [blocked, blocked]);
  }
});

test("only a worked status marks an unworked record open; open records keep their state", () => {
  assert.equal(planEngagementEffects(input({ engagement: engagement({ work_status: "not_contacted", promised_callbacks: [], next_steps: [] }) })).mark_worked, false);
  assert.equal(planEngagementEffects(input({ engagement: engagement({ work_status: "worked_no_next_step", promised_callbacks: [], next_steps: [] }) })).mark_worked, true);
  assert.equal(planEngagementEffects(input({ record: { state: "open" } })).mark_worked, false);
});
