import assert from "node:assert/strict";
import { test } from "node:test";
import type { Document, Filter } from "mongodb";
import { ObjectId } from "mongodb";
import {
  DELETE_SCOPES,
  DROP_TARGETS,
  deleteInBatches,
  isTrimCommandAllowed,
  planTtlIndex,
  PROTECTED_COLLECTIONS,
  runDiskTrim,
  summarizeTrimReport,
  TTL_INDEXES,
  type TrimCluster,
  type TrimOptions,
  type TtlIndexTarget,
  type ObservedIndex,
  WORKER_AUDIT_KINDS,
} from "./disk-trim";
import { SALES_INTELLIGENCE_AUDIT_EVENT_INDEXES } from "../../src/models/salesIntelligence/infrastructure";

const NOW = new Date("2026-10-07T03:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const oidAt = (date: Date) => ObjectId.createFromTime(Math.floor(date.getTime() / 1000));

type Row = Document & { _id: ObjectId };

/** Enough of a Mongo filter for the trim's own scopes: `{field: {$lt}}`, `{field: {$in}}`, `$and`, `_id: {$in}`. */
function matches(row: Row, filter: Filter<Document>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === "$and") {
      if (!(condition as Filter<Document>[]).every((f) => matches(row, f))) return false;
      continue;
    }
    const value = row[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date) && !(condition instanceof ObjectId)) {
      const c = condition as Record<string, unknown>;
      if ("$lt" in c && !(value instanceof Date && value < (c.$lt as Date))) return false;
      if ("$in" in c && !(c.$in as unknown[]).some((v) => String(v) === String(value))) return false;
    } else if (String(value) !== String(condition)) return false;
  }
  return true;
}

class FakeCluster implements TrimCluster {
  readonly calls: string[] = [];
  readonly collections = new Map<string, Row[]>();
  readonly indexSets = new Map<string, ObservedIndex[]>();
  constructor(
    private readonly name = "vantagemovers",
    readonly dbStats = { dataMB: 100, storageMB: 50, indexMB: 10, fsUsedMB: 8600, fsTotalMB: 13212 },
  ) {}
  seed(collection: string, rows: Document[], indexes: ObservedIndex[] = [{ name: "_id_", key: { _id: 1 } }]) {
    this.collections.set(collection, rows.map((r) => ({ _id: new ObjectId(), ...r }) as Row));
    this.indexSets.set(collection, indexes);
    return this;
  }
  databaseName() {
    return this.name;
  }
  async replicaSetName() {
    return "fake-rs";
  }
  async listCollections() {
    return [...this.collections.keys()].sort();
  }
  async count(collection: string, filter: Filter<Document>) {
    return (this.collections.get(collection) ?? []).filter((r) => matches(r, filter)).length;
  }
  async countBy(collection: string, filter: Filter<Document>, field: string) {
    const out: Record<string, number> = {};
    for (const r of (this.collections.get(collection) ?? []).filter((r) => matches(r, filter))) out[String(r[field])] = (out[String(r[field])] ?? 0) + 1;
    return out;
  }
  async newestInsertAt(collection: string) {
    const rows = this.collections.get(collection) ?? [];
    return rows.length ? rows.map((r) => r._id.getTimestamp()).sort((a, b) => b.getTime() - a.getTime())[0]! : null;
  }
  async indexes(collection: string) {
    return this.indexSets.get(collection) ?? [];
  }
  async findIds(collection: string, filter: Filter<Document>, limit: number) {
    return (this.collections.get(collection) ?? [])
      .filter((r) => matches(r, filter))
      .sort((a, b) => a._id.toHexString().localeCompare(b._id.toHexString()))
      .slice(0, limit)
      .map((r) => r._id);
  }
  async storage() {
    return this.dbStats;
  }
  async deployment() {
    return { commit: "deadbeef", recorded_at: NOW.toISOString(), vercel_deployment_id: "dpl_x" };
  }
  async stuckSheetSyncJobs() {
    return (this.collections.get("sheet_sync_jobs") ?? []).filter((r) => r.status === "processing").map((r) => ({ id: String(r._id), operation: String(r.operation), updated_at: null }));
  }
  async deleteByIds(collection: string, ids: unknown[], filter: Filter<Document>) {
    this.calls.push(`delete:${collection}:${ids.length}`);
    const rows = this.collections.get(collection) ?? [];
    const set = new Set(ids.map(String));
    const keep = rows.filter((r) => !(set.has(String(r._id)) && matches(r, filter)));
    this.collections.set(collection, keep);
    return rows.length - keep.length;
  }
  async createIndex(collection: string, target: TtlIndexTarget) {
    this.calls.push(`createIndex:${collection}:${target.name}`);
    this.indexSets.get(collection)!.push({ name: target.name, key: target.key, expireAfterSeconds: target.expireAfterSeconds });
  }
  async dropCollection(collection: string) {
    this.calls.push(`drop:${collection}`);
    this.collections.delete(collection);
    this.indexSets.delete(collection);
  }
}

