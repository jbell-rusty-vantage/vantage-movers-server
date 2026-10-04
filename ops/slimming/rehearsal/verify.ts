/**
 * SLIM-09 rehearsal verification (read-only, through the slimming driver guard). Pairs with `seed.ts`: compares the
 * pre-purge snapshot with live state on the loopback replica and checks every expectation the runbook sets.
 *
 *   MONGO_URI=<loopback> node --import tsx ops/slimming/rehearsal/verify.ts --manifest=<rehearsal manifest> \
 *     --before=<snapshot.json> --after=<snapshot.json>
 *
 * Prints one line per check and exits 1 when any check fails.
 */
import { readFileSync } from "node:fs";
import { isLoopbackMongoUri } from "../../lib/loopback-mongo";
import { ReadOnlyCluster } from "../lib/guarded-mongo";
import type { Manifest } from "../lib/manifest";
import {
  ADMIN_NEVER_DROP,
  CONTACT_NUMBER_DEAD_FIELDS,
  CONTACT_NUMBER_REVIEW_FIELDS,
  HISTORICAL_DATABASE,
  KEPT_SYNC_SCOPES,
  LEGACY_JOB_STAGES,
  NEVER_DROP,
  PENDING_SYNC_SCOPES,
  RETIRED_AUDIT_ACTOR_KINDS,
  RETIRED_AUDIT_EVENT_KINDS,
  RETIRED_SYNC_SCOPES,
} from "../policy";
import { arg } from "./guard";

type Snapshot = Record<string, "absent" | Record<string, { count: number; sha256: string; indexes: string[] }>>;
/** Collections a cleanup legitimately changes; every other protected namespace must be byte-identical. */
const CLEANED = new Set(["contact_numbers", "sales_intelligence_jobs", "sales_intelligence_sync_state", "sales_intelligence_audit_events"]);

