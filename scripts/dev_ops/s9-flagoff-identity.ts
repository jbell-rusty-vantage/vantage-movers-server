import { spawn } from "node:child_process";
/**
 * S9-PUBLISH flag-off identity (T3-S9-INTERFACE: "the flag off keeps the publish and every read byte-identical").
 *
 * One file, run unchanged from the base tree (feat/si-assignment-data@fbee8ee, extracted with `git archive`) and from
 * the S9 worktree, against ONE replica database, with the clock frozen (node:test MockTimers, `Date` only):
 *
 *   node --import tsx scripts/dev_ops/s9-flagoff-identity.ts seed --db t3bident
 *   (base tree)  node --import tsx scripts/dev_ops/s9-flagoff-identity.ts dump --db t3bident --out base.json
 *   (S9 tree)    node --import tsx scripts/dev_ops/s9-flagoff-identity.ts dump --db t3bident --out off.json
 *   (S9 tree)    node --import tsx scripts/dev_ops/s9-flagoff-identity.ts dump --db t3bident --out on.json --overview on
 *   node --import tsx scripts/dev_ops/s9-flagoff-identity.ts compare base.json off.json on.json
 *
 * `dump` publishes once at the frozen instant and records the snapshot rows, the header (minus identity and expiry),
 * every `GET /attention` page (all_outreach and the closed view), `GET /outreach/:id` and the Outreach timeline of
 * every record. `compare` checks base = off minus `filter_keys.responsible/overdue`, and base = on minus those two,
 * `outreach.band_since`, the header `publish_meta` and the timeline's `band_changed` events. Replica csi01 only.
 */
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const mode = process.argv[2];
const suffix = (arg("--db") ?? "t3bident").replace(/[^a-z0-9]/gi, "");
const database = `testvantagemovers_${suffix}`;
const FIXED = new Date("2026-09-23T19:00:00.000Z"); // Wed 15:00 EDT, staffed

if (mode === "compare") {
  void compare().catch(error => { console.error(error); process.exitCode = 1; });
} else if (process.env.S9_IDENTITY_CHILD !== "1") {
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", __filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env, S9_IDENTITY_CHILD: "1", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database, MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
      SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_LEAD_PROGRESS: "true",
      SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_ATTENTION_V2: "true", SALES_INTELLIGENCE_ATTENTION_EVOLUTION: "true", SALES_INTELLIGENCE_CASE_FILE: "true",
      SALES_INTELLIGENCE_PROGRESS_PLAN: "true", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "false", SALES_INTELLIGENCE_TIMELINE_V2: "true",
      SALES_INTELLIGENCE_OVERVIEW: arg("--overview") === "on" ? "true" : "false",
      RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
    },
  });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} else {
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}

async function main() {
  const { mock } = await import("node:test");
  mock.timers.enable({ apis: ["Date"], now: +FIXED });
  const assert = await import("node:assert/strict");
  const fs = await import("node:fs/promises");
  const mongoose = (await import("mongoose")).default;
  const { connectMongo } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  assert.equal(getMongoDatabaseName(), database);
  await connectMongo();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  try {
    if (mode === "seed") await seed(db);
    else if (mode === "dump") await fs.writeFile(arg("--out")!, JSON.stringify(await dump(), null, 1));
    else throw new Error(`unknown mode ${mode}`);
  } finally {
    await mongoose.disconnect();
    mock.timers.reset();
  }
}

