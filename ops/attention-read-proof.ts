/** Read-only page/cursor/Overview and latency proof; output contains aggregate data only. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { clearParsedAttentionSnapshots, readAttention, attentionQuerySchema } from "../src/services/salesIntelligence/outreach/attention";
import { entryMatchesAttentionQuery } from "../src/services/salesIntelligence/outreach/attentionIndex";
import { readOverviewIndex, clearOverviewIndexCache } from "../src/services/salesIntelligence/overview/now";
async function main() {
  await connectMongo();
  clearParsedAttentionSnapshots(); clearOverviewIndexCache();
  const before = process.memoryUsage();
  const start = performance.now(), first = await readAttention({ limit: 50 });
  const cold_ms = performance.now() - start;
  assert.equal(first.data.status, "ready");
  const nextStart = performance.now(), warm = await readAttention({ limit: 50 });
  const warm_ms = performance.now() - nextStart;
  if (first.data.snapshot_id === warm.data.snapshot_id) assert.deepEqual(first.data.items, warm.data.items);
  if (first.data.cursor) {
    const next = await readAttention({ limit: 50, cursor: first.data.cursor });
    assert.equal(next.data.snapshot_id, first.data.snapshot_id); assert.equal(next.as_of, first.as_of);
    const ids = new Set(first.data.items.map(row => row.subject_key));
    assert.ok(next.data.items.every(row => !ids.has(row.subject_key)));
  }
  const overview = await readOverviewIndex(new Date()); assert.ok(overview);
  if (overview.snapshot_id === first.data.snapshot_id) assert.equal(overview.entries.filter(entry => entryMatchesAttentionQuery(entry, attentionQuerySchema.parse({}), { as_of: overview.as_of })).length, first.data.total_items);
  const agent = overview.entries.flatMap(entry => entry.filter_keys.agents)[0];
  let rep: Record<string, unknown> | null = null;
  if (agent) {
    const started = performance.now(), page = await readAttention({ limit: 50 }, { scope: { agent_id: agent } });
    assert.ok(page.data.items.every(row => row.filter_keys?.agents.includes(agent)));
    rep = { ms: performance.now() - started, total_items: page.data.total_items, metrics_present: Boolean(page.data.metrics) };
  }
  const views = [];
  for (const view of ["all_outreach", "closed"] as const) {
    const page = await readAttention({ view, limit: 50 });
    assert.equal(page.data.status, "ready");
    assert.ok(page.data.items.every(row => (row.partition === "closed") === (view === "closed")));
    views.push({ view, total_items: page.data.total_items, items: page.data.items.length });
  }
  const after = process.memoryUsage();
  const result = { at: new Date(), as_of: first.as_of, cold_ms, warm_ms, items: first.data.items.length, total_items: first.data.total_items,
    cursor_consistent: true, overview_consistent: true, views, rep, heap_delta: after.heapUsed - before.heapUsed, heap_used: after.heapUsed, rss: after.rss,
    measurement: "Service reads from operator host to production Mongo; not deployed HTTP latency." };
  const json = JSON.stringify(result, null, 2), output = process.argv.indexOf("--out");
  if (output >= 0) writeFileSync(process.argv[output + 1]!, json);
  console.log(json);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Attention read proof failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
