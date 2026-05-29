import dns from "node:dns";
import mongoose from "mongoose";
import { MONGO_DATABASE_NAME } from "./config/domain";
import { ServiceUnavailableError } from "./services/errors";
import { logger } from "./logger";

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
    configureMongoDnsServers();
    cache.promise = mongoose
      .connect(uri, { dbName: MONGO_DATABASE_NAME })
      .catch((error) => {
        // Reset so the next request retries the connection instead of
        // reusing a rejected promise for the life of the isolate.
        cache.promise = null;
        // Connection failures (Atlas TLS handshake aborts, server
        // selection timeouts, DNS/network errors) are transient and
        // safely retryable -- surface them as a 503 with a clean public
        // message while preserving the raw driver/OpenSSL text for logs.
        throw new ServiceUnavailableError(
          "Database temporarily unavailable. Please retry shortly.",
          {
            internalMessage:
              error instanceof Error ? error.message : String(error),
            cause: error,
            metadata: { dependency: "mongodb" },
          },
        );
      });
  }

  await cache.promise;
  cache.conn = mongoose;
}

let loggedDnsServers = false;

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
  if (!loggedDnsServers) {
    loggedDnsServers = true;
    logger.info({
      msg: "mongo.dns.servers_configured",
      servers,
    });
  }
}
