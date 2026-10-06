/**
 * SRV-2 replica proof (local csi01 loopback replica only; synthetic rows in a unique database that
 * is dropped afterwards). Run with `pnpm test:outreach:replica`. Never loads production env.
 *
 * Proves on real Mongo transactions what the unit tests prove on the in-memory stand-in:
 * - uninitialized → no writes from reads; explicit initialization creates revision 1;
 * - a concurrent initialization race leaves exactly one pointer and one winner;
 * - version + pointer CAS + audit + command ledger commit together; a replay writes nothing;
 * - two independent loaders (two instances) see a committed PATCH on their next read;
 * - version documents are immutable; a dangling pointer fails closed and is repairable;
 * - the index build plan is idempotent against the real index list.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_sodconfig${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.sod-config-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "sod-config-replica";
process.env.SHEET_SYNC_MODE = "disabled";

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { SALES_OUTREACH_MODEL_REGISTRY } = await import("../../src/models/salesOutreach/registry.js");
  const { getSalesOutreachConfigurationModel } = await import("../../src/models/salesOutreach/configuration.js");
  const { getSalesIntelligenceCommandExecutionModel } = await import("../../src/models/SalesIntelligenceCommandExecution.js");
  const { getSalesIntelligenceAuditEventModel } = await import("../../src/models/SalesIntelligenceAuditEvent.js");
  const { csiOperatorActor } = await import("../../src/services/salesIntelligence/auth.js");
  const { patchSalesOutreachConfiguration } = await import("../../src/services/salesOutreach/config/commands.js");
  const { createConfigurationLoader } = await import("../../src/services/salesOutreach/config/load.js");
  const { readSalesOutreachConfiguration } = await import("../../src/services/salesOutreach/config/reads.js");
  const { planIndexBuild } = await import("../lib/sales-outreach-indexes.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);

  for (const Model of [getSalesIntelligenceCommandExecutionModel(), getSalesIntelligenceAuditEventModel(), ...SALES_OUTREACH_MODEL_REGISTRY.map((e) => e.model())]) {
    await Model.createCollection();
    await Model.createIndexes();
  }
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  const declared = SALES_OUTREACH_MODEL_REGISTRY.map((e) => ({ collection: String(e.model().collection.collectionName), indexes: e.indexes }));
  const observed = new Map<string, never[]>();
  for (const { collection } of declared) observed.set(collection, (await db.collection(collection).indexes()) as never[]);
  assert.ok(planIndexBuild(declared, observed).every((a) => a.action === "exists"), "declared indexes match the built ones");

  const Configuration = getSalesOutreachConfigurationModel();
  const Ledger = getSalesIntelligenceCommandExecutionModel();
  const Audit = getSalesIntelligenceAuditEventModel();
  const owner = csiOperatorActor("sod-config-replica");
  const instanceA = createConfigurationLoader();
  const instanceB = createConfigurationLoader();

  assert.deepEqual(await instanceA.load(), { state: "uninitialized" });
  assert.equal((await readSalesOutreachConfiguration(instanceA)).configuration_state, "uninitialized");
  assert.equal(await Configuration.countDocuments({}), 0, "GET never initializes");

  const race = await Promise.allSettled(
    ["race-a", "race-b"].map((key) =>
      patchSalesOutreachConfiguration({ actor: owner, idempotency_key: key, expected_revision: 0, value: { controls: { desk_enabled: key === "race-a" } } }),
    ),
  );
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1, "exactly one initialization wins");
  const loser = race.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal((loser.reason as { code?: string }).code, "REVISION_CONFLICT");
  assert.equal(await Configuration.countDocuments({ kind: "pointer" }), 1);
  assert.equal(await Configuration.countDocuments({ kind: "version" }), 1, "the losing version rolled back");
  assert.equal(await Audit.countDocuments({ subject_key: "sales_outreach_configuration:active" }), 1);

  const before = await instanceA.requireActive();
  assert.equal(before.revision, 1);
  const patched = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "v2", expected_revision: 1, value: { transition: { backfill_lookback_days: 90 } } });
  assert.equal(patched.response.revision, 2);
  for (const instance of [instanceA, instanceB]) {
    const seen = await instance.requireActive();
    assert.equal(seen.revision, 2);
    assert.equal(seen.value.transition.backfill_lookback_days, 90);
  }
  const ledgerRows = await Ledger.countDocuments({});
  const replay = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "v2", expected_revision: 1, value: { transition: { backfill_lookback_days: 90 } } });
  assert.equal(replay.replayed, true);
  assert.equal(await Ledger.countDocuments({}), ledgerRows);
  await assert.rejects(
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "v2", expected_revision: 1, value: {} }),
    (error: unknown) => (error as { code?: string }).code === "IDEMPOTENCY_CONFLICT",
  );
  await assert.rejects(
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "stale", expected_revision: 1, value: {} }),
    (error: unknown) => (error as { code?: string }).code === "REVISION_CONFLICT",
  );

  await assert.rejects(Configuration.updateOne({ key: `version:${patched.response.version}` }, { $set: { approval_ref: "x" } }).exec(), /immutable/);
  await assert.rejects(Configuration.deleteOne({ kind: "version" }).exec(), /immutable/);

  // Dangling pointer (version removed out of band) fails closed, then the Owner repairs it.
  await Configuration.collection.deleteOne({ kind: "version", version: patched.response.version });
  const fresh = createConfigurationLoader();
  assert.equal((await fresh.inspect()).state, "unavailable");
  await assert.rejects(fresh.requireActive(), (error: unknown) => (error as { code?: string }).code === "CONFIGURATION_UNAVAILABLE");
  const repaired = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "repair", expected_revision: 2, value: {} });
  assert.equal(repaired.response.revision, 3);
  assert.equal((await fresh.requireActive()).revision, 3);

  // olr A0: a version written before a schema addition (raw insert of the revision-5 shape, which
  // lacks every key the repair adds) round-trips through Mongo and loads active with its stored hash.
  const { CONFIGURATION_REVISION_5_HASH, configurationRevision5Value } = await import("../../src/services/salesOutreach/config/testing.js");
  const { configurationContentHash } = await import("../../src/services/salesOutreach/config/store.js");
  const insertRawVersion = async (version: string, value: unknown, content_hash: string) => {
    await Configuration.collection.insertOne({
      kind: "version",
      key: `version:${version}`,
      version,
      schema_version: 1,
      value,
      content_hash,
      approval_ref: "owner-session-2026-10-03-FINAL-01",
      created_by: { kind: "operator", id: "sod-config-replica" },
      revision: null,
      updated_by: null,
    });
    await Configuration.updateOne({ kind: "pointer", key: "active" }, { $set: { version, content_hash }, $inc: { revision: 1 } }).exec();
  };
  await insertRawVersion("sod-config-legacy-rev5", configurationRevision5Value(), CONFIGURATION_REVISION_5_HASH);
  const legacy = await createConfigurationLoader().inspect();
  assert.equal(legacy.state, "active", "a pre-addition version stays active");
  assert.equal(legacy.state === "active" && legacy.content_hash, CONFIGURATION_REVISION_5_HASH);
  assert.equal(legacy.state === "active" && legacy.revision, 4);
  const stored = await Configuration.findOne({ kind: "version", version: "sod-config-legacy-rev5" }).lean<{ value: unknown }>();
  assert.equal(configurationContentHash(stored!.value as never), CONFIGURATION_REVISION_5_HASH, "the Mongo round trip keeps the canonical hash");
  assert.equal((await readSalesOutreachConfiguration(createConfigurationLoader())).content_hash, CONFIGURATION_REVISION_5_HASH);
  const same = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "rev5-same", expected_revision: 4, value: configurationRevision5Value() });
  assert.deepEqual([same.response.changed, same.response.revision], [false, 4], "re-submitting the stored content writes nothing");

  const tampered = configurationRevision5Value();
  tampered.goals!.default_scheduled_goal = 1;
  await insertRawVersion("sod-config-tampered", tampered, CONFIGURATION_REVISION_5_HASH);
  const broken = await createConfigurationLoader().inspect();
  assert.equal(broken.state === "unavailable" && broken.reason, "hash_mismatch", "an out-of-band edit still fails closed");
  // Repair with a value that also sets a new optional key: it is hashed only because it is set.
  const repairValue = configurationRevision5Value();
  repairValue.evidence!.webhook_silence_minutes = 30;
  const fixed = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "rev5-repair", expected_revision: 5, value: repairValue });
  assert.equal(fixed.response.revision, 6);
  assert.notEqual(fixed.response.content_hash, CONFIGURATION_REVISION_5_HASH);
  const repairedActive = await createConfigurationLoader().requireActive();
  assert.deepEqual([repairedActive.revision, repairedActive.value.evidence.webhook_silence_minutes], [6, 30]);
  console.log("PASS: uninitialized reads, initialization race, version+pointer+audit+ledger atomicity, replay/conflicts, two-instance reload, immutable versions, dangling-pointer repair, idempotent index plan, pre-addition version loads active (A0), tampered value fails closed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(mongoose.modelNames().map((name) => mongoose.model(name).init()));
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
