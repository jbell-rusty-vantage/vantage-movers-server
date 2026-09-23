/** Read-only production readiness check; never prints customer details. */
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { readAttention } from "../src/services/salesIntelligence/outreach/attention";

async function main() {
  await connectMongo();
  const page = await readAttention({ scope: "production", limit: 1 });
  console.log(JSON.stringify({ status: page.data.status, total_items: page.data.total_items, as_of: page.as_of }));
  assert.equal(page.data.status, "ready", "Attention must leave Preparing and expose counts");
  assert.notEqual(page.data.total_items, null);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
