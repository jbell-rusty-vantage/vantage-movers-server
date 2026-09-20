import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { getSalesIntelligenceAiBudgetModel } from "../src/models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { ensureCurrentCsiBudgetPeriod } from "../src/services/salesIntelligence/budgetPeriod";
import { enqueueCsiJob } from "../src/services/salesIntelligence/jobs";

test("CSI-15 runtime budget period activation", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 120_000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi15period[a-f0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  const Budget = getSalesIntelligenceAiBudgetModel(), Jobs = getSalesIntelligenceJobModel();
  const now = new Date("2026-09-19T12:00:00Z");
  const job = await withTransaction(session => enqueueCsiJob({ dedupe_key: "csi15:period:analysis", stage: "analysis", subject_key: "number:period-proof", input_revision: 1, input_refs: [] }, session));
  await Jobs.updateOne({ _id: job._id }, { $set: { status: "paused", reason: "budget_exhausted" } });
  await t.test("first runtime entry activates local month and resumes saved stage once", async () => {
    const row = await ensureCurrentCsiBudgetPeriod(now);
    assert.equal(row.month, "2026-09");
    assert.equal(row.period_start.toISOString(), "2026-09-01T04:00:00.000Z");
    assert.equal(row.activated_at?.toISOString(), now.toISOString());
    const resumed = await Jobs.findById(job._id).lean();
    assert.equal(resumed?.status, "pending");
    assert.equal(resumed?.stage, "analysis");
    await Budget.updateOne({ _id: row._id }, { $set: { actual_cents: 7, reserved_cents: 11, ceiling_cents: 123 } });
    await Jobs.updateOne({ _id: job._id }, { $set: { status: "paused", reason: "budget_exhausted" } });
    const again = await ensureCurrentCsiBudgetPeriod(now);
    assert.equal(again.actual_cents, 7);
    assert.equal(again.reserved_cents, 11);
    assert.equal(again.ceiling_cents, 123);
    assert.equal((await Jobs.findById(job._id).lean())?.status, "paused");
    assert.equal(await Budget.countDocuments(), 1);
  });
  await t.test("covering custom bounds and timezone survive policy defaults", async () => {
    await Budget.deleteMany({});
    await Budget.create({ month: "2026-09", policy_version: "custom", ceiling_cents: 234, timezone: "UTC",
      period_start: new Date("2026-09-17T00:00:00Z"), period_end: new Date("2026-10-17T00:00:00Z"), actual_cents: 9, reserved_cents: 12 });
    const row = await ensureCurrentCsiBudgetPeriod(now);
    assert.equal(row.timezone, "UTC");
    assert.equal(row.period_start.toISOString(), "2026-09-17T00:00:00.000Z");
    assert.equal(row.ceiling_cents, 234);
    assert.equal(row.actual_cents, 9);
    assert.equal(row.reserved_cents, 12);
    assert.equal(await Budget.countDocuments(), 1);
  });
  await t.test("later period creates allowance and resumes the same job", async () => {
    await Jobs.updateOne({ _id: job._id }, { $set: { status: "paused", reason: "budget_exhausted" } });
    const row = await ensureCurrentCsiBudgetPeriod(new Date("2026-11-10T12:00:00Z"));
    assert.equal(row.month, "2026-11");
    assert.equal(row.period_end.toISOString(), "2026-12-01T05:00:00.000Z");
    assert.equal((await Jobs.findById(job._id).lean())?.status, "pending");
    assert.equal(await Budget.countDocuments(), 2);
  });
});
