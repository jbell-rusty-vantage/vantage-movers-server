/**
 * Where the slimming tools point: production (the default) or an explicit, loopback-only rehearsal.
 *
 * Production reads `.env`, uses the policy database names (`vantagemovers`, `vantageadmin`) and the tracked
 * `ops/slimming/deletion-manifest.json`. A rehearsal (`--rehearsal`) is the SLIM-09 purge rehearsal on a local
 * replica and is refused unless every one of these holds:
 *   - `MONGO_URI` (process env; `.env` files are never read) is loopback-only (`127.0.0.1` / `localhost`, no SRV);
 *   - `DOTENV_CONFIG_PATH` names a file that does not exist, so no `import "dotenv/config"` reached through `src/`
 *     can load the production `.env`;
 *   - `BLOB_READ_WRITE_TOKEN` is unset: a rehearsal never calls Vercel Blob, and its manifest has no Blob target and
 *     an empty key list (purge re-checks both);
 *   - the main and Admin auth databases are explicit `slimrehearsal_<suffix>` names (never a production name), and
 *     the historical database keeps its literal name `vantagemovershistorical` on that loopback replica;
 *   - the manifest path is absolute and outside the workspace, so the tracked production manifest is never written.
 * None of the rehearsal flags is accepted without `--rehearsal`, and a production run refuses a rehearsal manifest.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isLoopbackMongoUri } from "../../lib/loopback-mongo";
import { ADMIN_AUTH_DATABASE, MAIN_DATABASE } from "../policy";
import { SERVER_ROOT, type SlimmingEnv, WORKSPACE_ROOT, argValue, hasFlag } from "./env";

export const REHEARSAL_DATABASE_PATTERN = /^slimrehearsal_[a-z0-9]+$/;
const REHEARSAL_ONLY_ARGS = ["rehearsal-main-db", "rehearsal-admin-db", "manifest"] as const;

export type SlimmingTarget = {
  rehearsal: boolean;
  mainDatabase: string;
  adminAuthDatabase: string;
  manifestPath: string;
  blobKeysPath: string;
};

export const PRODUCTION_MANIFEST_PATH = resolve(__dirname, "../deletion-manifest.json");
export const PRODUCTION_BLOB_KEYS_PATH = resolve(__dirname, "../conversation-blob-keys.json");

export function isRehearsal(argv: readonly string[]): boolean {
  return hasFlag(argv, "rehearsal");
}

function outsideWorkspace(path: string): boolean {
  return [WORKSPACE_ROOT, SERVER_ROOT].every((root) => {
    const rel = relative(root, resolve(path));
    return rel.startsWith("..") || isAbsolute(rel);
  });
}

export function resolveSlimmingTarget(argv: readonly string[]): SlimmingTarget {
  if (!isRehearsal(argv)) {
    const stray = REHEARSAL_ONLY_ARGS.filter((name) => argValue(argv, name) !== undefined);
    if (stray.length) throw new Error(`--${stray.join(", --")} is accepted only with --rehearsal`);
    return {
      rehearsal: false,
      mainDatabase: MAIN_DATABASE,
      adminAuthDatabase: ADMIN_AUTH_DATABASE,
      manifestPath: PRODUCTION_MANIFEST_PATH,
      blobKeysPath: PRODUCTION_BLOB_KEYS_PATH,
    };
  }
  const mainDatabase = argValue(argv, "rehearsal-main-db") ?? "";
  const adminAuthDatabase = argValue(argv, "rehearsal-admin-db") ?? "";
  const manifestPath = argValue(argv, "manifest") ?? "";
  for (const [flag, name] of [["rehearsal-main-db", mainDatabase], ["rehearsal-admin-db", adminAuthDatabase]] as const)
    if (!REHEARSAL_DATABASE_PATTERN.test(name)) throw new Error(`--${flag} must match ${REHEARSAL_DATABASE_PATTERN} (got '${name}')`);
  if (mainDatabase === adminAuthDatabase) throw new Error("rehearsal main and Admin auth databases must differ");
  if (!manifestPath || !isAbsolute(manifestPath) || !outsideWorkspace(manifestPath))
    throw new Error("--manifest must be an absolute path outside the workspace in a rehearsal");
  return { rehearsal: true, mainDatabase, adminAuthDatabase, manifestPath: resolve(manifestPath), blobKeysPath: join(dirname(resolve(manifestPath)), "conversation-blob-keys.json") };
}

/** The rehearsal's process-env preconditions (see the module comment). Returns the loopback MONGO_URI. */
export function assertRehearsalEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const uri = (env.MONGO_URI ?? "").trim();
  if (!uri || !isLoopbackMongoUri(uri)) throw new Error("rehearsal refused: MONGO_URI must be set to a loopback-only replica (127.0.0.1/localhost)");
  if ((env.BLOB_READ_WRITE_TOKEN ?? "").trim()) throw new Error("rehearsal refused: BLOB_READ_WRITE_TOKEN must be unset (a rehearsal never calls Vercel Blob)");
  const dotenv = (env.DOTENV_CONFIG_PATH ?? "").trim();
  if (!dotenv || existsSync(dotenv)) throw new Error("rehearsal refused: DOTENV_CONFIG_PATH must name a file that does not exist");
  return uri;
}

/**
 * Connection settings for a rehearsal, from the process env only (never a `.env` file): the loopback MONGO_URI for
 * both the main and the Admin auth database (same replica), no Blob token, no custom DNS.
 */
export function loadRehearsalEnv(target: SlimmingTarget, env: NodeJS.ProcessEnv = process.env): SlimmingEnv {
  if (!target.rehearsal) throw new Error("loadRehearsalEnv called for a production target");
  const uri = assertRehearsalEnvironment(env);
  return { serverMongoUri: uri, adminMongoUri: uri, adminAuthDbName: target.adminAuthDatabase, blobToken: null, dnsServers: [] };
}
