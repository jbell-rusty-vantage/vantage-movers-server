/**
 * SLIM-09 purge rehearsal: seeds a synthetic production-shaped dataset on a LOOPBACK replica.
 *
 *   MONGO_URI=mongodb://127.0.0.1:27189/?replicaSet=csi01 node --import tsx ops/slimming/rehearsal/seed.ts \
 *     --main-db=slimrehearsal_main --admin-db=slimrehearsal_admin --deployment-commit=<sha> [--live-legacy-lease]
 *
 * Creates, in the rehearsal main DB, every policy drop target, every protected collection, the mixed cleanup
 * collections with rows each cleanup must and must not touch, an unclassified collection, and the deployment stamp;
 * the literal `vantagemovershistorical` database; and the rehearsal Admin auth DB (audit log + kept auth). Refuses
 * when any of the three databases already exists. Synthetic values only; no production data is read.
 * `--live-legacy-lease` adds one legacy-stage job whose lease is still live (the purge must abort on it).
 */
import { ObjectId } from "mongodb";
import {
  ADMIN_DROP_COLLECTIONS,
  ADMIN_NEVER_DROP,
  CONTACT_NUMBER_DEAD_FIELDS,
  CONTACT_NUMBER_REVIEW_FIELDS,
  HISTORICAL_DATABASE,
  KEPT_SYNC_SCOPES,
  MAIN_DROP_COLLECTIONS,
  NEVER_DROP,
  PENDING_SYNC_SCOPES,
  RETIRED_SYNC_SCOPES,
} from "../policy";
import { REHEARSAL_DATABASE_PATTERN } from "../lib/rehearsal";
import { arg, assertRehearsalWritableDatabase, connectLoopbackReplica } from "./guard";

const MINUTE = 60_000;

