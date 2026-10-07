/**
 * CPL save regression (2026-10-06, local csi01 loopback replica only; synthetic rows in a unique database that is
 * dropped afterwards). Never loads production env.
 *
 * The Owner's Lead cost sheet failed with "Cannot call `create()` with a session and multiple documents unless
 * `ordered: true` is set": a dated simple change writes two periods (the closed predecessor and the new open period)
 * in one transaction. This proves, on real Mongo inside the real registry transaction, that:
 * - a simple change dated after the current period start saves and leaves exactly two active periods;
 * - the predecessor ends where the new amount starts, and the granularity's revision moves by one;
 * - a second simple change dated at the coverage start replaces the whole schedule with one open period
 *   ("all past leads too").
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_cplsave${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.cpl-save-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SHEET_SYNC_MODE = "disabled";

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { getLeadSourceCompanyModel } = await import("../../src/models/LeadSourceCompany.js");
  const { getLeadSourceGranularityModel } = await import("../../src/models/LeadSourceGranularity.js");
  const { getCplRatePeriodModel } = await import("../../src/models/CplRatePeriod.js");
  const { OperationsRegistryChange } = await import("../../src/models/OperationsRegistryChange.js");
  const { applySimpleCplSchedule, businessDateToUtc } = await import("../../src/services/operationsRegistry/cplSchedule.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  for (const Model of [getLeadSourceCompanyModel(), getLeadSourceGranularityModel(), getCplRatePeriodModel(), OperationsRegistryChange]) {
    await Model.createCollection();
    await Model.createIndexes();
  }

  const company = await getLeadSourceCompanyModel().create({ company_slug: "tbm_leads", name: "TBM", owner_label: "TBM", active: true });
  const feed = await getLeadSourceGranularityModel().create({
    source_company: company._id,
    granularity_key: "tbm_leads_form",
    channel: "form",
    owner_label: "TBM Forms",
    crm_label: "TBM Forms",
    active: true,
    schedule_revision: 1,
  });
  await getCplRatePeriodModel().create({
    source_granularity: feed._id,
    amount_cents: 20500,
    effective_from: businessDateToUtc("2024-01-01"),
    effective_from_date: "2024-01-01",
    business_timezone: "America/New_York",
    schedule_revision: 1,
    created_by: { actor_type: "owner", actor_id: "seed", actor_label: "Seed", actor_role: "owner" },
  });

  const actor = (n: number) => ({
    actorType: "owner" as const,
    actorId: "owner-1",
    actorLabel: "Owner",
    actorRole: "owner" as const,
    requestId: `cpl-save-${n}-${randomUUID()}`,
  });
  const feedId = String(feed._id);

  // 1. A dated change: two periods in one transaction (the failing case).
  const dated = await applySimpleCplSchedule(
    { effective_date: "2026-10-01", expected_revisions: { [feedId]: 1 }, changes: [{ source_granularity_id: feedId, amount: "190" }], reason: "final rate" },
    actor(1) as never,
  );
  assert.equal(dated.changed, true);
  const afterDated = await getCplRatePeriodModel().find({ source_granularity: feed._id, archived_at: null }).sort({ effective_from: 1 }).lean();
  assert.equal(afterDated.length, 2, "the predecessor and the new period are both active");
  assert.equal(afterDated[0]!.amount_cents, 20500);
  assert.equal(afterDated[0]!.effective_until_date_exclusive, "2026-10-01");
  assert.equal(afterDated[1]!.amount_cents, 19000);
  assert.equal(afterDated[1]!.effective_from_date, "2026-10-01");
  assert.equal((await getLeadSourceGranularityModel().findById(feed._id).lean())!.schedule_revision, 2);

  // 2. "All past leads too": dated at the coverage start, one open period replaces the schedule.
  const all = await applySimpleCplSchedule(
    { effective_date: "2024-01-01", expected_revisions: { [feedId]: 2 }, changes: [{ source_granularity_id: feedId, amount: "185" }] },
    actor(2) as never,
  );
  assert.equal(all.changed, true);
  const afterAll = await getCplRatePeriodModel().find({ source_granularity: feed._id, archived_at: null }).lean();
  assert.equal(afterAll.length, 1);
  assert.equal(afterAll[0]!.amount_cents, 18500);
  assert.equal(afterAll[0]!.effective_until, undefined);
  assert.equal(await OperationsRegistryChange.countDocuments({ entity_type: "cpl_schedule" }), 2, "each save is audited");

  console.log("cpl-schedule replica: OK (dated two-period save, all-history replace, audits)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === database) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  });
