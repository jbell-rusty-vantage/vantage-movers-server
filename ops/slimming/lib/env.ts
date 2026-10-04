/**
 * Connection settings for the slimming inventory and purge tools.
 *
 * Values are parsed from the server and Admin `.env` files into a private object; `process.env` is not
 * mutated and no value is ever printed. Only non-secret identifiers (database names, a sha256 fingerprint
 * of the cluster host) leave this module.
 */
import { createHash } from "node:crypto";
import dns from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

export const SERVER_ROOT = resolve(__dirname, "../../..");
export const WORKSPACE_ROOT = resolve(SERVER_ROOT, "..");

export type SlimmingEnv = {
  serverMongoUri: string;
  adminMongoUri: string | null;
  adminAuthDbName: string | null;
  blobToken: string | null;
  dnsServers: string[];
};

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parse(readFileSync(path));
}

const arg = (argv: readonly string[], name: string) =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export function loadSlimmingEnv(argv: readonly string[] = process.argv): SlimmingEnv {
  const server = readEnvFile(arg(argv, "server-env") ?? resolve(SERVER_ROOT, ".env"));
  const admin = readEnvFile(arg(argv, "admin-env") ?? resolve(WORKSPACE_ROOT, "vantage-admin/.env"));
  const serverMongoUri = (process.env.MONGO_URI ?? server.MONGO_URI ?? "").trim();
  if (!serverMongoUri) throw new Error("MONGO_URI is not set in the server .env");
  const dnsServers = (process.env.MONGO_DNS_SERVERS ?? server.MONGO_DNS_SERVERS ?? admin.MONGO_DNS_SERVERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    serverMongoUri,
    adminMongoUri: (admin.MONGODB_URI ?? "").trim() || null,
    adminAuthDbName: (admin.ADMIN_AUTH_DB_NAME ?? "").trim() || null,
    blobToken: (process.env.BLOB_READ_WRITE_TOKEN ?? server.BLOB_READ_WRITE_TOKEN ?? "").trim() || null,
    dnsServers,
  };
}

/** SRV resolution of an Atlas `mongodb+srv` URI from a workstation needs the configured resolvers. */
export function applyDnsServers(env: SlimmingEnv): void {
  if (env.dnsServers.length) dns.setServers(env.dnsServers);
}

/** Lowercased host list of a Mongo URI, credentials and options stripped. */
export function uriHosts(uri: string): string {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i);
  if (!match) throw new Error("Mongo URI is not parseable");
  return match[1]!.toLowerCase().split(",").sort().join(",");
}

/** A stable non-secret identity for the cluster: sha256 of the host list, first 16 hex. */
export function clusterFingerprint(uri: string): string {
  return createHash("sha256").update(uriHosts(uri)).digest("hex").slice(0, 16);
}

export const argValue = arg;
export const hasFlag = (argv: readonly string[], name: string) => argv.includes(`--${name}`);
