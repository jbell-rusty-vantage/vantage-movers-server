import assert from "node:assert/strict";
import { test } from "node:test";
import { readContentSchema } from "../analysis/reads";
import type { CoverageDto } from "../dto";
import { storyToReadContent } from "./page";
import type { GranotLeadState, StoryEvent, StoryEventKind, SubjectStory } from "./types";

const LEAD = "64b000000000000000000002";
const coverage: CoverageDto = { known_through: "2026-09-23T15:00:00.000Z", gaps: [], capabilities: {}, ai_paused: false };
const make = (kind: StoryEventKind, id: string, happened_at: string, detail: Record<string, unknown> = {}, sentence = "Something happened."): StoryEvent => ({
  id: `${kind}:${id}`, kind, happened_at, observed_at: happened_at, subject_key: `lead:FormLead:${LEAD}`,
  actor: { kind: "vantage", agent_id: null, name: null, identity_status: null }, record: { record_type: "story_event", record_id: `${kind}:${id}` },
  sentence, detail, evidence_refs: [] });
const granot = (id: string): GranotLeadState => ({ lead_ref: { model: "FormLead", id }, job_no: "84521", granot_priority: "1", priority_label: "Quoted", disposition: "quoted", quoted: true,
  booked: false, cancelled: false, duplicate: false, bad_lead: false, no_sync: false, receiver_agent_name: "Jordan Bell", granot_rep_raw: "JBELL",
  move: { pickup: "Norfolk, VA 23510", delivery: "Raleigh, NC 27601", move_date: "2026-10-10", move_size: "2 Bedrooms", granot_move_size: null, cubic_feet: null, service_type: null },
  money: { estimate: "2,450.00", payment: "300.00", balance: "2,150.00" }, booking_action: "booked",
  observation: { id: "64b000000000000000000009", kind: "lead_snapshot", captured_at: "2026-09-18T14:00:00.000Z", source_label: "top10" }, booking: null });
const story = (over: Partial<SubjectStory> = {}): SubjectStory => ({
  as_of: "2026-09-23T15:00:00.000Z",
  subject: { contact_number_id: "64b000000000000000000001", e164: "+17573180143", lead_refs: [{ model: "FormLead", id: LEAD }], outreach_record_ids: [], conversation_ids: [], as_of: new Date("2026-09-23T15:00:00.000Z"), focus: null },
  opening: "Maria Lopez (+17573180143) — 1 Lead attached: Form Lead Maria Lopez, Top10, received Sep 15, 2026, Job 84521.",
  events: [
    make("lead_received", LEAD, "2026-09-15T22:30:00.000Z", { model: "FormLead", lead_ref: { model: "FormLead", id: LEAD }, job_no: "84521" }, "Maria Lopez submitted a Form Lead."),
    make("lead_message_sent", "m1", "2026-09-15T22:35:00.000Z", { purpose: "quote_request_confirmation", status: "delivered", body: "SECRET BODY TEXT", nested: { body: "SECRET BODY TEXT" } }, "Vantage sent the customer a quote request confirmation text (delivered)."),
    make("call", "c1", "2026-09-17T18:00:00.000Z", { direction: "Outbound", provider_connected: true, conversation_id: "64b000000000000000000005", rep: { name: "Jordan Bell", status: "reviewed" } }, "Jordan Bell made an outbound call."),
    make("owner_note", "n1", "2026-09-18T18:00:00.000Z", { note: "Email her at maria@example.com" }, "the Owner noted: \"Email her at [REDACTED:EMAIL]\"."),
  ],
  tail: "No contact since Thu Sep 17 (6 days before this analysis).",
  prose: "…", coverage: { sources: { calls: { read: 3, truncated: false }, audit: { read: 400, truncated: true } }, dropped_from_model_page: 2, from: "2026-09-15T22:30:00.000Z", to: "2026-09-18T18:00:00.000Z" },
  candidates: [{ lead_ref: { model: "CallLead", id: "64b000000000000000000003" }, basis: ["phone:normalized_phone_number", "name:caller_id"], name: "M Lopez", received_at: "2026-09-10T10:00:00.000Z",
    source_company_label: "Google Ads", job_no: null, duplicate: true, booked: false, cancelled: false, bad_lead: false, attachment_state: "candidate", certainty: "likely" }],
  granot: [granot(LEAD)], digest: "abc", ...over });

test("the story page parses as read content with one record per event, Granot state and candidate", () => {
  const content = storyToReadContent(story(), coverage);
  assert.doesNotThrow(() => readContentSchema.parse(content));
  assert.deepEqual(content.page.records.map(r => r.record_type), ["story_event", "story_event", "story_event", "story_event", "granot_state", "lead"]);
  const call = content.page.records[2]!;
  assert.equal(call.record_id, "call:c1");
  assert.equal(call.fields.conversation_id, "64b000000000000000000005");
  assert.equal(call.fields.lead_id, LEAD);
  assert.equal(call.fields.status, "connected");
  assert.equal(call.fields.occurred_at, "2026-09-17T18:00:00.000Z");
  const state = content.page.records[4]!;
  assert.equal(state.record_id, `FormLead:${LEAD}`);
  assert.equal(state.fields.description, "Priority 1 (Quoted), estimate $2,450.00, payment $300.00, balance $2,150.00, booking action booked, quoted");
  assert.equal(state.fields.estimate, "2,450.00");
  const candidate = content.page.records[5]!;
  assert.equal(candidate.fields.certainty, "candidate:phone:normalized_phone_number|name:caller_id");
  assert.equal(candidate.fields.status, "not_attached");
  assert.deepEqual(content.page.missing_ranges, ["story_truncated:audit"]);
  assert.equal(content.page.complete, true);
  assert.equal(content.story?.digest, "abc");
  assert.deepEqual(content.allowed_followup_ids, []);
});

test("no Lead Message body and no email address reaches the page", () => {
  const json = JSON.stringify(storyToReadContent(story(), coverage));
  assert.ok(!json.includes("SECRET BODY TEXT"));
  assert.ok(!json.includes("maria@example.com"));
});

test("records never exceed 200: candidates overflow first, then Granot states, never story events", () => {
  const events = Array.from({ length: 80 }, (_, i) => make("owner_note", `n${i}`, "2026-09-18T18:00:00.000Z", { note: `n${i}` }));
  const states = Array.from({ length: 130 }, (_, i) => granot(`64b0000000000000000${String(i).padStart(5, "0")}`));
  const content = storyToReadContent(story({ events, granot: states }), coverage);
  assert.equal(content.page.records.length, 200);
  assert.equal(content.page.records.filter(r => r.record_type === "story_event").length, 80);
  assert.equal(content.page.records.filter(r => r.record_type === "granot_state").length, 120);
  assert.equal(content.page.records.filter(r => r.record_type === "lead").length, 0);
  assert.deepEqual(content.page.missing_ranges, ["story_truncated:audit", "story_granot_overflow", "story_candidates_overflow"]);
  assert.doesNotThrow(() => readContentSchema.parse(content));
});

test("oversized details are truncated with a marker instead of refusing the page", () => {
  const content = storyToReadContent(story({ events: [make("owner_note", "big", "2026-09-18T18:00:00.000Z", { note: "x".repeat(10_000) })] }), coverage);
  const details = content.page.records[0]!.fields.details!;
  assert.ok(details.length <= 4000);
  assert.ok(details.endsWith("…[truncated]"));
});
