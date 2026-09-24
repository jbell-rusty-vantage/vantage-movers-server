import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { timelineV2PageDtoSchema } from "../../numberActivity/dto";
import { readNumberTimelineV2 } from "../outreach/timelineRead";
import { assembleSubjectStory, resolveStorySubject } from "./assemble";
import { installFakeMongo } from "./fakeMongo.fixtures";
import { storyToReadContent } from "./page";
import { callCaptureState, isInProgressCall, modelCallEvent, OWNER_ONLY_CALL_DETAIL_KEYS } from "./sources";
import { buildS4TimelineDocs, S4_AS_OF, S4_E164, S4_IDS } from "./timeline.fixtures";

/**
 * S5c-CALLS (reconciliation addendum §3.1, G2; C16, C17) and the S5c-RECOVERY reader (§3.3, G4; C19)
 * over the S4 story documents in the in-memory Mongo fake:
 *
 * - the Owner timeline / Calls tab (`kinds[]=call`) shows a webhook-only in-progress call with
 *   `in_progress: true` and null result and duration, and the same call final after its settle;
 * - the model's story page drops it (`coverage.excluded_in_progress = 1`) and is otherwise
 *   byte-identical to the page without it, so a Number without an in-progress call is unchanged;
 * - `call_log_state: null` + `terminal: true` is final (C17); `observed_reason` is
 *   `recovered` / `late_capture` / null (C19).
 */
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID ||= "csi-local-proof";
const coverage = { known_through: S4_AS_OF.toISOString(), gaps: [], capabilities: {}, ai_paused: false };
const MIN = 60_000, HOUR = 60 * MIN;
const LIVE_ID = new mongoose.Types.ObjectId("64c5c5c5c5c5c5c5c5c5c5c5");

/** A webhook-only call on N2 that started 20 minutes before `as_of` and has not ended. */
function inProgressCall(template: Record<string, unknown>) {
  const started = new Date(+S4_AS_OF - 20 * MIN);
  return { ...template, _id: LIVE_ID, telephony_session_id: "s5c-live", direction: "Unknown", started_at: started, answered_at: null, ended_at: null,
    duration_seconds: null, provider_result: null, provider_connected: false, contact_type: "unknown", contact_type_basis: null, recordings: [],
    sources: ["webhook"], terminal: false, call_log_state: null, first_observed_at: new Date(+started + 5_000), last_observed_at: new Date(+started + 60_000),
    createdAt: new Date(+started + 5_000), updatedAt: new Date(+started + 60_000) };
}

async function modelPage(numberId: string, options: { purpose?: "model" | "owner" } = {}) {
  const subject = await resolveStorySubject({ contact_number_id: numberId, as_of: S4_AS_OF });
  assert.ok(subject);
  const story = await assembleSubjectStory(subject, options);
  return story;
}
const serialize = (story: Awaited<ReturnType<typeof modelPage>>) => JSON.stringify({ story, page: storyToReadContent(story, coverage) });

test("callCaptureState: the null rule (C17), in progress (C16) and the observed reason (C19)", () => {
  const started = new Date("2026-09-20T15:00:00.000Z");
  assert.deepEqual(callCaptureState({ started_at: started, first_observed_at: new Date(+started + 30_000), terminal: true, call_log_state: null }),
    { terminal: true, call_log_state: null, in_progress: false, observed_reason: null, capture_recovery: null }, "null + terminal is final");
  assert.equal(callCaptureState({ started_at: started }).terminal, true, "a row without `terminal` is final");
  assert.deepEqual(callCaptureState({ started_at: started, terminal: false, call_log_state: null }).in_progress, true);
  assert.deepEqual(callCaptureState({ started_at: started, terminal: false, call_log_state: "provisional" }).call_log_state, "provisional");
  assert.equal(callCaptureState({ started_at: started, call_log_state: "bogus" }).call_log_state, null);
  assert.equal(callCaptureState({ started_at: started, first_observed_at: new Date(+started + HOUR) }).observed_reason, null, "exactly one hour is not late");
  assert.equal(callCaptureState({ started_at: started, first_observed_at: new Date(+started + HOUR + 1) }).observed_reason, "late_capture");
  const recovered = callCaptureState({ started_at: started, first_observed_at: new Date(+started + 4 * 24 * HOUR),
    capture_recovery: { kind: "completed", at: new Date("2026-09-24T03:40:00.000Z") } });
  assert.equal(recovered.observed_reason, "recovered", "recovered wins over late_capture");
  assert.deepEqual(recovered.capture_recovery, { kind: "completed", at: "2026-09-24T03:40:00.000Z" });
  assert.equal(callCaptureState({ started_at: started, capture_recovery: { kind: "other", at: new Date() } }).capture_recovery, null);
});

