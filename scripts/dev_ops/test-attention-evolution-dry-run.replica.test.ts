/**
 * AC7-DRYRUN write-free proof (Attention and Case File spec §10) on the csi01 replica: the final-UI seed
 * (`testvantagemovers_finalui`, 86 states) is copied read-only into a disposable database and the dry run
 * walks it. Mongo op log = reads only; dbHash identical before/after; the report is written as the
 * replica evidence when `T4C_DRYRUN_OUT` is set.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { dryRunAttentionEvolution, dryRunMarkdown } from "./dry-run-attention-evolution";

const SEED = "testvantagemovers_finalui";
const WRITE_METHODS = /^(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|bulkWrite|createIndex|drop|rename)/i;

test("AC7-DRYRUN: the dry run over the seed copy writes nothing", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async (t) => {
  const database = getMongoDatabaseName();
  assert.match(database, /^testvantagemovers_t4cdry[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const target = mongoose.connection.useDb(database, { useCache: true }).db!;
  const seed = mongoose.connection.useDb(SEED, { useCache: true }).db!;
  t.after(async () => { await target.dropDatabase(); await mongoose.disconnect(); });
  for (const info of await seed.listCollections().toArray()) {
    if (info.type === "view") continue;
    const rows = await seed.collection(info.name).find({}).toArray();
    const indexes = (await seed.collection(info.name).indexes()).filter(i => i.name !== "_id_");
    await target.createCollection(info.name).catch(() => undefined);
    for (const index of indexes) { const { key, name, v: _v, ns: _ns, ...options } = index as Record<string, unknown>; await target.collection(info.name).createIndex(key as never, { name: name as string, ...options }).catch(() => undefined); }
    if (rows.length) await target.collection(info.name).insertMany(rows.map(r => (r.database === SEED ? { ...r, database } : r)));
  }
  // The seed's own clock: the newest record trigger, so the seeded ages (40 s, 3 h, 239/240 staffed min) read as seeded.
  const asOf = process.env.T4C_DRYRUN_AS_OF ? new Date(process.env.T4C_DRYRUN_AS_OF) : new Date();

  const ops: string[] = [];
  mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
  const before = await target.command({ dbHash: 1 });
  const report = await dryRunAttentionEvolution({ asOf });
  const after = await target.command({ dbHash: 1 });
  mongoose.set("debug", false);
  const writes = ops.filter(op => WRITE_METHODS.test(op.split(".").at(-1)!));
  console.log(JSON.stringify({ ops: ops.length, methods: [...new Set(ops.map(o => o.split(".").at(-1)))].sort(), writes: writes.length,
    records: report.records, changed: report.changed_records, bands: report.bands, transitions: report.transitions, added: report.reasons.added,
    p4: report.p4_defaults.eligible_now, p7: report.p7_first_attempts.eligible_now }));
  assert.deepEqual(writes, [], "the dry run issued reads only");
  assert.equal(after.md5, before.md5, "dbHash identical before/after");
  assert.ok(report.records > 0);
  assert.equal(Object.values(report.bands.off).reduce((a, b) => a + b, 0), report.records);
  assert.equal(Object.values(report.transitions).reduce((a, b) => a + b, 0), report.records);
  if (process.env.T4C_DRYRUN_OUT) {
    await mkdir(process.env.T4C_DRYRUN_OUT, { recursive: true });
    await writeFile(join(process.env.T4C_DRYRUN_OUT, "AC7-DRYRUN-replica.md"), dryRunMarkdown(report).replace(`Database \`${database}\``, `Database \`${database}\` (a copy of \`${SEED}\`)`) +
      `\n## Write-free proof\n\n${ops.length} Mongo operations, methods ${[...new Set(ops.map(o => o.split(".").at(-1)))].sort().join(", ")}; 0 writes; dbHash md5 ${before.md5} before and after.\n\n\`\`\`json\n${JSON.stringify(report, null, 1)}\n\`\`\`\n`);
  }
});
