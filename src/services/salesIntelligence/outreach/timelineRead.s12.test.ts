import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { getOwnerRepNudgeModel } from "../../../models/OwnerRepNudge";
import type { TimelineV2EventDto } from "../../numberActivity/dto";
import { installFakeMongo } from "../story/fakeMongo.fixtures";
import { REP_ACTION_KINDS, resolveRepActions, TIMELINE_KINDS, timelineKindOrder, type RepActionReaders } from "../story/sources";
import { buildS4TimelineDocs, S4_AS_OF, S4_IDS } from "../story/timeline.fixtures";
import type { StoryEvent, StoryEventKind } from "../story/types";
import { nudgeFoldFilter, readOutreachTimeline, redactOwnerTextForRep, repWording, storyEventToTimelineDto, timelineV2QuerySchema } from "./timelineRead";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";

/**
 * S12-REPACT (UI-2 §9, A09) and S12-REPNUDGE (UI-2 §5 server, A10): a rep's own follow-up commands named on the timeline with
 * the rep's note, and a rep's timeline keeping only the Owner's nudges addressed to it. Pure adapter checks, the batched
 * resolver with injected readers, and the real readers over the deterministic S4 documents (in-memory Mongo fake).
 */
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID ||= "csi-local-proof";
const now = () => S4_AS_OF;
// Compiled before `installFakeMongo` replaces `connection.collection` (a model compiles against it).
getOwnerRepNudgeModel();
const coverage = { known_through: S4_AS_OF.toISOString(), gaps: [], capabilities: {}, ai_paused: false };
const AGENT_DANA = "6ab5ab0d72ee2eb383d940a7", AGENT_MARCUS = "6ab5ab0d72ee2eb383d940a8", AGENT_GONE = "6ab5ab0d72ee2eb383d940ff";
const render = { timezone: "America/New_York", customer: "Maria Lopez", phone: "+13055550101", lead_count: 1 };
const ctx = { scope: "outreach" as const, number_id: null, outreach_id: String(S4_IDS.recordA), as_of: S4_AS_OF, render, job_no_by_lead: null };
const KEY = `lead:FormLead:${S4_IDS.leadA}`;

const make = (kind: string, id: string, happened_at: string, detail: Record<string, unknown>, actor: Partial<StoryEvent["actor"]> = {}): StoryEvent => ({
  id: `${kind}:${id}`, kind: kind as StoryEventKind, happened_at, observed_at: happened_at, subject_key: KEY,
  actor: { kind: "rep", agent_id: null, name: null, identity_status: null, ...actor }, record: { record_type: "story_event", record_id: `${kind}:${id}` },
  sentence: "", detail, evidence_refs: [] });