async function main(): Promise<void> {
  const mainDb = arg("main-db") ?? "";
  const adminDb = arg("admin-db") ?? "";
  const commit = arg("deployment-commit") ?? "";
  if (!REHEARSAL_DATABASE_PATTERN.test(mainDb) || !REHEARSAL_DATABASE_PATTERN.test(adminDb) || mainDb === adminDb)
    throw new Error("--main-db and --admin-db must be two distinct slimrehearsal_<suffix> names");
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error("--deployment-commit must be a commit sha");
  for (const db of [mainDb, adminDb, HISTORICAL_DATABASE]) assertRehearsalWritableDatabase(db);

  const client = await connectLoopbackReplica();
  try {
    const existing = (await client.db("admin").admin().listDatabases({ nameOnly: true })).databases.map((d) => d.name);
    const clash = [mainDb, adminDb, HISTORICAL_DATABASE].filter((db) => existing.includes(db));
    if (clash.length) throw new Error(`refusing to seed over existing database(s): ${clash.join(", ")}`);

    const now = new Date();
    const main = client.db(mainDb);
    const counts: Record<string, number> = {};
    const insert = async (db: string, name: string, docs: Array<Record<string, unknown>>) => {
      await client.db(db).collection(name).insertMany(docs.map((doc) => ({ _id: new ObjectId(), ...doc })));
      counts[`${db}.${name}`] = docs.length;
    };
    const many = (n: number, make: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => make(i));

    // 1. Every exclusive drop target in the main DB (2-4 documents each; one TTL index; media pathnames).
    let k = 0;
    for (const name of Object.keys(MAIN_DROP_COLLECTIONS)) {
      const n = 2 + (k++ % 3);
      await insert(mainDb, name, many(n, (i) => ({ synthetic: "slim-rehearsal", seq: i, createdAt: new Date(now.getTime() - i * MINUTE) })));
    }
    await main.collection("lead_conversations").updateMany({ seq: { $in: [0, 1] } }, [{ $set: { media: { blob_pathname: { $concat: ["conversations/rehearsal/", { $toString: "$_id" }, ".mp3"] } } } }]);
    await main.collection("notification_deliveries").createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: "rehearsal_ttl" });
    await main.collection("notification_deliveries").updateMany({}, { $set: { expires_at: new Date(now.getTime() + 365 * 24 * 60 * MINUTE) } });

    // 2. Protected namespaces: every NEVER_DROP name holds documents.
    const special = new Set(["contact_numbers", "sales_intelligence_jobs", "sales_intelligence_sync_state", "sales_intelligence_audit_events", "daily_operations_events", "daily_operations_days", "granot_webhook_receipts", "entity_changes"]);
    for (const name of NEVER_DROP) if (!special.has(name)) await insert(mainDb, name, many(2, (i) => ({ synthetic: "slim-rehearsal", seq: i })));
    await insert(mainDb, "testimonials", many(1, () => ({ synthetic: "slim-rehearsal" })));
    await insert(mainDb, "rehearsal_unclassified_collection", many(2, (i) => ({ synthetic: "slim-rehearsal", seq: i })));
    await insert(mainDb, "daily_operations_events", many(3, (i) => ({ synthetic: "slim-rehearsal", kind: "booking_confirmed", seq: i, occurred_at: new Date(now.getTime() - i * MINUTE) })));
    await insert(mainDb, "daily_operations_days", many(2, (i) => ({ synthetic: "slim-rehearsal", day: `2026-10-0${i + 1}`, totals: { bookings: i + 1 } })));
    await insert(mainDb, "granot_webhook_receipts", many(3, (i) => ({ synthetic: "slim-rehearsal", status: ["processed", "dead_letter", "pending"][i], channel: "granot_webhook" })));
    await insert(mainDb, "entity_changes", many(3, (i) => ({ synthetic: "slim-rehearsal", entity: { model: "FormLead", id: `lead-${i}` }, revision: i + 1 })));

    // 3. contact_numbers: dead fields (C1), review fields (C5) and purged_at (kept) in every combination.
    const dead = { running_summary: { text: "synthetic", run_id: new ObjectId() }, intelligence_schedule: { job_id: new ObjectId(), next_at: now } };
    const deadRollups = { open_outreach_count: 1, conversations_analyzed_total: 2, last_analyzed_at: now, outreach_records_total: 3, last_meaningful_contact_at: now };
    const review = { content_purge_pending: true, retention_epoch: 2, evidence_fence: { at: now } };
    await insert(mainDb, "contact_numbers", [
      { e164: "+15550000001", ...dead, rollups: { ...deadRollups, calls_total: 7 }, ...review, purged_at: now },
      { e164: "+15550000002", ...review, purged_at: now, rollups: { calls_total: 1 } },
      { e164: "+15550000003", ...dead, rollups: { ...deadRollups, calls_total: 2 } },
      { e164: "+15550000004", purged_at: now, rollups: { calls_total: 0 } },
      { e164: "+15550000005", rollups: { calls_total: 4 } },
    ]);
    await main.collection("contact_numbers").createIndex({ e164: 1 }, { unique: true, name: "e164_1" });

    // 4. sales_intelligence_jobs: legacy stages in every status, retained stages that must stay untouched.
    const job = (stage: string, status: string, extra: Record<string, unknown> = {}) => ({
      dedupe_key: `rehearsal:${stage}:${status}`, payload_hash: "rehearsal", stage, subject_key: "number:rehearsal", input_revision: 1,
      deployment: "csi-production", database: mainDb, status, attempts: 1, max_attempts: 8, priority: 0,
      next_attempt_at: new Date(now.getTime() - MINUTE), lease_owner: null, lease_epoch: 1, leased_until: null, reason: null,
      result: null, completed_at: null, input_refs: [], createdAt: now, updatedAt: now, ...extra,
    });
    const expired = { lease_owner: "old-worker", leased_until: new Date(now.getTime() - 10 * MINUTE) };
    const live = { lease_owner: "live-worker", leased_until: new Date(now.getTime() + 60 * MINUTE) };
    await insert(mainDb, "sales_intelligence_jobs", [
      job("analysis", "pending"),
      job("backfill", "pending"),
      job("transcription", "retry"),
      job("media_fetch", "paused"),
      job("outreach_ensure", "leased", expired),
      job("move_assessment", "dead_letter"),
      job("application", "completed", { completed_at: now }),
      job("rep_identity_reevaluate", "completed", { completed_at: now }),
      job("number_refresh", "retired", { reason: "stage_retired" }),
      ...(process.argv.includes("--live-legacy-lease") ? [job("recording_discovery", "leased", live)] : []),
      job("attachment_refresh", "pending"),
      job("call_log_reconcile", "leased", { ...live, dedupe_key: "rehearsal:call_log_reconcile:leased-live" }),
      job("directory", "completed", { completed_at: now }),
      job("rebuild", "retry"),
      job("nudge_repair", "paused"),
      job("capture_projection", "dead_letter"),
    ]);
    await main.collection("sales_intelligence_jobs").createIndex({ dedupe_key: 1 }, { unique: true, name: "csi_job_dedupe" });

    // 5. sync_state: retired + outreach-cursor scopes (deleted), kept scopes incl. the deployment stamp (kept).
    await insert(mainDb, "sales_intelligence_sync_state", [
      ...[...RETIRED_SYNC_SCOPES, ...PENDING_SYNC_SCOPES].map((scope) => ({ scope, cursor: { at: now }, updatedAt: now })),
      ...KEPT_SYNC_SCOPES.filter((s) => s !== "deployment").map((scope) => ({ scope, cursor: { at: now }, updatedAt: now })),
      { scope: "rep_identity:rehearsal", cursor: { at: now }, updatedAt: now },
      { scope: "deployment", deployment_commit: commit, commit_source: "rehearsal", vercel_deployment_id: null, recorded_at: now },
    ]);
    await main.collection("sales_intelligence_sync_state").createIndex({ scope: 1 }, { unique: true, name: "scope_1" });

    // 6. Audit: retired kinds by worker/intelligence (deleted) and by Owner/Rep (kept); a kept kind by a worker (kept).
    const audit = (event_kind: string, actor: string) => ({ event_kind, actor: { kind: actor, id: `${actor}-1` }, happened_at: now, payload: { synthetic: true } });
    await insert(mainDb, "sales_intelligence_audit_events", [
      ...["intelligence.published", "outreach_created", "media_played"].flatMap((kind) => ["worker", "intelligence", "owner", "rep"].map((actor) => audit(kind, actor))),
      audit("owner_instruction_created", "worker"),
      audit("restriction_applied", "owner"),
    ]);

    // 7. Historical database (dropped whole) and the Admin auth DB (audit log dropped, auth kept).
    await insert(HISTORICAL_DATABASE, "form_leads", many(4, (i) => ({ synthetic: "slim-rehearsal", historical: true, seq: i })));
    await insert(HISTORICAL_DATABASE, "call_leads", many(3, (i) => ({ synthetic: "slim-rehearsal", historical: true, seq: i })));
    await insert(HISTORICAL_DATABASE, "booked_leads", many(2, (i) => ({ synthetic: "slim-rehearsal", historical: true, seq: i })));
    for (const name of Object.keys(ADMIN_DROP_COLLECTIONS)) await insert(adminDb, name, many(5, (i) => ({ synthetic: "slim-rehearsal", action: "page_view", seq: i })));
    for (const name of ADMIN_NEVER_DROP) await insert(adminDb, name, many(2, (i) => ({ synthetic: "slim-rehearsal", seq: i })));
    await insert(adminDb, "rehearsal_admin_sessions", many(1, () => ({ synthetic: "slim-rehearsal" })));

    process.stdout.write(`${JSON.stringify({ seeded_at: now.toISOString(), main: mainDb, admin: adminDb, historical: HISTORICAL_DATABASE, deployment_commit: commit, counts }, null, 1)}\n`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[rehearsal-seed] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
