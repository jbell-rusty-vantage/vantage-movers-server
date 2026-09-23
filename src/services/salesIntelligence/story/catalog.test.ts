import assert from "node:assert/strict";
import { test } from "node:test";
import { auditEventStoryKind, boundModelPage, collapseEvents, kindOrder } from "./catalog";
import type { StoryEvent, StoryEventKind } from "./types";

const make = (kind: StoryEventKind, id: string, happened_at: string, detail: Record<string, unknown> = {}, over: Partial<StoryEvent> = {}): StoryEvent => ({
  id: `${kind}:${id}`, kind, happened_at, observed_at: happened_at, subject_key: "number:64b000000000000000000001",
  actor: { kind: "vantage", agent_id: null, name: null, identity_status: null }, record: { record_type: "story_event", record_id: `${kind}:${id}` },
  sentence: "", detail, evidence_refs: [`${kind}:${id}`], ...over });
const attempt = (id: string, at: string, result = "Voicemail", direction = "Outbound") =>
  make("call", id, at, { interaction_id: id, direction, provider_result: result, provider_connected: false, contact_type: result === "Voicemail" ? "voicemail" : "unknown", recording_count: 0 });
const day = (n: number, hour = 12) => `2026-09-${String(n).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

test("kind order follows the catalog row order", () => {
  assert.ok(kindOrder("lead_received") < kindOrder("call"));
  assert.ok(kindOrder("call") < kindOrder("conversation_analyzed"));
  assert.ok(kindOrder("unknown_kind") > kindOrder("owner_correction"));
});

test("consecutive unconnected calls of one direction within 7 days collapse into one call_attempts", () => {
  const events = [attempt("a", day(1)), attempt("b", day(2), "Missed"), attempt("c", day(3)),
    make("call", "h", day(4), { direction: "Outbound", provider_connected: true, contact_type: "human_conversation", recording_count: 1 }),
    attempt("d", day(5)), attempt("e", day(20))];
  const collapsed = collapseEvents(events);
  assert.deepEqual(collapsed.map(e => e.kind), ["call_attempts", "call", "call", "call"]);
  const run = collapsed[0]!;
  assert.equal(run.id, "call_attempts:a");
  assert.deepEqual(run.detail.results, { voicemail: 2, missed: 1, no_answer: 0, other: 0 });
  assert.deepEqual(run.collapsed_ids, ["call:a", "call:b", "call:c"]);
  assert.deepEqual(run.detail.interaction_ids, ["a", "b", "c"]);
  assert.equal(run.detail.from, day(1)); assert.equal(run.detail.to, day(3));
  // A single attempt, and an attempt more than 7 days after the previous one, stay ordinary calls.
  assert.deepEqual(collapsed.slice(2).map(e => e.id), ["call:d", "call:e"]);
});

test("a change of direction or an intervening event breaks an attempt run", () => {
  const events = [attempt("a", day(1)), attempt("b", day(1, 13), "Missed", "Inbound"), attempt("c", day(1, 14)), make("owner_note", "n", day(1, 15), { note: "x" }), attempt("d", day(1, 16))];
  assert.deepEqual(collapseEvents(events).map(e => e.kind), ["call", "call", "call", "owner_note", "call"]);
});

test("Priority churn within an hour collapses to first-from / last-to", () => {
  const change = (id: string, at: string, from: string, to: string) => make("granot_priority_changed", id, at, { from, to, label_from: from, label_to: to, change_id: id }, { subject_key: "lead:FormLead:64b000000000000000000002" });
  const collapsed = collapseEvents([change("1", day(1, 10), "0", "3"), change("2", "2026-09-01T10:20:00.000Z", "3", "1"), change("3", "2026-09-01T10:50:00.000Z", "1", "5"), change("4", day(1, 14), "5", "1")]);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0]!.detail.from, "0"); assert.equal(collapsed[0]!.detail.to, "5"); assert.equal(collapsed[0]!.detail.change_id, "3");
  assert.deepEqual(collapsed[0]!.collapsed_ids, ["granot_priority_changed:1", "granot_priority_changed:2", "granot_priority_changed:3"]);
  assert.equal(collapsed[1]!.id, "granot_priority_changed:4");
});

test("only the newest five Owner notes survive and the oldest kept one counts the rest", () => {
  const notes = Array.from({ length: 7 }, (_, i) => make("owner_note", `n${i}`, day(i + 1), { note: `note ${i}` }));
  const collapsed = collapseEvents([make("lead_received", "l", day(1, 1)), ...notes]);
  assert.deepEqual(collapsed.map(e => e.id), ["lead_received:l", "owner_note:n2", "owner_note:n3", "owner_note:n4", "owner_note:n5", "owner_note:n6"]);
  assert.equal(collapsed[1]!.detail.older_notes_omitted, 2);
  assert.equal(collapsed[2]!.detail.older_notes_omitted, undefined);
});

test("the model page keeps arrivals, edges, bookings, closures and the focus call, dropping attempts and notes first", () => {
  const events = [make("lead_received", "l", day(1)), make("call_attempts", "a", day(2)), make("owner_note", "n1", day(3)), make("call", "c1", day(4)),
    make("number_attached", "e", day(5)), make("call", "c2", day(6), { conversation_id: "focus" }), make("owner_note", "n2", day(7)), make("lead_message_sent", "m", day(8)),
    make("booking_recorded", "b", day(9)), make("closed", "z", day(10))];
  const page = boundModelPage(events, 6, "focus");
  assert.equal(page.dropped, 4);
  // Attempts and notes go first; of the remaining droppable events the oldest (`call:c1`) goes before the newer message.
  assert.deepEqual(page.kept.map(e => e.id), ["lead_received:l", "number_attached:e", "call:c2", "lead_message_sent:m", "booking_recorded:b", "closed:z"]);
  // Under the bound nothing is dropped; protected events are never dropped even when they alone exceed it.
  assert.equal(boundModelPage(events, 10, null).dropped, 0);
  const tight = boundModelPage(events, 2, "focus");
  assert.deepEqual(tight.kept.map(e => e.id), ["lead_received:l", "number_attached:e", "call:c2", "booking_recorded:b", "closed:z"]);
  assert.equal(tight.dropped, 5);
});

test("audit event kinds map to story kinds and unknown kinds are skipped", () => {
  assert.equal(auditEventStoryKind("add_note"), "owner_note");
  assert.equal(auditEventStoryKind("assign"), "assigned");
  assert.equal(auditEventStoryKind("close"), "closed");
  assert.equal(auditEventStoryKind("outreach_closed"), "closed");
  assert.equal(auditEventStoryKind("reopen"), "reopened");
  assert.equal(auditEventStoryKind("set_waiting"), "waiting_set");
  assert.equal(auditEventStoryKind("number_review_opened"), "review_opened");
  assert.equal(auditEventStoryKind("review_resolved"), "review_resolved");
  assert.equal(auditEventStoryKind("restriction", "restriction"), "restriction_set");
  assert.equal(auditEventStoryKind("restriction_resolved", "restriction"), "restriction_resolved");
  assert.equal(auditEventStoryKind("nudge.authorized"), "nudge_sent");
  assert.equal(auditEventStoryKind("start_call"), "call_started");
  assert.equal(auditEventStoryKind("end_call"), "call_ended");
  assert.equal(auditEventStoryKind("outreach_created"), null);
  assert.equal(auditEventStoryKind("intelligence.published"), null);
});
