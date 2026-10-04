/**
 * SLIM-09 rehearsal snapshot (read-only, through the slimming driver guard): for each named database on the loopback
 * replica, every collection's count, a sha256 over its documents (canonical EJSON, `_id` order) and its index names.
 *
 *   MONGO_URI=<loopback> node --import tsx ops/slimming/rehearsal/snapshot.ts --dbs=a,b,c --out=<json>
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BSON } from "mongodb";
import { isLoopbackMongoUri } from "../../lib/loopback-mongo";
import { ReadOnlyCluster } from "../lib/guarded-mongo";
import { arg } from "./guard";

async function main(): Promise<void> {
  const uri = (process.env.MONGO_URI ?? "").trim();
  if (!isLoopbackMongoUri(uri)) throw new Error("snapshot refuses a MONGO_URI that is not loopback-only");
  const dbs = (arg("dbs") ?? "").split(",").filter(Boolean);
  const out = arg("out");
  if (!dbs.length || !out) throw new Error("--dbs and --out are required");
  const c = await ReadOnlyCluster.connect(uri, { serverMongoUri: uri, adminMongoUri: null, adminAuthDbName: null, blobToken: null, dnsServers: [] });
  try {
    const present = new Set((await c.listDatabases()).map((d) => d.name));
    const snapshot: Record<string, unknown> = { taken_at: new Date().toISOString() };
    for (const db of dbs) {
      if (!present.has(db)) {
        snapshot[db] = "absent";
        continue;
      }
      const collections: Record<string, { count: number; sha256: string; indexes: string[] }> = {};
      for (const info of await c.listCollections(db)) {
        const hash = createHash("sha256");
        let count = 0;
        for await (const doc of c.stream(db, info.name)) {
          hash.update(BSON.EJSON.stringify(doc, { relaxed: false })).update("\n");
          count += 1;
        }
        collections[info.name] = { count, sha256: hash.digest("hex"), indexes: (await c.indexes(db, info.name)).map((i) => i.name).sort() };
      }
      snapshot[db] = collections;
    }
    writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`);
    process.stdout.write(`[rehearsal-snapshot] wrote ${out}\n`);
  } finally {
    await c.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[rehearsal-snapshot] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