test("S12-REPACT adapter: the three rep kinds are Work events, not routine, titled with the rep and described by the rep's note", () => {
  assert.ok(TIMELINE_KINDS.includes("followup_redated"), "the new kind is a timeline kind (the kinds[] filter accepts it)");
  assert.equal(timelineKindOrder("followup_redated"), 9);
  assert.deepEqual([...REP_ACTION_KINDS].sort(), ["followup_completed", "followup_redated", "followup_snoozed"]);
  assert.deepEqual(timelineV2QuerySchema.parse({ kinds: "followup_redated" }).kinds, ["followup_redated"]);
  const dana = { agent_id: AGENT_DANA, name: "Dana Reyes" };
  const redated = storyEventToTimelineDto(make("followup_redated", "r1", "2026-09-20T15:00:00.000Z", { due_at: "2026-09-28T13:00:00.000Z", note: "Customer asked for Monday" }, dana), ctx);
  const snoozed = storyEventToTimelineDto(make("followup_snoozed", "s1", "2026-09-20T14:00:00.000Z", { until: "2026-09-26T22:00:00.000Z", note: "Customer is at work until Friday" }, dana), ctx);
  const completed = storyEventToTimelineDto(make("followup_completed", "c1", "2026-09-20T16:00:00.000Z", { description: "Call back", completion_basis: "rep_confirmation", note: "Spoke, sending the estimate" }, dana), ctx);
  assert.deepEqual([redated.title, redated.description], ["Dana Reyes moved the follow-up to Sep 28, 9:00 AM ET", "Customer asked for Monday"]);
  assert.deepEqual([snoozed.title, snoozed.description], ["Dana Reyes snoozed until Sep 26, 6:00 PM ET", "Customer is at work until Friday"]);
  assert.deepEqual([completed.title, completed.description], ["Dana Reyes completed the follow-up", "Spoke, sending the estimate"]);
  for (const dto of [redated, snoozed, completed]) {
    assert.equal(dto.group, "work", dto.kind); assert.equal(dto.routine, false, dto.kind);
    assert.deepEqual(dto.actor, { kind: "rep", agent_id: AGENT_DANA, name: "Dana Reyes" });
  }
  // Rep audience: the rep's own notes are not Owner free text, so they show.
  for (const e of [make("followup_redated", "r1", "2026-09-20T15:00:00.000Z", { due_at: "2026-09-28T13:00:00.000Z", note: "Customer asked for Monday" }, dana)]) {
    assert.equal(storyEventToTimelineDto(redactOwnerTextForRep(e), ctx).description, "Customer asked for Monday");
  }
  // A rep whose Agent couldn't be read: `A rep`.
  const unnamed = storyEventToTimelineDto(make("followup_redated", "r2", "2026-09-20T15:00:00.000Z", { due_at: "2027-01-04T15:00:00.000Z", note: null }, { agent_id: AGENT_GONE }), ctx);
  assert.deepEqual([unnamed.title, unnamed.description], ["A rep moved the follow-up to Jan 4, 2027, 10:00 AM ET", "The follow-up was moved to Mon Jan 4, 2027 at 10:00 AM ET."]);
});

test("S12-REPACT adapter: the Owner's own snooze and a completion without a rep command keep today's rendering", () => {
  const ownerSnooze = storyEventToTimelineDto(make("followup_snoozed", "o1", "2026-09-20T15:00:00.000Z", { until: "2027-01-04T15:00:00.000Z", reason: "customer travelling" },
    { kind: "owner", agent_id: "owner@example.test" }), ctx);
  assert.equal(ownerSnooze.title, "Snoozed until Jan 4, 2027, 10:00 AM ET");
  assert.equal(ownerSnooze.description, "The follow-up was snoozed until Mon Jan 4, 2027 at 10:00 AM ET: customer travelling.");
  // `resolveRepActions` found no command row: the actor stays anonymous and the title is today's.
  const legacy = storyEventToTimelineDto(make("followup_completed", "c9", "2026-09-20T16:00:00.000Z", { description: "Call back", completion_basis: "rep_confirmation" }), ctx);
  assert.equal(legacy.title, "Follow-up completed · rep confirmed");
  assert.equal(legacy.description, "That follow-up (\"Call back\") was completed (rep confirmed).");
});

function readers(notes: Array<{ subject_key: string; happened_at: Date; event_kind: string; current?: unknown }>, agents: Record<string, string>) {
  const calls = { notes: 0, agents: 0, agentIds: [] as string[] };
  const value: RepActionReaders = {
    notes: async () => { calls.notes++; return notes; },
    agents: async ids => { calls.agents++; calls.agentIds.push(...ids); return new Map(ids.flatMap(id => (agents[id] ? [[id, agents[id]!] as const] : []))); },
  };
  return { value, calls };
}

