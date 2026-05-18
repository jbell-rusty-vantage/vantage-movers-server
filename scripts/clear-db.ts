import mongoose from "mongoose";
import { connectMongo } from "../api/db";
import { MONGO_DATABASE_NAME } from "../api/config/domain";

async function main(): Promise<void> {
  await connectMongo();

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  const collections = (await db.collections()).filter(
    (collection) => !collection.collectionName.startsWith("system."),
  );

  if (!collections.length) {
    console.log(`No collections found in database "${MONGO_DATABASE_NAME}".`);
    return;
  }

  console.log(`Clearing ${collections.length} collections from "${MONGO_DATABASE_NAME}"...`);

  for (const collection of collections) {
    const result = await collection.deleteMany({});
    console.log(`${collection.collectionName}: deleted ${result.deletedCount} documents`);
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
