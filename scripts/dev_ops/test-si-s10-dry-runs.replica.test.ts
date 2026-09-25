/**
 * S10-REPAIR C25 harness (reconciliation addendum §5, §7): every S10 script's dry run, and the read-only step 7
 * and step 9 commands, run as the operator runs them (the CLI, a child process) against a copy of the final-UI
 * seed (`testvantagemovers_finalui`, 109/109 states), with production flags on.
 *
 * Around each command: the server's `top` write counters for this database (insert + update + remove, every
 * collection), dbHash, and the collection + index inventory. A write-free command moves none of them.
 * `backfill-form-lead-contact-numbers.ts` is run too and is EXPECTED to send writes (its dry run executes and
 * aborts transactions; DECISIONS 2026-09-24): the harness records its counter and proves dbHash unchanged.
 *
 * Setup (before any measurement, on the copy only): TTL indexes dropped (a TTL pass mid-proof would delete rows);
 * the S5c form-created Number's `created_via` unset (so the step-1 stamp has one to find); one Attention publish
 * with SALES_INTELLIGENCE_OVERVIEW on (the estimated baseline transitions step 9 reports).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { publishAttentionSnapshot } from "../../src/services/salesIntelligence/outreach/attention";

const SEED = "testvantagemovers_finalui";

test("S10 C25: every dry run on a copy of the final-UI seed", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 1_800_000 }, async (t) => {
  const database = getMongoDatabaseName();
  assert.match(database, /^testvantagemovers_t3cs10[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  const copy = spawnSync("docker", ["exec", "csi01", "sh", "-c",
    `mongodump --port 27189 --quiet --archive --db=${SEED} | mongorestore --port 27189 --quiet --archive --nsFrom='${SEED}.*' --nsTo='${database}.*'`], { encoding: "utf8", timeout: 600_000 });
  assert.equal(copy.status, 0, copy.stderr);
  await connectMongo();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.ok(await db.collection("si_seed_manifest").countDocuments() > 0, "the seed manifest was copied");
  for (const name of await db.listCollections({}, { nameOnly: true }).toArray())
    for (const ix of await db.collection(name.name).indexes()) if (ix.expireAfterSeconds !== undefined) await db.collection(name.name).dropIndex(ix.name!);
  const formNumber = await db.collection("contact_numbers").findOne({ created_via: "form_lead" });
  assert.ok(formNumber, "the S5c form-created Number");
  await db.collection("contact_numbers").updateOne({ _id: formNumber._id }, { $unset: { created_via: "" } });
  process.env.SALES_INTELLIGENCE_OVERVIEW = "true";
  const published = await publishAttentionSnapshot({ deadlineMs: 300_000 }) as { status?: string };
  assert.equal(published.status, "published");
  delete process.env.SALES_INTELLIGENCE_OVERVIEW;
  const baselines = await db.collection("outreach_band_transitions").countDocuments({ "cause.kind": "baseline" });
  assert.ok(baselines > 0, "baseline rows written by the first OVERVIEW publish");

  const writeCount = async () => {
    const totals = (await db.admin().command({ top: 1 })).totals as Record<string, { insert?: { count: number }; update?: { count: number }; remove?: { count: number } }>;
    return Object.entries(totals).filter(([ns]) => ns.startsWith(`${database}.`)).reduce((sum, [, v]) => sum + (v.insert?.count ?? 0) + (v.update?.count ?? 0) + (v.remove?.count ?? 0), 0);
  };
  const dbHash = async () => (await db.command({ dbHash: 1 })).md5 as string;
  let lastInventory: string[] = [];
  const inventory = async () => {
    const out: string[] = [];
    for (const c of (await db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name).sort())
      for (const i of (await db.collection(c).indexes()).map(i => i.name).sort()) out.push(`${c}.${i}`);
    lastInventory = out;
    return createHash("md5").update(out.join("\n")).digest("hex");
  };
  const out = mkdtempSync(join(tmpdir(), "t3c-s10-"));
  const reportDir = process.env.T3C_S10_REPORT_DIR ?? join(out, "evidence");
  mkdirSync(reportDir, { recursive: true });
  // V-T3 m21: the real 09-20 manifest is gitignored; a clean checkout uses the shipped synthetic fixture.
  const realManifest = "scripts/dev_ops/output/call-log-repair-2026-09-20.json";
  const manifest = existsSync(realManifest) && process.env.T3_S10_SYNTHETIC_MANIFEST !== "1" ? realManifest : "scripts/dev_ops/fixtures/call-log-repair-synthetic.json";
  console.log(`# step 5 manifest: ${manifest}`);
  const results: Array<Record<string, unknown>> = [];
  const lastJsonLine = (text: string) => {
    const lines = text.trim().split(/\r?\n/).filter(l => l.startsWith("{") && l.endsWith("}"));
    return lines.at(-1) ?? null;
  };
  async function measure(step: string, script: string, args: string[], expectWriteFree = true) {
    const before = await writeCount(), hash = await dbHash(), inv = await inventory();
    const invBefore = lastInventory;
    const t0 = Date.now();
    const run = spawnSync(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", `scripts/dev_ops/${script}`, ...args],
      { env: process.env, encoding: "utf8", timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
    const writes = (await writeCount()) - before, hashAfter = await dbHash(), invAfter = await inventory();
    const created = lastInventory.filter(x => !invBefore.includes(x)), dropped = invBefore.filter(x => !lastInventory.includes(x));
    const row = { step, command: `${script} ${args.join(" ")}`.trim(), exit: run.status, top_writes: writes, dbhash_equal: hashAfter === hash, inventory_equal: invAfter === inv,
      seconds: Math.round((Date.now() - t0) / 100) / 10, created, dropped, result: lastJsonLine(run.stdout) };
    results.push(row);
    writeFileSync(join(reportDir, "S10-replica-dry-runs.json"), JSON.stringify({ database, seed: SEED, baselines, results }, null, 1) + "\n");
    assert.equal(run.status, 0, `${script}: ${run.stderr.slice(-4000)}\n${run.stdout.slice(-2000)}`);
    assert.equal(hashAfter, hash, `${script}: dbHash identical`);
    assert.equal(invAfter, inv, `${script}: no collection or index created or dropped`);
    if (expectWriteFree) assert.equal(writes, 0, `${script}: zero write commands`);
    return row;
  }

  await t.test("step 1: stamp-form-created-numbers.ts dry run", async () => {
    await measure("1", "stamp-form-created-numbers.ts", ["--report", join(reportDir, "S10-1-replica.md")]);
  });
  await t.test("step 1: backfill-form-lead-contact-numbers.ts dry run (aborted transactions: writes counted, nothing committed)", async () => {
    const row = await measure("1", "backfill-form-lead-contact-numbers.ts", [], false);
    assert.ok(row.dbhash_equal);
  });
  await t.test("step 2: backfill-sole-match-attachments.ts dry run", async () => {
    await measure("2", "backfill-sole-match-attachments.ts", [`--out=${out}`, `--report-dir=${reportDir}`]);
  });
  await t.test("step 4: reconcile-priority5.ts dry run", async () => {
    await measure("4", "reconcile-priority5.ts", [`--manifest=${join(out, "p5.json")}`, `--report-dir=${reportDir}`]);
  });
  await t.test("step 5: stamp-capture-recovery.ts dry run (the real 09-20 manifest, or the synthetic fixture)", async () => {
    await measure("5", "stamp-capture-recovery.ts", ["--manifest", manifest, "--out", out, "--report", join(reportDir, "S10-5-replica.md")]);
  });
  await t.test("step 6: reensure-outreach.ts dry run", async () => {
    await measure("6", "reensure-outreach.ts", [`--out=${out}`, `--report-dir=${reportDir}`]);
    assert.ok(existsSync(join(reportDir, "S10-6-replica-dry-run.json")));
  });
  await t.test("step 7: refingerprint-numbers.ts (read-only verifier)", async () => {
    await measure("7", "refingerprint-numbers.ts", ["--json", join(reportDir, "S10-7-replica-refingerprint.json")]);
  });
  await t.test("step 7: inspect-attention-walks.ts", async () => {
    await measure("7", "inspect-attention-walks.ts", ["--n", "5"]);
  });
  await t.test("step 7: inspect-number-rollups.ts (B1 rollup equality)", async () => {
    await measure("7", "inspect-number-rollups.ts", ["--sample=60", `--json=${join(reportDir, "S10-7-replica-rollups.json")}`]);
  });
  await t.test("step 9: report-si-state.ts", async () => {
    await measure("9", "report-si-state.ts", [`--report-dir=${reportDir}`, `--before=${join(reportDir, "S10-6-replica-dry-run.json")}`, "--since=2026-09-01T00:00:00Z"]);
    assert.ok(existsSync(join(reportDir, "S10-9-replica.md")) && existsSync(join(reportDir, "S10-9-replica.json")));
  });

  await db.dropDatabase();
  await mongoose.disconnect();
});
