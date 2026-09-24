/**
 * CC-08 read-only readiness check for webhook capture.
 *
 *   RC_TOKEN_STORE=file node --env-file=.env --import tsx scripts/dev_ops/check-webhook-capture-readiness.ts [--post-validation]
 *
 * Reports:
 *  1. the configured webhook URL and the resolved all-direction delivery address;
 *  2. whether the route answers: GET on the deployed URL (read-only), plus the
 *     RingCentral validation handshake (POST + `Validation-Token`) against the
 *     same route mounted in-process with Mongo detached, so nothing is stored;
 *  3. `planAllDirectionSubscription` output (provider list + owned ids; never mutates);
 *  4. every subscription visible to this app (GET /restapi/v1.0/subscription);
 *  5. the receipt store: newest receipt and 14-day count (read-only).
 *
 * `--post-validation` also POSTs the handshake to the deployed URL. The deployed
 * route stores every POST as a receipt (one row, `validationTokenPresent: true`,
 * no telephony session, no job), so it is off by default.
 *
 * Safety: never creates, renews or deletes a subscription (the provider adapter
 * here throws on any mutation), and never writes Mongo: ownership and receipts
 * are read with plain `find`s (no index creation). Run with `RC_TOKEN_STORE=file`
 * so the RingCentral token cache is a local file, not the production token row.
 */
import type { AddressInfo } from "node:net";
import express from "express";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { getRingCentralCollectionName } from "../../src/services/ringcentral/ringcentral-config";
import {
  DEFAULT_RENEW_WITHIN_MS,
  planAllDirectionSubscription,
  resolveAllDirectionWebhookAddress,
  ringCentralSubscriptionProvider,
  type OwnershipStore,
  type SubscriptionProvider,
} from "../../src/services/ringcentral/webhook-subscription-lifecycle";
import { buildRingCentralTelephonyEventFilters } from "../../src/services/ringcentral/webhook-subscriptions";

const postValidation = process.argv.includes("--post-validation");

