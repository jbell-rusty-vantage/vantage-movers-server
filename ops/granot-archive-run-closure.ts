import dns from "node:dns";
import { MongoClient } from "mongodb";
import { archiveCatalog } from "../src/services/granotHistory/archiveReads";
import { decodeChains } from "../src/services/granotHistory/archiveCodec";
import { readArchiveObject } from "../src/services/granotHistory/archiveObjects";
import { automationRunId } from "../src/services/granotHistory/closedAutomationRun";
import { prepareClosedRun, publishClosedRun } from "../src/services/granotHistory/prepareClosedRun";

async function main() {
  const [mode] = process.argv.slice(2);
  if (!["--review","--publish"].includes(mode)) throw new Error("Use --review or --publish");
  if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map(x=>x.trim()));
  const client = new MongoClient(process.env.MONGO_URI!, {maxPoolSize:1,appName:"granot-replay-closure"});
  try {
    const db=client.db("vantagemovers"), cutoff=new Date(Date.now()-7*86400000), runs=new Set<string>();
    for (const entry of await archiveCatalog(db).find({}).sort({_id:1}).limit(32).toArray()) {
      const rows=decodeChains(await readArchiveObject(db.databaseName,entry.hash ?? entry._id),entry.hash ?? entry._id,entry.job);
      for (const chain of rows) { const run=automationRunId(chain.receipt.channel_operation_id); if(run)runs.add(run); }
    }
    const counts:Record<string,number>={};
    for (const run of runs) {
      const state=mode==="--review"?(await prepareClosedRun(db,run,cutoff)).reason:await publishClosedRun(db,run,cutoff);
      counts[state]=(counts[state]??0)+1;
    }
    console.log(JSON.stringify({mode,runs:runs.size,counts}));
  } finally {await client.close();}
}
main().catch(e=>{console.error(e.name,e.code??"closure_failed");process.exitCode=1;});