test("S12-REPACT resolver: one note read and one Agent read per page; the rep named from its Agent, `A rep` when missing; no read without a rep action", async () => {
  const T1 = "2026-09-20T15:00:00.000Z", T2 = "2026-09-20T16:00:00.000Z", T3 = "2026-09-20T17:00:00.000Z";
  const events = [
    make("followup_redated", "r1", T1, { due_at: "2026-09-28T13:00:00.000Z" }, { agent_id: AGENT_DANA }),
    make("followup_completed", "c1", T2, { completion_basis: "rep_confirmation" }),
    make("followup_snoozed", "s1", T3, { until: "2026-09-26T22:00:00.000Z" }, { agent_id: AGENT_GONE }),
    make("followup_completed", "c2", "2026-09-19T10:00:00.000Z", { completion_basis: "rep_confirmation" }),
    make("call", "x1", T1, {}, { agent_id: AGENT_MARCUS, name: "Marcus Bell" }),
  ];
  const { value, calls } = readers([
    { subject_key: KEY, happened_at: new Date(T1), event_kind: "patch_followup", current: { note: "Customer asked for Monday", rep_agent_id: AGENT_DANA } },
    { subject_key: KEY, happened_at: new Date(T2), event_kind: "complete_followup", current: { note: "Spoke, sending the estimate", rep_agent_id: AGENT_DANA } },
    { subject_key: KEY, happened_at: new Date(T3), event_kind: "snooze_followup", current: { note: "At work", rep_agent_id: AGENT_GONE } },
  ], { [AGENT_DANA]: "Dana Reyes" });
  const out = await resolveRepActions(events, value);
  assert.deepEqual(calls, { notes: 1, agents: 1, agentIds: [AGENT_DANA, AGENT_GONE] });
  assert.deepEqual(out.map(e => [e.kind, e.actor.agent_id, e.actor.name, e.detail.note ?? null]), [
    ["followup_redated", AGENT_DANA, "Dana Reyes", "Customer asked for Monday"],
    ["followup_completed", AGENT_DANA, "Dana Reyes", "Spoke, sending the estimate"],
    ["followup_snoozed", AGENT_GONE, null, "At work"],
    // A rep completion with no command row (not the rep path) is left as it was.
    ["followup_completed", null, null, null],
    ["call", AGENT_MARCUS, "Marcus Bell", null],
  ]);
  assert.equal(storyEventToTimelineDto(out[2]!, ctx).title, "A rep snoozed until Sep 26, 6:00 PM ET");
  const none = readers([], {});
  assert.deepEqual(await resolveRepActions([events[4]!], none.value), [events[4]!]);
  assert.deepEqual(none.calls, { notes: 0, agents: 0, agentIds: [] }, "a page without a rep action costs no read");
});

/** The S4 documents plus Dana's three commands on record A (as `applyRepCommandInTransaction` writes them) and two nudges. */
function s12Docs() {
  const docs = buildS4TimelineDocs();
  const oid = (hex: string) => new mongoose.Types.ObjectId(hex);
  const F = oid("6ab5ab1472ee2eb383d9458c"), record = S4_IDS.recordA;
  const T = { snooze: new Date("2026-09-22T14:00:00.000Z"), redate: new Date("2026-09-22T15:00:00.000Z"), complete: new Date("2026-09-22T16:00:00.000Z") };
  const due = new Date("2026-09-28T13:00:00.000Z"), until = new Date("2026-09-26T22:00:00.000Z");
  const followup = { _id: F, commitment_key: "s12:dana", outreach_record_id: record, kind: "call", description: "Owner promised the customer a callback", status: "completed",
    due_at: due, origin: "owner", source_finding_ids: [], completion_basis: "rep_confirmation", completed_at: T.complete, completed_by: "rep-user-dana",
    responsible_agent_id: oid(AGENT_DANA), cancel_reason: null, revision: 4, createdAt: new Date("2026-09-21T12:00:00.000Z"), updatedAt: T.complete };
  (docs.followups as Record<string, unknown>[]).push(followup);
  let n = 0;
  const pair = (command: string, at: Date, current: Record<string, unknown>, note: string) => {
    const actor = { kind: "rep", id: "rep-user-dana", request_id: `s12-${++n}`, run_id: null };
    (docs.audits as Record<string, unknown>[]).push(
      { _id: new mongoose.Types.ObjectId(), semantic_key: `s12:f:${n}`, subject_key: KEY, event_kind: command, happened_at: at, recorded_at: at, prior: { status: "open" },
        current: { ...followup, status: command === "complete_followup" ? "completed" : "open", ...current }, actor, invalidation: { kind: "followup", target_id: String(F) }, revision: n + 1 },
      { _id: new mongoose.Types.ObjectId(), semantic_key: `s12:o:${n}`, subject_key: KEY, event_kind: command, happened_at: at, recorded_at: at, prior: { state: "open" },
        current: { state: "open", note, rep_agent_id: AGENT_DANA }, actor, invalidation: { kind: "outreach", target_id: String(record) }, revision: n + 10 });
  };
  pair("snooze_followup", T.snooze, { snoozed_until: until }, "Customer is at work until Friday");
  pair("patch_followup", T.redate, { due_at: due, snoozed_until: null, date_text: "Monday morning" }, "Customer asked for Monday");
  pair("complete_followup", T.complete, {}, "Spoke, sending the estimate");
  // Two Owner nudges on record A: one to Dana, one to Marcus; each writes an `authorized` and a `sent` audit row (the send path).
  const nudges = [{ _id: oid("6ab5ab2072ee2eb383d95001"), agent_id: oid(AGENT_DANA), at: new Date("2026-09-22T11:00:00.000Z") },
    { _id: oid("6ab5ab2072ee2eb383d95002"), agent_id: oid(AGENT_MARCUS), at: new Date("2026-09-22T11:30:00.000Z") },
    { _id: oid("6ab5ab2072ee2eb383d95003"), agent_id: null, at: new Date("2026-09-22T11:45:00.000Z") }];
  for (const nudge of nudges) for (const [event_kind, offset] of [["nudge.authorized", 0], ["nudge_sent", 2000]] as const)
    (docs.audits as Record<string, unknown>[]).push({ _id: new mongoose.Types.ObjectId(), semantic_key: `s12:n:${String(nudge._id)}:${event_kind}`, subject_key: KEY, event_kind,
      happened_at: new Date(+nudge.at + offset), recorded_at: new Date(+nudge.at + offset), prior: { status: "pending" }, current: { status: "sent", nudge_id: String(nudge._id) },
      actor: { kind: "owner", id: "owner-user", request_id: "n", run_id: null }, invalidation: { kind: "nudge", target_id: String(nudge._id) }, revision: 1 });
  return { docs, nudges, followup: String(F) };
}

