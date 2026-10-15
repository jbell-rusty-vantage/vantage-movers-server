/** Read-only production queue timing probe. Emits timings/counts only, never customer data. */
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { performance } from "node:perf_hooks";
import { connectMongo } from "../../src/db";
import { readQueue } from "../../src/services/salesOutreach/reads/queue";
import { salesOutreachConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { getSalesOutreachSubjectModel } from "../../src/models/salesOutreach";

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  if (process.argv.includes("--trace")) mongoose.set("debug", (collection: string, method: string) => console.log(JSON.stringify({ at: Math.round(performance.now()), collection, method })));
  const subject = await getSalesOutreachSubjectModel().findOne({ status: "active", assigned_agent_id: { $ne: null } }, { assigned_agent_id: 1 }).lean();
  assert.ok(subject?.assigned_agent_id);
  const agent = String(subject.assigned_agent_id);
  for (const workflow of ["new", "quoted", "other", "pool"] as const) {
    const started = performance.now();
    const result = await readQueue({ role: "rep", agent_id: agent, actor: { kind: "rep", id: "performance-probe", request_id: "performance-probe", run_id: null } },
      workflow === "pool" ? { queue_scope: "pool", state: "needs_contact" } : { workflow, state: "needs_contact" },
      { loader: salesOutreachConfigurationLoader, now: new Date(), cursorSecret: "read-only-performance-probe" });
    const ms = Math.round(performance.now() - started);
    console.log(JSON.stringify({ workflow, ms, rows: result.rows.length, has_more: result.has_more }));
    if (process.argv.includes("--assert-fast")) assert.ok(ms < 3000, `${workflow} queue exceeded 3000ms: ${ms}ms`);
  }
}
main().finally(() => mongoose.disconnect()).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Probe failed"); process.exitCode = 1; });
