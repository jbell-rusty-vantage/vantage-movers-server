import { spawn } from "node:child_process";
/**
 * Team 4 K17: a read-only snapshot of `derive()` over every Outreach Record of a replica database.
 *
 * Loads every non-purged Outreach Record with exactly what the Attention publish hands `derive()`
 * (`loadOutreachInputsBatch`: follow-ups, restrictions, review items, the Contact Number and the
 * 24-hour attempt audit; the resolved policy; Capture Coverage) and writes one row per record,
 * sorted by record id, with the `deriveOutreachFacts()` output at a fixed `as_of`. Nothing is
 * written to the database. The same file runs unchanged in the base worktree (`%TEMP%/t4base`,
 * commit 01bcf18), so a flag-off diff is `diff base.json branch.json`.
 *
 *   node --import tsx scripts/dev_ops/snapshot-derive.ts <db> <out.json> [--as-of ISO] [--evolution on|off]
 *
 * `<db>` is a replica database name (`testvantagemovers_<alnum>`) on csi01 (127.0.0.1:27189).
 * `--as-of` defaults to 2026-09-24T16:00:00.000Z so two runs on the same data are byte-identical.
 * `--evolution on` sets SALES_INTELLIGENCE_ATTENTION_EVOLUTION=true (branch only; base ignores it).
 */
const [, , dbArg, outArg] = process.argv;
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
if (!dbArg || !outArg || !/^testvantagemovers_[a-z0-9]+$/i.test(dbArg)) {
  console.error("usage: snapshot-derive.ts <testvantagemovers_db> <out.json> [--as-of ISO] [--evolution on|off]");
  process.exit(2);
}
if (process.env.T4_DERIVE_CHILD !== "1") {
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", __filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env, T4_DERIVE_CHILD: "1", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: dbArg, MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
      SALES_INTELLIGENCE_DEPLOYMENT_ID: process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID ?? "csi-local-proof", SHEET_SYNC_MODE: "disabled",
      SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_LEAD_PROGRESS: "true",
      SALES_INTELLIGENCE_ATTENTION_EVOLUTION: arg("--evolution") === "on" ? "true" : "false",
      RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global",
      VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
    },
  });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} else {
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}

async function main() {
  const { createHash } = await import("node:crypto");
  const { writeFileSync } = await import("node:fs");
  const mongoose = (await import("mongoose")).default;
  const { connectMongo } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { loadOutreachInputsBatch, deriveOutreachFacts } = await import("../../src/services/salesIntelligence/outreach/reads");
  const { resolvePolicy } = await import("../../src/services/salesIntelligence/policy");
  const { readCaptureCoverage } = await import("../../src/services/numberActivity/coverage");
  const { subjectKey } = await import("../../src/services/salesIntelligence/outreach/types");
  if (getMongoDatabaseName() !== dbArg) throw new Error("database mismatch");
  const asOf = new Date(arg("--as-of") ?? "2026-09-24T16:00:00.000Z");
  if (!Number.isFinite(+asOf)) throw new Error("invalid --as-of");
  await connectMongo();
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (hello.setName !== "csi01") throw new Error("not the csi01 replica");
    const [policy, coverage] = await Promise.all([resolvePolicy(), readCaptureCoverage()]);
    const rows: Array<{ record_id: string; subject_key: string; state: string; derived: unknown }> = [];
    let after: unknown = null;
    for (;;) {
      const page = await getOutreachRecordModel().find({ purged_at: null, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(500).lean();
      if (!page.length) break;
      const inputs = await loadOutreachInputsBatch(page, asOf);
      for (const record of page) {
        const bundle = inputs.get(String(record._id));
        if (!bundle) continue;
        rows.push({ record_id: String(record._id), subject_key: subjectKey(record.subject), state: record.state,
          derived: JSON.parse(JSON.stringify(deriveOutreachFacts(record, bundle, { now: asOf, policy, coverage }))) });
      }
      if (page.length < 500) break;
      after = page.at(-1)!._id;
    }
    rows.sort((a, b) => a.record_id.localeCompare(b.record_id));
    const body = JSON.stringify({ database: dbArg, as_of: asOf.toISOString(), evolution: process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION === "true",
      policy_version: policy.version, records: rows.length, rows }, null, 1) + "\n";
    writeFileSync(outArg!, body);
    const digest = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    const bands: Record<string, number> = {};
    for (const row of rows) { const band = String((row.derived as { attention_band: number | null }).attention_band); bands[band] = (bands[band] ?? 0) + 1; }
    console.log(JSON.stringify({ out: outArg, records: rows.length, as_of: asOf.toISOString(), rows_sha256: digest, bands }));
  } finally {
    await mongoose.disconnect();
  }
}