/** Serves `agents` (raw) and `owner_rep_nudges` (model) on top of the S4 fake. */
function serveExtras(t: TestContext, agents: Array<{ _id: mongoose.Types.ObjectId; name: string }>, nudges: Array<{ _id: mongoose.Types.ObjectId; agent_id: mongoose.Types.ObjectId | null }>) {
  const nudgeModel = getOwnerRepNudgeModel();
  const connection = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const previous = connection.collection.bind(connection);
  const reads = { agents: 0, nudges: 0 };
  t.mock.method(connection, "collection", ((name: string) => name === "agents"
    ? { find: (filter: { _id: { $in: mongoose.Types.ObjectId[] } }) => ({ toArray: async () => { reads.agents++; return agents.filter(a => filter._id.$in.some(id => id.equals(a._id))); } }) }
    : previous(name)) as never);
  t.mock.method(nudgeModel, "find", ((filter: { agent_id: mongoose.Types.ObjectId }) => {
    const chain = { select: () => chain, limit: () => chain, lean: async () => { reads.nudges++; return nudges.filter(n => n.agent_id?.equals(filter.agent_id)).map(n => ({ _id: n._id })); } };
    return chain;
  }) as never);
  return reads;
}

async function pageAll(read: (cursor: string | undefined, limit: number) => Promise<{ items: TimelineV2EventDto[]; cursor: string | null } | null>, limit: number) {
  const items: TimelineV2EventDto[] = [];
  let cursor: string | undefined;
  for (;;) { const page = await read(cursor, limit); assert.ok(page); items.push(...page.items); if (!page.cursor) return items; cursor = page.cursor; }
}
const reader = (opts: Record<string, unknown>) => (cursor: string | undefined, limit: number) =>
  readOutreachTimeline(String(S4_IDS.recordA), { cursor, limit, ...opts }, { now, coverage }).then(page => page?.data ?? null);
const keys = (items: TimelineV2EventDto[]) => items.map(e => `${e.kind}:${e.id}`);

