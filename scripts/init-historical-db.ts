import mongoose, { type Model } from "mongoose";
import { connectMongo } from "../api/db";
import { Agent } from "../api/models/Agent";
import { BookedLead } from "../api/models/BookedLead";
import { CallLead } from "../api/models/CallLead";
import { CancelledLead } from "../api/models/CancelledLead";
import { Customer } from "../api/models/Customer";
import { FormLead } from "../api/models/FormLead";

const HISTORICAL_DATABASE_NAME = "vantagemovershistorical";

const sourceModels = [Agent, BookedLead, CallLead, CancelledLead, Customer, FormLead] as const;

async function ensureHistoricalModel(model: Model<unknown>): Promise<void> {
  const historicalConnection = mongoose.connection.useDb(HISTORICAL_DATABASE_NAME, {
    useCache: true,
  });

  const historicalModel =
    historicalConnection.models[model.modelName] ??
    historicalConnection.model(model.modelName, model.schema);

  await historicalModel.createCollection();
  await historicalModel.createIndexes();

  console.log(`${historicalModel.collection.collectionName}: collection and indexes ready`);
}

async function main(): Promise<void> {
  await connectMongo();

  console.log(`Preparing historical database "${HISTORICAL_DATABASE_NAME}"...`);

  for (const model of sourceModels) {
    await ensureHistoricalModel(model);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