function seeded(name?: string) {
  const c = new FakeCluster(name);
  c.seed("sales_intelligence_audit_events", [
    ...WORKER_AUDIT_KINDS.map((event_kind) => ({ event_kind, happened_at: daysAgo(1) })),
    { event_kind: "interaction.updated", happened_at: daysAgo(3) },
    { event_kind: "sales_outreach_assignment_changed", happened_at: daysAgo(1) },
    { event_kind: "contact_number_created_from_form_lead", happened_at: daysAgo(1) },
    { event_kind: "review_opened", happened_at: daysAgo(2) },
    { event_kind: "nudge_sent", happened_at: daysAgo(200) },
  ]);
  c.seed("ringcentral_webhook_events", [
    { receivedAt: daysAgo(1), rawBody: {} },
    { receivedAt: daysAgo(6.9), rawBody: {} },
    { receivedAt: daysAgo(7.1), rawBody: {} },
    { receivedAt: daysAgo(90), rawBody: {} },
  ]);
  c.seed("sheet_sync_runs", [{ started_at: daysAgo(1) }, { started_at: daysAgo(91) }]);
  c.seed("sheet_sync_attempts", [{ createdAt: daysAgo(1) }, { createdAt: daysAgo(91) }]);
  c.seed("daily_operations_events", [{ createdAt: daysAgo(1), day: "2026-10-06" }, { createdAt: daysAgo(401), day: "2025-09-01" }]);
  c.seed("sheet_sync_jobs", [{ status: "processing", operation: "form_lead.create" }, { status: "synced", operation: "form_lead.create" }]);
  for (const name of PROTECTED_COLLECTIONS) if (!c.collections.has(name)) c.seed(name, [{ x: 1 }]);
  const old = daysAgo(120);
  for (const name of ["ringcentral_webhook_events_test", "ringcentral_call_candidates_test", "ringcentral_call_candidate_decisions_test"]) c.collections.set(name, [{ _id: oidAt(old), x: 1 }]);
  c.collections.set("sales_intelligence_owner_instructions", [{ _id: oidAt(daysAgo(9)) }]);
  c.collections.set("sales_intelligence_sync_windows", []);
  c.collections.set("sales_intelligence_review_items", [{ _id: oidAt(daysAgo(2)) }]);
  return c;
}

const options = (overrides: Partial<TrimOptions> = {}): TrimOptions => ({
  mode: "dry_run",
  now: () => NOW,
  ringcentralCollectionMode: "production",
  openReviewCallers: [],
  localHead: "deadbeef",
  batch: 2,
  ...overrides,
});

test("the scope is exactly the brief's allowlist", () => {
  assert.deepEqual([...WORKER_AUDIT_KINDS], ["interaction.updated", "interaction.created", "interaction.merged", "capture_projection.completed", "call_log_refresh.completed", "attachment_refreshed", "attachment_auto_attached", "attachment_auto_contested"]);
  assert.deepEqual(DELETE_SCOPES.map((s) => s.collection), ["sales_intelligence_audit_events", "ringcentral_webhook_events", "sheet_sync_runs", "sheet_sync_attempts", "daily_operations_events"]);
  assert.deepEqual(DROP_TARGETS.map((t) => t.collection), ["ringcentral_webhook_events_test", "ringcentral_call_candidates_test", "ringcentral_call_candidate_decisions_test", "sales_intelligence_owner_instructions", "sales_intelligence_sync_windows", "sales_intelligence_review_items"]);
  for (const live of ["ringcentral_call_sessions", "ringcentral_processed_calls", "sales_intelligence_jobs", "call_interactions", "sales_outreach_contact_events", "sheet_sync_jobs"]) {
    assert.equal(DROP_TARGETS.some((t) => t.collection === live), false, live);
    assert.equal(DELETE_SCOPES.some((s) => s.collection === live), false, live);
    assert.ok((PROTECTED_COLLECTIONS as readonly string[]).includes(live), live);
  }
});