test("S12-REPACT (real readers): Dana's re-date, snooze and completion are three Work events on the Owner's timeline with her name and notes; her own timeline shows her notes", async t => {
  const { docs, nudges, followup } = s12Docs();
  installFakeMongo(t, docs);
  const reads = serveExtras(t, [{ _id: new mongoose.Types.ObjectId(AGENT_DANA), name: "Dana Reyes" }], nudges);
  const owner = await pageAll(reader({}), 200);
  const rep = owner.filter(e => e.actor.kind === "rep" && REP_ACTION_KINDS.has(e.kind) && (e.detail.followup_id === followup || e.id === `followup_completed:${followup}`));
  assert.deepEqual(rep.map(e => [e.kind, e.group, e.routine, e.title, e.description]), [
    ["followup_completed", "work", false, "Dana Reyes completed the follow-up", "Spoke, sending the estimate"],
    ["followup_redated", "work", false, "Dana Reyes moved the follow-up to Sep 28, 9:00 AM ET", "Customer asked for Monday"],
    ["followup_snoozed", "work", false, "Dana Reyes snoozed until Sep 26, 6:00 PM ET", "Customer is at work until Friday"],
  ]);
  assert.ok(rep.every(e => e.actor.agent_id === AGENT_DANA && e.actor.name === "Dana Reyes"));
  // One event per command: the record audit rows of Dana's commands are not events of their own.
  assert.equal(owner.filter(e => e.detail.event_kind && String(e.detail.actor) === "rep-user-dana").length, 2, "the snooze and the re-date (the completion is the follow-up row's)");
  // The fixture's Owner snoozes keep today's title.
  assert.ok(owner.filter(e => e.kind === "followup_snoozed" && e.actor.kind !== "rep").every(e => e.title.startsWith("Snoozed until") || e.title === "Follow-up snoozed"));
  // Exact paging holds with the new kind: limit 7 = pages of 200.
  assert.deepEqual(keys(await pageAll(reader({}), 7)), keys(owner));
  // The kinds filter reaches the new kind.
  assert.deepEqual(keys(await pageAll(reader({ kinds: ["followup_redated"] }), 50)), keys(owner.filter(e => e.kind === "followup_redated")));
  // Dana's own timeline: the same three events, with her notes.
  const mine = await pageAll(reader({ audience: "rep", rep_agent_id: AGENT_DANA }), 200);
  assert.deepEqual(mine.filter(e => rep.some(r => r.id === e.id)).map(e => e.description), rep.map(e => e.description));
  assert.ok(reads.agents >= 1);
});

test("S12-REPACT (real readers): a rep Agent that can't be read is `A rep`", async t => {
  const { docs, nudges } = s12Docs();
  installFakeMongo(t, docs);
  serveExtras(t, [], nudges);
  const owner = await pageAll(reader({ kinds: ["followup_redated", "followup_snoozed", "followup_completed"] }), 200);
  const titles = owner.filter(e => e.actor.agent_id === AGENT_DANA).map(e => e.title);
  assert.deepEqual(titles, ["A rep completed the follow-up", "A rep moved the follow-up to Sep 28, 9:00 AM ET", "A rep snoozed until Sep 26, 6:00 PM ET"]);
});

test("S12-REPNUDGE (real readers): Dana's timeline keeps only her nudge's events, Marcus's only his, the Owner both; an unresolved recipient is hidden; paging stays exact", async t => {
  const { docs, nudges } = s12Docs();
  installFakeMongo(t, docs);
  const reads = serveExtras(t, [{ _id: new mongoose.Types.ObjectId(AGENT_DANA), name: "Dana Reyes" }], nudges);
  const [toDana, toMarcus, toNobody] = nudges.map(n => String(n._id));
  const nudgeTargets = (items: TimelineV2EventDto[]) => [...new Set(items.filter(e => e.kind === "nudge_sent").map(e => String(e.detail.target_id)))].sort();
  const owner = await pageAll(reader({}), 200);
  assert.deepEqual(nudgeTargets(owner).filter(id => [toDana, toMarcus, toNobody].includes(id)), [toDana, toMarcus, toNobody].sort());
  const dana = await pageAll(reader({ audience: "rep", rep_agent_id: AGENT_DANA }), 200);
  const marcus = await pageAll(reader({ audience: "rep", rep_agent_id: AGENT_MARCUS }), 200);
  assert.deepEqual(nudgeTargets(dana), [toDana], "Dana: her nudge only (the fixture's other nudge rows and Marcus's are dropped)");
  assert.deepEqual(nudgeTargets(marcus), [toMarcus]);
  assert.equal(dana.filter(e => e.kind === "nudge_sent").length, 1, "one event per nudge (its authorized and sent rows fold into the newest)");
  assert.equal(owner.filter(e => e.kind === "nudge_sent" && [toDana, toMarcus, toNobody].includes(String(e.detail.target_id))).length, 3, "the Owner: one per nudge");
  const danaEvent = dana.find(e => e.kind === "nudge_sent")!;
  assert.equal(danaEvent.detail.event_kind, "nudge_sent", "the newest state's row");
  assert.equal(danaEvent.happened_at, new Date(+nudges[0]!.at + 2000).toISOString(), "the newest state's time");
  // Owner free text stays blanked on the rep's nudge events; no Owner note reaches a rep.
  assert.ok(dana.filter(e => e.kind === "nudge_sent").every(e => e.detail.current === null && e.detail.prior === null));
  assert.equal(dana.filter(e => e.kind === "owner_note").length, 0);
  // Exact paging over the filtered stream.
  assert.deepEqual(keys(await pageAll(reader({ audience: "rep", rep_agent_id: AGENT_DANA }), 7)), keys(dana));
  // Dana's stream = the Owner's minus Owner notes and every nudge event not addressed to her.
  assert.deepEqual(keys(dana).filter(k => !k.startsWith("followup_")), keys(owner.filter(e => e.kind !== "owner_note" && (e.kind !== "nudge_sent" || String(e.detail.target_id) === toDana))).filter(k => !k.startsWith("followup_")));
  // Asking for nudges only: hers.
  assert.deepEqual(nudgeTargets(await pageAll(reader({ audience: "rep", rep_agent_id: AGENT_DANA, kinds: ["nudge_sent"] }), 50)), [toDana]);
  assert.ok(reads.nudges >= 1);
});

