import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { timelineV2EventDtoSchema, timelineV2PageDtoSchema } from "../../numberActivity/dto";
import { decodeTimelineCursor } from "../../numberActivity/timeline";
import { renderSentence, type RenderContext } from "../story/prose";
import type { StoryEvent, StoryEventKind } from "../story/types";
import { isRecordedLate, mergeTimelinePages, storyEventToTimelineDto, timelineChips, timelineV2QuerySchema } from "./timelineRead";

const NUMBER = "64b000000000000000000001";
const LEAD_A = "64b0000000000000000000a1";
const LEAD_B = "64b0000000000000000000b2";
const OUTREACH = "64b0000000000000000000c3";
const CONV = "64b0000000000000000000d4";
const AS_OF = new Date("2026-09-23T15:00:00.000Z");
const render: RenderContext = { timezone: "America/New_York", customer: "Maria Lopez", phone: "+17573180143", lead_count: 2 };
const numberCtx = (multi = true) => ({ scope: "number" as const, number_id: NUMBER, outreach_id: null, as_of: AS_OF, render,
  job_no_by_lead: multi ? new Map([[LEAD_A, "84521"], [LEAD_B, "90210"]]) : null });
const outreachCtx = { scope: "outreach" as const, number_id: NUMBER, outreach_id: OUTREACH, as_of: AS_OF, render: { ...render, lead_count: 1 }, job_no_by_lead: null };

const make = (kind: string, id: string, happened_at: string, detail: Record<string, unknown>, over: Partial<StoryEvent> = {}): StoryEvent => ({
  id: `${kind}:${id}`, kind: kind as StoryEventKind, happened_at, observed_at: happened_at, subject_key: `lead:FormLead:${LEAD_A}`,
  actor: { kind: "vantage", agent_id: null, name: null, identity_status: null }, record: { record_type: "story_event", record_id: `${kind}:${id}` },
  sentence: "", detail, evidence_refs: [], ...over });

const callEvent = (over: Partial<StoryEvent> = {}, detail: Record<string, unknown> = {}) => make("call", "64b0000000000000000000e5", "2026-09-17T18:00:00.000Z", {
  interaction_id: "64b0000000000000000000e5", direction: "Outbound", provider_result: "Call connected", provider_connected: true, contact_type: "human_conversation",
  duration_seconds: 252, recording_count: 1, rep: { agent_id: "a1", name: "Jordan Bell", status: "reviewed", extension: "101" }, conversation_id: CONV,
  analyzed_conversation_id: CONV, recording_state: "analyzed", ...detail },
{ subject_key: `number:${NUMBER}`, observed_at: "2026-09-17T18:05:00.000Z", actor: { kind: "rep", agent_id: "a1", name: "Jordan Bell", identity_status: "reviewed" }, ...over });

test("recorded_late: strictly more than one hour between happened_at and observed_at", () => {
  const at = "2026-09-17T18:00:00.000Z";
  assert.equal(isRecordedLate(at, "2026-09-17T19:00:00.000Z"), false, "exactly one hour is processing noise");
  assert.equal(isRecordedLate(at, "2026-09-17T19:00:00.001Z"), true, "one hour and a millisecond is late");
  assert.equal(isRecordedLate(at, "2026-09-17T18:59:59.999Z"), false);
  assert.equal(isRecordedLate(at, "2026-09-17T17:00:00.000Z"), false, "observed before happened is never late");
  const late = storyEventToTimelineDto(callEvent({ observed_at: "2026-09-17T20:30:00.000Z" }), numberCtx());
  assert.equal(late.recorded_late, true);
  assert.equal(storyEventToTimelineDto(callEvent(), numberCtx()).recorded_late, false);
});

test("adapter: a call carries title, the model's sentence, chips, rep, recording state and Open conversation", () => {
  const e = callEvent();
  const dto = storyEventToTimelineDto(e, numberCtx());
  assert.doesNotThrow(() => timelineV2EventDtoSchema.parse(dto));
  assert.equal(dto.title, "Outbound call · Call connected · 4 min 12 s");
  const sentence = renderSentence(e, render);
  assert.equal(dto.description, sentence[0]!.toUpperCase() + sentence.slice(1), "the Owner reads the same sentence as the model");
  assert.equal(dto.description, "Jordan Bell made an outbound call: connected, 4 min 12 s, recorded, human conversation.");
  assert.deepEqual(dto.chips, ["Recording", "Analyzed", "Human conversation"]);
  assert.deepEqual(dto.action, { kind: "open_conversation", href: `/sales-intelligence/numbers/${NUMBER}?tab=calls&conversation=${CONV}` });
  assert.deepEqual(dto.call, { interaction_id: "64b0000000000000000000e5", direction: "Outbound", result: "Call connected", connected: true, contact_type: "human_conversation",
    duration_seconds: 252, recording_count: 1, recording_state: "analyzed", conversation_id: CONV, rep: { agent_id: "a1", name: "Jordan Bell", status: "reviewed", extension: "101" } });
  assert.equal(dto.kind_order, 3);
  assert.equal(dto.group, "calls");
  assert.equal(dto.routine, false);
  assert.equal(dto.job_no, null, "calls are the Number's, not one Lead's");
  assert.equal(storyEventToTimelineDto(e, outreachCtx).action?.href, `/sales-intelligence/outreach/${OUTREACH}?tab=analysis&conversation=${CONV}`);
});

