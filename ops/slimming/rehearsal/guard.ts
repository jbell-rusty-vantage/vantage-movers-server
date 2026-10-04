/**
 * Shared guard for the SLIM-09 rehearsal helpers (`seed.ts`, `restore.ts`): they write, so they connect only to a
 * loopback replica named by MONGO_URI and only touch databases a rehearsal may own.
 */
import { MongoClient } from "mongodb";
import { isLoopbackMongoUri } from "../../lib/loopback-mongo";
import { HISTORICAL_DATABASE } from "../policy";
import { REHEARSAL_DATABASE_PATTERN } from "../lib/rehearsal";

/** A rehearsal writes only `slimrehearsal_<suffix>` databases and the literal historical database, on loopback. */
export function assertRehearsalWritableDatabase(name: string): void {
  if (!REHEARSAL_DATABASE_PATTERN.test(name) && name !== HISTORICAL_DATABASE) throw new Error(`refusing to write database '${name}' in a rehearsal`);
}

export async function connectLoopbackReplica(): Promise<MongoClient> {
  const uri = (process.env.MONGO_URI ?? "").trim();
  if (!isLoopbackMongoUri(uri)) throw new Error("rehearsal helpers refuse a MONGO_URI that is not loopback-only");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, appName: "vantage-slimming-rehearsal" });
  await client.connect();
  const hello = await client.db("admin").command({ hello: 1 });
  const hosts = (hello.hosts as string[] | undefined) ?? [];
  if (!hello.setName || !hosts.length || !hosts.every((host) => isLoopbackMongoUri(`mongodb://${host}/`))) {
    await client.close();
    throw new Error("rehearsal helpers need a loopback replica set (every member on 127.0.0.1/localhost)");
  }
  return client;
}

export const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
