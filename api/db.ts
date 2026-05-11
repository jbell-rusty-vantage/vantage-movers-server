import mongoose from "mongoose";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var __mongooseCache: MongooseCache | undefined;
}

function getCache(): MongooseCache {
  if (!global.__mongooseCache) {
    global.__mongooseCache = { conn: null, promise: null };
  }
  return global.__mongooseCache;
}

/** Reuses one connection per serverless isolate (avoids exhausting Atlas connections). */
export async function connectMongo(): Promise<void> {
  const uri = process.env.MONGO_URI?.trim();
  if (!uri) {
    throw new Error("MONGO_URI is not set");
  }

  const cache = getCache();
  if (cache.conn && mongoose.connection.readyState === 1) {
    return;
  }

  if (!cache.promise) {
    cache.promise = mongoose.connect(uri).catch((error) => {
      cache.promise = null;
      throw error;
    });
  }

  await cache.promise;
  cache.conn = mongoose;
}
