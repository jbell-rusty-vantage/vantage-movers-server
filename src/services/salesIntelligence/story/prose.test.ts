import assert from "node:assert/strict";
import { test } from "node:test";
import { connector, formatAbsolute, renderSentence, renderStoryProse, renderTail, type RenderContext } from "./prose";
import type { StoryEvent, StoryEventKind } from "./types";

const TZ = "America/New_York";
const ctx: RenderContext = { timezone: TZ, customer: "Maria Lopez", phone: "+17573180143", lead_count: 1 };
const make = (kind: StoryEventKind, id: string, happened_at: string, detail: Record<string, unknown>, over: Partial<StoryEvent> = {}): StoryEvent => ({
  id: `${kind}:${id}`, kind, happened_at, observed_at: happened_at, subject_key: "lead:FormLead:64b000000000000000000001",
  actor: { kind: "vantage", agent_id: null, name: null, identity_status: null }, record: { record_type: "story_event", record_id: `${kind}:${id}` },
  sentence: "", detail, evidence_refs: [], ...over });

const DESCRIPTION = "Call back Monday after she talks to her husband";
const fixture = (): StoryEvent[] => [
  make("lead_received", "l1", "2026-09-15T22:30:00.000Z", { model: "FormLead", source_company_label: "Top10", move_size: "2 Bedrooms", pickup: "Norfolk, VA 23510",
    delivery: "Raleigh, NC 27601", move_date: "2026-10-10", job_no: "84521", duplicate: false, bad_lead: false, no_sync: false },
    { actor: { kind: "customer", agent_id: null, name: "Maria Lopez", identity_status: null } }),
  make("lead_message_sent", "m1", "2026-09-15T22:35:00.000Z", { purpose: "quote_request_confirmation", status: "delivered" }),
  make("call", "c1", "2026-09-17T18:00:00.000Z", { direction: "Outbound", provider_connected: true, duration_seconds: 252, recording_count: 1, contact_type: "human_conversation",
    rep: { name: "Jordan Bell", status: "reviewed", agent_id: "a1", extension: "101" }, conversation_id: "conv1" }, { focus: true, actor: { kind: "rep", agent_id: "a1", name: "Jordan Bell", identity_status: "reviewed" } }),
  make("number_attached", "e1", "2026-09-17T20:00:00.000Z", { state: "attached", certainty: "exact", reason: "sole non-duplicate phone match" }),
  make("granot_priority_changed", "g1", "2026-09-18T14:00:00.000Z", { from: "0", to: "1", label_from: "Fresh", label_to: "Quoted", granot_rep_raw: "JBELL" }),
  make("followup_created", "f1", "2026-09-20T15:00:00.000Z", { kind: "call", description: DESCRIPTION, due_at: "2026-09-21T13:00:00.000Z", origin: "rep_promise" }),
];
const tail = () => renderTail({ last_contact_at: "2026-09-17T18:00:00.000Z", as_of: "2026-09-23T15:00:00.000Z",
  open_followups: [{ kind: "call", description: DESCRIPTION, due_at: "2026-09-21T13:00:00.000Z" }] }, { timezone: TZ });
const render = () => {
  const events = fixture().map(event => ({ ...event, sentence: renderSentence(event, ctx) }));
  return renderStoryProse({ opening: "", events, tail: tail() }, { timezone: TZ });
};

const EXPECTED = "Maria Lopez (+17573180143) submitted a Form Lead on Top10 on Tue Sep 15, 2026 at 6:30 PM ET for a 2 Bedrooms move from Norfolk, VA 23510 to Raleigh, NC 27601, move date Oct 10, 2026 (Job 84521). "
  + "Minutes later Vantage sent the customer a quote request confirmation text (delivered). "
  + "2 days later Jordan Bell made an outbound call: connected, 4 min 12 s, recorded, human conversation (this call). "
  + "Later that day this number was attached to the Lead (Exact, sole non-duplicate phone match). "
  + "The next day Granot Priority changed from 0 (Fresh) to 1 (Quoted) by JBELL. "
  + `2 days later a follow-up was recorded: call "${DESCRIPTION}" due Mon Sep 21 (rep promise). `
  + "No contact since Thu Sep 17 (6 days before this analysis). "
  + `Open now: call "${DESCRIPTION}" due Sep 21 (overdue by 2 days).`;

