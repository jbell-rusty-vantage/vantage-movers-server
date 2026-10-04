/**
 * The only Mongo access the slimming tools have.
 *
 * Two layers keep the inventory and a purge dry run read-only by construction:
 *   1. Callers never see the driver `MongoClient`/`Db`/`Collection`. They get `ReadOnlyCluster`, whose
 *      methods are reads, and whose `aggregate` rejects any pipeline that contains `$out` or `$merge`.
 *   2. Every command the driver is about to put on the wire passes a `commandStarted` guard. The driver
 *      emits that event synchronously before writing the command, and the guard terminates the process
 *      (exit 97) on any command outside the mode's allowlist, so a forbidden command is never sent.
 *
 * `PurgeCluster` (mode `purge`) additionally allows `update`, `delete`, `drop` and `dropDatabase`, and is
 * only constructed by `purge.ts` after every `--apply` gate passed. `insert`, `createIndexes`, `renameCollection`
 * and every administrative command stay forbidden in both modes.
 */
import { createHash } from "node:crypto";
import {
  type AggregateOptions,
  type Document,
  type Filter,
  MongoClient,
  type ObjectId,
  type UpdateFilter,
} from "mongodb";
import { applyDnsServers, type SlimmingEnv } from "./env";

export const GUARD_EXIT_CODE = 97;

const READ_COMMANDS = new Set([
  "aggregate",
  "count",
  "distinct",
  "find",
  "getMore",
  "killCursors",
  "listDatabases",
  "listCollections",
  "listIndexes",
  "dbStats",
  "collStats",
  "hello",
  "isMaster",
  "ismaster",
  "ping",
  "buildInfo",
  "endSessions",
  "saslStart",
  "saslContinue",
  "authenticate",
]);
const PURGE_WRITE_COMMANDS = new Set(["update", "delete", "drop", "dropDatabase"]);

export type GuardMode = "read" | "purge";

/** Throws when a pipeline (including nested `$facet`/`$lookup`/`$unionWith` pipelines) can write. */
export function assertReadOnlyPipeline(pipeline: unknown): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$out" || key === "$merge") throw new Error(`write stage ${key} refused by the slimming read guard`);
      visit(value);
    }
  };
  visit(pipeline);
}

export function isCommandAllowed(mode: GuardMode, name: string, command: Document): boolean {
  if (READ_COMMANDS.has(name)) {
    if (name === "aggregate") {
      try {
        assertReadOnlyPipeline(command.pipeline);
      } catch {
        return false;
      }
    }
    return true;
  }
  return mode === "purge" && PURGE_WRITE_COMMANDS.has(name);
}

function installGuard(client: MongoClient, mode: GuardMode): void {
  client.on("commandStarted", (event) => {
    if (isCommandAllowed(mode, event.commandName, event.command)) return;
    process.stderr.write(
      `\n[slimming guard] refused command '${event.commandName}' on '${event.databaseName}' in ${mode} mode; exiting before it is sent.\n`,
    );
    process.exit(GUARD_EXIT_CODE);
  });
}

export type CollectionInfo = { name: string; type: string; uuid: string | null; options: Document };
export type IndexInfo = { name: string; key: Document; unique: boolean; expireAfterSeconds: number | null; partial: boolean };
export type CollStats = {
  count: number;
  size: number;
  storageSize: number;
  totalIndexSize: number;
  avgObjSize: number;
  indexSizes: Record<string, number>;
};

const uuidHex = (info: Document): string | null => {
  const uuid = info?.info?.uuid as { toString(encoding?: string): string } | undefined;
  return uuid ? uuid.toString("hex") : null;
};

export class ReadOnlyCluster {
  protected constructor(
    protected readonly client: MongoClient,
    readonly mode: GuardMode,
  ) {}