test("the TTL definitions match the brief and the schemas: audit 90 d on happened_at, webhooks 7 d on receivedAt, sheet runs/attempts 90 d, daily operations 400 d", () => {
  const byCollection = Object.fromEntries(TTL_INDEXES.map((i) => [i.collection, i]));
  assert.deepEqual(byCollection["sales_intelligence_audit_events"], { collection: "sales_intelligence_audit_events", name: "csi_audit_happened_ttl", key: { happened_at: 1 }, expireAfterSeconds: 90 * 86_400 });
  assert.deepEqual(byCollection["ringcentral_webhook_events"], { collection: "ringcentral_webhook_events", name: "ringcentral_webhook_event_received_ttl", key: { receivedAt: 1 }, expireAfterSeconds: 7 * 86_400 });
  assert.deepEqual(byCollection["sheet_sync_runs"], { collection: "sheet_sync_runs", name: "sheet_sync_run_started_ttl", key: { started_at: 1 }, expireAfterSeconds: 90 * 86_400 });
  assert.deepEqual(byCollection["sheet_sync_attempts"], { collection: "sheet_sync_attempts", name: "sheet_sync_attempt_created_ttl", key: { createdAt: 1 }, expireAfterSeconds: 90 * 86_400 });
  assert.deepEqual(byCollection["daily_operations_events"], { collection: "daily_operations_events", name: "daily_operations_event_created_ttl", key: { createdAt: 1 }, expireAfterSeconds: 400 * 86_400 });
  assert.ok(byCollection["ringcentral_webhook_events"]!.expireAfterSeconds >= 48 * 3600, "never below 48 hours");
  // The audit TTL is declared on the model like `csi_job_completed_ttl`, so the CSI index tooling builds it in a fresh environment.
  const declared = SALES_INTELLIGENCE_AUDIT_EVENT_INDEXES.find((i) => i.name === "csi_audit_happened_ttl");
  assert.deepEqual(declared, { name: "csi_audit_happened_ttl", key: { happened_at: 1 }, expireAfterSeconds: 90 * 86_400 });
});

test("the driver guard: a dry run sends reads only; apply adds delete, createIndexes and drop, never insert/update/dropDatabase/compact", () => {
  for (const read of ["find", "aggregate", "count", "listCollections", "listIndexes", "dbStats", "hello"]) {
    assert.ok(isTrimCommandAllowed("dry_run", read), read);
    assert.ok(isTrimCommandAllowed("apply", read), read);
  }
  for (const write of ["delete", "createIndexes", "drop"]) {
    assert.equal(isTrimCommandAllowed("dry_run", write), false, write);
    assert.ok(isTrimCommandAllowed("apply", write), write);
  }
  for (const never of ["insert", "update", "findAndModify", "dropDatabase", "dropIndexes", "compact", "renameCollection", "collMod"]) {
    assert.equal(isTrimCommandAllowed("apply", never), false, never);
  }
});

test("the TTL plan is idempotent and refuses to create over a clashing shape", () => {
  const target = TTL_INDEXES[1]!;
  assert.deepEqual(planTtlIndex(target, [{ name: "_id_", key: { _id: 1 } }]), { action: "create", detail: null });
  assert.equal(planTtlIndex(target, [{ name: target.name, key: { receivedAt: 1 }, expireAfterSeconds: 7 * 86_400 }]).action, "exists");
  assert.equal(planTtlIndex(target, [{ name: "other_name", key: { receivedAt: 1 }, expireAfterSeconds: 7 * 86_400 }]).action, "exists");
  assert.equal(planTtlIndex(target, [{ name: target.name, key: { receivedAt: -1 }, expireAfterSeconds: 7 * 86_400 }]).action, "conflict");
  assert.equal(planTtlIndex(target, [{ name: "legacy", key: { receivedAt: 1 }, expireAfterSeconds: null }]).action, "conflict");
  // An existing non-TTL index on the same key with a partial filter (the recovery scan index) is not a clash.
  assert.equal(planTtlIndex(target, [{ name: "provider_1_receivedAt_1__id_1", key: { provider: 1, receivedAt: 1, _id: 1 }, partialFilterExpression: {} }]).action, "create");
});

