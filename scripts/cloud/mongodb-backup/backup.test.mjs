import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, describe, it } from "node:test";
import {
  buildArchiveMetadata,
  buildSuccessManifest,
  dailyArchiveObjectName,
  encodeYamlString,
  formatUtcStamp,
  isNewYorkSunday,
  isoWeekParts,
  newYorkDateParts,
  redactSecrets,
  runBackup,
  successManifestObjectName,
  utcDateParts,
  validateConfig,
  weeklyArchiveObjectName,
} from "./backup.mjs";

const validEnv = {
  MONGO_URI: "mongodb+srv://user:super-secret-password@cluster.example.test/",
  MONGO_DATABASE: "vantagemovers",
  BACKUP_BUCKET: "vantage-mongodb-backups-496816",
  BACKUP_SCHEMA_VERSION: "1",
  MONGO_TOOLS_VERSION: "100.17.0",
  TZ: "America/New_York",
};

function createSpawnFake({
  exitCode = 0,
  stdout = "",
  stderr = "",
  writeArchive,
} = {}) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(async () => {
      if (writeArchive) await writeArchive(command, args, options);
      if (stdout) child.stdout.end(stdout);
      else child.stdout.end();
      if (stderr) child.stderr.end(stderr);
      else child.stderr.end();
      child.emit("close", exitCode);
    });
    return child;
  };
}

function createMemoryStorage({
  failUpload = false,
  failVerify = false,
  failWeekly = false,
  collide = false,
} = {}) {
  const objects = new Map();
  const uploads = [];
  const copies = [];
  const manifests = [];

  return {
    objects,
    uploads,
    copies,
    manifests,
    async uploadArchive({ localPath, objectName, metadata }) {
      uploads.push({ localPath, objectName, metadata, ifGenerationMatch: 0 });
      if (failUpload) throw new Error("upload failed");
      if (collide || objects.has(objectName)) {
        const error = new Error("Precondition Failed");
        error.code = 412;
        throw error;
      }
      const bytes = await readFile(localPath);
      objects.set(objectName, {
        generation: "17",
        size: String(bytes.length),
        metadata,
        timeCreated: "2026-09-01T18:00:00.000Z",
      });
    },
    async getMetadata(objectName) {
      const current = objects.get(objectName);
      if (!current) throw new Error(`missing object ${objectName}`);
      if (failVerify) {
        return { ...current, size: "0", metadata: { sha256: "nope" } };
      }
      return current;
    },
    async copyObject({ from, to, metadata }) {
      copies.push({ from, to, metadata, ifGenerationMatch: 0 });
      if (failWeekly) throw new Error("weekly copy failed");
      if (objects.has(to)) {
        const error = new Error("Precondition Failed");
        error.code = 412;
        throw error;
      }
      const source = objects.get(from);
      objects.set(to, {
        ...source,
        generation: "29",
        metadata,
      });
    },
    async uploadManifest({ objectName, body }) {
      manifests.push({ objectName, body, ifGenerationMatch: 0 });
      objects.set(objectName, {
        generation: "3",
        size: String(Buffer.byteLength(body)),
        body,
      });
    },
  };
}

function successfulDeps({ now, storage, spawn, tmpdir, hashFile }) {
  const events = [];
  return {
    events,
    deps: {
      env: { ...validEnv },
      now,
      spawn,
      storage,
      tmpdir,
      hashFile,
      executionId: "exec-1",
      log: (payload) => events.push(payload),
    },
  };
}

describe("UTC daily object naming", () => {
  it("uses the UTC timestamp and UTC calendar path", () => {
    const date = new Date("2026-09-01T18:15:07.123Z");
    const stamp = formatUtcStamp(date);
    assert.equal(stamp, "20260901T181507Z");
    const objectName = dailyArchiveObjectName({
      stamp,
      utcParts: utcDateParts(date),
      toolsVersion: "100.17.0",
    });
    assert.equal(
      objectName,
      "backups/mongodb/vantagemovers/daily/schema-v1/2026/09/01/vantagemovers-20260901T181507Z-tools-100.17.0.archive.gz",
    );
    assert.equal(
      successManifestObjectName({ stamp, utcParts: utcDateParts(date) }),
      "backups/mongodb/vantagemovers/manifests/schema-v1/2026/09/01/vantagemovers-20260901T181507Z.success.json",
    );
  });
});

