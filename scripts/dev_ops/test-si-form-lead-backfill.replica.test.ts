/**
 * V-T3 M5a replica proof: S10 step 1 (`scripts/dev_ops/backfill-form-lead-contact-numbers.ts`) creates no unheld
 * paid job. csi01 replica, disposable `testvantagemovers_t3bform<hex>`, production flags on (ATTENTION_EVOLUTION,
 * CASE_FILE, PROGRESS_PLAN, LEAD_PROGRESS, OUTREACH_ENSURE, MOVE_ASSESSMENT + ENABLED, PRIORITY5_CLOSURE,
 * FORM_LEAD_NUMBERS). No job consumer runs.
 *
 * Form Leads without a Contact Number: B has an open Outreach record and its Lead is booked since, so the group's
 * attach → `ensureLead` closes it `official/booked` and enqueues a `number_refresh` (the paid path M5a names);
 * P is a plain Lead (no paid job).
 *
 * Proves: the dry run reports `would_hold_number_refresh 1` and leaves dbHash identical; the apply creates both
 * Numbers, puts exactly that `number_refresh` on `operator_hold` (paused) in the group's transaction, records it in
 * the output and the checkpoint, leaves the claimable paid-stage counts unchanged and `paid_created_unheld 0`; a
 * re-apply creates nothing; `--release-holds=<output>` hands the job back (and `unheldCount` then sees it).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { unheldCount, type FormLeadHold } from "./lib/form-lead-numbers-backfill";

const PAID = ["transcription", "analysis", "application", "number_refresh", "move_assessment"] as const;
const OUT = "scripts/dev_ops/output";
const CHECKPOINT = `${OUT}/form-lead-contact-numbers.checkpoint.json`;

test("V-T3 M5a: the Form Lead Numbers backfill holds the paid work it creates", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async (t) => {
  const database = getMongoDatabaseName();
  assert.match(database, /^testvantagemovers_t3bform[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  // Keep an operator checkpoint in this checkout untouched.
  const savedCheckpoint = existsSync(CHECKPOINT) ? readFileSync(CHECKPOINT, "utf8") : null;
  t.after(async () => {
    if (savedCheckpoint !== null) writeFileSync(CHECKPOINT, savedCheckpoint); else rmSync(CHECKPOINT, { force: true });
    await db.dropDatabase(); await mongoose.disconnect();
  });
  await applyCsiMigration();
  const Jobs = getSalesIntelligenceJobModel(), Records = getOutreachRecordModel();
  const at = new Date(Date.now() - 3 * 86_400_000);
  const lead = async (ten: string) => {
    const row = { _id: new mongoose.Types.ObjectId(), timestamp: at, createdAt: at, updatedAt: at, name: "Synthetic FIX-B", normalized_phone_number: ten,
      source_company: "partner-a", ingested_contact_snapshot: { normalized_phone_number: ten, captured_at: at }, quoted: false, domain_revision: 0 };
    await getFormLeadModel().collection.insertOne(row);
    return row;
  };
  const b = await lead("2025550701"), p = await lead("2025550702");
  // B: an open Outreach record from its arrival (no Number yet), then the Lead is booked (the Lead mirror only).
  await withTransaction(s => ensureLead({ model: "FormLead", id: String(b._id) }, workerContext(s, String(new mongoose.Types.ObjectId()), at)));
  assert.notEqual((await Records.findOne({ "subject.id": b._id }).lean())?.state, "closed");
  await getFormLeadModel().collection.updateOne({ _id: b._id }, { $set: { booked: true } });
  assert.equal(await getContactNumberModel().countDocuments({}), 0);
  for (const name of await db.listCollections({}, { nameOnly: true }).toArray())
    for (const ix of await db.collection(name.name).indexes()) if (ix.expireAfterSeconds !== undefined) await db.collection(name.name).dropIndex(ix.name!);

  const claimable = async () => Object.fromEntries(await Promise.all(PAID.map(async s => [s, await Jobs.countDocuments({ stage: s, status: { $in: ["pending", "retry", "leased"] } })] as const)));
  const dbHash = async () => (await db.command({ dbHash: 1 })).md5 as string;
  const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "scripts/dev_ops/backfill-form-lead-contact-numbers.ts", ...args],
    { env: process.env, encoding: "utf8", timeout: 300_000 });
  type Output = { counts: Record<string, number>; holds: FormLeadHold[]; paid_created_unheld: number; paid_jobs: { before: Record<string, number>; after: Record<string, number> } };
  const latest = (mode: "apply" | "dry") => {
    const file = readdirSync(OUT).filter(f => f.startsWith(`form-lead-contact-numbers-${mode}-`) && f.endsWith(".json")).sort().at(-1)!;
    return { file: join(OUT, file), output: JSON.parse(readFileSync(join(OUT, file), "utf8")) as Output };
  };
  const paidBefore = await claimable();
  let applied: { file: string; output: Output };

  await t.test("dry run: would hold the one number_refresh; nothing committed", async () => {
    const hash = await dbHash();
    const run = cli();
    assert.equal(run.status, 0, run.stderr + run.stdout.slice(-2000));
    const { output } = latest("dry");
    assert.equal(output.counts.phones_to_create, 2);
    assert.equal(output.counts.result_created, 2);
    assert.equal(output.counts.would_hold_number_refresh, 1, JSON.stringify(output.counts));
    assert.equal(output.holds.length, 0, "a dry run records no hold (its transactions rolled back)");
    assert.equal(await dbHash(), hash, "dbHash identical");
    assert.equal(await Jobs.countDocuments({}), 0);
  });

  await t.test("apply: both Numbers created, the number_refresh held in the same transaction, nothing unheld", async () => {
    const run = cli("--apply");
    assert.equal(run.status, 0, run.stderr + run.stdout.slice(-2000));
    applied = latest("apply");
    const { output } = applied;
    assert.equal(output.counts.result_created, 2);
    assert.equal(output.counts.held_number_refresh, 1, JSON.stringify(output.counts));
    assert.equal(output.paid_created_unheld, 0);
    assert.equal(output.holds.length, 1);
    assert.equal(output.holds[0]!.stage, "number_refresh");
    assert.equal(output.holds[0]!.creator_lead_id, String(b._id));
    const job = await Jobs.findById(output.holds[0]!.job_id).lean();
    assert.deepEqual([job?.status, job?.reason], ["paused", "operator_hold"]);
    assert.deepEqual(await claimable(), paidBefore, "claimable paid-stage counts unchanged");
    assert.equal(await Jobs.countDocuments({ stage: { $in: [...PAID] }, status: { $ne: "paused" } }), 0, "no paid job outside the hold");
    const record = await Records.findOne({ "subject.id": b._id }).lean();
    assert.deepEqual([record?.state, record?.closure_origin, record?.closed_reason], ["closed", "official", "booked"]);
    assert.equal(await getContactNumberModel().countDocuments({ created_via: "form_lead" }), 2);
    const checkpoint = JSON.parse(readFileSync(CHECKPOINT, "utf8")) as { holds?: FormLeadHold[]; done?: boolean };
    assert.equal(checkpoint.done, true);
    assert.deepEqual(checkpoint.holds?.map(h => h.job_id), [output.holds[0]!.job_id], "the checkpoint carries the hold");
    assert.equal(await unheldCount(output.holds), 0);
  });

  await t.test("re-apply: idempotent (no phone to create, no job)", async () => {
    const jobs = await Jobs.countDocuments({}), hash = await dbHash();
    const run = cli("--apply");
    assert.equal(run.status, 0, run.stderr + run.stdout.slice(-2000));
    const { output } = latest("apply");
    assert.equal(output.counts.phones_to_create ?? 0, 0);
    assert.equal(output.counts.phones_number_exists, 2);
    assert.equal(output.holds.length, 0);
    assert.equal(await Jobs.countDocuments({}), jobs);
    assert.equal(await dbHash(), hash);
  });

  await t.test("--release-holds (operator decision) hands the job back; the unheld check then counts it", async () => {
    assert.notEqual(cli("--release-holds").status, 0, "needs --apply and a file");
    const run = cli("--apply", `--release-holds=${applied.file}`);
    assert.equal(run.status, 0, run.stderr + run.stdout.slice(-2000));
    assert.match(run.stdout, /"released":1/);
    const job = await Jobs.findById(applied.output.holds[0]!.job_id).lean();
    assert.equal(job?.status, "pending");
    assert.equal(await unheldCount(applied.output.holds), 1, "a hold that is no longer held is what fails a run");
  });
});
