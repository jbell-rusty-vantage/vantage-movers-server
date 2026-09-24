import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { followsRecordRep, receiverAssignmentPlan } from "./receiverAssignment";
import { assignmentRank, mayReplaceAssignment, receiverBlocksPhoneEvidence, receiverRankKey } from "./types";
import { outreachRepairNomination, receiverRepairSuffix, RECEIVER_REPAIR_WINDOW_MS } from "./worker";
import { receiverAgentDto } from "./detailDto";
import { renderTimelineSentence, renderTimelineTitle, type RenderContext } from "../story/prose";
import type { StoryEvent, StoryEventKind } from "../story/types";

/** S6-AGENT C4 / C13 / E26 and flag-off identity (assignment addendum §3.2), fixed clock. */
const NOW = new Date("2026-09-24T16:00:00.000Z");
const oid = () => new mongoose.Types.ObjectId();
const GRANOT_REP = oid(), PHONE_REP = oid(), OWNER_PICK = oid();
function withFlag<T>(value: boolean, run: () => T): T {
  const prior = process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT;
  process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT = value ? "true" : "false";
  try { return run(); } finally { if (prior === undefined) delete process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT; else process.env.SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT = prior; }
}
const record = (agent: mongoose.Types.ObjectId | null, origin: string | null, receiver_source?: string) =>
  ({ responsible_agent_id: agent, assignment: origin ? { origin, ...(receiver_source ? { receiver_source } : {}) } : null });
const granot = { receiver_agent: GRANOT_REP, receiver_agent_source: "granot_username_match" };

test("ranks: crm_receiver between owner and the conversation origins; a ringcentral_answered receiver just above first_attempts", () => {
  assert.ok(assignmentRank("owner") > assignmentRank("crm_receiver", "granot_username_match"));
  assert.ok(assignmentRank("crm_receiver", "extension_match") > assignmentRank("first_conversation"));
  assert.ok(assignmentRank("rep_promise") > assignmentRank("crm_receiver", "ringcentral_answered"));
  assert.ok(assignmentRank("inherited_outreach") > assignmentRank("crm_receiver", "ringcentral_answered"));
  assert.ok(assignmentRank("crm_receiver", "ringcentral_answered") > assignmentRank("first_attempts"));
  assert.equal(receiverRankKey("ringcentral_answered"), "ringcentral_answered");
  assert.equal(receiverRankKey("manual"), "crm_receiver");
  // A conversation displaces a RingCentral-answered receiver assignment, never a Granot one.
  assert.equal(mayReplaceAssignment(record(GRANOT_REP, "crm_receiver", "ringcentral_answered"), "first_conversation"), true);
  assert.equal(mayReplaceAssignment(record(GRANOT_REP, "crm_receiver", "granot_username_match"), "first_conversation"), false);
});

test("C4: the responsible rep follows receiver_agent unless the Owner assigned the record", () => {
  // Phone evidence and weaker automatic origins yield to the receiver.
  for (const origin of [null, "first_attempts", "inherited_outreach", "first_conversation", "rep_promise"])
    assert.equal(receiverAssignmentPlan(record(origin ? PHONE_REP : null, origin), granot), "follow", String(origin));
  // C13 / E26: an Owner assignment (or an Owner unassignment) is never overwritten by a Granot rep change.
  assert.equal(receiverAssignmentPlan(record(OWNER_PICK, "owner"), granot), null);
  assert.equal(receiverAssignmentPlan(record(null, "owner"), granot), null);
  // A legacy agent without an origin is of unknown strength: kept.
  assert.equal(receiverAssignmentPlan(record(PHONE_REP, null), granot), null);
  // A crm_receiver record tracks the receiver and its source; identical input is a no-op.
  assert.equal(receiverAssignmentPlan(record(GRANOT_REP, "crm_receiver", "granot_username_match"), granot), null);
  assert.equal(receiverAssignmentPlan(record(PHONE_REP, "crm_receiver", "granot_username_match"), granot), "follow", "Granot rep changed");
  assert.equal(receiverAssignmentPlan(record(GRANOT_REP, "crm_receiver", "ringcentral_answered"), granot), "follow", "same rep, stronger source");
  // Cleared receiver: a crm_receiver record falls back to phone evidence; anything else is untouched.
  assert.equal(receiverAssignmentPlan(record(GRANOT_REP, "crm_receiver", "granot_username_match"), { receiver_agent: null }), "fallback");
  assert.equal(receiverAssignmentPlan(record(PHONE_REP, "first_conversation"), { receiver_agent: null }), null);
  // E5: a RingCentral-answered receiver never displaces phone evidence.
  const answered = { receiver_agent: GRANOT_REP, receiver_agent_source: "ringcentral_answered" };
  assert.equal(receiverAssignmentPlan(record(PHONE_REP, "first_conversation"), answered), null);
  assert.equal(receiverAssignmentPlan(record(PHONE_REP, "first_attempts"), answered), "follow");
});