describe("New York Sunday and ISO week around DST", () => {
  it("classifies spring-forward Sunday as weekly week 10", () => {
    const beforeSkip = new Date("2026-03-08T06:30:00.000Z"); // 01:30 EST
    const afterSkip = new Date("2026-03-08T07:30:00.000Z"); // 03:30 EDT
    assert.equal(isNewYorkSunday(beforeSkip), true);
    assert.equal(isNewYorkSunday(afterSkip), true);
    const parts = newYorkDateParts(afterSkip);
    assert.deepEqual(isoWeekParts(parts.year, parts.month, parts.day), {
      isoYear: 2026,
      isoWeek: "10",
    });
  });

  it("classifies fall-back Sunday as weekly week 44", () => {
    const firstOneAm = new Date("2026-11-01T05:30:00.000Z"); // 01:30 EDT
    const secondOneAm = new Date("2026-11-01T06:30:00.000Z"); // 01:30 EST
    assert.equal(isNewYorkSunday(firstOneAm), true);
    assert.equal(isNewYorkSunday(secondOneAm), true);
    const parts = newYorkDateParts(secondOneAm);
    assert.deepEqual(isoWeekParts(parts.year, parts.month, parts.day), {
      isoYear: 2026,
      isoWeek: "44",
    });
  });

  it("treats early UTC Sunday before New York midnight as Saturday, so no weekly copy", () => {
    const date = new Date("2026-03-08T04:15:00.000Z"); // 23:15 EST Saturday
    assert.equal(isNewYorkSunday(date), false);
    assert.equal(utcDateParts(date).day, "08");
    assert.equal(newYorkDateParts(date).day, "07");
  });

  it("does not treat UTC Sunday / New York Saturday as a weekly run", () => {
    const date = new Date("2026-11-08T03:15:00.000Z"); // Saturday 22:15 EST
    assert.equal(isNewYorkSunday(date), false);
    assert.equal(utcDateParts(date).day, "08");
  });
});

describe("metadata and manifest serialization", () => {
  it("includes required archive fields and omits secrets", () => {
    const metadata = buildArchiveMetadata({
      createdAt: "2026-09-01T18:15:07.000Z",
      retentionClass: "daily",
      sha256: "abc123",
      sizeBytes: 4096,
      executionId: "exec-1",
    });
    assert.deepEqual(metadata, {
      source: "mongodb",
      kind: "logical-full-backup",
      database: "vantagemovers",
      format: "mongodump-archive-gzip",
      backup_schema_version: "1",
      mongo_tools_version: "100.17.0",
      created_at: "2026-09-01T18:15:07.000Z",
      retention_class: "daily",
      sha256: "abc123",
      size_bytes: "4096",
      owner: "vantage",
      execution_id: "exec-1",
    });
    const serialized = JSON.stringify(
      buildSuccessManifest({
        archiveObject: "daily/obj",
        archiveGeneration: 17,
        sizeBytes: 4096,
        sha256: "abc123",
        createdAt: "2026-09-01T18:15:07.000Z",
        toolsVersion: "100.17.0",
        retentionClass: "daily",
        durationMs: 1200,
        verification: { size_match: true, sha256_match: true, metadata_match: true },
        weeklyCopy: null,
        executionId: "exec-1",
      }),
    );
    assert.match(serialized, /"archive_generation":"17"/);
    assert.doesNotMatch(serialized, /mongodb\+srv|super-secret|MONGO_URI/i);
  });
});

describe("secret and URI redaction", () => {
  it("redacts URI-like values and explicit secrets", () => {
    const raw =
      'failed mongodb+srv://user:super-secret-password@cluster.example.test/db extra super-secret-password';
    const redacted = redactSecrets(raw, [validEnv.MONGO_URI]);
    assert.equal(redacted.includes("super-secret-password"), false);
    assert.equal(redacted.includes("mongodb+srv://"), false);
    assert.match(redacted, /\[REDACTED\]/);
  });
});