test("adapter: rep name only when reviewed; voicemail chip; no action before analysis", () => {
  const e = callEvent({}, { rep: { agent_id: null, name: "Should Not Show", status: "proposed", extension: "102" }, contact_type: "voicemail", analyzed_conversation_id: null,
    recording_state: "recorded", provider_connected: false, provider_result: "Voicemail" });
  const dto = storyEventToTimelineDto(e, numberCtx());
  assert.equal(dto.call?.rep?.name, null);
  assert.equal(dto.call?.rep?.status, "proposed");
  assert.deepEqual(dto.chips, ["Recording", "Voicemail"]);
  assert.equal(dto.action, null);
  assert.equal(dto.call?.conversation_id, CONV, "the linked conversation is still named");
  assert.deepEqual(timelineChips(make("lead_received", "x", "2026-09-01T00:00:00.000Z", {})), []);
});

test("adapter: B13 shapes — a paired Priority change keeps captured/applied, an unpaired one applied twice", () => {
  const paired = make("granot_priority_changed", "p1", "2026-09-18T14:00:00.000Z", { from: "0", to: "1", label_from: "Fresh", label_to: "Quoted", observation_id: "o1",
    applied_at: "2026-09-18T16:30:00.000Z", lead_ref: { model: "FormLead", id: LEAD_A } }, { observed_at: "2026-09-18T16:30:00.000Z" });
  const dto = storyEventToTimelineDto(paired, numberCtx());
  assert.equal(dto.happened_at, "2026-09-18T14:00:00.000Z");
  assert.equal(dto.observed_at, "2026-09-18T16:30:00.000Z");
  assert.equal(dto.recorded_late, true);
  assert.equal(dto.title, "Granot Priority 1 (Quoted)");
  assert.equal(dto.job_no, "84521");
  const unpaired = storyEventToTimelineDto({ ...paired, id: "granot_priority_changed:p2", happened_at: "2026-09-18T16:30:00.000Z", detail: { ...paired.detail, observation_id: null } }, numberCtx());
  assert.equal(unpaired.happened_at, unpaired.observed_at);
  assert.equal(unpaired.recorded_late, false);
});

test("adapter: job_no only on a multi-Lead Number for the per-Lead sources", () => {
  const followup = make("followup_created", "f1", "2026-09-20T15:00:00.000Z", { kind: "call", description: "Call back Monday", due_at: "2026-09-21T13:00:00.000Z", origin: "rep_promise" },
    { subject_key: `lead:FormLead:${LEAD_B}` });
  assert.equal(storyEventToTimelineDto(followup, numberCtx()).job_no, "90210");
  assert.equal(storyEventToTimelineDto(followup, numberCtx(false)).job_no, null);
  assert.equal(storyEventToTimelineDto(followup, outreachCtx).job_no, null);
  assert.equal(storyEventToTimelineDto(make("owner_note", "n1", "2026-09-20T15:00:00.000Z", { note: "x" }), numberCtx()).job_no, null);
  assert.equal(storyEventToTimelineDto(followup, numberCtx()).title, "Callback promised for Sep 21, 9:00 AM ET");
  const booking = make("booking_recorded", "b1", "2026-09-22T15:00:00.000Z", { booking_id: "64b0000000000000000000f6", job_no: "77777", total_binder_amount: 1200, agent_name: "Jordan Bell" });
  const dto = storyEventToTimelineDto(booking, numberCtx());
  assert.equal(dto.job_no, "77777", "a Booking names its own Job");
  assert.equal(dto.title, "Booked · binder $1,200 · Jordan Bell");
  assert.deepEqual(dto.action, { kind: "open_booking", href: "/bookings?record=64b0000000000000000000f6&database_scope=production" });
});

