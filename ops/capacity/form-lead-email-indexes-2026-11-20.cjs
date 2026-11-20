// Add the two Form Lead contact-email indexes the Granot identity contact match needs (Owner-approved 2026-11-20,
// INDEX-READ-BASELINE index-phase item 1). Without them the six-branch contact `$or` cannot use an index union and
// scans the whole Lead Source scope (about 3,000 keys for 0 returned).
//
//   node ops/capacity/form-lead-email-indexes-2026-11-20.cjs            # preflight only, changes nothing
//   node ops/capacity/form-lead-email-indexes-2026-11-20.cjs --create   # create both (idempotent), then verify
//   node ops/capacity/form-lead-email-indexes-2026-11-20.cjs --verify   # read-only: definitions, plan, per-member sizes
//   node ops/capacity/form-lead-email-indexes-2026-11-20.cjs --hide     # rollback step 1 (reversible: --unhide)
//   node ops/capacity/form-lead-email-indexes-2026-11-20.cjs --unhide
//   node ops/capacity/form-lead-email-indexes-2026-11-20.cjs --drop     # rollback step 2; refuses an index that is not hidden
//
// Preflight refuses when a target name exists with another definition, when another index already has a target key,
// or when the replica set is not healthy. Writes before/after evidence to docs/operations/evidence/. Never prints the
// connection string. The definitions match `FORM_LEAD_CONTACT_EMAIL_INDEXES` in src/models/FormLead.ts.
require("dotenv").config({ quiet: true });
const dns = require("dns");
if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(","));
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

const COLLECTION = "form_leads";
// Production by default. A rehearsal may name a disposable test database (testvantagemovers_*) only.
const DATABASE = process.env.FORM_LEAD_INDEX_REHEARSAL_DB || "vantagemovers";
if (DATABASE !== "vantagemovers" && !/^testvantagemovers_[a-z0-9]+$/.test(DATABASE)) throw new Error("rehearsal database must be testvantagemovers_*");
const TARGETS = [
  { name: "form_lead_ingested_contact_email", key: { "ingested_contact_snapshot.email": 1 }, sparse: true },
  { name: "form_lead_granot_contact_email", key: { "granot_contact_snapshot.email": 1 }, sparse: true },
];
const mode = ["--create", "--verify", "--hide", "--unhide", "--drop"].find((flag) => process.argv.includes(flag))?.slice(2) ?? "preflight";
const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const redact = (value) => String(value).replace(/mongodb(\+srv)?:\/\/\S+/g, "mongodb://***");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = path.join(__dirname, "..", "..", "docs", "operations", "evidence");

/** The contact-match shape of `identity.ts` `findFormLeadsByScopedContact`, with reserved fictional values. */
function contactShape(scope) {
  const phones = ["2015550199"], emails = ["nobody@example.test"];
  return { lead_source_company: scope.lead_source_company, source_granularity_id: scope.source_granularity_id, duplicate: { $ne: true }, $or: [
    { normalized_phone_number: { $in: phones } }, { "ingested_contact_snapshot.normalized_phone_number": { $in: phones } },
    { "granot_contact_snapshot.normalized_phone_number": { $in: phones } }, { email: { $in: emails } },
    { "ingested_contact_snapshot.email": { $in: emails } }, { "granot_contact_snapshot.email": { $in: emails } },
  ] };
}