describe("configuration refusal", () => {
  it("refuses a non-production database name", () => {
    assert.throws(
      () => validateConfig({ ...validEnv, MONGO_DATABASE: "testvantagemovers" }),
      /MONGO_DATABASE must be vantagemovers/,
    );
  });

  it("refuses missing required configuration", () => {
    assert.throws(
      () => validateConfig({ ...validEnv, MONGO_URI: "" }),
      /Missing required configuration: MONGO_URI/,
    );
    assert.throws(
      () => validateConfig({ ...validEnv, BACKUP_BUCKET: "other-bucket" }),
      /BACKUP_BUCKET must be vantage-mongodb-backups-496816/,
    );
  });
});

describe("YAML encoding", () => {
  it("encodes the URI as a quoted YAML scalar", () => {
    assert.equal(
      encodeYamlString('mongodb+srv://user:p@ss:word@host/db?x=1'),
      '"mongodb+srv://user:p@ss:word@host/db?x=1"',
    );
  });
});

describe("runBackup behavior", { concurrency: 1 }, () => {
  let tmpdir;

  before(async () => {
    tmpdir = await mkdtemp(path.join(os.tmpdir(), "vantage-backup-run-"));
  });

  after(async () => {
    await rm(tmpdir, { recursive: true, force: true });
  });

  it("uploads with ifGenerationMatch 0, writes a manifest, and cleans temp files", async () => {
    const storage = createMemoryStorage();
    const now = sequentialNow("2026-09-01T18:15:07.000Z");
    const { deps, events } = successfulDeps({
      now,
      storage,
      tmpdir,
      spawn: createSpawnFake({
        writeArchive: async (_command, args) => {
          const archiveArg = args.find((arg) => arg.startsWith("--archive="));
          await writeFile(archiveArg.slice("--archive=".length), "ARCHIVE");
        },
      }),
    });

    const result = await runBackup(deps);
    assert.equal(storage.uploads[0].ifGenerationMatch, 0);
    assert.equal(storage.manifests.length, 1);
    assert.equal(storage.copies.length, 0);
    assert.equal(result.sizeBytes, 7);
    assert.equal(events.at(-1).event, "backup.succeeded");
    const leftovers = await leftoverBackupFiles(tmpdir);
    assert.deepEqual(leftovers, []);
  });

  it("copies to weekly on a New York Sunday after verification", async () => {
    const storage = createMemoryStorage();
    const now = sequentialNow("2026-03-08T07:30:00.000Z");
    const { deps } = successfulDeps({
      now,
      storage,
      tmpdir,
      spawn: createSpawnFake({
        writeArchive: async (_command, args) => {
          const archiveArg = args.find((arg) => arg.startsWith("--archive="));
          await writeFile(archiveArg.slice("--archive=".length), "SUNDAY");
        },
      }),
    });

    await runBackup(deps);
    assert.equal(storage.copies.length, 1);
    assert.equal(storage.copies[0].ifGenerationMatch, 0);
    assert.equal(storage.copies[0].metadata.retention_class, "weekly");
    assert.equal(storage.manifests.length, 1);
    assert.match(JSON.parse(storage.manifests[0].body).weekly_copy.object, /\/weekly\//);
  });

  it("fails on a zero-byte archive and does not upload a manifest", async () => {
    const storage = createMemoryStorage();
    const { deps, events } = successfulDeps({
      now: sequentialNow("2026-09-01T18:15:07.000Z"),
      storage,
      tmpdir,
      spawn: createSpawnFake({
        writeArchive: async (_command, args) => {
          const archiveArg = args.find((arg) => arg.startsWith("--archive="));
          await writeFile(archiveArg.slice("--archive=".length), "");
        },
      }),
    });

    await assert.rejects(runBackup(deps), /zero-byte archive/);
    assert.equal(storage.uploads.length, 0);
    assert.equal(storage.manifests.length, 0);
    assert.equal(events.at(-1).event, "backup.failed");
    assert.deepEqual(await leftoverBackupFiles(tmpdir), []);
  });

  it("fails on mongodump error, redacts secrets, and cleans up", async () => {
    const storage = createMemoryStorage();
    const { deps, events } = successfulDeps({
      now: sequentialNow("2026-09-01T18:15:07.000Z"),
      storage,
      tmpdir,
      spawn: createSpawnFake({
        exitCode: 1,
        stderr: `auth failed ${validEnv.MONGO_URI}`,
      }),
    });

    await assert.rejects(runBackup(deps), /mongodump failed/);
    assert.equal(storage.manifests.length, 0);
    assert.equal(events.at(-1).event, "backup.failed");
    assert.equal(String(events.at(-1).error).includes("super-secret-password"), false);
    assert.deepEqual(await leftoverBackupFiles(tmpdir), []);
  });

  it("does not write a success manifest after upload failure", async () => {
    const storage = createMemoryStorage({ failUpload: true });
    const { deps } = successfulDeps({
      now: sequentialNow("2026-09-01T18:15:07.000Z"),
      storage,
      tmpdir,
      spawn: createSpawnFake({
        writeArchive: async (_command, args) => {
          const archiveArg = args.find((arg) => arg.startsWith("--archive="));
          await writeFile(archiveArg.slice("--archive=".length), "ARCHIVE");
        },
      }),
    });

    await assert.rejects(runBackup(deps), /upload failed/);
    assert.equal(storage.manifests.length, 0);
  });

  it("does not write a success manifest after verification failure", async () => {
    const storage = createMemoryStorage({ failVerify: true });
    const { deps } = successfulDeps({
      now: sequentialNow("2026-09-01T18:15:07.000Z"),
      storage,
      tmpdir,
      spawn: createSpawnFake({
        writeArchive: async (_command, args) => {
          const archiveArg = args.find((arg) => arg.startsWith("--archive="));
          await writeFile(archiveArg.slice("--archive=".length), "ARCHIVE");
        },
      }),
    });

    await assert.rejects(runBackup(deps), /verification failed/);
    assert.equal(storage.manifests.length, 0);
  });

  it("does not write a success manifest after weekly-copy failure", async () => {
    const storage = createMemoryStorage({ failWeekly: true });
    const { deps } = successfulDeps({
      now: sequentialNow("2026-03-08T07:30:00.000Z"),
      storage,
      tmpdir,
      spawn: createSpawnFake({
        writeArchive: async (_command, args) => {
          const archiveArg = args.find((arg) => arg.startsWith("--archive="));
          await writeFile(archiveArg.slice("--archive=".length), "SUNDAY");
        },
      }),
    });

    await assert.rejects(runBackup(deps), /weekly copy failed/);
    assert.equal(storage.manifests.length, 0);
  });

  it("fails rather than overwrite when the object name already exists", async () => {
    const storage = createMemoryStorage({ collide: true });
    const { deps } = successfulDeps({
      now: sequentialNow("2026-09-01T18:15:07.000Z"),
      storage,
      tmpdir,
      spawn: createSpawnFake({
        writeArchive: async (_command, args) => {
          const archiveArg = args.find((arg) => arg.startsWith("--archive="));
          await writeFile(archiveArg.slice("--archive=".length), "ARCHIVE");
        },
      }),
    });

    await assert.rejects(runBackup(deps), /Precondition Failed/);
    assert.equal(storage.manifests.length, 0);
  });

  it("writes a mode-0600 YAML config and never puts the URI on argv", async () => {
    const storage = createMemoryStorage();
    let observedArgs;
    let observedEnv;
    let configContents;
    const { deps } = successfulDeps({
      now: sequentialNow("2026-09-01T18:15:07.000Z"),
      storage,
      tmpdir,
      spawn: createSpawnFake({
        writeArchive: async (_command, args, options) => {
          observedArgs = args;
          observedEnv = options.env;
          const configArg = args.find((arg) => arg.startsWith("--config="));
          configContents = await readFile(configArg.slice("--config=".length), "utf8");
          const archiveArg = args.find((arg) => arg.startsWith("--archive="));
          await writeFile(archiveArg.slice("--archive=".length), "ARCHIVE");
        },
      }),
    });

    await runBackup(deps);
    assert.ok(observedArgs.every((arg) => !String(arg).includes("super-secret-password")));
    assert.equal(observedEnv.MONGO_URI, undefined);
    assert.equal(configContents, `uri: ${encodeYamlString(validEnv.MONGO_URI)}\n`);
  });
});

function sequentialNow(iso) {
  const start = new Date(iso);
  let offset = 0;
  return () => new Date(start.getTime() + offset++);
}

async function leftoverBackupFiles(dir) {
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(dir);
  return names.filter(
    (name) => name.startsWith("vantagemovers-") || name.startsWith("mongodump-"),
  );
}

