import assert from "node:assert/strict";
import { test } from "node:test";
import { publishOutreachLive, toLiveDocs, type OutreachLiveDoc } from "./publish";
import { liveWatchPipeline, outreachLiveHint } from "./stream";

/**
 * SRV-8 `GET /live` units: the after-commit publish helper (bounded ids-only documents, never throws),
 * the server-side Rep scope (change-stream pipeline + in-process re-filter + own-Agent-only hints),
 * the frame shapes and version negotiation.
 */

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const S = "5".repeat(24);

test("publish: ids and revisions only, bounded chunks, invalid ids dropped, and a failing insert never throws", async () => {
  const many = Array.from({ length: 150 }, (_, i) => i.toString(16).padStart(24, "0"));
  const docs = toLiveDocs([
    { topic: "outreach_desk", subject_ids: [...many, "nope", null], agent_ids: [A, A, null, B], revision: 3, cause: "evaluation" },
    { topic: "outreach_configuration", revision: 9, cause: "configuration" },
  ]);
  assert.deepEqual(docs.map((d) => [d.topic, d.subject_ids.length, d.agent_ids]), [
    ["outreach_desk", 100, [A, B]],
    ["outreach_desk", 50, [A, B]],
    ["outreach_configuration", 0, []],
  ]);
  for (const doc of docs) assert.deepEqual(Object.keys(doc).sort(), ["agent_ids", "business_day", "cause", "revision", "subject_ids", "topic"]);
  const written: OutreachLiveDoc[][] = [];
  await publishOutreachLive({ topic: "outreach_goal", agent_ids: [A], business_day: "2026-10-05", cause: "rep_day" }, async (d) => {
    written.push([...d]);
  });
  assert.equal(written[0]![0]!.business_day, "2026-10-05");
  await publishOutreachLive({ topic: "outreach_desk", subject_ids: [S], cause: "command" }, async () => {
    throw new Error("db down");
  });
  // No live connection in unit tests: the default publisher is a no-op, never a 10-second buffer.
  const started = Date.now();
  await publishOutreachLive({ topic: "outreach_desk", subject_ids: [S], cause: "command" });
  assert.ok(Date.now() - started < 1000);
});

const change = (doc: Record<string, unknown>) => ({ operationType: "insert", fullDocument: doc, documentKey: { _id: "x" }, ns: { coll: "sales_outreach_live_events" } });

test("scope: a Rep receives only events naming its Agent (and configuration), and only its own Agent id; Owner/Manager receive all", () => {
  const desk = change({ topic: "outreach_desk", subject_ids: [S], agent_ids: [A, B], revision: 2, business_day: null });
  assert.deepEqual(outreachLiveHint(desk, { role: "rep", agent_id: A }), { topic: "outreach_desk", subject_ids: [S], agent_ids: [A], business_day: null, revision: 2 });
  assert.equal(outreachLiveHint(change({ topic: "outreach_goal", agent_ids: [B], business_day: "2026-10-05" }), { role: "rep", agent_id: A }), null);
  assert.deepEqual(outreachLiveHint(change({ topic: "outreach_configuration", revision: 7 }), { role: "rep", agent_id: A })?.agent_ids, []);
  assert.deepEqual(outreachLiveHint(desk, { role: "manager", agent_id: null })?.agent_ids, [A, B]);
  assert.equal(outreachLiveHint(change({ topic: "unknown_topic" }), { role: "owner", agent_id: null }), null);
  assert.equal(outreachLiveHint({ fullDocument: null }, { role: "owner", agent_id: null }), null);
  // Customer data that somehow reached a row is never forwarded.
  const leaked = outreachLiveHint(change({ topic: "outreach_desk", subject_ids: [S], agent_ids: [A], phone: "+15550100200", name: "x" }), { role: "owner", agent_id: null });
  assert.deepEqual(Object.keys(leaked!).sort(), ["agent_ids", "business_day", "revision", "subject_ids", "topic"]);
  // The change stream itself is filtered for a Rep (server-side, before anything reaches the process).
  const repPipeline = JSON.stringify(liveWatchPipeline({ role: "rep", agent_id: A }));
  assert.match(repPipeline, /fullDocument\.agent_ids/);
  assert.match(repPipeline, /outreach_configuration/);
  assert.doesNotMatch(JSON.stringify(liveWatchPipeline({ role: "owner", agent_id: null })), /agent_ids":"/);
});
