/**
 * S10 step 2 replica proof (reconciliation addendum §5, C25): `scripts/dev_ops/backfill-sole-match-attachments.ts`.
 * csi01 replica, disposable `testvantagemovers_t3csole<hex>`, production flags on (ATTENTION_EVOLUTION, CASE_FILE,
 * PROGRESS_PLAN, LEAD_PROGRESS, OUTREACH_ENSURE, MOVE_ASSESSMENT + ENABLED, PRIORITY5_CLOSURE). No job consumer runs.
 *
 * Numbers (all Form Leads, no calls): W a sole match left as a candidate (AUTO_ATTACH was off) → attach;
 * M1 attached, its Outreach mirror lost → repair; M2 attached, mirror lost, and the Lead booked since → repair
 * closes the record `official/booked`, whose `number_refresh` must be held; C two non-duplicate Leads → competing;
 * K attached with a current mirror → untouched.
 *
 * Proves: C25 the dry run sends zero write commands (`top`) and leaves dbHash and the index inventory identical;
 * the counts match the scenarios; apply with `--limit` then `--resume` attaches 1 and repairs 2, holds exactly the
 * one `number_refresh` (`paused` / `operator_hold`), leaves claimable paid-stage counts unchanged and nothing unheld;
 * M1's Number fingerprint (`intelligenceSources`) is unchanged by the mirror repair; a second apply writes nothing;
 * `--release-holds` hands the held job back.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getNumberLeadAttachmentModel } from "../../src/models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { persistLeadAttachments } from "../../src/services/salesIntelligence/attachment/store";
import type { LeadSource } from "../../src/services/salesIntelligence/attachment/sources";
import { intelligenceSources } from "../../src/services/salesIntelligence/analysis/sources";

const PAID = ["transcription", "analysis", "application", "number_refresh", "move_assessment"] as const;

test("S10 step 2: sole-match attachment backfill on the replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async (t) => {
  const database = getMongoDatabaseName();
  assert.match(database, /^testvantagemovers_t3csole[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const Numbers = getContactNumberModel(), Edges = getNumberLeadAttachmentModel(), Records = getOutreachRecordModel(), Jobs = getSalesIntelligenceJobModel();
  const at = new Date("2026-09-01T12:00:00Z");
  let serial = 0;
  const number = () => Numbers.create({ e164: `+120255502${String(++serial).padStart(2, "0")}`, national_ten: `20255502${String(serial).padStart(2, "0")}`,
    digits_reversed: `s${serial}`, first_observed_at: at, last_activity_at: at });
  async function lead(phone: string, extra: Record<string, unknown> = {}) {
    const row = { _id: new mongoose.Types.ObjectId(), timestamp: at, createdAt: at, updatedAt: at, name: "Synthetic S10-2", normalized_phone_number: phone,
      source_company: "partner-a", ingested_contact_snapshot: { normalized_phone_number: phone, captured_at: at }, ...extra };
    await getFormLeadModel().collection.insertOne(row);
    return row as unknown as LeadSource & { _id: mongoose.Types.ObjectId };
  }
  const persist = (row: LeadSource) => withTransaction(s => persistLeadAttachments(row, "FormLead", s, "a".repeat(24), at));
  const ten = (n: { national_ten?: string | null }) => n.national_ten!;
  const recordOf = (id: mongoose.Types.ObjectId) => Records.findOne({ "subject.kind": "lead", "subject.model": "FormLead", "subject.id": id }).lean();

  // W: a sole match left as a candidate (AUTO_ATTACH off when it was scanned).
  process.env.SALES_INTELLIGENCE_AUTO_ATTACH = "false";
  const nW = await number(); const aW = await lead(ten(nW)); await persist(aW);
  assert.notEqual((await Edges.findOne({ "lead_ref.id": aW._id }).lean())?.state, "attached");
  // M1, M2, K: attached by the live rule, with an Outreach record and its mirror.
  process.env.SALES_INTELLIGENCE_AUTO_ATTACH = "true";
  const nM1 = await number(); const aM1 = await lead(ten(nM1)); await persist(aM1);
  const nM2 = await number(); const aM2 = await lead(ten(nM2)); await persist(aM2);
  const nK = await number(); const aK = await lead(ten(nK)); await persist(aK);
  // C: two non-duplicate Leads on one phone.
  const nC = await number(); const c1 = await lead(ten(nC)); const c2 = await lead(ten(nC), { source_company: "partner-b" }); await persist(c1); await persist(c2);
  process.env.SALES_INTELLIGENCE_AUTO_ATTACH = "false";
  for (const a of [aM1, aM2, aK]) {
    assert.equal((await Edges.findOne({ "lead_ref.id": a._id }).lean())?.state, "attached");
    assert.equal((await recordOf(a._id))?.lead_attachment?.state, "attached", "mirror written by the live hook");
  }
  // The lost mirrors, and M2's Lead booked since (the Lead mirror only; no Booking row, no EntityChange).
  await Records.collection.updateMany({ "subject.id": { $in: [aM1._id, aM2._id] } }, { $unset: { lead_attachment: "" } });
  await getFormLeadModel().collection.updateOne({ _id: aM2._id }, { $set: { booked: true } });
  // TTL monitors would delete expired rows mid-proof; this disposable database keeps none.
  for (const name of await db.listCollections({}, { nameOnly: true }).toArray())
    for (const ix of await db.collection(name.name).indexes()) if (ix.expireAfterSeconds !== undefined) await db.collection(name.name).dropIndex(ix.name!);

  const writeCount = async () => {
    const totals = (await db.admin().command({ top: 1 })).totals as Record<string, { insert?: { count: number }; update?: { count: number }; remove?: { count: number } }>;
    return Object.entries(totals).filter(([ns]) => ns.startsWith(`${database}.`)).reduce((sum, [, v]) => sum + (v.insert?.count ?? 0) + (v.update?.count ?? 0) + (v.remove?.count ?? 0), 0);
  };
  const dbHash = async () => (await db.command({ dbHash: 1 })).md5 as string;
  const inventory = async () => {
    const out: string[] = [];
    for (const c of (await db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name).sort())
      out.push(`${c}:${(await db.collection(c).indexes()).map(i => i.name).sort().join(",")}`);
    return createHash("md5").update(out.join("\n")).digest("hex");
  };
  const paidClaimable = async () => Object.fromEntries(await Promise.all(PAID.map(async s => [s, await Jobs.countDocuments({ stage: s, status: { $in: ["pending", "retry", "leased"] } })] as const)));
  const fingerprint = async (id: unknown) => { const session = await mongoose.connection.startSession(); try { return (await intelligenceSources(String(id), session)).fingerprint; } finally { await session.endSession(); } };
  const out = mkdtempSync(join(tmpdir(), "t3c-sole-"));
  const reportDir = process.env.T3C_SOLE_REPORT_DIR ?? out;
  const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "scripts/dev_ops/backfill-sole-match-attachments.ts",
    `--out=${out}`, `--report-dir=${reportDir}`, ...args], { env: { ...process.env, SALES_INTELLIGENCE_AUTO_ATTACH: "false" }, encoding: "utf8", timeout: 300_000 });
  const lastOutput = () => {
    const file = readdirSync(out).filter(f => /^sole-match-attachment-backfill-\d.*\.json$/.test(f)).sort().at(-1)!;
    return JSON.parse(readFileSync(join(out, file), "utf8")) as { counts: Record<string, number>; holds: number; paid_created_unheld: number; done: boolean; jobs_before: Record<string, number>; jobs_after: Record<string, number> };
  };
  const proof: Record<string, unknown> = {};
  const fpM1 = await fingerprint(nM1._id);
  const paidBefore = await paidClaimable();

  await t.test("C25: the dry run sends zero write commands; dbHash and the index inventory are identical; counts match", async () => {
    const before = await writeCount(), hash = await dbHash(), inv = await inventory();
    const run = cli();
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const after = await writeCount();
    assert.equal(after - before, 0, "zero write commands (top: insert + update + remove on this database)");
    assert.equal(await dbHash(), hash, "dbHash identical");
    assert.equal(await inventory(), inv, "no collection or index created");
    const { counts } = lastOutput();
    assert.equal(counts.numbers_scanned, 5);
    assert.equal(counts.would_attach, 1, "W");
    assert.equal(counts.would_repair_mirror, 2, "M1, M2");
    assert.equal(counts.would_repair_mirror_official_booked, 1, "M2");
    assert.equal(counts.already_attached_mirror_ok, 1, "K");
    assert.equal(counts.competing, 1, "C");
    assert.ok(existsSync(join(reportDir, "S10-2-replica-dry-run.md")));
    proof.dry_run = { top_writes: after - before, dbhash: hash, counts };
  });

  await t.test("apply --limit=2 then --resume: attach 1, repair 2 (one closes as booked), hold the one number_refresh, nothing unheld", async () => {
    const first = cli("--apply", "--limit=2");
    assert.equal(first.status, 0, first.stderr + first.stdout);
    assert.equal(lastOutput().done, false);
    const cp = JSON.parse(readFileSync(join(out, "sole-match-attachment-backfill.checkpoint.json"), "utf8")) as { counts: Record<string, number>; after: string };
    assert.equal(cp.counts.numbers_scanned, 2);
    const second = cli("--apply", "--resume");
    assert.equal(second.status, 0, second.stderr + second.stdout);
    const result = lastOutput();
    assert.equal(result.done, true);
    assert.equal(result.counts.numbers_scanned, 5, "each Number scanned once across the resume");
    assert.equal(result.counts.attached, 1);
    assert.equal(result.counts.mirror_repaired, 1, "M1");
    assert.equal(result.counts.mirror_repair_closed_record, 1, "M2: the repair applied the official closure");
    assert.equal(result.counts.held_number_refresh, 1);
    assert.equal(result.holds, 1);
    assert.equal(result.paid_created_unheld, 0);
    assert.equal((await Edges.findOne({ "lead_ref.id": aW._id }).lean())?.state, "attached");
    assert.equal((await Edges.findOne({ "lead_ref.id": aW._id }).lean())?.decision_reason, "sole_non_duplicate_match");
    assert.equal((await recordOf(aM1._id))?.lead_attachment?.state, "attached");
    const m2 = await recordOf(aM2._id);
    assert.equal(m2?.state, "closed"); assert.equal(m2?.closure_origin, "official"); assert.equal(m2?.closed_reason, "booked");
    const held = await Jobs.find({ stage: "number_refresh", status: "paused", reason: "operator_hold" }).lean();
    assert.equal(held.length, 1);
    assert.match(String(held[0]!.dedupe_key), new RegExp(`^csi:outreach-closure:${m2!._id}:`));
    assert.deepEqual(await paidClaimable(), paidBefore, "claimable paid-stage counts unchanged (zero model calls)");
    assert.equal(await Edges.countDocuments({ contact_number_id: nC._id, state: "attached" }), 0, "competing stays unattached");
    assert.equal(await fingerprint(nM1._id), fpM1, "the mirror repair does not change M1's Number fingerprint (no analysis wake)");
    proof.apply = { counts: result.counts, holds: result.holds, jobs_before: result.jobs_before, jobs_after: result.jobs_after,
      nonpaid_created: Object.fromEntries(Object.entries(result.counts).filter(([k]) => k.startsWith("nonpaid_job_"))) };
  });

  await t.test("a second apply writes nothing (dbHash, top)", async () => {
    const before = await writeCount(), hash = await dbHash();
    const run = cli("--apply");
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.equal(await writeCount() - before, 0);
    assert.equal(await dbHash(), hash);
    const { counts } = lastOutput();
    assert.equal(counts.already_attached_mirror_ok, 3, "W, M1, K");
    assert.equal(counts.mirror_record_closed, 1, "M2: closed, reported, never re-locked");
    assert.equal(counts.attached ?? 0, 0); assert.equal(counts.mirror_repaired ?? 0, 0); assert.equal(counts.mirror_repair_closed_record ?? 0, 0);
    proof.second_apply = { top_writes: 0, counts };
  });

  await t.test("--release-holds hands the held number_refresh back (operator decision)", async () => {
    // The second apply archived the first checkpoint: release from it.
    const archived = readdirSync(out).filter(f => /^sole-match-attachment-backfill\.checkpoint\..+\.json$/.test(f));
    assert.ok(archived.length >= 1);
    const withHold = archived.map(f => join(out, f)).find(f => (JSON.parse(readFileSync(f, "utf8")).holds ?? []).length === 1)!;
    writeFileSync(join(out, "sole-match-attachment-backfill.checkpoint.json"), readFileSync(withHold));
    const run = cli("--apply", "--release-holds");
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /"released":1/);
    assert.equal(await Jobs.countDocuments({ stage: "number_refresh", status: "paused", reason: "operator_hold" }), 0);
  });

  writeFileSync(join(reportDir, "S10-2-replica-proof.json"), JSON.stringify(proof, null, 1) + "\n");
  await db.dropDatabase();
  await mongoose.disconnect();
});
