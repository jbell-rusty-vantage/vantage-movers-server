import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { CSI_RETIRED_JOB_STAGES } from "../../../src/config/domain/salesIntelligence";
import {
  ADMIN_DROP_COLLECTIONS,
  ADMIN_NEVER_DROP,
  CALL_INTERACTION_DEAD_PATHS,
  CLEANUP_SCOPES,
  CLEANUP_STATUS,
  CONTACT_NUMBER_DEAD_FIELDS,
  CONTACT_NUMBER_REVIEW_FIELDS,
  HISTORICAL_DATABASE,
  LEGACY_JOB_STAGES,
  MAIN_DROP_COLLECTIONS,
  NEVER_DROP,
  RETIRED_AUDIT_ACTOR_KINDS,
  RETIRED_AUDIT_EVENT_KINDS,
} from "../policy";
import type { Cleanup } from "./manifest";
import { idKey, readBackupIdKeys, verifyBackupFile, verifyBlobBackupFile, writeBackupFile } from "./backup";
import { SERVER_ROOT, loadSlimmingEnv } from "./env";
import { GUARD_EXIT_CODE, assertReadOnlyPipeline, isCommandAllowed } from "./guarded-mongo";
import { type ManifestTargets, assertManifestInvariants, canonicalJson, dropCountMatches, loadManifest, manifestHash } from "./manifest";
import {
  BASELINE_COMMIT,
  assertBackupDir,
  assertClosedFilter,
  blobDeletePlan,
  cleanupFilter,
  deploymentProblems,
  idsMissingFromBackup,
  manifestPolicyDrift,
  runBackupProblems,
  unsetPathFilter,
  terminalJobsFilter,
  terminalizeFilter,
  unlistedBlobProblems,
  verifiedFullBackupProblem,
} from "./purge-rules";
import { PRODUCTION_MANIFEST_PATH, loadRehearsalEnv, resolveSlimmingTarget } from "./rehearsal";
import { type Snapshot, snapshotFindings } from "../cutover-check";
import {
  CLAIMABLE_JOB_STATUSES,
  type CutoverGate,
  type NewestWrite,
  OLD_DEPLOYMENT_DRAIN_MS,
  WRITE_TIMESTAMP_FIELDS,
  claimableBeforeFilter,
  cutoverGateProblems,
  newestWritePipeline,
  writesAfterProblems,
} from "./write-gate";

const baseTargets = (): ManifestTargets => ({
  cluster: { fingerprint: "f", replica_set: "rs" },
  main_database: "vantagemovers",
  admin_auth_database: "vantageadmin",
  drop_databases: [{ name: HISTORICAL_DATABASE, spec: "§3", gate: "g", size_on_disk: 1, collections: [{ name: "form_leads", uuid: "u1", count: 1 }] }],
  drop_collections: [{ db: "vantagemovers", name: "lead_conversations", uuid: "u2", count: 3, size: 1, storage_size: 1, index_size: 1, ttl: false, spec: "§7.2", owner: "o", gate: "g" }],
  absent_targets: [],
  cleanups: [],
  blob: null,
  protected: [],
});

/** A manifest exactly as `inventory.ts` would build it from `policy.ts` (counts and UUIDs synthetic). */
const policyTargets = (mainDb = "vantagemovers", adminDb = "vantageadmin"): ManifestTargets => {
  const target = (db: string, name: string, t: { spec: string; owner: string; gate: string }) => ({ db, name, uuid: `u-${name}`, count: 1, size: 1, storage_size: 1, index_size: 1, ttl: false, ...t });
  const cleanups = Object.entries(CLEANUP_SCOPES).map(([id, scope]): Cleanup => {
    const base = { id, db: mainDb, status: (CLEANUP_STATUS as Record<string, "final" | "pending_wave3">)[id]!, spec: "" };
    switch (scope.kind) {
      case "unset_fields":
        return { ...base, kind: "unset_fields", collection: scope.collection, fields: [...scope.fields], expected_matches: 1 };
      case "retire_jobs":
        return { ...base, kind: "retire_jobs", collection: "sales_intelligence_jobs", stages: [...scope.stages], expected_by_status: {}, reason: scope.reason };
      case "delete_exact":
        return { ...base, kind: "delete_exact", collection: scope.collection, key_field: scope.key_field, key_values: [...scope.key_values], expected_matches: 1 };
      case "delete_filter":
        return { ...base, kind: "delete_filter", collection: scope.collection, filter: JSON.parse(JSON.stringify(scope.filter)) as Record<string, unknown>, expected_matches: 1 };
    }
  });
  return {
    ...(mainDb === "vantagemovers" ? {} : { rehearsal: true as const }),
    cluster: { fingerprint: "f", replica_set: "rs" },
    main_database: mainDb,
    admin_auth_database: adminDb,
    drop_databases: [{ name: HISTORICAL_DATABASE, spec: "§3", gate: "g", size_on_disk: 1, collections: [{ name: "form_leads", uuid: "u1", count: 1 }] }],
    drop_collections: [
      ...Object.entries(MAIN_DROP_COLLECTIONS).map(([name, t]) => target(mainDb, name, t)),
      ...Object.entries(ADMIN_DROP_COLLECTIONS).map(([name, t]) => target(adminDb, name, t)),
    ],
    absent_targets: [],
    cleanups,
    blob: null,
    protected: [...NEVER_DROP.map((name) => ({ db: mainDb, name, uuid: `p-${name}`, count: 1 })), ...ADMIN_NEVER_DROP.map((name) => ({ db: adminDb, name, uuid: `p-${name}`, count: 1 }))],
  };
};