  static async connect(uri: string, env: SlimmingEnv): Promise<ReadOnlyCluster> {
    return new ReadOnlyCluster(await openClient(uri, env, "read"), "read");
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async replicaSetName(): Promise<string | null> {
    const hello = await this.client.db("admin").command({ hello: 1 });
    return typeof hello.setName === "string" ? hello.setName : null;
  }

  async listDatabases(): Promise<Array<{ name: string; sizeOnDisk: number; empty: boolean }>> {
    const result = await this.client.db("admin").admin().listDatabases({ nameOnly: false });
    return result.databases.map((d) => ({ name: d.name, sizeOnDisk: Number(d.sizeOnDisk ?? 0), empty: Boolean(d.empty) }));
  }

  async listCollections(db: string): Promise<CollectionInfo[]> {
    const rows = await this.client.db(db).listCollections({}, { nameOnly: false }).toArray();
    return rows
      .map((row) => ({ name: row.name, type: String(row.type ?? "collection"), uuid: uuidHex(row), options: (row as Document).options ?? {} }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async collection(db: string, name: string): Promise<CollectionInfo | null> {
    const rows = await this.client.db(db).listCollections({ name }, { nameOnly: false }).toArray();
    const row = rows[0];
    return row ? { name: row.name, type: String(row.type ?? "collection"), uuid: uuidHex(row), options: (row as Document).options ?? {} } : null;
  }

  async dbStats(db: string): Promise<Document> {
    return this.client.db(db).command({ dbStats: 1, scale: 1 });
  }

  async collStats(db: string, name: string): Promise<CollStats> {
    const [row] = await this.client
      .db(db)
      .collection(name)
      .aggregate([{ $collStats: { storageStats: { scale: 1 } } }])
      .toArray();
    const s = (row?.storageStats ?? {}) as Document;
    return {
      count: Number(s.count ?? 0),
      size: Number(s.size ?? 0),
      storageSize: Number(s.storageSize ?? 0),
      totalIndexSize: Number(s.totalIndexSize ?? 0),
      avgObjSize: Number(s.avgObjSize ?? 0),
      indexSizes: Object.fromEntries(Object.entries((s.indexSizes ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v)])),
    };
  }

  async indexes(db: string, name: string): Promise<IndexInfo[]> {
    const rows = await this.client.db(db).collection(name).listIndexes().toArray();
    return rows.map((r) => ({
      name: String(r.name),
      key: r.key as Document,
      unique: Boolean(r.unique),
      expireAfterSeconds: typeof r.expireAfterSeconds === "number" ? r.expireAfterSeconds : null,
      partial: Boolean(r.partialFilterExpression),
    }));
  }

  async count(db: string, name: string, filter: Filter<Document> = {}): Promise<number> {
    return this.client.db(db).collection(name).countDocuments(filter);
  }

  async aggregate<T extends Document = Document>(
    db: string,
    name: string,
    pipeline: Document[],
    options: AggregateOptions = {},
  ): Promise<T[]> {
    assertReadOnlyPipeline(pipeline);
    return this.client.db(db).collection(name).aggregate<T>(pipeline, { allowDiskUse: true, ...options }).toArray();
  }

  async distinct(db: string, name: string, field: string, filter: Filter<Document> = {}): Promise<unknown[]> {
    return this.client.db(db).collection(name).distinct(field, filter);
  }

  /** Bounded find. `limit` is mandatory and capped so a report cannot pull a whole collection. */
  async find(
    db: string,
    name: string,
    filter: Filter<Document>,
    options: { projection?: Document; sort?: Document; limit: number },
  ): Promise<Document[]> {
    const limit = Math.min(Math.max(1, options.limit), 5_000);
    return this.client
      .db(db)
      .collection(name)
      .find(filter, { projection: options.projection, sort: options.sort as never, limit })
      .toArray();
  }

  /** Streams every matching document (backup only), in `_id` order. */
  stream(db: string, name: string, filter: Filter<Document> = {}): AsyncIterable<Document> {
    return this.client.db(db).collection(name).find(filter, { sort: { _id: 1 } });
  }

  /** Stable digest of a collection's `_id` set (sorted), for before/after manifest checks on small targets. */
  async idDigest(db: string, name: string, filter: Filter<Document> = {}): Promise<{ count: number; sha256: string }> {
    const hash = createHash("sha256");
    let count = 0;
    for await (const row of this.client.db(db).collection(name).find(filter, { projection: { _id: 1 }, sort: { _id: 1 } })) {
      hash.update(String(row._id)).update("\n");
      count += 1;
    }
    return { count, sha256: hash.digest("hex") };
  }
}

/** Exact, narrow mutations for `purge.ts --apply`. Constructed only after every apply gate passed. */
export class PurgeCluster extends ReadOnlyCluster {
  static async connectForPurge(uri: string, env: SlimmingEnv): Promise<PurgeCluster> {
    return new PurgeCluster(await openClient(uri, env, "purge"), "purge");
  }

  /**
   * `$unset` on the given ids, one update per path, each re-checking that path's own filter (so an all-elements
   * `a.$[].b` path only runs where `a` is an array that carries `b`). Returns how many of `ids` matched `filter` before
   * the updates, i.e. the documents this page cleaned.
   */
  async unsetPaths(
    db: string,
    name: string,
    ids: ObjectId[],
    filter: Filter<Document>,
    paths: ReadonlyArray<{ path: string; filter: Filter<Document> }>,
  ): Promise<number> {
    if (!ids.length || !paths.length) return 0;
    const collection = this.client.db(db).collection(name);
    const touched = await collection.countDocuments({ $and: [{ _id: { $in: ids } }, filter] });
    for (const { path, filter: pathFilter } of paths) await collection.updateMany({ $and: [{ _id: { $in: ids } }, pathFilter] }, { $unset: { [path]: "" } });
    return touched;
  }

  async updateByIds(db: string, name: string, ids: ObjectId[], filter: Filter<Document>, update: UpdateFilter<Document>): Promise<number> {
    if (!ids.length) return 0;
    const result = await this.client.db(db).collection(name).updateMany({ $and: [{ _id: { $in: ids } }, filter] }, update);
    return result.modifiedCount;
  }

  async deleteByIds(db: string, name: string, ids: ObjectId[], filter: Filter<Document>): Promise<number> {
    if (!ids.length) return 0;
    const result = await this.client.db(db).collection(name).deleteMany({ $and: [{ _id: { $in: ids } }, filter] });
    return result.deletedCount;
  }

  /** Drops one collection after re-asserting its UUID immediately before the drop. */
  async dropCollectionExact(db: string, name: string, expectedUuid: string): Promise<void> {
    const info = await this.collection(db, name);
    if (!info) throw new Error(`${db}.${name} is already absent`);
    if (info.uuid !== expectedUuid) throw new Error(`${db}.${name} UUID ${info.uuid} differs from manifest ${expectedUuid}`);
    await this.client.db(db).dropCollection(name);
  }

  /** Drops one whole database. The caller has asserted the exact name and its collection/UUID set. */
  async dropDatabaseExact(db: string): Promise<void> {
    await this.client.db(db).dropDatabase();
  }
}

/** A driver client with command monitoring on and the mode's guard installed; not yet connected. */
export function createGuardedClient(uri: string, mode: GuardMode): MongoClient {
  const client = new MongoClient(uri, {
    appName: `vantage-slimming-${mode}`,
    monitorCommands: true,
    maxPoolSize: 4,
    serverSelectionTimeoutMS: 15_000,
    readPreference: "primary",
    retryWrites: false,
  });
  installGuard(client, mode);
  return client;
}

async function openClient(uri: string, env: SlimmingEnv, mode: GuardMode): Promise<MongoClient> {
  applyDnsServers(env);
  const client = createGuardedClient(uri, mode);
  await client.connect();
  return client;
}
