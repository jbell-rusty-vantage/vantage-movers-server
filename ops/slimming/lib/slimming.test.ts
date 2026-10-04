import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { HISTORICAL_DATABASE, RETIRED_AUDIT_ACTOR_KINDS, RETIRED_AUDIT_EVENT_KINDS } from "../policy";
import { verifyBackupFile, verifyBlobBackupFile, writeBackupFile } from "./backup";
import { GUARD_EXIT_CODE, assertReadOnlyPipeline, isCommandAllowed } from "./guarded-mongo";
import { type ManifestTargets, assertManifestInvariants, canonicalJson, dropCountMatches, loadManifest, manifestHash } from "./manifest";
import {
  BASELINE_COMMIT,
  assertBackupDir,
  assertClosedFilter,
  cleanupFilter,
  deploymentProblems,
  terminalizeFilter,
  unlistedBlobProblems,
  verifiedFullBackupProblem,
} from "./purge-rules";

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