describe("slimming driver guard", () => {
  it("allows reads and refuses every write in read mode", () => {
    for (const name of ["find", "aggregate", "count", "listCollections", "listIndexes", "dbStats", "getMore", "distinct"])
      assert.equal(isCommandAllowed("read", name, { pipeline: [] }), true, name);
    for (const name of ["insert", "update", "delete", "drop", "dropDatabase", "createIndexes", "renameCollection", "findAndModify", "create", "collMod"])
      assert.equal(isCommandAllowed("read", name, {}), false, name);
  });

  it("allows only update/delete/drop/dropDatabase on top of reads in purge mode", () => {
    for (const name of ["update", "delete", "drop", "dropDatabase"]) assert.equal(isCommandAllowed("purge", name, {}), true, name);
    for (const name of ["insert", "createIndexes", "renameCollection", "findAndModify", "create", "applyOps"]) assert.equal(isCommandAllowed("purge", name, {}), false, name);
  });

  it("terminates the process from the commandStarted event of a forbidden command", () => {
    const guarded = join(__dirname, "guarded-mongo.ts").replaceAll("\\", "/");
    const run = (mode: string, commandName: string) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `const { createGuardedClient } = require(${JSON.stringify(guarded)});
           const client = createGuardedClient("mongodb://127.0.0.1:9/", ${JSON.stringify(mode)});
           client.emit("commandStarted", { commandName: ${JSON.stringify(commandName)}, command: { pipeline: [] }, databaseName: "vantagemovers" });
           process.stdout.write("still-running");`,
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
    const insert = run("read", "insert");
    assert.equal(insert.status, GUARD_EXIT_CODE, insert.stderr);
    assert.doesNotMatch(insert.stdout, /still-running/);
    assert.match(insert.stderr, /refused command 'insert'/);
    assert.equal(run("read", "drop").status, GUARD_EXIT_CODE);
    assert.equal(run("purge", "insert").status, GUARD_EXIT_CODE);
    const find = run("read", "find");
    assert.equal(find.status, 0, find.stderr);
    assert.match(find.stdout, /still-running/);
    assert.equal(run("purge", "delete").status, 0);
  });

  it("refuses aggregate pipelines that write, including nested ones", () => {
    assert.equal(isCommandAllowed("read", "aggregate", { pipeline: [{ $match: {} }, { $out: "x" }] }), false);
    assert.equal(isCommandAllowed("read", "aggregate", { pipeline: [{ $facet: { a: [{ $merge: { into: "x" } }] } }] }), false);
    assert.equal(isCommandAllowed("purge", "aggregate", { pipeline: [{ $lookup: { from: "y", pipeline: [{ $out: "z" }], as: "w" } }] }), false);
    assert.throws(() => assertReadOnlyPipeline([{ $unionWith: { coll: "a", pipeline: [{ $merge: "b" }] } }]));
    assert.doesNotThrow(() => assertReadOnlyPipeline([{ $group: { _id: "$stage", n: { $sum: 1 } } }]));
  });
});

describe("deletion manifest invariants", () => {
  it("accepts the expected shape and hashes it canonically", () => {
    const t = baseTargets();
    assert.doesNotThrow(() => assertManifestInvariants(t));
    const reordered = JSON.parse(canonicalJson(t)) as ManifestTargets;
    assert.equal(manifestHash(reordered), manifestHash(t));
    assert.notEqual(manifestHash({ ...t, drop_collections: [{ ...t.drop_collections[0]!, count: 4 }] }), manifestHash(t));
  });

  it("refuses protected databases and collections whatever the file says", () => {
    const withDb = (name: string) => ({ ...baseTargets(), drop_databases: [{ ...baseTargets().drop_databases[0]!, name }] });
    for (const name of ["vantagemovers", "vantageadmin", "admin", "local", "config", "testvantagemovers"]) assert.throws(() => assertManifestInvariants(withDb(name)), name);
    const withCol = (db: string, name: string) => ({ ...baseTargets(), drop_collections: [{ ...baseTargets().drop_collections[0]!, db, name }] });
    for (const name of ["granot_webhook_receipts", "entity_changes", "contact_numbers", "sales_intelligence_jobs", "daily_operations_events", "customers", "agents", "reporting_runs"])
      assert.throws(() => assertManifestInvariants(withCol("vantagemovers", name)), name);
    assert.throws(() => assertManifestInvariants(withCol("vantageadmin", "admin_users")));
    assert.throws(() => assertManifestInvariants(withCol("testvantagemovers", "lead_conversations")));
    assert.throws(() => assertManifestInvariants({ ...baseTargets(), drop_collections: [{ ...baseTargets().drop_collections[0]!, uuid: "" }] }));
  });

  it("refuses a cleanup on a collection that is also dropped", () => {
    const t = baseTargets();
    t.cleanups = [{ id: "x", kind: "delete_exact", db: "vantagemovers", collection: "lead_conversations", key_field: "_id", key_values: ["a"], expected_matches: 1, status: "final", spec: "s" }];
    assert.throws(() => assertManifestInvariants(t));
  });

  it("loads the generated manifest with a matching hash", () => {
    const { manifest, computedHash } = loadManifest();
    assert.equal(computedHash, manifest.manifest_hash);
    assert.ok(manifest.targets.drop_collections.every((c) => c.uuid));
  });

  it("accepts TTL decreases only", () => {
    assert.equal(dropCountMatches({ count: 4, ttl: true }, 3), true);
    assert.equal(dropCountMatches({ count: 4, ttl: true }, 5), false);
    assert.equal(dropCountMatches({ count: 4, ttl: false }, 3), false);
    assert.equal(dropCountMatches({ count: 4, ttl: false }, 4), true);
  });
});

