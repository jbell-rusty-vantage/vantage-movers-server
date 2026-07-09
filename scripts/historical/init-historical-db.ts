import mongoose, { type Model } from "mongoose";
import { connectMongo } from "../../api/db";
import {
  getHistoricalModelList,
  HISTORICAL_DATABASE_NAME,
  registerHistoricalModels,
} from "./models";

async function ensureHistoricalModel(model: Model<unknown>): Promise<void> {
  await model.createCollection();
  await model.createIndexes();

  console.log(
    `${model.collection.collectionName}: collection and indexes ready`,
  );
}

async function main(): Promise<void> {
  await connectMongo();

  console.log(`Preparing historical database "${HISTORICAL_DATABASE_NAME}"...`);

  const historicalModels = registerHistoricalModels();
  const models = getHistoricalModelList(historicalModels);

  for (const model of models) {
    await ensureHistoricalModel(model);
  }

  console.log(
    `Historical database "${HISTORICAL_DATABASE_NAME}" is ready for backfill.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
