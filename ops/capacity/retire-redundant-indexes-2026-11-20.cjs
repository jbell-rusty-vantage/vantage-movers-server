// Retire prefix-redundant single-field Lead indexes flagged by Atlas Performance Advisor (2026-11-20).
//
//   node ops/capacity/retire-redundant-indexes-2026-11-20.cjs            # preflight only, changes nothing
//   node ops/capacity/retire-redundant-indexes-2026-11-20.cjs --hide     # hide each target (reversible: --unhide)
//   node ops/capacity/retire-redundant-indexes-2026-11-20.cjs --unhide   # rollback for --hide
//   node ops/capacity/retire-redundant-indexes-2026-11-20.cjs --drop     # drop each target (rollback: recreate from the before file)
//
// Every target must exist with exactly the expected key and no unique, sparse, partial or collation option,
// and its covering compound index must exist, be visible and start with the target's key. Any mismatch aborts
// before the first change. Writes before/after listIndexes evidence to docs/operations/evidence/.
// Requires an explicit Owner approval for --hide/--drop. Never prints the connection string.
require("dotenv").config({ quiet: true });
const dns = require("dns");
if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(","));
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

const TARGETS = [
  ["booked_leads", "lead_ref_1", { lead_ref: 1 }, "lead_ref_1_lead_model_1"],
  ["lead_messages", "form_lead_1", { form_lead: 1 }, "form_lead_1_createdAt_-1"],
  ["booking_lead_reconciliation_cases", "origin_1", { origin: 1 }, "origin_1_status_1_createdAt_-1"],
  ["booking_lead_reconciliation_cases", "reason_1", { reason: 1 }, "reason_1_status_1_updatedAt_-1"],
  ["booking_lead_reconciliation_cases", "status_1", { status: 1 }, "status_1_createdAt_-1"],
  ["call_leads", "lead_source_company_1", { lead_source_company: 1 }, "lead_source_company_1_createdAt_-1"],
  ["call_leads", "source_company_1", { source_company: 1 }, "source_company_1_createdAt_-1"],
  ["call_leads", "source_company_1_normalized_phone_number_1_duplicate_1",
    { source_company: 1, normalized_phone_number: 1, duplicate: 1 },
    "source_company_1_normalized_phone_number_1_duplicate_1_timestamp_-1"],
  ["form_leads", "lead_source_company_1", { lead_source_company: 1 }, "lead_source_company_1_createdAt_-1"],
  ["form_leads", "normalized_phone_number_1", { normalized_phone_number: 1 }, "form_lead_attach_normalized_phone_number"],
  ["form_leads", "ref_no_1", { ref_no: 1 }, "form_lead_ref_no_duplicate"],
  ["form_leads", "source_company_1", { source_company: 1 }, "source_company_1_createdAt_-1"],
  ["form_leads", "source_granularity_id_1", { source_granularity_id: 1 }, "form_lead_source_granularity_normalized_job_no"],
];
// Held: call_leads.source_granularity_id_1 — ops/best-relocation-retirement/callBackfillScan.ts requires a single-field index.

const mode = process.argv.includes("--drop") ? "drop" : process.argv.includes("--hide") ? "hide"
  : process.argv.includes("--unhide") ? "unhide" : "preflight";
const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isPrefix = (prefix, key) => {
  const p = Object.entries(prefix), k = Object.entries(key);
  return p.length < k.length && p.every(([f, d], i) => k[i][0] === f && k[i][1] === d);
};

(async () => {
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000, appName: "retire-redundant-indexes" });
  await client.connect();
  const db = client.db("vantagemovers");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const evidenceDir = path.join(__dirname, "..", "..", "docs", "operations", "evidence");
  const snapshot = async () => {
    const out = {};
    for (const coll of [...new Set(TARGETS.map(t => t[0]))]) out[coll] = await db.collection(coll).indexes();
    return out;
  };
  try {
    const before = await snapshot();
    const problems = [];
    for (const [coll, name, key, cover] of TARGETS) {
      const target = before[coll].find(i => i.name === name);
      const covering = before[coll].find(i => i.name === cover);
      if (!target) { if (mode !== "unhide") problems.push(`${coll}.${name}: missing`); continue; }
      if (!sameKey(target.key, key)) problems.push(`${coll}.${name}: key ${JSON.stringify(target.key)}`);
      // A drop only follows the hidden observation window. An index that is visible again was
      // unhidden as a rollback, so the drop refuses rather than removing it.
      if (mode === "drop" && target.hidden !== true) problems.push(`${coll}.${name}: not hidden (unhidden as rollback?); refusing to drop`);
      for (const opt of ["unique", "sparse", "partialFilterExpression", "collation", "expireAfterSeconds"])
        if (target[opt] !== undefined) problems.push(`${coll}.${name}: has ${opt}`);
      if (!covering) problems.push(`${coll}.${cover}: covering index missing`);
      else {
        if (covering.hidden) problems.push(`${coll}.${cover}: covering index hidden`);
        if (covering.partialFilterExpression || covering.sparse) problems.push(`${coll}.${cover}: covering index is partial or sparse`);
        if (!isPrefix(key, covering.key)) problems.push(`${coll}.${cover}: does not start with ${JSON.stringify(key)}`);
      }
    }
    const beforeFile = path.join(evidenceDir, `redundant-indexes-before-${stamp}.json`);
    fs.writeFileSync(beforeFile, JSON.stringify({ at: new Date(), mode, targets: TARGETS, problems, indexes: before }, null, 2));
    console.log(JSON.stringify({ mode, targets: TARGETS.length, problems, before: path.relative(process.cwd(), beforeFile) }, null, 2));
    if (problems.length) { process.exitCode = 2; return; }
    if (mode === "preflight") return;

    const results = [];
    for (const [coll, name] of TARGETS) {
      const present = before[coll].find(i => i.name === name);
      if (!present) { results.push({ coll, name, result: "absent" }); continue; }
      if (mode === "drop") await db.collection(coll).dropIndex(name);
      else await db.command({ collMod: coll, index: { name, hidden: mode === "hide" } });
      results.push({ coll, name, result: mode });
    }
    const after = await snapshot();
    const afterFile = path.join(evidenceDir, `redundant-indexes-after-${stamp}.json`);
    fs.writeFileSync(afterFile, JSON.stringify({ at: new Date(), mode, results, indexes: after }, null, 2));
    console.log(JSON.stringify({ results, after: path.relative(process.cwd(), afterFile) }, null, 2));
  } finally {
    await client.close();
  }
})().catch(e => { console.error(e.name, e.code, String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, "mongodb://***")); process.exitCode = 1; });