describe("purge rules", () => {
  it("purges exactly the server's retired job stages, including rows the fence marked retired", () => {
    assert.deepEqual([...LEGACY_JOB_STAGES].sort(), [...CSI_RETIRED_JOB_STAGES].sort());
    assert.deepEqual(terminalJobsFilter(["analysis"]), { stage: { $in: ["analysis"] }, status: { $in: ["completed", "dead_letter", "retired"] } });
  });

  it("never unsets a retained Number field", () => {
    for (const field of ["purged_at", "e164", "rollups", "rollups.interactions_total", "rollups.recordings_total"]) {
      assert.equal(([...CONTACT_NUMBER_DEAD_FIELDS, ...CONTACT_NUMBER_REVIEW_FIELDS] as string[]).includes(field), false, field);
    }
  });

  it("reports a manifest whose cleanups are stale against policy.ts", () => {
    const current = policyTargets();
    assert.deepEqual(manifestPolicyDrift(current), []);
    const byId = (id: string) => current.cleanups.find((c) => c.id === id)!;
    const stale: Cleanup[] = [
      { ...byId("C1-contact-numbers-dead-fields"), fields: ["running_summary", "purged_at"] } as Cleanup,
      { ...byId("C2-legacy-stage-jobs"), stages: ["analysis"] } as Cleanup,
      { ...byId("C4-retired-audit-events"), status: "pending_wave3" } as Cleanup,
      { ...byId("C4-retired-audit-events"), id: "C9-unknown" } as Cleanup,
      byId("C3-retired-sync-scopes"),
      byId("C5-contact-numbers-retention-fields"),
      byId("C6-outreach-cursor-sync-scopes"),
    ];
    const drift = manifestPolicyDrift({ ...current, cleanups: stale });
    assert.ok(drift.some((p) => p.includes("unsets purged_at")));
    assert.ok(drift.some((p) => p.includes("stages differ")));
    assert.ok(drift.some((p) => p.includes("is pending_wave3 in the manifest but final")));
    assert.ok(drift.some((p) => p.includes("C9-unknown is not in policy.ts")));
    // A manifest generated before C7 existed is stale: every policy cleanup must be present.
    assert.ok(drift.some((p) => p.includes("C7-call-interactions-conversation-pointers appears 0 times")));
  });

  it("ties every cleanup's collection, kind, scope and filter to policy.ts", () => {
    const t = policyTargets();
    const swap = (id: string, change: Record<string, unknown>) =>
      manifestPolicyDrift({ ...t, cleanups: t.cleanups.map((c) => (c.id === id ? ({ ...c, ...change } as Cleanup) : c)) });
    assert.ok(swap("C1-contact-numbers-dead-fields", { collection: "customers" }).some((p) => p.includes("unset_fields on customers in the manifest")));
    assert.ok(swap("C7-call-interactions-conversation-pointers", { fields: ["recording_discovery"] }).some((p) => p.includes("fields differ")));
    assert.ok(swap("C7-call-interactions-conversation-pointers", { fields: ["recording_discovery", "recordings"] }).some((p) => p.includes("unsets recordings")));
    assert.ok(swap("C3-retired-sync-scopes", { key_values: ["deployment"] }).some((p) => p.includes("deletes scope=deployment")));
    assert.ok(swap("C3-retired-sync-scopes", { key_field: "_id" }).some((p) => p.includes("key field _id")));
    // Fewer scopes than the policy (absent at observation) is fine.
    assert.deepEqual(swap("C6-outreach-cursor-sync-scopes", { key_values: ["outreach_ensure"] }), []);
    assert.ok(
      swap("C4-retired-audit-events", { filter: { event_kind: { $in: ["intelligence.published"] }, "actor.kind": { $in: ["worker", "intelligence"] } } }).some((p) =>
        p.includes("filter differs"),
      ),
    );
    assert.ok(
      swap("C4-retired-audit-events", { filter: { event_kind: { $in: [...RETIRED_AUDIT_EVENT_KINDS] }, "actor.kind": { $in: ["worker", "intelligence", "owner"] } } }).some((p) =>
        p.includes("filter differs"),
      ),
    );
    // `$in` order does not matter.
    assert.deepEqual(swap("C4-retired-audit-events", { filter: { "actor.kind": { $in: ["intelligence", "worker"] }, event_kind: { $in: [...RETIRED_AUDIT_EVENT_KINDS].reverse() } } }), []);
    assert.ok(swap("C2-legacy-stage-jobs", { reason: "other" }).some((p) => p.includes("reason differs")));
    assert.ok(manifestPolicyDrift({ ...t, cleanups: [...t.cleanups, t.cleanups[0]!] }).some((p) => p.includes("appears 2 times")));
  });

  it("ties drop targets, the database drop and the protected list to the policy allowlist", () => {
    const t = policyTargets();
    const extra = { ...t.drop_collections[0]!, name: "testimonials", uuid: "u-x" };
    assert.ok(manifestPolicyDrift({ ...t, drop_collections: [...t.drop_collections, extra] }).some((p) => p.includes("vantagemovers.testimonials is not in policy.ts")));
    assert.ok(
      manifestPolicyDrift({ ...t, drop_collections: [...t.drop_collections, { ...extra, db: "vantageadmin", name: "operational_events" }] }).some((p) =>
        p.includes("vantageadmin.operational_events is not in policy.ts"),
      ),
    );
    const missing = manifestPolicyDrift({ ...t, drop_collections: t.drop_collections.filter((c) => c.name !== "outreach_followups") });
    assert.ok(missing.some((p) => p.includes("vantagemovers.outreach_followups is neither dropped nor recorded absent")));
    // Recording a target as absent instead of dropped is fine; listing it in both is not.
    const absent = [{ db: "vantagemovers", name: "operational_report_runs", spec: "§4" }];
    assert.deepEqual(manifestPolicyDrift({ ...t, drop_collections: t.drop_collections.filter((c) => c.name !== "operational_report_runs"), absent_targets: absent }), []);
    assert.ok(manifestPolicyDrift({ ...t, absent_targets: absent }).some((p) => p.includes("appears 2 times")));
    assert.ok(manifestPolicyDrift({ ...t, absent_targets: [{ db: "vantagemovers", name: "customers", spec: "x" }] }).some((p) => p.includes("vantagemovers.customers is not in policy.ts")));
    assert.ok(manifestPolicyDrift({ ...t, drop_databases: [{ ...t.drop_databases[0]!, name: "vantagemovers_old" }] }).some((p) => p.includes("database drop vantagemovers_old")));
    assert.ok(manifestPolicyDrift({ ...t, protected: t.protected.filter((p) => p.name !== "daily_operations_events") }).some((p) => p.includes("NEVER_DROP")));
    assert.ok(manifestPolicyDrift({ ...t, protected: t.protected.filter((p) => p.name !== "admin_users") }).some((p) => p.includes("ADMIN_NEVER_DROP")));
    // A rehearsal manifest is checked against its own database names.
    const rehearsal = policyTargets("slimrehearsal_main", "slimrehearsal_admin");
    assert.deepEqual(manifestPolicyDrift(rehearsal), []);
    assert.ok(manifestPolicyDrift({ ...rehearsal, cleanups: rehearsal.cleanups.map((c) => ({ ...c, db: "vantagemovers" })) }).some((p) => p.includes("not the main database")));
  });

  it("only accepts closed delete filters", () => {
    assert.doesNotThrow(() => assertClosedFilter({ event_kind: { $in: [...RETIRED_AUDIT_EVENT_KINDS] }, "actor.kind": { $in: [...RETIRED_AUDIT_ACTOR_KINDS] } }));
    assert.doesNotThrow(() => assertClosedFilter({ scope: "attention_publish" }));
    assert.throws(() => assertClosedFilter({}));
    assert.throws(() => assertClosedFilter({ $or: [{ a: 1 }] }));
    assert.throws(() => assertClosedFilter({ scope: { $regex: "^attention" } }));
    assert.throws(() => assertClosedFilter({ scope: { $in: [] } }));
    assert.throws(() => assertClosedFilter({ scope: { $exists: true } }));
    assert.throws(() => assertClosedFilter({ scope: { $in: [{ $gt: 1 }] } }));
  });

  it("selects and unsets exact C7 paths, including the all-elements recordings path", () => {
    assert.deepEqual([...CALL_INTERACTION_DEAD_PATHS], ["recording_discovery", "recordings.$[].lead_conversation_id"]);
    assert.deepEqual(unsetPathFilter("recording_discovery"), { recording_discovery: { $exists: true } });
    assert.deepEqual(unsetPathFilter("recordings.$[].lead_conversation_id"), { recordings: { $type: "array" }, "recordings.lead_conversation_id": { $exists: true } });
    const c7 = policyTargets().cleanups.find((c) => c.id === "C7-call-interactions-conversation-pointers")!;
    assert.equal(c7.collection, "call_interactions");
    assert.deepEqual(cleanupFilter(c7), {
      $or: [{ recording_discovery: { $exists: true } }, { recordings: { $type: "array" }, "recordings.lead_conversation_id": { $exists: true } }],
    });
    for (const bad of ["recordings.$.x", "recordings.$[i].x", "recordings.$[]", "a.$[].b.$[].c", "$set", "", "a..b", "A"]) assert.throws(() => unsetPathFilter(bad), bad);
    // Never a retained recording field or the call itself.
    for (const kept of ["recordings", "recordings.$[].provider_recording_id", "recordings.$[].observed_at", "recordings.$[].recording_type", "purged_at", "contact_number_id"])
      assert.equal((CALL_INTERACTION_DEAD_PATHS as readonly string[]).includes(kept), false, kept);
  });

  it("builds exact cleanup filters", () => {
    assert.deepEqual(cleanupFilter({ id: "a", kind: "delete_exact", db: "vantagemovers", collection: "sales_intelligence_sync_state", key_field: "scope", key_values: ["overview_refresh"], expected_matches: 1, status: "final", spec: "" }), {
      scope: { $in: ["overview_refresh"] },
    });
    assert.deepEqual(cleanupFilter({ id: "b", kind: "unset_fields", db: "vantagemovers", collection: "contact_numbers", fields: ["running_summary"], expected_matches: 1, status: "final", spec: "" }), {
      $or: [{ running_summary: { $exists: true } }],
    });
    assert.throws(() => cleanupFilter({ id: "c", kind: "retire_jobs", db: "vantagemovers", collection: "sales_intelligence_jobs", stages: [], expected_by_status: {}, reason: "r", status: "final", spec: "" }));
    const now = new Date("2026-10-03T00:00:00Z");
    assert.deepEqual(terminalizeFilter(["analysis"], now), {
      stage: { $in: ["analysis"] },
      $or: [{ status: { $in: ["pending", "retry", "paused"] } }, { status: "leased", $or: [{ leased_until: null }, { leased_until: { $lte: now } }] }],
    });
  });

  it("keeps backups outside the workspace", () => {
    assert.throws(() => assertBackupDir(undefined));
    assert.throws(() => assertBackupDir("relative/dir"));
    assert.throws(() => assertBackupDir("C:/work/repo/backups", ["C:/work/repo"]));
    assert.equal(assertBackupDir("D:/slimming-backups", ["C:/work/repo"]).replaceAll("\\", "/"), "D:/slimming-backups");
  });

  it("requires a deployed commit that descends from the baseline and lacks retired models", () => {
    assert.match(deploymentProblems(null)[0]!, /no deployed server commit/);
    assert.match(deploymentProblems("abc", () => false)[0]!, /unknown locally/);
    const sliM = (args: string[]) => args[0] === "cat-file" ? args[2]!.endsWith("^{commit}") : args[0] === "merge-base" && args[2] === BASELINE_COMMIT;
    assert.deepEqual(deploymentProblems("abc", sliM), []);
    const old = (args: string[]) => args[0] === "cat-file" || args[0] === "merge-base";
    assert.equal(deploymentProblems("abc", old).length, 5);
  });
});