function section(title: string, value: unknown): void {
  console.log(`\n== ${title}`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function readOnlyProvider(): SubscriptionProvider {
  const real = ringCentralSubscriptionProvider();
  const refuse = () => {
    throw new Error("readiness check is read-only: subscription mutation refused");
  };
  return { list: () => real.list(), create: refuse, renew: refuse, remove: refuse };
}

async function db() {
  await connectMongo();
  const handle = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
  if (!handle) throw new Error("MongoDB connection is not ready");
  return handle;
}

function readOnlyOwnershipStore(): OwnershipStore {
  const refuse = () => {
    throw new Error("readiness check is read-only: ownership write refused");
  };
  return {
    ownedIds: async () => {
      const rows = await (await db())
        .collection("ringcentral_webhook_subscriptions")
        .find({ provider: "ringcentral" }, { projection: { subscriptionId: 1 } })
        .toArray();
      return new Set(rows.map((r) => String(r.subscriptionId)).filter(Boolean));
    },
    record: async () => refuse(),
    markStatus: async () => refuse(),
  };
}

/** Mounts the real webhook route in-process with Mongo detached and posts the handshake. Stores nothing. */
async function localHandshake(): Promise<Record<string, unknown>> {
  const saved = {
    MONGO_URI: process.env.MONGO_URI,
    RINGCENTRAL_WEBHOOK_ENABLED: process.env.RINGCENTRAL_WEBHOOK_ENABLED,
    SALES_INTELLIGENCE_CAPTURE_WEBHOOK: process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK,
  };
  delete process.env.MONGO_URI;
  process.env.RINGCENTRAL_WEBHOOK_ENABLED = "false";
  process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "true";
  const { default: routes } = await import("../../src/routes/ringcentral-webhook.routes");
  const app = express();
  app.use(express.json());
  app.use(routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/ringcentral`;
    const started = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Validation-Token": "readiness-check-token" },
      signal: AbortSignal.timeout(5000),
    });
    const body = (await response.json()) as { storedRawEvent?: boolean; captureProjection?: unknown };
    return {
      status: response.status,
      echoed_token: response.headers.get("validation-token") === "readiness-check-token",
      content_type: response.headers.get("content-type"),
      stored_raw_event: body.storedRawEvent ?? null,
      capture_projection: body.captureProjection ?? null,
      elapsed_ms: Date.now() - started,
    };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function deployedRoute(address: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const started = Date.now();
  try {
    const get = await fetch(address, { method: "GET", signal: AbortSignal.timeout(15_000) });
    const text = await get.text();
    out.get = { status: get.status, elapsed_ms: Date.now() - started, body: text.slice(0, 300) };
  } catch (error) {
    out.get = { error: error instanceof Error ? error.message : String(error) };
  }
  if (!postValidation) {
    out.post_validation = "skipped (deployed route stores every POST as a receipt; pass --post-validation to run it)";
    return out;
  }
  const postStarted = Date.now();
  try {
    const post = await fetch(address, {
      method: "POST",
      headers: { "Validation-Token": "readiness-check-token" },
      signal: AbortSignal.timeout(15_000),
    });
    out.post_validation = {
      status: post.status,
      echoed_token: post.headers.get("validation-token") === "readiness-check-token",
      content_type: post.headers.get("content-type"),
      elapsed_ms: Date.now() - postStarted,
    };
  } catch (error) {
    out.post_validation = { error: error instanceof Error ? error.message : String(error) };
  }
  return out;
}

async function main(): Promise<void> {
  if (process.env.RC_TOKEN_STORE?.trim().toLowerCase() === "mongo") {
    throw new Error("Run with RC_TOKEN_STORE=file: this check must not write the shared token row");
  }
  const configured = process.env.RINGCENTRAL_WEBHOOK_URL?.trim() ?? null;
  const address = resolveAllDirectionWebhookAddress();
  section("Webhook URL", {
    RINGCENTRAL_WEBHOOK_URL: configured,
    resolved_delivery_address: address,
    all_direction_filters: await buildRingCentralTelephonyEventFilters("all"),
    local_env_flags: {
      SALES_INTELLIGENCE_CAPTURE_WEBHOOK: process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK ?? null,
      SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE: process.env.SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE ?? null,
      RINGCENTRAL_WEBHOOK_ENABLED: process.env.RINGCENTRAL_WEBHOOK_ENABLED ?? null,
      note: "local .env values; production values live in Vercel",
    },
  });

  section("Validation handshake (route mounted in-process, Mongo detached)", await localHandshake());
  section("Deployed route", await deployedRoute(address));

  const provider = readOnlyProvider();
  const store = readOnlyOwnershipStore();
  const plan = await planAllDirectionSubscription({ provider, store, address, renewWithinMs: DEFAULT_RENEW_WITHIN_MS });
  section("planAllDirectionSubscription (read-only)", plan);

  const [records, owned] = await Promise.all([provider.list(), store.ownedIds()]);
  section(
    "Subscriptions visible to this app (GET /restapi/v1.0/subscription)",
    records.length
      ? records.map((r) => ({
          id: r.id,
          owned: owned.has(r.id),
          status: r.status,
          transport: r.transportType,
          address: r.address?.replace(/\?.*$/, "") ?? null,
          filters: r.eventFilters,
          expires: r.expirationTime?.toISOString() ?? null,
        }))
      : "none",
  );
  section("Ownership store (ringcentral_webhook_subscriptions)", { owned_ids: [...owned] });

  const receipts = (await db()).collection(getRingCentralCollectionName("webhookEvents"));
  const since = new Date(Date.now() - 14 * 24 * 60 * 60_000);
  const [newest, recent] = await Promise.all([
    receipts.find({}, { projection: { receivedAt: 1, subscriptionId: 1, validationTokenPresent: 1 } }).sort({ receivedAt: -1 }).limit(1).next(),
    receipts.countDocuments({ receivedAt: { $gte: since } }),
  ]);
  section(`Receipt store (${getRingCentralCollectionName("webhookEvents")})`, {
    newest_received_at: newest?.receivedAt ?? null,
    newest_subscription_id: newest?.subscriptionId ?? null,
    receipts_last_14_days: recent,
  });
}

main()
  .catch((error) => {
    console.error(`Readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