test("C4: follow-ups — inherited or unassigned actions follow the record; promises and Owner actions keep theirs", () => {
  const base = { responsible_agent_id: null, promised_by_agent_id: null, promise_chain: null, assignment: null };
  assert.equal(followsRecordRep({ ...base, origin: "system_default" }), true, "no agent, no origin");
  assert.equal(followsRecordRep({ ...base, origin: "customer_request", responsible_agent_id: PHONE_REP, assignment: { origin: "inherited_outreach" } }), true);
  assert.equal(followsRecordRep({ ...base, origin: "rep_promise", responsible_agent_id: PHONE_REP, promised_by_agent_id: PHONE_REP, assignment: { origin: "rep_promise" } }), false, "the promiser keeps it");
  assert.equal(followsRecordRep({ ...base, origin: "system_default", responsible_agent_id: PHONE_REP, promise_chain: { root_id: oid(), root_origin: "rep_promise", attempt: 1 },
    assignment: { origin: "inherited_outreach" } } as never), false, "a promise's retry stays with the promiser");
  assert.equal(followsRecordRep({ ...base, origin: "owner", responsible_agent_id: null, assignment: { origin: "inherited_outreach" } }), false, "Owner action");
  assert.equal(followsRecordRep({ ...base, origin: "customer_request", responsible_agent_id: OWNER_PICK, assignment: { origin: "owner" } }), false, "Owner-assigned action");
  assert.equal(followsRecordRep({ ...base, origin: "customer_request", responsible_agent_id: PHONE_REP, assignment: null }), false, "legacy agent without origin");
});

test("E4: only an outranking receiver blocks phone-evidence responsibility, and only with the flag", () => {
  withFlag(true, () => {
    assert.equal(receiverBlocksPhoneEvidence(granot, "first_conversation"), true);
    assert.equal(receiverBlocksPhoneEvidence({ receiver_agent: GRANOT_REP, receiver_agent_source: "manual" }, "rep_promise"), true);
    assert.equal(receiverBlocksPhoneEvidence({ receiver_agent: GRANOT_REP, receiver_agent_source: "ringcentral_answered" }, "first_conversation"), false);
    assert.equal(receiverBlocksPhoneEvidence({}, "rep_promise"), false);
    assert.equal(receiverBlocksPhoneEvidence(null, "rep_promise"), false);
  });
  withFlag(false, () => assert.equal(receiverBlocksPhoneEvidence(granot, "first_conversation"), false));
});

test("repair sweep: the receiver suffix only for recent receivers with the flag; off keeps today's key", () => {
  const lead = { _id: oid(), booked: null, cancelled: null, duplicate: false, bad_lead: null, no_sync: false,
    receiver_agent: GRANOT_REP, receiver_agent_source: "granot_username_match", receiver_agent_set_at: new Date(+NOW - 86_400_000) };
  const plain = { ...lead, receiver_agent: undefined, receiver_agent_source: undefined, receiver_agent_set_at: undefined };
  const off = withFlag(false, () => outreachRepairNomination("FormLead", lead, NOW)!);
  assert.equal(off.dedupe_key, withFlag(false, () => outreachRepairNomination("FormLead", plain, NOW)!).dedupe_key, "flag off: receiver never enters the key");
  withFlag(true, () => {
    const on = outreachRepairNomination("FormLead", lead, NOW)!;
    assert.equal(on.dedupe_key, `${off.dedupe_key}:receiver-v1:${GRANOT_REP}:granot_username_match`);
    assert.equal(on.input_revision, off.input_revision);
    assert.equal(outreachRepairNomination("FormLead", plain, NOW)!.dedupe_key, off.dedupe_key, "no receiver: today's key");
    const old = { ...lead, receiver_agent_set_at: new Date(+NOW - RECEIVER_REPAIR_WINDOW_MS - 1) };
    assert.equal(outreachRepairNomination("FormLead", old, NOW)!.dedupe_key, off.dedupe_key, "older than 90 days: today's key (no storm)");
    assert.notEqual(receiverRepairSuffix({ ...lead, receiver_agent: PHONE_REP }, NOW), receiverRepairSuffix(lead, NOW), "a rep change is a new key");
  });
});

test("E26 detail: the Lead's Receiver agent beside the Assigned rep", () => {
  assert.equal(receiverAgentDto(null), null);
  assert.equal(receiverAgentDto({ receiver_agent: null }), null);
  assert.deepEqual(receiverAgentDto({ receiver_agent: GRANOT_REP, receiver_agent_name_snapshot: "Jordan Bell", receiver_agent_source: "granot_username_match", receiver_agent_set_at: NOW }),
    { agent: { id: String(GRANOT_REP), name: "Jordan Bell" }, source: "granot_username_match", set_at: NOW.toISOString() });
  assert.deepEqual(receiverAgentDto({ receiver_agent: GRANOT_REP }), { agent: { id: String(GRANOT_REP), name: "Unknown Agent" }, source: null, set_at: null });
});

test("timeline: Rep changed in Granot: {old} → {new}", () => {
  const ctx: RenderContext = { timezone: "America/New_York", customer: "Maria Lopez", phone: "+17573180143", lead_count: 1 };
  const event = (detail: Record<string, unknown>): StoryEvent => ({ id: "receiver_agent_changed:c1", kind: "receiver_agent_changed" as StoryEventKind, happened_at: NOW.toISOString(),
    observed_at: NOW.toISOString(), subject_key: "lead:FormLead:64b000000000000000000001", actor: { kind: "granot", agent_id: null, name: null, identity_status: null },
    record: { record_type: "story_event", record_id: "receiver_agent_changed:c1" }, sentence: "", detail, evidence_refs: [] });
  const granotChange = event({ source_system: "granot", from: { agent_id: "a", name: "Jordan Bell" }, to: { agent_id: "b", name: "Sam Rivera" } });
  assert.equal(renderTimelineTitle(granotChange, ctx, NOW), "Rep changed in Granot: Jordan Bell → Sam Rivera");
  assert.equal(renderTimelineSentence(granotChange, ctx), "Rep changed in Granot: Jordan Bell → Sam Rivera.");
  assert.equal(renderTimelineTitle(event({ source_system: "ringcentral", from: { agent_id: null, name: null }, to: { agent_id: "b", name: "Sam Rivera" } }), ctx, NOW),
    "Receiver agent changed: none → Sam Rivera");
});
