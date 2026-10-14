import assert from "node:assert/strict";
import { test } from "node:test";
import { isMetricEntityChange, metricEntityChangeHint } from "./repMetrics";
import { outreachCombinedWatchPipeline, outreachLiveFrame, outreachLiveHint } from "./stream";
import { salesOutreachLiveFrameSchema } from "../../../validation/v1/salesOutreachReads";
const A = "aaaaaaaaaaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbbbbbbbbbb", C = "cccccccccccccccccccccccc", ID = "dddddddddddddddddddddddd";
const change = (model: string, paths: string[], fields: unknown[] = []) => ({ operationType: "insert", ns: { coll: "entity_changes" }, fullDocument: { entity: { model, id: ID }, changed_paths: paths, fields, provenance: { secret: "discard" } } });
const field = (path: string, before: unknown, after: unknown) => ({ path, value_mode: "stored", before, after });

test("committed allocation and amount/date changes refresh allocation owners plus current assigned rep, with Rep isolation", async () => {
  const event = change("BookedLead", ["agent_allocations", "book_date", "total_binder_amount"], [field("agent_allocations", [{ agent: A, binder_amount: 50 }], [{ agent: B, binder_amount: 90 }])]);
  for (const agent of [A, B, C]) {
    const hint = await metricEntityChangeHint(event, { role: "rep", agent_id: agent }, async () => [B, C]);
    assert.deepEqual(hint, { topic: "outreach_rep_metrics", subject_ids: [], agent_ids: [agent], business_day: null, revision: null });
  }
  assert.equal(await metricEntityChangeHint(event, { role: "rep", agent_id: ID }, async () => [B, C]), null);
  const hint = await metricEntityChangeHint(event, { role: "owner", agent_id: null }, async () => [B, C]);
  assert.deepEqual(hint?.agent_ids, [A, B, C]);
  assert.deepEqual(Object.keys(hint!).sort(), ["agent_ids", "business_day", "revision", "subject_ids", "topic"]);
});

test("canonical reassignment invalidates previous/current receivers and preserves same connection hint contract", async () => {
  const event = change("FormLead", ["receiver_agent"], [field("receiver_agent", A, B)]);
  for (const agent of [A, B]) {
    const hint = await metricEntityChangeHint(event, { role: "rep", agent_id: agent }, async () => [B]);
    assert.deepEqual(outreachLiveHint({ fullDocument: hint }, { role: "rep", agent_id: agent }), hint);
    const frame = salesOutreachLiveFrameSchema.parse(outreachLiveFrame("change", [hint!], new Date("2026-10-13T15:00:00Z")));
    assert.deepEqual(frame.topics, ["outreach_rep_metrics"]);
    assert.equal(frame.refetch, "scoped");
  }
  assert.equal(await metricEntityChangeHint(event, { role: "rep", agent_id: C }, async () => [B]), null);
});

test("delete/cancellation safely refetch only viewer scope when no before values exist; unrelated domain changes dropped", async () => {
  for (const event of [change("BookedLead", ["$deleted"]), change("CallLead", ["$deleted"]), change("CancelledLead", ["booked_lead"])]) {
    const hint = await metricEntityChangeHint(event, { role: "rep", agent_id: A }, async () => { throw new Error("unneeded lookup"); });
    assert.deepEqual(hint?.agent_ids, [A]);
    assert.deepEqual(hint?.subject_ids, []);
  }
  assert.equal(isMetricEntityChange(change("FormLead", ["name"])), false);
  assert.equal(isMetricEntityChange(change("GranotRecordLink", ["lead_ref"])), false);
  assert.equal(await metricEntityChangeHint(change("FormLead", ["email"]), { role: "owner", agent_id: null }), null);
  const pipeline = JSON.stringify(outreachCombinedWatchPipeline({ role: "rep", agent_id: A }, "sales_outreach_live_events"));
  assert.match(pipeline, /entity_changes/);
  assert.match(pipeline, /operationType.*insert/);
  assert.match(pipeline, /fullDocument\.agent_ids/);
  assert.doesNotMatch(pipeline, /provenance|phone|customer_name/);
});