async function seed(db: import("mongodb").Db) {
  const mongoose = (await import("mongoose")).default;
  const express = (await import("express")).default;
  const { withTransaction } = await import("../../src/db");
  const { applyCsiMigration } = await import("../migrations/sales-intelligence.lib");
  const { getContactNumberModel } = await import("../../src/models/ContactNumber");
  const { getCallInteractionModel } = await import("../../src/models/CallInteraction");
  const { getFormLeadModel } = await import("../../src/models/FormLead");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { getOutreachFollowupModel } = await import("../../src/models/OutreachFollowup");
  const { getRepIdentityLinkModel } = await import("../../src/models/RepIdentityLink");
  const { requireCsiOwner } = await import("../../src/services/salesIntelligence/auth");
  const { computeAdminActorSignature } = await import("../../src/services/operationsRegistry/trustedActor");
  const { persistLeadAttachments } = await import("../../src/services/salesIntelligence/attachment/store");
  const { ensureLead, workerContext } = await import("../../src/services/salesIntelligence/outreach/ensure");
  const { runOutreachEnsureJob } = await import("../../src/services/salesIntelligence/outreach/worker");
  const { commandOutreach } = await import("../../src/services/salesIntelligence/followups/commands");
  const { enqueueCsiJob } = await import("../../src/services/salesIntelligence/jobs");
  await db.dropDatabase();
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const now = +FIXED, MIN = 60_000, DAY = 86_400_000;
  const jordan = oid(), casey = oid();
  for (const [agent, ext, name] of [[jordan, "101", "Jordan"], [casey, "102", "Casey"]] as const)
    await getRepIdentityLinkModel().create({ agent_id: agent, agent_name_snapshot: name, rc_account_id: "synthetic", rc_extension_id: ext, role_kind: "sales_rep", status: "reviewed", effective_from: new Date(now - 400 * DAY) });
  await db.collection("agents").insertMany([{ _id: jordan, name: "Jordan", normalized_name: "jordan" }, { _id: casey, name: "Casey", normalized_name: "casey" }]);
  const request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/outreach/commands", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(now), requestId: "t3b-ident", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
    "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request);
  let serial = 0;
  async function fixture(ageDays: number, agent: mongoose.Types.ObjectId | null) {
    const at = new Date(now - ageDays * DAY);
    const n = await getContactNumberModel().create({ e164: `+120255507${String(++serial).padStart(2, "0")}`, digits_reversed: `t3bi${serial}`, first_observed_at: at, last_activity_at: at });
    const lead = { _id: oid(), timestamp: at, createdAt: at, updatedAt: at, name: `Synthetic Ident ${serial}`, normalized_phone_number: n.e164, receiver_agent: agent,
      ingested_contact_snapshot: { normalized_phone_number: n.e164, captured_at: at }, quoted: false, domain_revision: 0, granot_priority: serial % 3 === 0 ? "1" : null };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(async session => {
      await ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), at), String(n._id));
      await persistLeadAttachments(lead, "FormLead", session, String(oid()), at);
    });
    const record = await getOutreachRecordModel().findOne({ "subject.id": lead._id }).orFail();
    if (agent) await getOutreachRecordModel().collection.updateOne({ _id: record._id }, { $set: { responsible_agent_id: agent, assignment: { origin: "first_conversation", assigned_at: at } } });
    return { n, record };
  }
  const call = async (number: mongoose.Types.ObjectId, minutesAgo: number, kind: "attempt" | "inbound_human", ext = "101") => {
    const started_at = new Date(now - minutesAgo * MIN);
    const c = await getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: String(oid()), identity_basis: "telephony_session_id", contact_number_id: number,
      direction: kind === "inbound_human" ? "Inbound" : "Outbound", started_at, ended_at: new Date(+started_at + 120_000), first_observed_at: started_at, last_observed_at: started_at, terminal: true,
      provider_connected: kind !== "attempt", contact_type: kind === "attempt" ? "unknown" : "human_conversation",
      parties: [{ role: "user", extension_id: ext, direction: kind === "inbound_human" ? "Inbound" : "Outbound", connected: true }], ...(kind === "inbound_human" ? { inbound_route_id: oid() } : {}) });
    const job = await withTransaction(s => enqueueCsiJob({ stage: "outreach_ensure", subject_key: `number:${number}`, dedupe_key: `csi:t3bi:interaction:${c._id}`, input_revision: 1, input_refs: [String(c._id)] }, s));
    if ((await runOutreachEnsureJob(String(job._id))).status !== "completed") throw new Error("ensure job failed");
  };
  const records = [];
  for (let i = 0; i < 12; i++) records.push(await fixture(i % 4 === 0 ? 0.01 : 1 + i, i % 5 === 0 ? null : i % 2 ? jordan : casey));
  await call(records[1]!.n._id, 300, "attempt");
  await call(records[2]!.n._id, 2 * 24 * 60, "inbound_human", "102");
  await call(records[3]!.n._id, 20, "attempt");
  await call(records[3]!.n._id, 10, "attempt", "102");
  await call(records[6]!.n._id, 3 * 24 * 60, "attempt");
  await getOutreachFollowupModel().create({ outreach_record_id: records[5]!.record._id, commitment_key: `t3bi:${oid()}`, kind: "call", description: "Customer asked for a call back",
    origin: "customer_request", requested_by: "customer", due_at: new Date(now - DAY), base_attention_due_at: new Date(now - DAY), responsible_agent_id: jordan,
    date_resolution: { precision: "exact", timezone: "America/New_York", anchor: new Date(now - 2 * DAY), policy_version: "csi-policy-v1" } });
  const revisionOf = async (id: unknown) => (await getOutreachRecordModel().findById(id).orFail()).revision;
  await commandOutreach({ actor, idempotency_key: String(oid()), target_id: String(records[7]!.record._id),
    command: { command: "set_waiting", expected_revision: await revisionOf(records[7]!.record._id), until: new Date(now + 2 * DAY).toISOString(), reason: "Travelling" } as never });
  await commandOutreach({ actor, idempotency_key: String(oid()), target_id: String(records[9]!.record._id),
    command: { command: "close", expected_revision: await revisionOf(records[9]!.record._id), reason: "lost", note: "Not moving" } as never });
  console.log(`# seeded ${records.length} records in ${database} at ${FIXED.toISOString()}`);
}

