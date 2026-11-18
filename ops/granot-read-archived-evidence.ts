import dns from "node:dns";
import { writeFile } from "node:fs/promises";
import { BSON, MongoClient, ObjectId } from "mongodb";
import { readArchivedScheduledRun } from "../src/services/granotHistory/scheduledRunArchive";
import { readArchivedReceipt } from "../src/services/granotHistory/settledLeadEvidence";

/** Recover a verified archived object to a new private BSON file for operator diagnostics. */
async function main() {
  const [kind, id, file] = process.argv.slice(2);
  if (!["--run", "--receipt"].includes(kind) || !/^[a-f0-9]{24}$/i.test(id ?? "") || !file)
    throw new Error("Expected --run|--receipt <ObjectId> <new private BSON file>");
  if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map(x => x.trim()));
  const client = new MongoClient(process.env.MONGO_URI!, { appName: "granot-read-archived-evidence", maxPoolSize: 1 });
  try {
    const db = client.db("vantagemovers");
    let bytes: Uint8Array | null;
    if (kind === "--run") bytes = await readArchivedScheduledRun(db, id.toLowerCase());
    else {
      const chain = await readArchivedReceipt(db, new ObjectId(id));
      bytes = chain ? BSON.serialize(chain) : null;
    }
    if (!bytes) throw new Error("Archived evidence has no point locator");
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ restored: true, shape: kind.slice(2), bson_bytes: bytes.byteLength }));
  } finally { await client.close(); }
}
main().catch(error => { console.error(error.name, error.code ?? error.message); process.exitCode = 1; });
