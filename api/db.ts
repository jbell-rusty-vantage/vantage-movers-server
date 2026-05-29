import dns from "node:dns";
import mongoose, { type ConnectOptions } from "mongoose";
import { MONGO_DATABASE_NAME } from "./config/domain";
import { ServiceUnavailableError } from "./services/errors";
import { logger } from "./logger";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

/**
 * Connection options tuned for a serverless (Vercel) deployment talking to
 * Atlas.
 *
 * The driver default `maxPoolSize` is 100 *per isolate*. Under load Vercel
 * spins up many isolates, so the default lets a single burst open hundreds of
 * connections and blow past Atlas connection/rate caps -- on shared tiers the
 * proxy then aborts new TLS handshakes with `tlsv1 alert internal error`
 * (SSL alert 80). A small pool keeps our footprint bounded; `maxIdleTimeMS`
 * lets idle sockets close so paused isolates free Atlas slots; the short
 * `serverSelectionTimeoutMS` fails fast (and within the function budget)
 * instead of hanging, so a retry can run.
 */
const MONGO_CONNECT_OPTIONS: ConnectOptions = {
  dbName: MONGO_DATABASE_NAME,
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 60_000,
  serverSelectionTimeoutMS: 5_000,
  socketTimeoutMS: 45_000,
};

/** How many times to (re)attempt the initial connection per cold isolate. */
const MAX_CONNECT_ATTEMPTS = 2;

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
    cache.promise = connectWithRetry(uri).catch((error) => {
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

/**
 * Attempts the initial connection, retrying once on transient connection
 * errors (e.g. an Atlas proxy TLS hiccup) since an immediate second attempt
 * frequently succeeds. Non-transient failures (bad URI, auth) fail fast.
 */
async function connectWithRetry(uri: string): Promise<typeof mongoose> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    try {
      return await mongoose.connect(uri, MONGO_CONNECT_OPTIONS);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === MAX_CONNECT_ATTEMPTS;
      if (isLastAttempt || !isTransientConnectionError(error)) {
        break;
      }
      const delayMs = 250 * attempt;
      logger.warn({
        msg: "mongo.connect.retry",
        attempt,
        nextAttemptInMs: delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await delay(delayMs);
    }
  }
  throw lastError;
}

/**
 * Transient = the connection/handshake itself failed and an immediate retry
 * is worthwhile. Matches Mongo network/server-selection errors and the
 * underlying TLS/socket failure signatures (incl. the Atlas `SSL alert 80`).
 */
function isTransientConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const name = error.name;
  if (
    name === "MongooseServerSelectionError" ||
    name === "MongoServerSelectionError" ||
    name === "MongoNetworkError" ||
    name === "MongoNetworkTimeoutError"
  ) {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("ssl") ||
    message.includes("tls") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("server selection")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
