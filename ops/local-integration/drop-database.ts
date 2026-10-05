/**
 * Local integration: drop a local test database on the csi01 loopback replica when a run is done.
 *
 *   node --import tsx ops/local-integration/drop-database.ts --database=testvantagemovers_sodpilot
 */
import mongoose from "mongoose";
import { LOCAL_REPLICA_URI, localTestDatabase } from "./local-target";

const database = localTestDatabase(process.argv.slice(2));

async function main() {
  await mongoose.connect(LOCAL_REPLICA_URI, { dbName: database });
  if (mongoose.connection.name !== database) throw new Error(`connected to ${mongoose.connection.name}, refusing`);
  await mongoose.connection.db!.dropDatabase();
  console.log("dropped", database);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