test("refuses any database that is not vantagemovers", async () => {
  await assert.rejects(runDiskTrim(seeded("vantagemovershistorical"), options()), /refusing database vantagemovershistorical/);
  await assert.rejects(runDiskTrim(seeded("vantageadmin"), options({ mode: "apply" })), /refusing database vantageadmin/);
});

test("dry run: reports the exact counts, plans every index and drop, and sends no mutation", async () => {
  const cluster = seeded();
  const report = await runDiskTrim(cluster, options());
  assert.deepEqual(cluster.calls, []);
  const byId = Object.fromEntries(report.deletes.map((d) => [d.id, d]));
  assert.equal(byId["audit_worker_kinds"]!.matched_before, WORKER_AUDIT_KINDS.length + 1);
  assert.equal(byId["audit_worker_kinds"]!.by_group!["interaction.updated"], 2);
  assert.equal(byId["audit_worker_kinds"]!.by_group!["review_opened"], undefined, "review_opened is not a worker kind");
  assert.equal(byId["webhook_receipts_past_7d"]!.matched_before, 2);
  assert.equal(byId["sheet_sync_runs_past_90d"]!.matched_before, 1);
  assert.equal(byId["sheet_sync_attempts_past_90d"]!.matched_before, 1);
  assert.equal(byId["daily_operations_events_past_400d"]!.matched_before, 1);
  assert.ok(report.deletes.every((d) => d.deleted === 0 && d.remaining_after === null));
  assert.deepEqual(report.ttl_indexes.map((i) => i.action), ["create", "create", "create", "create", "create"]);
  assert.ok(report.ttl_indexes.every((i) => !i.created));
  assert.deepEqual(report.drops.map((d) => d.decision), ["drop", "drop", "drop", "drop", "drop", "drop"]);
  assert.equal(report.drops[4]!.count, 0, "sync_windows is empty and still a drop");
  assert.equal(report.stuck_sheet_sync_jobs.length, 1, "stuck processing rows are reported, never touched");
  assert.deepEqual(report.problems, []);
  assert.equal(report.storage_after, null);
  assert.match(summarizeTrimReport(report), /no problems/);
});

test("apply: deletes only the worker kinds and the rows past each window, creates the TTL indexes, drops the six leftovers, and proves the protected names survive", async () => {
  const cluster = seeded();
  const report = await runDiskTrim(cluster, options({ mode: "apply" }));
  assert.deepEqual(report.problems, []);
  const byId = Object.fromEntries(report.deletes.map((d) => [d.id, d]));
  assert.equal(byId["audit_worker_kinds"]!.deleted, WORKER_AUDIT_KINDS.length + 1);
  assert.equal(byId["audit_worker_kinds"]!.remaining_after, 0);
  const auditLeft = cluster.collections.get("sales_intelligence_audit_events")!.map((r) => r.event_kind).sort();
  assert.deepEqual(auditLeft, ["contact_number_created_from_form_lead", "nudge_sent", "review_opened", "sales_outreach_assignment_changed"], "Owner, desk and the stray review_opened rows stay");
  assert.equal(byId["webhook_receipts_past_7d"]!.deleted, 2);
  assert.equal(cluster.collections.get("ringcentral_webhook_events")!.length, 2, "receipts inside 7 days stay; new receipts keep landing");
  assert.equal(cluster.collections.get("sheet_sync_runs")!.length, 1);
  assert.equal(cluster.collections.get("sheet_sync_attempts")!.length, 1);
  assert.equal(cluster.collections.get("daily_operations_events")!.length, 1);
  assert.ok(cluster.calls.filter((c) => c.startsWith("delete:sales_intelligence_audit_events:")).length >= 2, "deletes run in _id batches");
  assert.ok(cluster.calls.every((c) => !c.startsWith("delete:") || c.split(":")[1] !== "sheet_sync_jobs"));
  assert.deepEqual(report.ttl_indexes.map((i) => [i.action, i.created]), [["create", true], ["create", true], ["create", true], ["create", true], ["create", true]]);
  for (const target of TTL_INDEXES) assert.ok(cluster.indexSets.get(target.collection)!.some((i) => i.name === target.name && i.expireAfterSeconds === target.expireAfterSeconds));
  assert.deepEqual(report.drops.map((d) => d.decision), ["dropped", "dropped", "dropped", "dropped", "dropped", "dropped"]);
  for (const target of DROP_TARGETS) assert.equal(cluster.collections.has(target.collection), false, target.collection);
  for (const row of report.protected) {
    assert.equal(row.present_after, true, row.collection);
    assert.equal(row.count_after, row.count_before, row.collection);
  }
  assert.equal(cluster.collections.get("sheet_sync_jobs")!.length, 2);
  assert.ok(report.storage_after);
  // A second apply is a no-op: nothing matches, every index exists, every drop target is absent.
  const again = await runDiskTrim(cluster, options({ mode: "apply" }));
  assert.ok(again.deletes.every((d) => d.matched_before === 0 && d.deleted === 0));
  assert.deepEqual(again.ttl_indexes.map((i) => i.action), ["exists", "exists", "exists", "exists", "exists"]);
  assert.deepEqual(again.drops.map((d) => d.decision), ["absent", "absent", "absent", "absent", "absent", "absent"]);
  assert.deepEqual(again.problems, []);
});