async function main(): Promise<void> {
  const uri = (process.env.MONGO_URI ?? "").trim();
  if (!isLoopbackMongoUri(uri)) throw new Error("verify refuses a MONGO_URI that is not loopback-only");
  const manifest = JSON.parse(readFileSync(arg("manifest") ?? "", "utf8")) as Manifest;
  const before = JSON.parse(readFileSync(arg("before") ?? "", "utf8")) as Snapshot;
  const after = JSON.parse(readFileSync(arg("after") ?? "", "utf8")) as Snapshot;
  const t = manifest.targets;
  if (!t.rehearsal) throw new Error("verify only reads a rehearsal manifest");
  const main = t.main_database;
  const admin = t.admin_auth_database;
  const results: Array<{ ok: boolean; check: string; detail?: unknown }> = [];
  const check = (ok: boolean, name: string, detail?: unknown) => results.push({ ok, check: name, ...(detail === undefined ? {} : { detail }) });
  const cols = (snap: Snapshot, db: string) => (snap[db] === "absent" || !snap[db] ? {} : (snap[db] as Exclude<Snapshot[string], "absent">));

  const c = await ReadOnlyCluster.connect(uri, { serverMongoUri: uri, adminMongoUri: null, adminAuthDbName: null, blobToken: null, dnsServers: [] });
  try {
    // Targets absent.
    for (const d of t.drop_collections) check(!(await c.collection(d.db, d.name)), `dropped ${d.db}.${d.name}`);
    check(!(await c.listDatabases()).some((d) => d.name === HISTORICAL_DATABASE), `dropped database ${HISTORICAL_DATABASE}`);

    // Protected and unclassified namespaces: present; untouched ones byte-identical (count + content sha + indexes).
    const keptMain = Object.keys(cols(before, main)).filter((n) => !t.drop_collections.some((d) => d.db === main && d.name === n));
    for (const name of keptMain) {
      const b = cols(before, main)[name]!;
      const a = cols(after, main)[name];
      if (!a) check(false, `kept ${main}.${name} present`);
      else if (CLEANED.has(name)) check(a.indexes.join() === b.indexes.join(), `cleaned ${main}.${name} present, indexes kept`, { before: b.count, after: a.count });
      else check(a.count === b.count && a.sha256 === b.sha256 && a.indexes.join() === b.indexes.join(), `untouched ${main}.${name} byte-identical (${a.count} docs)`);
    }
    for (const name of NEVER_DROP) check(Boolean(cols(after, main)[name]), `NEVER_DROP ${name} present`);
    for (const name of Object.keys(cols(before, admin)).filter((n) => !t.drop_collections.some((d) => d.db === admin && d.name === n))) {
      const b = cols(before, admin)[name]!;
      const a = cols(after, admin)[name];
      check(Boolean(a) && a!.count === b.count && a!.sha256 === b.sha256, `untouched ${admin}.${name} byte-identical`);
    }
    for (const name of ADMIN_NEVER_DROP) check(Boolean(cols(after, admin)[name]), `ADMIN_NEVER_DROP ${name} present`);
    for (const name of ["daily_operations_events", "daily_operations_days", "granot_webhook_receipts", "entity_changes"])
      check(cols(after, main)[name]?.sha256 === cols(before, main)[name]?.sha256, `${name} byte-identical (Daily/receipts/changes untouched)`);

    // contact_numbers: dead + review fields unset everywhere, purged_at and retained fields kept.
    const deadFilter = { $or: [...CONTACT_NUMBER_DEAD_FIELDS, ...CONTACT_NUMBER_REVIEW_FIELDS].map((f) => ({ [f]: { $exists: true } })) };
    check((await c.count(main, "contact_numbers", deadFilter)) === 0, "contact_numbers: no dead/review field remains");
    check((await c.count(main, "contact_numbers", { purged_at: { $type: "date" } })) === 3, "contact_numbers: purged_at kept on all 3 seeded rows");
    check((await c.count(main, "contact_numbers", { "rollups.calls_total": { $exists: true } })) === 5, "contact_numbers: retained rollups.calls_total kept on all 5 rows");
    check((await c.count(main, "contact_numbers")) === 5, "contact_numbers: no document deleted");

    // Jobs: no legacy-stage row left; retained-stage rows untouched (status, lease, epoch, timestamps as seeded).
    check((await c.count(main, "sales_intelligence_jobs", { stage: { $in: [...LEGACY_JOB_STAGES] } })) === 0, "jobs: 0 legacy-stage rows remain");
    const retained = await c.find(main, "sales_intelligence_jobs", {}, { sort: { stage: 1 }, limit: 100 });
    const expected: Record<string, string> = { attachment_refresh: "pending", call_log_reconcile: "leased", directory: "completed", rebuild: "retry", nudge_repair: "paused", capture_projection: "dead_letter" };
    check(retained.length === 6, "jobs: 6 retained-stage rows remain", retained.map((r) => `${r.stage}:${r.status}`));
    for (const r of retained)
      check(expected[String(r.stage)] === r.status && r.lease_epoch === 1 && +r.updatedAt === +r.createdAt && r.reason === null, `jobs: retained ${r.stage} untouched (${r.status}${r.lease_owner ? `, lease ${r.lease_owner}` : ""})`);

    // Sync state: retired + outreach cursor scopes gone; kept scopes and the deployment stamp remain.
    const scopes = (await c.distinct(main, "sales_intelligence_sync_state", "scope")).map(String).sort();
    check(![...RETIRED_SYNC_SCOPES, ...PENDING_SYNC_SCOPES].some((s) => scopes.includes(s)), "sync_state: retired and outreach-cursor scopes deleted");
    check([...KEPT_SYNC_SCOPES, "rep_identity:rehearsal"].every((s) => scopes.includes(s)) && scopes.length === KEPT_SYNC_SCOPES.length + 1, "sync_state: kept scopes (incl. deployment) intact", scopes);

    // Audit: retired kinds by worker/intelligence deleted; human-actor rows and kept kinds remain.
    check((await c.count(main, "sales_intelligence_audit_events", { event_kind: { $in: [...RETIRED_AUDIT_EVENT_KINDS] }, "actor.kind": { $in: [...RETIRED_AUDIT_ACTOR_KINDS] } })) === 0, "audit: retired worker/intelligence rows deleted");
    check((await c.count(main, "sales_intelligence_audit_events", { "actor.kind": { $in: ["owner", "rep"] }, event_kind: { $in: [...RETIRED_AUDIT_EVENT_KINDS] } })) === 6, "audit: 6 Owner/Rep rows of retired kinds kept");
    check((await c.count(main, "sales_intelligence_audit_events", { event_kind: "owner_instruction_created", "actor.kind": "worker" })) === 1, "audit: kept kind by a worker kept");
  } finally {
    await c.close();
  }
  for (const r of results) process.stdout.write(`${r.ok ? "PASS" : "FAIL"} ${r.check}${r.detail === undefined ? "" : ` ${JSON.stringify(r.detail)}`}\n`);
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`[rehearsal-verify] ${results.length - failed}/${results.length} checks passed\n`);
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`[rehearsal-verify] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
