import dns from "node:dns";
import mongoose from "mongoose";

const TEST_DATABASE_NAME = "testvantagemovers";

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI?.trim();
  if (!uri) {
    throw new Error("MONGO_URI is not set");
  }

  configureMongoDnsServers();
  await mongoose.connect(uri, { dbName: TEST_DATABASE_NAME });

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  if (mongoose.connection.name !== TEST_DATABASE_NAME) {
    throw new Error(
      `Refusing to clear unexpected database "${mongoose.connection.name}". Expected "${TEST_DATABASE_NAME}".`,
    );
  }

  const collections = (await db.collections()).filter(
    (collection) => !collection.collectionName.startsWith("system."),
  );

  if (!collections.length) {
    console.log(`No collections found in database "${TEST_DATABASE_NAME}".`);
    return;
  }

  console.log(`Clearing ${collections.length} collections from "${TEST_DATABASE_NAME}"...`);

  for (const collection of collections) {
    const result = await collection.deleteMany({});
    console.log(`${collection.collectionName}: deleted ${result.deletedCount} documents`);
  }
}

function shouldUseLocalMongoDnsServers(): boolean {
  return process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production";
}

function configureMongoDnsServers(): void {
  if (!shouldUseLocalMongoDnsServers()) {
    return;
  }

  const servers = process.env.MONGO_DNS_SERVERS?.split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  if (!servers?.length) {
    return;
  }

  dns.setServers(servers);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