test("S12-REPNUDGE fold: three audit rows of one nudge → one nudge_sent event (the newest); two nudges → two; other kinds and unread rows pass", async t => {
  const nudgeA = "5eed12000000000000000001", nudgeB = "5eed12000000000000000002";
  // Newest first, as the read sorts: A's sent, B's sent, A's submission_started, B's authorized, A's authorized.
  const rows = [["aa0000000000000000000003", nudgeA], ["bb0000000000000000000002", nudgeB], ["aa0000000000000000000002", nudgeA],
    ["bb0000000000000000000001", nudgeB], ["aa0000000000000000000001", nudgeA]].map(([id, target]) => ({ _id: new mongoose.Types.ObjectId(id), invalidation: { target_id: target } }));
  const seen: unknown[] = [];
  t.mock.method(getSalesIntelligenceAuditEventModel(), "find", ((filter: unknown) => {
    seen.push(filter);
    const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => rows };
    return chain;
  }) as never);
  const keep = await nudgeFoldFilter([KEY]);
  assert.deepEqual(seen, [{ subject_key: { $in: [KEY] }, "invalidation.kind": "nudge" }]);
  const nudgeEvent = (auditId: string) => make("nudge_sent", auditId, "2026-09-22T11:00:00.000Z", {}, { kind: "owner" });
  const kept = rows.map(row => String(row._id)).filter(id => keep(nudgeEvent(id)));
  assert.deepEqual(kept, ["aa0000000000000000000003", "bb0000000000000000000002"], "one event per nudge, its newest row");
  assert.equal(rows.filter(row => row.invalidation.target_id === nudgeA).map(row => String(row._id)).filter(id => keep(nudgeEvent(id))).length, 1, "3 rows for one nudge → 1");
  assert.equal(keep(make("owner_note", "x1", "2026-09-22T11:00:00.000Z", {}, { kind: "owner" })), true, "other kinds pass");
  assert.equal(keep(nudgeEvent("cc0000000000000000000009")), true, "a row the fold didn't read (beyond the cap) is kept");
  assert.equal((await nudgeFoldFilter([]))(nudgeEvent("aa0000000000000000000001")), true, "no subject keys: no read, nothing folded");
  assert.equal(seen.length, 1);
});

test("UI-2: a rep reads the Owner's timeline titles as the Owner's (You corrected → The Owner corrected)", () => {
  assert.deepEqual(repWording({ title: "You corrected status", description: "Confirmed by you · Exact" }), { title: "The Owner corrected status", description: "Confirmed by the Owner · Exact" });
  assert.deepEqual(repWording({ title: "Dana Reyes completed the follow-up", description: null }), { title: "Dana Reyes completed the follow-up", description: null });
});
