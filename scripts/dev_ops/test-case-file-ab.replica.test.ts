/**
 * AC7-AB side-effect-free proof (Attention and Case File spec §10) on the csi01 replica with a stubbed
 * gateway: the 86-state seed is copied read-only into a disposable database, the script selects Numbers,
 * renders both layouts and runs both findings and both assessments against the stub. Proves: both layouts
 * produce validated outputs; nothing is written (Mongo op log = reads only, dbHash identical, no run,
 * submission, job or reservation row); the CLI refuses without --confirm-paid before any model call.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { runCaseFileAb, selectAbNumbers } from "./case-file-ab";

const SEED = "testvantagemovers_finalui";
const WRITE_METHODS = /^(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|bulkWrite|createIndex|drop|rename)/i;

/** A stub gateway: a minimal valid findings object, and an assessment citing the first customer-evidence catalog id. */
async function stubModel() {
  const { MockLanguageModelV4 } = await import("ai/test");
  const calls: Array<{ kind: "findings" | "assessment"; layout: string }> = [];
  const model = new MockLanguageModelV4({ doGenerate: async input => {
    const system = input.prompt.filter(m => m.role === "system").map(m => String(m.content)).join("");
    const user = input.prompt.filter(m => m.role === "user").flatMap(m => (Array.isArray(m.content) ? m.content : [])).map(part => ("text" in part ? part.text : "")).join("");
    const assessment = system.includes("Assess one moving-sales subject");
    calls.push({ kind: assessment ? "assessment" : "findings", layout: assessment ? (system.includes("Customer-evidence rule") ? "case_file" : "legacy") : (user.includes("\"case_file\"") ? "case_file" : "legacy") });
    let output: unknown;
    if (assessment) {
      const payload = JSON.parse(user.split("\nThe previous")[0]) as { conversations: Array<{ entries: Array<{ id: string; kind: string }> }> };
      const cite = payload.conversations.flatMap(c => c.entries).find(e => ["said_on_call", "summary_section", "move_evidence"].includes(e.kind))?.id;
      const dimension = { level: cite ? "exploring" : "unknown", confidence: "low", rationale: "Stubbed assessment for the A/B proof.", evidence_ids: cite ? [cite] : [], conditions: [] };
      output = { move_likelihood: dimension, transaction_intent: { ...dimension }, move_details: [], inventory: { items: [], coverage: "none", limitations: [] }, conflicts: [],
        engagement: { work_status: "unknown", rationale: "Stubbed.", evidence_ids: [], promised_callbacks: [], next_steps: [] } };
    } else {
      output = { summary: { overview: "Stubbed overview.", customer_wanted: "Unknown.", money_and_dates: "Unknown.", outcome: "Unknown.", commitments: "None.", discrepancies: "None." },
        findings: [], next_step: null, owner_instruction_assessments: [], prior_finding_relations: [], story_discrepancies: [] };
    }
    return { content: [{ type: "text", text: JSON.stringify(output) }], finishReason: { unified: "stop", raw: "synthetic" },
      usage: { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 100, text: 100, reasoning: 0 } }, warnings: [], providerMetadata: {} };
  } });
  return { model, calls };
}

test("AC7-AB: side-effect-free A/B with a stubbed gateway on a seed copy", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async (t) => {
  const database = getMongoDatabaseName();
  assert.match(database, /^testvantagemovers_t4cab[a-z0-9]+$/);
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
  const out = await mkdtemp(join(tmpdir(), "t4c-ab-"));
  const { model, calls } = await stubModel();
  const count = async (name: string) => target.collection(name).countDocuments();
  const counts = async () => ({ runs: await count("intelligence_runs"), submissions: await count("intelligence_submissions"), jobs: await count("sales_intelligence_jobs"),
    reservations: await count("sales_intelligence_ai_reservations"), snapshots: await count("intelligence_evidence_snapshots"), artifacts: await count("move_assessment_artifacts") });

  const ops: string[] = [];
  mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
  const before = await target.command({ dbHash: 1 }), rowsBefore = await counts();
  const selected = await selectAbNumbers(2, 6);
  const results = await runCaseFileAb({ numbers: selected, model, modelId: "openai/gpt-5.6-luna", pricing: { version: "stub", input_cents_per_million: 20, output_cents_per_million: 120 }, outDir: out });
  const after = await target.command({ dbHash: 1 }), rowsAfter = await counts();
  mongoose.set("debug", false);
  const writes = ops.filter(op => WRITE_METHODS.test(op.split(".").at(-1)!));
  console.log(JSON.stringify({ selected, ops: ops.length, methods: [...new Set(ops.map(o => o.split(".").at(-1)))].sort(), writes: writes.length, calls: calls.length,
    results: results.map(r => ({ number: r.number_id, category: r.category, skipped: r.skipped, case_file: r.case_file?.bytes,
      findings: r.findings.map(f => `${f.layout}:${f.error ?? "valid"}:${f.prompt_bytes}`), assessment: r.assessment.map(a => `${a.layout}:${a.error ?? a.skipped ?? "valid"}`) })) }));
  assert.deepEqual(writes, [], "reads only");
  assert.equal(after.md5, before.md5, "dbHash identical");
  assert.deepEqual(rowsAfter, rowsBefore, "no run, submission, job, reservation, snapshot or artifact row");
  assert.ok(selected.length >= 2, "the selection found seed Numbers");
  const ran = results.filter(r => !r.skipped);
  assert.ok(ran.length >= 1, "at least one Number ran both layouts");
  for (const r of ran) {
    assert.deepEqual(r.findings.map(f => f.layout), ["legacy", "case_file"]);
    for (const f of r.findings) assert.equal(f.error, undefined, `${r.number_id} ${f.layout} findings validated: ${f.error}`);
    assert.deepEqual(r.findings.map(f => f.prompt_version), ["sales_intelligence_analyze_v4", "sales_intelligence_analyze_v5"]);
    for (const a of r.assessment) assert.equal(a.error, undefined, `${r.number_id} ${a.layout} assessment validated: ${a.error}`);
    const file = await readFile(join(out, `${r.number_id}.md`), "utf8");
    assert.match(file, /## Findings, side by side/);
    assert.match(file, /## The rendered Case File\n\n```text\nCASE FILE \(data\) · /);
  }
  assert.ok(calls.some(c => c.kind === "findings" && c.layout === "case_file") && calls.some(c => c.kind === "findings" && c.layout === "legacy"));
  assert.match(await readFile(join(out, "SUMMARY.md"), "utf8"), /# AC7-AB summary \(model openai\/gpt-5\.6-luna\)/);

  // The CLI refuses a paid run without --confirm-paid, before connecting or calling anything.
  const numbersFile = join(out, "numbers.json");
  await writeFile(numbersFile, JSON.stringify(selected));
  const refused = spawnSync(process.execPath, ["--import", "tsx", "scripts/dev_ops/case-file-ab.ts", "--numbers", numbersFile], { encoding: "utf8", env: { ...process.env } });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /pass --confirm-paid only with the operator's approval/);
  console.log(JSON.stringify({ refusal: refused.stderr.trim().slice(0, 200), files: (await readdir(out)).length }));
});