test("drops are refused one by one: test-mode environment, a recent insert on a _test name, or a surviving openReview caller", async () => {
  const testMode = await runDiskTrim(seeded(), options({ mode: "apply", ringcentralCollectionMode: "test" }));
  assert.deepEqual(testMode.drops.map((d) => d.decision), ["refused", "refused", "refused", "dropped", "dropped", "dropped"]);
  assert.match(testMode.problems.join("\n"), /RINGCENTRAL_COLLECTION_MODE is test/);

  const recent = seeded();
  recent.collections.set("ringcentral_call_candidates_test", [{ _id: oidAt(daysAgo(3)) }]);
  const recentReport = await runDiskTrim(recent, options({ mode: "apply" }));
  assert.equal(recentReport.drops[1]!.decision, "refused");
  assert.match(recentReport.drops[1]!.reason, /inside the last 30 days/);
  assert.ok(recent.collections.has("ringcentral_call_candidates_test"));
  assert.equal(recentReport.drops[0]!.decision, "dropped", "the other _test names still drop");

  const caller = await runDiskTrim(seeded(), options({ mode: "apply", openReviewCallers: ["src/services/x.ts"] }));
  assert.equal(caller.drops[5]!.decision, "refused");
  assert.match(caller.drops[5]!.reason, /src\/services\/x\.ts/);
  assert.equal(caller.drops[3]!.decision, "dropped");
});

test("a conflicting TTL shape is reported, not created, and does not stop the rest of the run", async () => {
  const cluster = seeded();
  cluster.indexSets.get("sheet_sync_runs")!.push({ name: "legacy_started_ttl", key: { started_at: 1 }, expireAfterSeconds: 10 });
  const report = await runDiskTrim(cluster, options({ mode: "apply" }));
  const runs = report.ttl_indexes.find((i) => i.collection === "sheet_sync_runs")!;
  assert.equal(runs.action, "conflict");
  assert.equal(runs.created, false);
  assert.ok(report.problems.some((p) => p.includes("sheet_sync_run_started_ttl conflicts")));
  assert.equal(report.ttl_indexes.filter((i) => i.created).length, 4);
  assert.deepEqual(report.drops.map((d) => d.decision), ["dropped", "dropped", "dropped", "dropped", "dropped", "dropped"]);
});

test("deleteInBatches refuses a collection outside the allowlist before any read", async () => {
  const cluster = seeded();
  await assert.rejects(deleteInBatches(cluster, "call_interactions", {}, 10), /not on the disk-trim allowlist/);
  await assert.rejects(deleteInBatches(cluster, "sales_intelligence_jobs", {}, 10), /not on the disk-trim allowlist/);
  assert.deepEqual(cluster.calls, []);
});