test("adapter: routine kinds, timeline-only kinds and copy", () => {
  const routine = ["conversation_recorded", "granot_observed", "analysis_submitted"];
  for (const kind of routine) assert.equal(storyEventToTimelineDto(make(kind, "r1", "2026-09-20T15:00:00.000Z", {}), numberCtx()).routine, true, kind);
  const snoozed = storyEventToTimelineDto(make("followup_snoozed", "s1", "2026-09-20T15:00:00.000Z", { until: "2027-01-04T15:00:00.000Z", reason: "customer travelling" }), numberCtx());
  assert.equal(snoozed.title, "Snoozed until Jan 4, 2027, 10:00 AM ET", "year shown when it is not the as_of year");
  assert.equal(snoozed.description, "The follow-up was snoozed until Mon Jan 4, 2027 at 10:00 AM ET: customer travelling.");
  assert.equal(snoozed.group, "work");
  const submitted = storyEventToTimelineDto(make("analysis_submitted", "a1", "2026-09-20T15:00:00.000Z", {}), numberCtx());
  assert.equal(submitted.title, "Analysis submitted");
  assert.equal(submitted.group, "analysis");
  const correction = storyEventToTimelineDto(make("owner_correction", "c1:1", "2026-09-20T15:00:00.000Z", { field: "due_at", current: "2026-09-25" }), numberCtx());
  assert.equal(correction.title, "You corrected due at");
  const attached = storyEventToTimelineDto(make("number_attached", "e1:0", "2026-09-17T20:00:00.000Z", { state: "attached", certainty: "owner_confirmed", reason: "same phone" }), numberCtx());
  assert.equal(attached.title, "Number attached to this Lead · Confirmed by you · same phone");
  const message = storyEventToTimelineDto(make("lead_message_sent", "m1", "2026-09-15T22:35:00.000Z", { purpose: "quote_request_confirmation", status: "delivered" }), numberCtx());
  assert.equal(message.title, "Text sent to the customer · quote request confirmation · delivered");
  assert.equal(message.description, "Vantage sent the customer a quote request confirmation text (delivered).");
  const detailWithUndefined = storyEventToTimelineDto(make("closed", "x1", "2026-09-20T15:00:00.000Z", { reason: "booked", missing: undefined }), numberCtx());
  assert.equal("missing" in detailWithUndefined.detail, false, "detail is JSON-safe");
  assert.equal(detailWithUndefined.title, "Closed · booked");
});

test("merge: dedupe on (kind, id), total order, cursor only when more remain", () => {
  const a = make("call", "3", "2026-09-17T18:00:00.000Z", {}), b = make("lead_received", "1", "2026-09-17T18:00:00.000Z", {}), c = make("owner_note", "2", "2026-09-10T00:00:00.000Z", {});
  const full = mergeTimelinePages([{ events: [a, c], read: 2, truncated: false }, { events: [b, a], read: 2, truncated: false }], 10);
  assert.deepEqual(full.events.map(e => e.id), ["lead_received:1", "call:3", "owner_note:2"]);
  assert.equal(full.cursor, null);
  const first = mergeTimelinePages([{ events: [a, c], read: 2, truncated: false }, { events: [b], read: 1, truncated: false }], 2);
  assert.deepEqual(first.events.map(e => e.id), ["lead_received:1", "call:3"]);
  assert.deepEqual(decodeTimelineCursor(first.cursor!), { happened_at: a.happened_at, kind: "call", id: "call:3" });
});

test("query: kinds[] in every spelling, unknown kinds rejected, strict", () => {
  assert.deepEqual(timelineV2QuerySchema.parse({ "kinds[]": "call" }), { cursor: undefined, limit: 50, kinds: ["call"] });
  assert.deepEqual(timelineV2QuerySchema.parse({ kinds: ["call", "lead_received"], limit: "7" }).kinds, ["call", "lead_received"]);
  assert.deepEqual(timelineV2QuerySchema.parse({ kinds: "call,booking_recorded,call" }).kinds, ["call", "booking_recorded"]);
  assert.equal(timelineV2QuerySchema.parse({}).kinds, null);
  assert.throws(() => timelineV2QuerySchema.parse({ kinds: "interaction" }));
  assert.throws(() => timelineV2QuerySchema.parse({ limit: "201" }));
  assert.throws(() => timelineV2QuerySchema.parse({ other: "x" }));
});

/** The production admin's `timelineSchema` (`vantage-admin/lib/api/salesIntelligence.ts` at 539a628), copied verbatim in shape. */
const adminCoverage = z.object({ known_through: z.string().nullable(), gaps: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() })), ai_paused: z.boolean() });
const adminTimelineSchema = z.object({ as_of: z.string(), coverage: adminCoverage, data: z.object({ number_id: z.string(),
  items: z.array(z.object({ id: z.string(), kind: z.string(), happened_at: z.string(), observed_at: z.string(), description: z.string(),
    evidence_refs: z.array(z.string()), detail: z.record(z.string(), z.json()) })), cursor: z.string().nullable() }) });

test("flag on: a v2 Number page still parses with the current admin timelineSchema", () => {
  const items = [callEvent(), make("followup_snoozed", "s1", "2026-09-16T15:00:00.000Z", { until: "2026-09-18T15:00:00.000Z" })].map(e => storyEventToTimelineDto(e, numberCtx()));
  const page = timelineV2PageDtoSchema.parse({ as_of: AS_OF.toISOString(), coverage: { known_through: null, gaps: [], capabilities: {}, ai_paused: false },
    data: { scope: "number", number_id: NUMBER, outreach_id: null, items, cursor: null, kinds: null, coverage: { truncated_sources: [] } } });
  const parsed = adminTimelineSchema.parse(JSON.parse(JSON.stringify(page)));
  assert.equal(parsed.data.number_id, NUMBER);
  assert.equal(parsed.data.items.length, 2);
});