test("modelCallEvent strips exactly the Owner-only keys and keeps the remaining detail order", () => {
  const detail = { interaction_id: "x", direction: "Inbound", provider_result: "Missed", duration_seconds: 0, terminal: true, call_log_state: null, in_progress: false,
    sources: ["webhook"], observed_reason: null, capture_recovery: null };
  const e = { id: "call:x", kind: "call" as const, happened_at: "2026-09-20T15:00:00.000Z", observed_at: "2026-09-20T15:00:00.000Z", subject_key: "number:y",
    actor: { kind: "customer" as const, agent_id: null, name: null, identity_status: null }, record: { record_type: "story_event" as const, record_id: "call:x" },
    sentence: "", detail, evidence_refs: [] };
  const stripped = modelCallEvent(e);
  assert.equal(JSON.stringify(stripped.detail), JSON.stringify({ interaction_id: "x", direction: "Inbound", provider_result: "Missed", duration_seconds: 0 }));
  assert.ok(OWNER_ONLY_CALL_DETAIL_KEYS.every(key => key in e.detail), "the input is not mutated");
  assert.equal(modelCallEvent(stripped), stripped, "already stripped: same object");
  assert.equal(isInProgressCall({ kind: "call", detail: { terminal: false } }), true);
  assert.equal(isInProgressCall({ kind: "call", detail: {} }), false);
  assert.equal(isInProgressCall({ kind: "conversation_recorded", detail: { terminal: false } }), false);
});

test("C16: an in-progress call is on the Owner timeline and Calls tab, off the model's story page; the page is otherwise byte-identical", async t => {
  const docs = buildS4TimelineDocs();
  installFakeMongo(t, docs);
  const n2 = String(S4_IDS.n2);
  const base = await modelPage(n2);
  assert.equal(base.coverage.excluded_in_progress, undefined, "no in-progress call: no coverage key");
  const baseBytes = serialize(base);
  assert.ok(base.events.some(e => e.kind === "call"), "the base page has calls");
  for (const e of base.events.filter(e => e.kind === "call")) assert.ok(OWNER_ONLY_CALL_DETAIL_KEYS.every(key => !(key in e.detail)), "no Owner-only key on the model page");

  const template = docs.calls.find(c => String(c.contact_number_id) === n2)!;
  docs.calls.push(inProgressCall(template));

  // Model page: excluded, counted, and everything else byte-identical (events, prose, digest, page records).
  const withLive = await modelPage(n2);
  assert.equal(withLive.coverage.excluded_in_progress, 1);
  assert.ok(!withLive.events.some(e => e.id === `call:${LIVE_ID}`));
  // The calls reader honestly counts the row it read (and dropped); nothing else differs.
  assert.equal(withLive.coverage.sources.calls!.read, base.coverage.sources.calls!.read + 1);
  delete withLive.coverage.excluded_in_progress;
  withLive.coverage.sources.calls!.read = base.coverage.sources.calls!.read;
  assert.equal(serialize(withLive), baseBytes, "the model page is the base page plus only `excluded_in_progress` (and the calls read count)");

  // Owner purpose keeps it, with its state.
  const owner = await modelPage(n2, { purpose: "owner" });
  const ownerCall = owner.events.find(e => e.id === `call:${LIVE_ID}`);
  assert.ok(ownerCall, "the Owner story keeps the in-progress call");
  assert.equal(ownerCall.detail.in_progress, true);

  // Owner timeline, Calls tab (kinds[]=call): the in-progress call is the newest, with null result and duration.
  const calls = await readNumberTimelineV2(n2, { kinds: ["call"], limit: 50 }, { now: () => S4_AS_OF, coverage });
  assert.ok(calls);
  assert.doesNotThrow(() => timelineV2PageDtoSchema.parse(calls));
  const live = calls.data.items[0]!;
  assert.equal(live.id, `call:${LIVE_ID}`);
  assert.deepEqual({ ...live.call, rep: null }, { interaction_id: String(LIVE_ID), direction: "Unknown", result: null, connected: false, contact_type: "unknown",
    duration_seconds: null, recording_count: 0, recording_state: "none", conversation_id: null, rep: null, terminal: false, call_log_state: null, in_progress: true,
    observed_reason: null });
  assert.equal(live.title, "Unknown call · In progress", "direction Unknown is passed through; no result or duration in the title");
  assert.equal(live.detail.in_progress, true);
  assert.equal(live.detail.duration_seconds, null);
  assert.deepEqual(live.detail.sources, ["webhook"]);

  // C17: a stored historical call (no call_log_state, terminal true) is final.
  const historical = calls.data.items[1]!;
  assert.deepEqual({ terminal: historical.call!.terminal, call_log_state: historical.call!.call_log_state, in_progress: historical.call!.in_progress },
    { terminal: true, call_log_state: null, in_progress: false });
  assert.ok(historical.call!.result !== null, "a final call keeps its result");

  // The settle: terminal, settled, the real direction, result and duration.
  const row = docs.calls.find(c => String(c._id) === String(LIVE_ID))!;
  Object.assign(row, { terminal: true, call_log_state: "settled", direction: "Inbound", provider_result: "Call connected", provider_connected: true, duration_seconds: 540,
    ended_at: new Date(+S4_AS_OF - 11 * MIN), sources: ["webhook", "call_log_reconcile"] });
  const settled = (await readNumberTimelineV2(n2, { kinds: ["call"], limit: 5 }, { now: () => S4_AS_OF, coverage }))!.data.items[0]!;
  assert.deepEqual({ result: settled.call!.result, duration: settled.call!.duration_seconds, in_progress: settled.call!.in_progress, state: settled.call!.call_log_state,
    direction: settled.call!.direction }, { result: "Call connected", duration: 540, in_progress: false, state: "settled", direction: "Inbound" });
  assert.equal(settled.title, "Inbound call · Call connected · 9 min");
  const afterSettle = await modelPage(n2);
  assert.equal(afterSettle.coverage.excluded_in_progress, undefined);
  assert.ok(afterSettle.events.some(e => e.id === `call:${LIVE_ID}`), "after the settle the model reads it, as a final call");
  assert.ok(!(afterSettle.events.find(e => e.id === `call:${LIVE_ID}`)!.detail as Record<string, unknown>).terminal, "still without Owner-only keys");
});