async function dump() {
  const { publishAttentionSnapshot, readAttention, clearParsedAttentionSnapshots, decompressAttentionRows } = await import("../../src/services/salesIntelligence/outreach/attention");
  const { getSalesIntelligenceAttentionSnapshotModel } = await import("../../src/models/SalesIntelligenceAttentionSnapshot");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { readOutreach } = await import("../../src/services/salesIntelligence/outreach/reads");
  const { readOutreachTimeline } = await import("../../src/services/salesIntelligence/outreach/timelineRead");
  const published = await publishAttentionSnapshot({ deadlineMs: 600_000 }) as { status: string; snapshot_id: string };
  if (published.status !== "published") throw new Error("publish failed");
  const header = await getSalesIntelligenceAttentionSnapshotModel().findOne({ snapshot_id: published.snapshot_id }).lean() as Record<string, unknown>;
  const rows = header.rows_gzip_base64 ? decompressAttentionRows(String(header.rows_gzip_base64)) : header.rows;
  const { _id, snapshot_id, createdAt, updatedAt, expires_at, rows: _rows, rows_gzip_base64, index_gzip_base64, ...rest } = header;
  const { gunzipSync } = await import("node:zlib");
  const index = index_gzip_base64 ? JSON.parse(gunzipSync(Buffer.from(String(index_gzip_base64), "base64")).toString("utf8")) : null;
  clearParsedAttentionSnapshots();
  const pages = [];
  for (const view of ["attention", "all_outreach", "closed"] as const) {
    let cursor: string | undefined;
    do {
      const page = await readAttention({ view, limit: 5, ...(cursor ? { cursor } : {}) });
      pages.push({ ...page, data: { ...page.data, snapshot_id: "<snapshot>", cursor: page.data.cursor ? "<cursor>" : null } });
      cursor = page.data.cursor ?? undefined;
    } while (cursor);
  }
  const ids = (await getOutreachRecordModel().find({}).select({ _id: 1 }).sort({ _id: 1 }).lean()).map(r => String(r._id));
  const details = [], timelines = [];
  for (const id of ids) {
    details.push(await readOutreach(id));
    timelines.push(await readOutreachTimeline(id, { limit: 50 }, { now: () => new Date() }));
  }
  return { header: rest, rows, index, pages, details, timelines };
}

type Json = unknown;
async function compare() {
  const fs = await import("node:fs/promises");
  const assert = await import("node:assert/strict");
  const [basePath, offPath, onPath] = process.argv.slice(3);
  const load = async (path: string) => JSON.parse(await fs.readFile(path!, "utf8")) as Record<string, Json>;
  const base = await load(basePath!), off = await load(offPath!), on = onPath ? await load(onPath) : null;
  /** Drops the S9 additions: the two filter keys everywhere, `band_since`, header `publish_meta`, `band_changed` events. */
  const strip = (value: Json, key?: string): Json => {
    if (Array.isArray(value)) return value.filter(v => !(v && typeof v === "object" && (v as { kind?: string }).kind === "band_changed")).map(v => strip(v));
    if (value && typeof value === "object") {
      const out: Record<string, Json> = {};
      for (const [k, v] of Object.entries(value as Record<string, Json>)) {
        if (key === "filter_keys" && (k === "responsible" || k === "overdue")) continue;
        if (k === "band_since" || k === "publish_meta") continue;
        out[k] = strip(v, k);
      }
      return out;
    }
    return value;
  };
  const sections = ["header", "rows", "index", "pages", "details", "timelines"];
  const counts = (dump: Record<string, Json>) => ({ rows: (dump.rows as unknown[]).length, details: (dump.details as unknown[]).length, timelines: (dump.timelines as unknown[]).length });
  console.log("# sizes", JSON.stringify({ base: counts(base), off: counts(off), ...(on ? { on: counts(on) } : {}) }));
  // Flag off: the only difference is the two additive filter keys (rows, index, pages); nothing else moves.
  for (const section of sections) assert.deepEqual(strip(off[section]), base[section], `flag off, ${section}`);
  const offOnlyKeys = JSON.stringify(off).match(/"(responsible|overdue)":/g)?.length ?? 0;
  assert.equal(JSON.stringify(off).includes("band_since") || JSON.stringify(off).includes("publish_meta") || JSON.stringify(off).includes("band_changed"), false, "flag off carries no S9 field");
  console.log(`# flag off = base for ${sections.join(", ")} after removing ${offOnlyKeys} filter_keys.responsible/overdue entries`);
  if (on) {
    // The index entry also carries the record `revision` beside `band_since` (flag on only).
    const onIndex = (on.index as Record<string, Json>[] | null)?.map(({ revision: _revision, ...entry }) => entry) ?? null;
    for (const section of sections) assert.deepEqual(strip(section === "index" ? onIndex : on[section]), base[section], `flag on minus S9 additions, ${section}`);
    const bands = JSON.stringify(on).match(/"band_since":/g)?.length ?? 0, events = JSON.stringify(on).match(/"kind":"band_changed"/g)?.length ?? 0;
    console.log(`# flag on = base after removing the filter keys, ${bands} band_since fields, publish_meta and ${events} band_changed events`);
  }
  console.log("# identity: PASS");
}
