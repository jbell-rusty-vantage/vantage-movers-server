import { spawn as defaultSpawn } from "node:child_process";
import { createHash as defaultCreateHash } from "node:crypto";
import { createReadStream as defaultCreateReadStream } from "node:fs";
import { chmod, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "@google-cloud/storage";

export const REQUIRED = Object.freeze({
  MONGO_DATABASE: "vantagemovers",
  BACKUP_BUCKET: "vantage-mongodb-backups-496816",
  BACKUP_SCHEMA_VERSION: "1",
  MONGO_TOOLS_VERSION: "100.17.0",
  TZ: "America/New_York",
});

const URI_LIKE =
  /mongodb(?:\+srv)?:\/\/[^\s"'`]+|(?:\/\/)[^/\s:@]+:[^/\s@]+@/gi;

export function validateConfig(env = {}) {
  const missing = ["MONGO_URI", ...Object.keys(REQUIRED)].filter((key) => {
    const value = env[key];
    return value == null || String(value).trim() === "";
  });
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }

  for (const [key, expected] of Object.entries(REQUIRED)) {
    if (String(env[key]).trim() !== expected) {
      throw new Error(
        `Refusing to run: ${key} must be ${expected}, got ${String(env[key]).trim()}`,
      );
    }
  }

  return {
    mongoUri: String(env.MONGO_URI),
    database: REQUIRED.MONGO_DATABASE,
    bucket: REQUIRED.BACKUP_BUCKET,
    schemaVersion: Number(REQUIRED.BACKUP_SCHEMA_VERSION),
    toolsVersion: REQUIRED.MONGO_TOOLS_VERSION,
    timeZone: REQUIRED.TZ,
  };
}

export function formatUtcStamp(date) {
  const iso = date.toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export function utcDateParts(date) {
  return {
    year: date.getUTCFullYear(),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

export function newYorkDateParts(date, timeZone = REQUIRED.TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    weekday: get("weekday"),
    year: Number(get("year")),
    month: get("month"),
    day: get("day"),
  };
}

export function isNewYorkSunday(date, timeZone = REQUIRED.TZ) {
  return newYorkDateParts(date, timeZone).weekday === "Sun";
}

export function isoWeekParts(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  const dayOfWeek = date.getUTCDay() || 7;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const isoWeek = 1 + Math.floor((date - week1Monday) / (7 * 24 * 60 * 60 * 1000));
  return {
    isoYear,
    isoWeek: String(isoWeek).padStart(2, "0"),
  };
}

export function dailyArchiveObjectName({ stamp, utcParts, toolsVersion }) {
  return [
    "backups/mongodb/vantagemovers/daily/schema-v1",
    utcParts.year,
    utcParts.month,
    utcParts.day,
    `vantagemovers-${stamp}-tools-${toolsVersion}.archive.gz`,
  ].join("/");
}

export function weeklyArchiveObjectName({ stamp, nyParts, toolsVersion }) {
  const { isoYear, isoWeek } = isoWeekParts(nyParts.year, nyParts.month, nyParts.day);
  return [
    "backups/mongodb/vantagemovers/weekly/schema-v1",
    isoYear,
    isoWeek,
    `vantagemovers-${stamp}-tools-${toolsVersion}.archive.gz`,
  ].join("/");
}

export function successManifestObjectName({ stamp, utcParts }) {
  return [
    "backups/mongodb/vantagemovers/manifests/schema-v1",
    utcParts.year,
    utcParts.month,
    utcParts.day,
    `vantagemovers-${stamp}.success.json`,
  ].join("/");
}

export function encodeYamlString(value) {
  return JSON.stringify(String(value));
}

function secretFragments(secrets) {
  const fragments = [];
  for (const secret of secrets) {
    if (!secret) continue;
    fragments.push(secret);
    try {
      const parsed = new URL(secret);
      if (parsed.password) fragments.push(decodeURIComponent(parsed.password));
      if (parsed.username) fragments.push(decodeURIComponent(parsed.username));
    } catch {
      // not a URL
    }
  }
  return fragments;
}

export function redactSecrets(text, secrets = []) {
  let redacted = String(text ?? "");
  redacted = redacted.replace(URI_LIKE, "[REDACTED]");
  for (const secret of secretFragments(secrets)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function buildArchiveMetadata({
  createdAt,
  retentionClass,
  sha256,
  sizeBytes,
  executionId,
  toolsVersion = REQUIRED.MONGO_TOOLS_VERSION,
}) {
  return {
    source: "mongodb",
    kind: "logical-full-backup",
    database: REQUIRED.MONGO_DATABASE,
    format: "mongodump-archive-gzip",
    backup_schema_version: "1",
    mongo_tools_version: toolsVersion,
    created_at: createdAt,
    retention_class: retentionClass,
    sha256,
    size_bytes: String(sizeBytes),
    owner: "vantage",
    execution_id: executionId,
  };
}

export function buildSuccessManifest({
  archiveObject,
  archiveGeneration,
  sizeBytes,
  sha256,
  createdAt,
  toolsVersion,
  retentionClass,
  durationMs,
  verification,
  weeklyCopy,
  executionId,
}) {
  return {
    archive_object: archiveObject,
    archive_generation: String(archiveGeneration),
    size_bytes: sizeBytes,
    sha256,
    created_at: createdAt,
    mongo_tools_version: toolsVersion,
    database: REQUIRED.MONGO_DATABASE,
    retention_class: retentionClass,
    duration_ms: durationMs,
    verification,
    weekly_copy: weeklyCopy,
    backup_schema_version: 1,
    execution_id: executionId,
  };
}

export function metadataMatches(remoteMetadata, expected) {
  const custom = remoteMetadata?.metadata ?? {};
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => String(custom[key] ?? "") !== String(value))
    .map(([key]) => key);
  return {
    ok: mismatches.length === 0,
    mismatches,
  };
}

export async function hashFile(
  filePath,
  {
    createHash = defaultCreateHash,
    createReadStream = defaultCreateReadStream,
  } = {},
) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export function createGcsStorage(storage, bucketName) {
  const bucket = storage.bucket(bucketName);
  return {
    async uploadArchive({ localPath, objectName, metadata }) {
      await bucket.upload(localPath, {
        destination: objectName,
        resumable: true,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: "application/gzip",
          metadata,
        },
      });
    },
    async getMetadata(objectName) {
      const [remote] = await bucket.file(objectName).getMetadata();
      return remote;
    },
    async copyObject({ from, to, metadata }) {
      await bucket.file(from).copy(bucket.file(to), {
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          metadata,
        },
      });
    },
    async uploadManifest({ objectName, body }) {
      await bucket.file(objectName).save(body, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        contentType: "application/json",
      });
    },
  };
}

function emitLog(log, event, payload) {
  log({
    event,
    ts: new Date().toISOString(),
    ...payload,
  });
}

function childEnvWithoutSecret(baseEnv) {
  const env = { ...baseEnv };
  delete env.MONGO_URI;
  return env;
}

export async function runMongodump({
  spawnImpl,
  configPath,
  archivePath,
  database,
  secrets,
  env,
}) {
  const args = [
    `--config=${configPath}`,
    `--db=${database}`,
    `--archive=${archivePath}`,
    "--gzip",
    "--quiet",
  ];

  const { exitCode, stdout, stderr } = await new Promise((resolve, reject) => {
    const child = spawnImpl("mongodump", args, {
      env: childEnvWithoutSecret(env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutText = "";
    let stderrText = "";
    child.stdout?.on("data", (chunk) => {
      stdoutText += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderrText += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: redactSecrets(stdoutText, secrets),
        stderr: redactSecrets(stderrText, secrets),
      });
    });
  });

  if (exitCode !== 0) {
    throw new Error(
      `mongodump failed with exit ${exitCode}: ${stderr || stdout || "no output"}`,
    );
  }
}

async function removeIfExists(filePath) {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function runBackup(deps) {
  const startedAt = deps.now();
  const config = validateConfig(deps.env);
  const secrets = [config.mongoUri];
  const stamp = formatUtcStamp(startedAt);
  const utcParts = utcDateParts(startedAt);
  const nyParts = newYorkDateParts(startedAt, config.timeZone);
  const sunday = isNewYorkSunday(startedAt, config.timeZone);
  const executionId = deps.executionId ?? deps.env.CLOUD_RUN_EXECUTION ?? "local";
  const createdAt = startedAt.toISOString();
  const tmpRoot = deps.tmpdir ?? os.tmpdir();
  const archivePath = path.join(tmpRoot, `vantagemovers-${stamp}.archive.gz`);
  const configPath = path.join(tmpRoot, `mongodump-${stamp}.yaml`);
  const dailyObject = dailyArchiveObjectName({
    stamp,
    utcParts,
    toolsVersion: config.toolsVersion,
  });
  const weeklyObject = weeklyArchiveObjectName({
    stamp,
    nyParts,
    toolsVersion: config.toolsVersion,
  });
  const manifestObject = successManifestObjectName({ stamp, utcParts });

  emitLog(deps.log, "backup.started", {
    database: config.database,
    bucket: config.bucket,
    daily_object: dailyObject,
    weekly_planned: sunday,
    execution_id: executionId,
  });

  try {
    await writeFile(configPath, `uri: ${encodeYamlString(config.mongoUri)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(configPath, 0o600);

    await runMongodump({
      spawnImpl: deps.spawn,
      configPath,
      archivePath,
      database: config.database,
      secrets,
      env: deps.env,
    });

    const archiveStat = await stat(archivePath);
    if (!archiveStat.isFile() || archiveStat.size <= 0) {
      throw new Error("mongodump produced a missing or zero-byte archive");
    }

    const sha256 = await (deps.hashFile ?? hashFile)(archivePath);
    const sizeBytes = archiveStat.size;

    emitLog(deps.log, "dump.completed", {
      size_bytes: sizeBytes,
      sha256,
      execution_id: executionId,
    });

    const dailyMetadata = buildArchiveMetadata({
      createdAt,
      retentionClass: "daily",
      sha256,
      sizeBytes,
      executionId,
      toolsVersion: config.toolsVersion,
    });

    await deps.storage.uploadArchive({
      localPath: archivePath,
      objectName: dailyObject,
      metadata: dailyMetadata,
    });

    emitLog(deps.log, "upload.completed", {
      object: dailyObject,
      size_bytes: sizeBytes,
      execution_id: executionId,
    });

    const remote = await deps.storage.getMetadata(dailyObject);
    const remoteSize = Number(remote.size);
    const compared = metadataMatches(remote, dailyMetadata);
    const verification = {
      size_match: remoteSize === sizeBytes,
      sha256_match: String(remote.metadata?.sha256 ?? "") === sha256,
      metadata_match: compared.ok,
    };
    if (!verification.size_match || !verification.sha256_match || !verification.metadata_match) {
      throw new Error(
        `Archive verification failed: ${JSON.stringify({
          verification,
          mismatches: compared.mismatches,
        })}`,
      );
    }

    emitLog(deps.log, "verification.completed", {
      object: dailyObject,
      generation: String(remote.generation),
      verification,
      execution_id: executionId,
    });

    let weeklyCopy = null;
    if (sunday) {
      const weeklyMetadata = {
        ...dailyMetadata,
        retention_class: "weekly",
      };
      await deps.storage.copyObject({
        from: dailyObject,
        to: weeklyObject,
        metadata: weeklyMetadata,
      });
      const weeklyRemote = await deps.storage.getMetadata(weeklyObject);
      weeklyCopy = {
        object: weeklyObject,
        generation: String(weeklyRemote.generation),
      };
      emitLog(deps.log, "weekly_copy.completed", {
        object: weeklyObject,
        generation: weeklyCopy.generation,
        execution_id: executionId,
      });
    }

    const durationMs = deps.now().getTime() - startedAt.getTime();
    const manifest = buildSuccessManifest({
      archiveObject: dailyObject,
      archiveGeneration: remote.generation,
      sizeBytes,
      sha256,
      createdAt,
      toolsVersion: config.toolsVersion,
      retentionClass: "daily",
      durationMs,
      verification,
      weeklyCopy,
      executionId,
    });
    await deps.storage.uploadManifest({
      objectName: manifestObject,
      body: `${JSON.stringify(manifest)}\n`,
    });

    emitLog(deps.log, "backup.succeeded", {
      object: dailyObject,
      generation: String(remote.generation),
      manifest_object: manifestObject,
      size_bytes: sizeBytes,
      sha256,
      duration_ms: durationMs,
      weekly_copy: weeklyCopy,
      execution_id: executionId,
    });

    return {
      dailyObject,
      manifestObject,
      weeklyObject: weeklyCopy?.object ?? null,
      sizeBytes,
      sha256,
      verification,
    };
  } catch (error) {
    emitLog(deps.log, "backup.failed", {
      error: redactSecrets(error?.message ?? String(error), secrets),
      execution_id: executionId,
    });
    throw error;
  } finally {
    await removeIfExists(archivePath);
    await removeIfExists(configPath);
  }
}

export function createDefaultDeps(overrides = {}) {
  const env = overrides.env ?? process.env;
  const storageClient = overrides.storageClient ?? new Storage();
  return {
    env,
    now: overrides.now ?? (() => new Date()),
    spawn: overrides.spawn ?? defaultSpawn,
    log:
      overrides.log ??
      ((payload) => {
        process.stdout.write(`${JSON.stringify(payload)}\n`);
      }),
    storage: overrides.storage ?? createGcsStorage(storageClient, REQUIRED.BACKUP_BUCKET),
    hashFile: overrides.hashFile,
    tmpdir: overrides.tmpdir ?? os.tmpdir(),
    executionId: overrides.executionId ?? env.CLOUD_RUN_EXECUTION ?? "local",
  };
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  runBackup(createDefaultDeps())
    .then(() => {
      process.exitCode = 0;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