test("C19: the timeline call's observed_reason is recovered, late_capture or null", async t => {
  const docs = buildS4TimelineDocs();
  installFakeMongo(t, docs);
  const n1 = String(S4_IDS.n1);
  const onN1 = docs.calls.filter(c => String(c.contact_number_id) === n1 && c.telephony_session_id !== "s4-legacy");
  const late = onN1.find(c => +(c.first_observed_at as Date) - +(c.started_at as Date) > HOUR)!;
  const prompt = onN1.find(c => +(c.first_observed_at as Date) - +(c.started_at as Date) < HOUR && c !== late)!;
  const recovered = onN1.find(c => c !== late && c !== prompt)!;
  recovered.capture_recovery = { run_id: "6ab499c0863c39d275413729", at: new Date("2026-09-22T03:40:00.000Z"), kind: "added" };
  const items = [];
  let cursor: string | undefined;
  do {
    const page = (await readNumberTimelineV2(n1, { kinds: ["call"], limit: 200, cursor }, { now: () => S4_AS_OF, coverage }))!;
    items.push(...page.data.items); cursor = page.data.cursor ?? undefined;
  } while (cursor);
  const byId = new Map(items.map(i => [i.id, i]));
  const reasonOf = (row: Record<string, unknown>) => byId.get(`call:${row._id}`)!.call!.observed_reason;
  assert.equal(reasonOf(late), "late_capture");
  assert.equal(reasonOf(prompt), null);
  assert.equal(reasonOf(recovered), "recovered");
  assert.deepEqual(byId.get(`call:${recovered._id}`)!.detail.capture_recovery, { kind: "added", at: "2026-09-22T03:40:00.000Z" });
  // The model's page never carries the recovery keys.
  const story = await modelPage(n1);
  for (const e of story.events.filter(e => e.kind === "call")) assert.ok(!("capture_recovery" in e.detail) && !("observed_reason" in e.detail));
  assert.ok(S4_E164.n1);
});
