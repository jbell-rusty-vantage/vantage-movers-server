import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContactEventDraft } from "./derive";
import { isRepCallOnSubject, receiverFillCandidates } from "./receiverFill";

const draft = (overrides: Partial<ContactEventDraft> = {}): ContactEventDraft => ({
  source_kind: "call",
  source_id: "c1",
  subject_id: "s1",
  channel: "call",
  direction: "outbound",
  event_at: new Date("2026-10-05T14:00:00Z"),
  business_date: "2026-10-05",
  actor_agent_id: "a1",
  goal_agent_id: "a1",
  kind: "outbound_attempt",
  verification: "confirmed",
  exclusion_reason: null,
  restricted_at_contact: false,
  association: "unique",
  association_reason: "eligible",
  subject_workflow: "new",
  outcome: "answered",
  goal_credit: "confirmed",
  goal_scope_eligible: true,
  originating_inbound: false,
  source_revision: 1,
  input_fingerprint: "f",
  ...overrides,
});

test("only a reviewed-rep call or answered inbound uniquely on a subject qualifies", () => {
  assert.ok(isRepCallOnSubject(draft()));
  assert.ok(isRepCallOnSubject(draft({ verification: "awaiting_confirmation" })));
  assert.ok(isRepCallOnSubject(draft({ direction: "inbound", kind: "inbound_answered" })));
  for (const bad of [
    draft({ source_kind: "sms", channel: "sms", kind: "sms_sent" }),
    draft({ association: "ambiguous" }),
    draft({ subject_id: null }),
    draft({ actor_agent_id: null }),
    draft({ kind: "inbound_missed" }),
    draft({ verification: "excluded", exclusion_reason: "restricted" }),
    draft({ verification: "pending_identity" }),
  ])
    assert.equal(isRepCallOnSubject(bad), false, JSON.stringify(bad));
});

test("one candidate per subject: the latest call, ties broken by source id", () => {
  const candidates = receiverFillCandidates([
    draft({ source_id: "c1", actor_agent_id: "a1", event_at: new Date("2026-10-05T14:00:00Z") }),
    draft({ source_id: "c2", actor_agent_id: "a2", event_at: new Date("2026-10-05T15:00:00Z") }),
    draft({ source_id: "c3", actor_agent_id: "a3", event_at: new Date("2026-10-05T15:00:00Z") }),
    draft({ source_id: "c4", subject_id: "s2", actor_agent_id: "a1" }),
  ]);
  assert.deepEqual(
    candidates.map((c) => [c.subject_id, c.agent_id, c.source_id]),
    [["s1", "a3", "c3"], ["s2", "a1", "c4"]],
  );
});