async function planOf(db) {
  // The largest Lead Source scope is the worst case for the scan this removes.
  const [scope] = await db.collection(COLLECTION).aggregate([
    { $match: { lead_source_company: { $type: "objectId" }, source_granularity_id: { $type: "objectId" } } },
    { $group: { _id: { lead_source_company: "$lead_source_company", source_granularity_id: "$source_granularity_id" }, n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 1 },
  ], { maxTimeMS: 15000 }).toArray();
  if (!scope) return { scope_size: 0, keys: 0, docs: 0, returned: 0, ms: 0, indexes: [], collscan: false, empty: true };
  const explain = await db.collection(COLLECTION).find(contactShape(scope._id)).maxTimeMS(15000).explain("executionStats");
  const s = explain.executionStats;
  return { scope_size: scope.n, keys: s.totalKeysExamined, docs: s.totalDocsExamined, returned: s.nReturned, ms: s.executionTimeMillis,
    indexes: [...new Set(JSON.stringify(explain.queryPlanner.winningPlan).match(/"indexName":"[^"]+"/g) ?? [])].map((x) => x.slice(13, -1)),
    collscan: JSON.stringify(explain.queryPlanner.winningPlan).includes("COLLSCAN") };
}

/** Index sizes on every member, read with a direct connection to each host. */
async function memberSizes(client) {
  const hello = await client.db("admin").command({ hello: 1 });
  const uri = new URL(process.env.MONGO_URI.replace(/^mongodb\+srv:/, "https:").replace(/^mongodb:/, "https:"));
  const out = [];
  for (const host of hello.hosts ?? []) {
    // Atlas members need TLS and the URI's credentials; a loopback rehearsal replica has neither.
    const secured = Boolean(uri.username);
    const direct = new MongoClient(`mongodb://${host}/?directConnection=true&readPreference=secondaryPreferred${secured ? "&tls=true&authSource=admin" : ""}`, {
      ...(secured ? { auth: { username: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password) } } : {}), serverSelectionTimeoutMS: 15000 });
    try {
      await direct.connect();
      const member = direct.db(DATABASE);
      const stats = await member.command({ collStats: COLLECTION });
      const state = await direct.db("admin").command({ hello: 1 });
      out.push({ member: host.split(".")[0], primary: state.isWritablePrimary === true,
        sizes: Object.fromEntries(TARGETS.map((t) => [t.name, stats.indexSizes?.[t.name] ?? null])), totalIndexSize: stats.totalIndexSize });
    } catch (error) {
      out.push({ member: host.split(".")[0], error: redact(error.message) });
    } finally {
      await direct.close();
    }
  }
  return out;
}

(async () => {
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000, appName: "form-lead-email-indexes" });
  await client.connect();
  const db = client.db(DATABASE);
  const coll = db.collection(COLLECTION);
  try {
    const before = await coll.indexes();
    const problems = [];
    for (const target of TARGETS) {
      const byName = before.find((i) => i.name === target.name);
      const byKey = before.filter((i) => sameKey(i.key, target.key) && i.name !== target.name);
      if (byName && (!sameKey(byName.key, target.key) || byName.sparse !== true || byName.unique || byName.partialFilterExpression || byName.collation))
        problems.push(`${target.name}: exists with another definition`);
      if (byKey.length) problems.push(`${target.name}: key already indexed as ${byKey.map((i) => i.name).join(", ")}`);
      if ((mode === "drop") && byName && byName.hidden !== true) problems.push(`${target.name}: not hidden; hide and observe before dropping`);
    }
    const status = await db.admin().command({ replSetGetStatus: 1 }).catch(() => null);
    const members = status?.members?.map((m) => ({ name: m.name.split(".")[0], state: m.stateStr, health: m.health })) ?? null;
    if (members && members.some((m) => m.health !== 1 || !["PRIMARY", "SECONDARY"].includes(m.state))) problems.push("replica set not healthy");
    const counts = Object.fromEntries(await Promise.all(TARGETS.map(async (t) => [t.name, await coll.countDocuments({ [Object.keys(t.key)[0]]: { $type: "string" } })])));
    const plan = await planOf(db);
    const beforeFile = path.join(evidenceDir, `form-lead-email-indexes-before-${stamp}.json`);
    fs.writeFileSync(beforeFile, JSON.stringify({ at: new Date(), mode, targets: TARGETS, problems, members, documents_with_value: counts, plan, indexes: before }, null, 2));
    console.log(JSON.stringify({ mode, problems, members, documents_with_value: counts, plan, before: path.relative(process.cwd(), beforeFile) }, null, 2));
    if (problems.length) { process.exitCode = 2; return; }
    if (mode === "preflight") return;

    const results = [];
    if (mode === "create") {
      const hidden = TARGETS.filter((t) => before.some((i) => i.name === t.name && i.hidden === true));
      if (hidden.length) {
        console.error(`already present but hidden: ${hidden.map((t) => t.name).join(", ")}; run --unhide (a rollback is in progress), not --create`);
        process.exitCode = 4;
        return;
      }
      const missing = TARGETS.filter((t) => !before.some((i) => i.name === t.name));
      if (missing.length) await coll.createIndexes(missing.map((t) => ({ name: t.name, key: t.key, sparse: t.sparse })));
      results.push(...TARGETS.map((t) => ({ name: t.name, result: missing.includes(t) ? "created" : "already_present" })));
    } else if (mode === "hide" || mode === "unhide") {
      for (const t of TARGETS) if (before.some((i) => i.name === t.name)) {
        await db.command({ collMod: COLLECTION, index: { name: t.name, hidden: mode === "hide" } });
        results.push({ name: t.name, result: mode });
      }
    } else if (mode === "drop") {
      for (const t of TARGETS) if (before.some((i) => i.name === t.name)) { await coll.dropIndex(t.name); results.push({ name: t.name, result: "dropped" }); }
    }
    const after = await coll.indexes();
    const verify = {
      definitions: TARGETS.map((t) => { const i = after.find((x) => x.name === t.name); return { name: t.name, present: !!i, key_ok: !!i && sameKey(i.key, t.key), sparse: i?.sparse === true, hidden: i?.hidden === true }; }),
      plan: await planOf(db),
      members: await memberSizes(client),
    };
    const afterFile = path.join(evidenceDir, `form-lead-email-indexes-after-${stamp}.json`);
    fs.writeFileSync(afterFile, JSON.stringify({ at: new Date(), mode, results, verify, indexes: after }, null, 2));
    console.log(JSON.stringify({ results, verify, after: path.relative(process.cwd(), afterFile) }, null, 2));
    if (mode === "create" || mode === "verify") {
      // An empty collection has no scope to plan; the definitions alone are checked.
      const planOk = verify.plan.empty === true || (!verify.plan.collscan && TARGETS.every((t) => verify.plan.indexes.includes(t.name)) && verify.plan.keys < 100);
      const ok = verify.definitions.every((d) => d.present && d.key_ok && d.sparse && !d.hidden) && planOk;
      const hiddenNow = verify.definitions.filter((d) => d.hidden).map((d) => d.name);
      if (!ok) { console.error(hiddenNow.length ? `verify failed: ${hiddenNow.join(", ")} hidden; run --unhide` : "verify failed: see the after file"); process.exitCode = 3; }
    }
  } finally {
    await client.close();
  }
})().catch((e) => { console.error(e.name, e.code, redact(e.message)); process.exitCode = 1; });
