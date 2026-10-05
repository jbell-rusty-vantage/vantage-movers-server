/**
 * Local integration: build the CSI ledger/audit and CSI registry indexes in a local test database,
 * the way the server's replica proofs do. Run before serving the API against a freshly seeded database.
 *
 *   node --import tsx ops/local-integration/csi-indexes.ts --database=testvantagemovers_sodpilot
 */
import { database } from "./env"; // first: points the process at the local replica before src/ loads
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { CSI_MODEL_REGISTRY } from "../../src/models/salesIntelligence/registry";
import { getSalesIntelligenceCommandExecutionModel } from "../../src/models/SalesIntelligenceCommandExecution";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";

async function main() {
  await connectMongo();
  if (mongoose.connection.name !== database) throw new Error(`connected to ${mongoose.connection.name}, refusing`);
  const models = [
    getSalesIntelligenceCommandExecutionModel(),
    getSalesIntelligenceAuditEventModel(),
    ...CSI_MODEL_REGISTRY.map((entry) => entry.model()),
  ] as mongoose.Model<unknown>[];
  for (const Model of models) {
    await Model.createCollection().catch(() => undefined);
    await Model.createIndexes();
    console.log("indexed", Model.collection.collectionName);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