test("the §4.5 worked example renders exactly and byte-identically", () => {
  assert.equal(render(), EXPECTED);
  assert.equal(render(), render());
});

test("absolute times use the story zone with ET for New York and the short zone name elsewhere", () => {
  assert.equal(formatAbsolute("2026-09-15T22:30:00.000Z", TZ), "Tue Sep 15, 2026 at 6:30 PM ET");
  assert.equal(formatAbsolute("2026-01-15T22:30:00.000Z", TZ), "Thu Jan 15, 2026 at 5:30 PM ET");
  assert.match(formatAbsolute("2026-09-15T22:30:00.000Z", "UTC"), /^Tue Sep 15, 2026 at 10:30 PM UTC$/);
});

test("connectors follow the §4.5 ladder and fall back to an absolute date after eight weeks", () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(connector(at("2026-09-15T22:30:00Z"), at("2026-09-15T23:00:00Z"), TZ), "Minutes later");
  assert.equal(connector(at("2026-09-15T12:00:00Z"), at("2026-09-15T23:00:00Z"), TZ), "Later that day");
  assert.equal(connector(at("2026-09-15T12:00:00Z"), at("2026-09-16T23:00:00Z"), TZ), "The next day");
  assert.equal(connector(at("2026-09-15T12:00:00Z"), at("2026-09-20T23:00:00Z"), TZ), "5 days later");
  assert.equal(connector(at("2026-09-15T12:00:00Z"), at("2026-10-10T23:00:00Z"), TZ), "3 weeks later");
  assert.equal(connector(at("2026-09-15T12:00:00Z"), at("2026-12-10T23:00:00Z"), TZ), "On Thu Dec 10, 2026");
});

test("free text is redacted and every sentence stays within 300 characters", () => {
  const note = make("owner_note", "n1", "2026-09-18T14:00:00.000Z", { note: `Reach her at maria@example.com. ${"x".repeat(500)}` });
  const sentence = renderSentence(note, ctx);
  assert.ok(!sentence.includes("maria@example.com"));
  assert.ok(sentence.includes("[REDACTED:EMAIL]"));
  assert.ok(sentence.length <= 300, `sentence length ${sentence.length}`);
});

test("a story that opens with an untimed event states its date, and inbound and unreviewed reps read honestly", () => {
  const inbound = make("call", "c2", "2026-09-17T18:00:00.000Z", { direction: "Inbound", provider_connected: true, duration_seconds: 61, recording_count: 0, contact_type: "unknown",
    rep: { name: null, status: "proposed", agent_id: null, extension: "102" } });
  const missed = make("call", "c3", "2026-09-17T18:30:00.000Z", { direction: "Inbound", provider_connected: false, provider_result: "Missed", recording_count: 0, contact_type: "unknown", rep: {} });
  const events = [inbound, missed].map(event => ({ ...event, sentence: renderSentence(event, ctx) }));
  assert.equal(renderStoryProse({ opening: "", events, tail: "" }, { timezone: TZ }),
    "On Thu Sep 17, 2026 at 2:00 PM ET Maria Lopez called in; a rep (extension 102, identity not reviewed) answered, 1 min 1 s. Minutes later Maria Lopez called in; not answered (Missed).");
});

test("the tail reports no contact and open follow-ups relative to the analysis instant", () => {
  assert.equal(renderTail({ last_contact_at: null, as_of: "2026-09-23T15:00:00.000Z", open_followups: [{ kind: "wait", description: "Customer will call", due_at: "2026-09-25T13:00:00.000Z" }] }, { timezone: TZ }),
    'No contact recorded. Open now: wait "Customer will call" due Sep 25 (due in 2 days).');
});