describe("backup files", () => {
  it("round-trips canonical EJSON and detects tampering", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slimming-backup-"));
    try {
      const file = join(dir, "x.ejson.gz");
      const docs = [{ _id: new ObjectId(), at: new Date("2026-10-03T00:00:00Z"), n: 1 }, { _id: new ObjectId(), nested: { big: 2n ** 40n > 0n } }];
      async function* source() {
        yield* docs;
      }
      const written = await writeBackupFile(source(), file);
      assert.equal(written.documents, 2);
      await verifyBackupFile(file, written);
      await assert.rejects(() => verifyBackupFile(file, { ...written, documents: 3 }));
      const bytes = readFileSync(file);
      bytes[bytes.length - 5] ^= 0xff;
      writeFileSync(file, bytes);
      await assert.rejects(() => verifyBackupFile(file, written));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("purge hardening", () => {
  it("checks a Blob backup by the bytes on disk, not the listing metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slimming-blob-"));
    try {
      const file = join(dir, "media.bin");
      writeFileSync(file, Buffer.from("conversation media bytes"));
      const ok = await verifyBlobBackupFile(file, { listedSize: 24 });
      assert.equal(ok.bytes, 24);
      assert.match(ok.sha256, /^[a-f0-9]{64}$/);
      await verifyBlobBackupFile(file, { listedSize: 24, streamedSha256: ok.sha256 });
      // A short write (or a listing that disagrees) and a stream/disk hash mismatch both abort.
      writeFileSync(file, Buffer.from("conversation media"));
      await assert.rejects(() => verifyBlobBackupFile(file, { listedSize: 24 }), /bytes on disk/);
      writeFileSync(file, Buffer.from("conversation media BYTES"));
      await assert.rejects(() => verifyBlobBackupFile(file, { listedSize: 24, streamedSha256: ok.sha256 }), /sha256 on disk/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deletes exactly the present manifest Blob keys and refuses before deleting when an unlisted object exists", () => {
    const keys = ["conversations/a.mp3", "conversations/b.mp3", "conversations/c.mp3"];
    const plan = blobDeletePlan([{ pathname: "conversations/a.mp3" }, { pathname: "conversations/c.mp3" }, { pathname: "dev-ops/keep.json" }], keys, "conversations/");
    assert.deepEqual(plan, { toDelete: ["conversations/a.mp3", "conversations/c.mp3"], alreadyAbsent: 1, problems: [] });
    const unlisted = blobDeletePlan([{ pathname: "conversations/a.mp3" }, { pathname: "conversations/new.mp3" }], keys, "conversations/");
    assert.equal(unlisted.problems.length, 1);
    assert.match(unlisted.problems[0]!, /conversations\/new\.mp3/);
    assert.equal(unlisted.toDelete.includes("conversations/new.mp3"), false);
    const outside = blobDeletePlan([{ pathname: "reports/x.pdf" }], ["reports/x.pdf"], "conversations/");
    assert.deepEqual(outside.toDelete, []);
    assert.match(outside.problems[0]!, /outside conversations\//);
  });

  it("treats any object under conversations/ that the manifest does not list as a problem", () => {
    const keys = ["conversations/a.mp3", "conversations/b.mp3"];
    assert.deepEqual(unlistedBlobProblems([{ pathname: "conversations/a.mp3" }], keys, "conversations/"), []);
    const problems = unlistedBlobProblems([{ pathname: "conversations/a.mp3" }, { pathname: "conversations/new.mp3" }], keys, "conversations/");
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /1 object\(s\) under conversations\/ are not in the manifest/);
    assert.match(problems[0]!, /conversations\/new\.mp3/);
    // Other prefixes are not the manifest's concern.
    assert.deepEqual(unlistedBlobProblems([{ pathname: "dev-ops/x" }], keys, "conversations/"), []);
  });

  it("counts an already-absent drop target as dropped only with this run's verified full backup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slimming-resume-"));
    try {
      async function* source() {
        yield { _id: new ObjectId() };
        yield { _id: new ObjectId() };
        yield { _id: new ObjectId() };
      }
      const written = await writeBackupFile(source(), join(dir, "vantagemovers.lead_conversations.ejson.gz"));
      const entry = { namespace: "vantagemovers.lead_conversations", filter: {}, file: "vantagemovers.lead_conversations.ejson.gz", indexes: [], ...written };
      const ledger = { backup_done: true, backups: [entry] };
      const accept3 = (n: number) => n === 3;
      assert.equal(await verifiedFullBackupProblem(ledger, dir, entry.namespace, accept3), null);
      assert.match(String(await verifiedFullBackupProblem({ ...ledger, backup_done: false }, dir, entry.namespace, accept3)), /not complete/);
      assert.match(String(await verifiedFullBackupProblem(ledger, dir, "vantagemovers.other", accept3)), /no full backup/);
      // A filtered (cleanup) backup of the same namespace is not a full backup.
      assert.match(String(await verifiedFullBackupProblem({ backup_done: true, backups: [{ ...entry, filter: { stage: "x" } }] }, dir, entry.namespace, accept3)), /no full backup/);
      assert.match(String(await verifiedFullBackupProblem(ledger, dir, entry.namespace, (n) => n === 4)), /does not accept/);
      const bytes = readFileSync(join(dir, entry.file));
      bytes[bytes.length - 5] ^= 0xff;
      writeFileSync(join(dir, entry.file), bytes);
      assert.match(String(await verifiedFullBackupProblem(ledger, dir, entry.namespace, accept3)), /does not verify/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds the cleanup ids no backup holds, by _id identity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slimming-cover-"));
    try {
      const a = new ObjectId();
      const b = new ObjectId();
      async function* source() {
        yield { _id: a, recording_discovery: null };
        yield { _id: b, recordings: [{ lead_conversation_id: new ObjectId() }] };
      }
      const file = join(dir, "cleanup-C7.ejson.gz");
      await writeBackupFile(source(), file);
      const keys = await readBackupIdKeys(file);
      assert.equal(keys.size, 2);
      assert.ok(keys.has(idKey(new ObjectId(a.toHexString()))));
      const extra = new ObjectId();
      assert.deepEqual(idsMissingFromBackup([a, b, extra], keys), [extra]);
      assert.deepEqual(idsMissingFromBackup([b], keys), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-verifies every backup of a run on resume (Mongo and Blob files)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slimming-resume-verify-"));
    try {
      async function* source() {
        yield { _id: new ObjectId() };
      }
      const written = await writeBackupFile(source(), join(dir, "cleanup-C1.ejson.gz"));
      const entry = { namespace: "vantagemovers.contact_numbers", filter: { x: 1 }, file: "cleanup-C1.ejson.gz", indexes: [], cleanup_id: "C1", ...written };
      mkdirSync(join(dir, "blob", "conversations"), { recursive: true });
      writeFileSync(join(dir, "blob", "conversations", "a.mp3"), Buffer.from("audio"));
      const blob = await verifyBlobBackupFile(join(dir, "blob", "conversations", "a.mp3"), { listedSize: 5 });
      const blobFiles = [{ key: "conversations/a.mp3", ...blob }];
      assert.deepEqual(await runBackupProblems({ backup_done: true, backups: [entry] }, dir, blobFiles), []);
      writeFileSync(join(dir, "blob", "conversations", "a.mp3"), Buffer.from("AUDIO"));
      assert.match((await runBackupProblems({ backup_done: true, backups: [entry] }, dir, blobFiles))[0]!, /blob backup conversations\/a\.mp3 does not verify/);
      const bytes = readFileSync(join(dir, entry.file));
      bytes[bytes.length - 5] ^= 0xff;
      writeFileSync(join(dir, entry.file), bytes);
      const problems = await runBackupProblems({ backup_done: true, backups: [entry] }, dir, []);
      assert.match(problems[0]!, /backup cleanup-C1\.ejson\.gz does not verify/);
      rmSync(join(dir, entry.file));
      assert.equal((await runBackupProblems({ backup_done: true, backups: [entry] }, dir, [])).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wires backup coverage, policy drift, resume re-verification and the Blob delete plan into purge.ts", () => {
    const source = readFileSync(join(__dirname, "..", "purge.ts"), "utf8");
    // Every mutation callback covers its ids first: terminalize, delete of terminal jobs, and the generic cleanups.
    assert.equal(source.match(/await cover\(ids\);/g)?.length, 3);
    assert.match(source, /const cover = await cleanupCoverage\(c, cleanup, runDir, log\);/);
    assert.doesNotMatch(source, /unsetFields/);
    // Drift is computed over the whole manifest, aborts apply and is a dry-run problem.
    assert.match(source, /const drift = manifestPolicyDrift\(manifest\.targets\);/);
    assert.match(source, /if \(drift\.length\) throw new PurgeAbort/);
    assert.match(source, /\.\.\.drift\.map\(\(d\) => `manifest\/policy drift: \$\{d\}`\)/);
    // Resume re-verifies the run's backups before anything else touches the cluster.
    assert.ok(source.indexOf("runBackupProblems(log, runDir, blobFiles)") < source.indexOf("PurgeCluster.connectForPurge"));
    assert.match(source, /blobDeletePlan\(await listBlobs\(env\.blobToken!, t\.blob\.prefix\), blobKeys, t\.blob\.prefix\)/);
    assert.match(source, /deleteBlobKeys\(env\.blobToken!, toDelete\)/);
    assert.match(source, /log\.backups = \[\];/);
  });

  it("wires the hardening into purge.ts: unlisted Blob objects in (a)/(g), disk-checked Blob backups, idempotent drops", () => {
    const source = readFileSync(join(__dirname, "..", "purge.ts"), "utf8");
    assert.match(source, /problems\.push\(\.\.\.unlistedBlobProblems\(listed, blobKeys, t\.blob\.prefix\)\)/);
    assert.match(source, /verifyBlobBackupFile\(destination, \{ listedSize, streamedSha256: streamed\.sha256 \}\)/);
    assert.doesNotMatch(source, /result\.blob\.size/);
    assert.match(source, /await reconcileAbsentDrops\(c, manifest, runDir, log\)/);
    assert.match(source, /e\.drop_collection_already_absent/);
    assert.match(source, /f\.drop_database_already_absent/);
  });
});

describe("cutover check (read-only)", () => {
  const row = (ns: string, extra: Partial<Snapshot["targets"][number]> = {}) => ({ ns, exists: true, uuid: "u", count: 3, last_insert_at: "2026-10-04T10:00:00.000Z", last_updated_at: "2026-10-04T10:05:00.000Z", ...extra });
  const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
    version: "slimming-cutover-snapshot-v1",
    observed_at: "2026-10-04T12:00:00.000Z",
    deployment: null,
    targets: [row("vantagemovers.outreach_records"), row("vantagemovers.operational_report_runs", { exists: false, uuid: null, count: 0, last_insert_at: null, last_updated_at: null })],
    historical: { exists: true, collections: [row("vantagemovershistorical.form_leads")] },
    legacy_jobs: { by_status: { completed: 5, retired: 2 }, runnable: 0, live_leases: 0, expired_leases: 0, nonterminal_by_dataset: {} },
    blob: { objects: 2, bytes: 10, last_uploaded_at: "2026-10-04T09:00:00.000Z" },
    ...extra,
  });

  it("is quiet when nothing was written after the deploy and nothing changed between snapshots", () => {
    assert.deepEqual(snapshotFindings(snap(), { since: "2026-10-04T11:00:00.000Z", earlier: snap() }), []);
  });

  it("flags writes after the deploy, growth between snapshots, recreation and runnable or leased legacy jobs", () => {
    const later = snap({
      targets: [row("vantagemovers.outreach_records", { count: 4, last_insert_at: "2026-10-04T11:30:00.000Z" }), row("vantagemovers.operational_report_runs", { uuid: "new", count: 0, last_insert_at: null, last_updated_at: null })],
      legacy_jobs: { by_status: { pending: 1 }, runnable: 1, live_leases: 1, expired_leases: 1, nonterminal_by_dataset: { "csi-production/vantagemovers": 3 } },
      blob: { objects: 3, bytes: 12, last_uploaded_at: "2026-10-04T11:45:00.000Z" },
    });
    const findings = snapshotFindings(later, { since: "2026-10-04T11:00:00.000Z", earlier: snap() });
    assert.ok(findings.some((f) => f.includes("outreach_records: insert at 2026-10-04T11:30")));
    assert.ok(findings.some((f) => f.includes("outreach_records: count 3 -> 4")));
    assert.ok(findings.some((f) => f.includes("operational_report_runs: appeared")));
    assert.ok(findings.some((f) => f.includes("Blob conversations/: upload at")));
    assert.ok(findings.some((f) => f.includes("Blob conversations/: 2 -> 3 objects")));
    assert.ok(findings.some((f) => f.includes("runnable")));
    assert.ok(findings.some((f) => f.includes("live lease")));
    assert.ok(findings.some((f) => f.includes("expired lease")));
  });
});

describe("loopback rehearsal (SLIM-09)", () => {
  const scratch = join(tmpdir(), "slimming-rehearsal-test");
  const rehearsalArgv = (...extra: string[]) => [
    "node",
    "purge.ts",
    "--rehearsal",
    "--rehearsal-main-db=slimrehearsal_main",
    "--rehearsal-admin-db=slimrehearsal_admin",
    `--manifest=${join(scratch, "deletion-manifest.json")}`,
    ...extra,
  ];
  const missingDotenv = join(scratch, "does-not-exist.env");
  const loopbackEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
    DOTENV_CONFIG_PATH: missingDotenv,
    ...extra,
  });
  const rehearsalTargets = (): ManifestTargets => ({
    ...baseTargets(),
    rehearsal: true,
    main_database: "slimrehearsal_main",
    admin_auth_database: "slimrehearsal_admin",
    drop_collections: [{ ...baseTargets().drop_collections[0]!, db: "slimrehearsal_main" }],
  });

  it("defaults to production and refuses rehearsal-only flags without --rehearsal", () => {
    const target = resolveSlimmingTarget(["node", "purge.ts"]);
    assert.deepEqual([target.rehearsal, target.mainDatabase, target.adminAuthDatabase], [false, "vantagemovers", "vantageadmin"]);
    assert.equal(target.manifestPath, PRODUCTION_MANIFEST_PATH);
    for (const flag of ["--rehearsal-main-db=slimrehearsal_main", "--rehearsal-admin-db=slimrehearsal_admin", `--manifest=${join(scratch, "m.json")}`])
      assert.throws(() => resolveSlimmingTarget(["node", "purge.ts", flag]), /only with --rehearsal/, flag);
  });

  it("accepts only distinct slimrehearsal_ databases and a manifest outside the workspace", () => {
    const target = resolveSlimmingTarget(rehearsalArgv());
    assert.deepEqual([target.rehearsal, target.mainDatabase, target.adminAuthDatabase], [true, "slimrehearsal_main", "slimrehearsal_admin"]);
    assert.equal(target.blobKeysPath, join(scratch, "conversation-blob-keys.json"));
    for (const name of ["vantagemovers", "vantageadmin", "testvantagemovers_x", "slimrehearsal_", "slimrehearsal_Main", "slimrehearsal_a_b"])
      assert.throws(() => resolveSlimmingTarget(rehearsalArgv().map((a) => (a.startsWith("--rehearsal-main-db=") ? `--rehearsal-main-db=${name}` : a))), /must match/, name);
    const replace = (flag: string, value: string) => rehearsalArgv().map((a) => (a.startsWith(`--${flag}=`) ? `--${flag}=${value}` : a));
    assert.throws(() => resolveSlimmingTarget(replace("rehearsal-admin-db", "slimrehearsal_main")), /must differ/);
    for (const manifest of [PRODUCTION_MANIFEST_PATH, "relative/deletion-manifest.json", join(SERVER_ROOT, "tmp", "m.json")])
      assert.throws(() => resolveSlimmingTarget(replace("manifest", manifest)), /outside the workspace/, manifest);
  });

  it("refuses a non-loopback cluster, a Blob token and a loadable dotenv", () => {
    const target = resolveSlimmingTarget(rehearsalArgv());
    const env = loadRehearsalEnv(target, loopbackEnv());
    assert.deepEqual(env, { serverMongoUri: "mongodb://127.0.0.1:27189/?replicaSet=csi01", adminMongoUri: "mongodb://127.0.0.1:27189/?replicaSet=csi01", adminAuthDbName: "slimrehearsal_admin", blobToken: null, dnsServers: [] });
    for (const uri of ["mongodb+srv://cluster0.example.mongodb.net/", "mongodb://127.0.0.1:27189,db.example.com:27017/?replicaSet=rs", "", undefined])
      assert.throws(() => loadRehearsalEnv(target, loopbackEnv({ MONGO_URI: uri })), /loopback/, String(uri));
    assert.throws(() => loadRehearsalEnv(target, loopbackEnv({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" })), /BLOB_READ_WRITE_TOKEN must be unset/);
    assert.throws(() => loadRehearsalEnv(target, loopbackEnv({ DOTENV_CONFIG_PATH: undefined })), /DOTENV_CONFIG_PATH/);
    assert.throws(() => loadRehearsalEnv(target, loopbackEnv({ DOTENV_CONFIG_PATH: join(SERVER_ROOT, "package.json") })), /DOTENV_CONFIG_PATH/);
    assert.throws(() => loadRehearsalEnv(resolveSlimmingTarget(["node", "purge.ts"]), loopbackEnv()), /production target/);
    assert.throws(() => loadSlimmingEnv(rehearsalArgv()), /reads no \.env file/);
  });

  it("keeps rehearsal manifests apart from production ones", () => {
    assert.doesNotThrow(() => assertManifestInvariants(rehearsalTargets()));
    assert.throws(() => assertManifestInvariants({ ...rehearsalTargets(), blob: { prefix: "conversations/", keys_file: "k", keys_sha256: "s", count: 0, bytes: 0, unreferenced_count: 0 } }), /never has a Blob target/);
    assert.throws(() => assertManifestInvariants({ ...rehearsalTargets(), main_database: "vantagemovers" }), /slimrehearsal_/);
    assert.throws(() => assertManifestInvariants({ ...rehearsalTargets(), admin_auth_database: "slimrehearsal_main" }), /distinct/);
    const { rehearsal: _flag, ...unflagged } = rehearsalTargets();
    assert.throws(() => assertManifestInvariants(unflagged), /main database must be vantagemovers/);
    assert.throws(() => assertManifestInvariants({ ...rehearsalTargets(), drop_databases: [{ ...baseTargets().drop_databases[0]!, name: "slimrehearsal_main" }] }), /can never be dropped/);
    assert.throws(() => assertManifestInvariants({ ...rehearsalTargets(), drop_collections: [{ ...rehearsalTargets().drop_collections[0]!, name: "contact_numbers" }] }), /protected/);
    // An absent flag adds nothing to the canonical JSON, so production hashes are unchanged.
    assert.equal(canonicalJson(baseTargets()).includes("rehearsal"), false);
    assert.notEqual(manifestHash(rehearsalTargets()), manifestHash({ ...rehearsalTargets(), rehearsal: undefined }));
  });

  it("wires the target into inventory.ts and purge.ts and closes the Blob-less production manifest", () => {
    const inventory = readFileSync(join(__dirname, "..", "inventory.ts"), "utf8");
    const purge = readFileSync(join(__dirname, "..", "purge.ts"), "utf8");
    assert.match(inventory, /if \(!target\.rehearsal && typeof blob\?\.objects !== "number"\)/);
    assert.match(inventory, /writeFileSync\(target\.manifestPath/);
    assert.doesNotMatch(inventory, /MANIFEST_PATH|BLOB_KEYS_PATH/);
    assert.match(purge, /assertTargetMatchesManifest\(target, manifest\)/);
    assert.match(purge, /!target\.rehearsal && !manifest\.targets\.blob/);
    assert.doesNotMatch(purge, /MANIFEST_PATH/);
  });
});

describe("old-deployment and late-write gate (pre-deploy audit)", () => {
  const now = new Date("2026-10-05T12:30:00.000Z");
  const gate = (extra: Partial<CutoverGate> = {}): CutoverGate => ({
    cutoverAt: "2026-10-05T12:00:00.000Z",
    quietSince: "2026-10-05T12:10:00.000Z",
    removedDeployments: ["dpl_old1", "dpl_adminOld2"],
    oldDeploymentsKept: false,
    ...extra,
  });
  const ctx = (extra: Partial<Parameters<typeof cutoverGateProblems>[1]> = {}) => ({ now, stampDeploymentId: "dpl_slim", claimableBeforeCutover: 7, ...extra });

  it("passes with T0, a quiet window after T0 and the removed old deployments (pre-cutover jobs then run on slim code only)", () => {
    assert.deepEqual(cutoverGateProblems(gate(), ctx()), []);
  });

  it("requires T0, the quiet instant and exactly one old-deployment disposition", () => {
    const missing = cutoverGateProblems({ cutoverAt: undefined, quietSince: "nope", removedDeployments: [], oldDeploymentsKept: false }, ctx());
    assert.ok(missing.some((p) => p.includes("--cutover-at=<ISO> is required")));
    assert.ok(missing.some((p) => p.includes("--quiet-since=<ISO> is required")));
    assert.ok(missing.some((p) => p.includes("exactly one of --old-deployments-removed")));
    assert.ok(cutoverGateProblems(gate({ oldDeploymentsKept: true }), ctx()).some((p) => p.includes("exactly one of")));
  });

  it("refuses a quiet window before T0, instants in the future, bad ids and removing the slim deployment", () => {
    assert.ok(cutoverGateProblems(gate({ quietSince: "2026-10-05T11:59:00.000Z" }), ctx()).some((p) => p.includes("is before --cutover-at")));
    assert.ok(cutoverGateProblems(gate({ quietSince: "2026-10-05T13:00:00.000Z" }), ctx()).some((p) => p.includes("in the future")));
    assert.ok(cutoverGateProblems(gate({ removedDeployments: ["https://old.vercel.app"] }), ctx()).some((p) => p.includes("not a Vercel deployment id")));
    assert.ok(cutoverGateProblems(gate({ removedDeployments: ["dpl_old1", "dpl_slim"] }), ctx()).some((p) => p.includes("the slim deployment that wrote the stamp")));
    assert.ok(cutoverGateProblems(gate(), ctx({ stampDeploymentId: null })).some((p) => p.includes("no vercel_deployment_id")));
  });

  it("with the old deployments kept, waits out queue retention + refresh max age + maxDuration and needs no claimable pre-T0 job", () => {
    const kept = gate({ removedDeployments: [], oldDeploymentsKept: true });
    const early = cutoverGateProblems(kept, ctx({ claimableBeforeCutover: 0 }));
    assert.equal(early.length, 1);
    assert.match(early[0]!, /can still be delivered until 2026-10-06T12:58:20\.000Z/);
    assert.equal(OLD_DEPLOYMENT_DRAIN_MS, (24 * 3_600 + 45 * 60 + 800) * 1_000);
    const later = new Date(Date.parse("2026-10-05T12:00:00.000Z") + OLD_DEPLOYMENT_DRAIN_MS);
    assert.deepEqual(cutoverGateProblems(kept, ctx({ now: later, claimableBeforeCutover: 0 })), []);
    assert.ok(cutoverGateProblems(kept, ctx({ now: later, claimableBeforeCutover: 2 })).some((p) => p.includes("2 sales_intelligence_jobs created before --cutover-at")));
  });

  it("selects pre-T0 jobs an old consumer can claim (pending/retry/leased, by ObjectId time)", () => {
    const filter = claimableBeforeFilter(new Date("2026-10-05T12:00:00.900Z")) as { _id: { $lt: ObjectId }; status: { $in: string[] } };
    assert.equal(filter._id.$lt.getTimestamp().toISOString(), "2026-10-05T12:00:00.000Z");
    assert.deepEqual(filter.status.$in, ["pending", "retry", "leased"]);
    assert.deepEqual([...CLAIMABLE_JOB_STATUSES], ["pending", "retry", "leased"]);
  });

  it("flags any insert or write timestamp at or after --quiet-since, inserts at whole-second precision", () => {
    const quiet = new Date("2026-10-05T12:10:00.500Z");
    const rows: NewestWrite[] = [
      { ns: "vantagemovers.operational_events", last_insert_at: "2026-10-05T12:10:00.000Z", last_write_field_at: null, field: null },
      { ns: "vantageadmin.admin_audit_logs", last_insert_at: "2026-10-05T11:00:00.000Z", last_write_field_at: "2026-10-05T12:11:00.000Z", field: "createdAt" },
      { ns: "vantagemovers.outreach_records", last_insert_at: "2026-10-05T12:09:59.000Z", last_write_field_at: "2026-10-05T12:10:00.400Z", field: "updatedAt" },
    ];
    const problems = writesAfterProblems(rows, quiet);
    assert.equal(problems.length, 2);
    assert.match(problems[0]!, /operational_events: insert at 2026-10-05T12:10:00\.000Z/);
    assert.match(problems[1]!, /admin_audit_logs: createdAt 2026-10-05T12:11:00\.000Z/);
  });

  it("finds the newest write with one read-only $group over date-typed timestamp fields", () => {
    const [stage] = newestWritePipeline();
    assert.deepEqual(Object.keys(stage!.$group).sort(), ["_id", ...WRITE_TIMESTAMP_FIELDS].sort());
    assert.doesNotThrow(() => assertReadOnlyPipeline(newestWritePipeline()));
  });

  it("wires the gate into purge.ts: required in production, re-checked immediately before every drop, logged", () => {
    const source = readFileSync(join(__dirname, "..", "purge.ts"), "utf8");
    assert.match(source, /const gateRequired = !target\.rehearsal \|\| cutoverGateGiven\(gate\);/);
    assert.match(source, /\.\.\.gateProblems,/);
    assert.equal(source.match(/await assertQuietBeforeDrop\(/g)?.length, 2);
    assert.ok(source.indexOf("await assertQuietBeforeDrop(c, target.db") < source.indexOf("await c.dropCollectionExact"));
    assert.ok(source.indexOf("await assertQuietBeforeDrop(c, db.name") < source.indexOf("await c.dropDatabaseExact"));
    assert.match(source, /await dropTargets\(purge, manifest, runDir, log, quietSince\);/);
    assert.match(source, /cutover_gate: facts\.cutover_gate \?\? null/);
  });
});
