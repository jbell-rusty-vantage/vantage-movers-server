import mongoose from "mongoose";
import { getRequiredEnv } from "../../api/config/domain";
import { buildRingCentralTelephonyEventFilters } from "../../api/services/ringcentral/call-lead-sources";
import { ringCentralRequest } from "../../api/services/ringcentral/client";
import { getRingCentralWebhookFilterMode } from "../../api/services/ringcentral/ringcentral-config";
import {
  storeRingCentralWebhookSubscriptionMetadata,
  type RingCentralSubscriptionStoreResult,
} from "../../api/services/ringcentral/webhook-subscriptions";

const RINGCENTRAL_WEBHOOK_ROUTE = "/api/webhooks/ringcentral";

type RingCentralSubscriptionResponse = {
  id?: unknown;
  eventFilters?: unknown;
  deliveryMode?: {
    transportType?: unknown;
    address?: unknown;
  };
  status?: unknown;
  expiresIn?: unknown;
};

async function main(): Promise<void> {
  const webhookBaseUrl =
    process.env.RINGCENTRAL_NGROK_WEBHOOK_URL?.trim() ||
    getRequiredEnv("RINGCENTRAL_WEBHOOK_URL");
  const webhookUrl = resolveRingCentralWebhookUrl(webhookBaseUrl);
  validateWebhookUrl(webhookUrl);

  const filterMode = getRingCentralWebhookFilterMode();
  const eventFilters = buildRingCentralTelephonyEventFilters(filterMode);

  console.log(`Webhook delivery address: ${webhookUrl}`);
  console.log(`Filter mode: ${filterMode} (${eventFilters.length} filter(s))`);
  for (const filter of eventFilters) {
    console.log(`  - ${filter}`);
  }
  console.log("");

  const response = await ringCentralRequest("POST", "/restapi/v1.0/subscription", {
    eventFilters,
    deliveryMode: {
      transportType: "WebHook",
      address: webhookUrl,
    },
  });

  const storeResult = await storeRingCentralWebhookSubscriptionMetadata(response);
  printCreateResult(response, storeResult);
}

function resolveRingCentralWebhookUrl(value: string): string {
  const url = new URL(value);
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = RINGCENTRAL_WEBHOOK_ROUTE;
  }
  return url.toString();
}

function validateWebhookUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RINGCENTRAL_WEBHOOK_URL must be a valid URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("RINGCENTRAL_WEBHOOK_URL must start with https://");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  ) {
    throw new Error("RINGCENTRAL_WEBHOOK_URL must not point to localhost");
  }
}

function printCreateResult(
  raw: unknown,
  storeResult: RingCentralSubscriptionStoreResult,
): void {
  const response = asSubscriptionResponse(raw);
  const expiresIn = valueToNumber(response.expiresIn);
  const expirationTime =
    expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000).toISOString();

  console.log("RingCentral webhook subscription created");
  console.log(`subscriptionId: ${valueToString(response.id) ?? "(missing)"}`);
  console.log(`eventFilters: ${formatJson(response.eventFilters ?? [])}`);
  console.log(
    `deliveryMode.transportType: ${
      valueToString(response.deliveryMode?.transportType) ?? "(missing)"
    }`,
  );
  console.log(
    `deliveryMode.address: ${
      valueToString(response.deliveryMode?.address) ?? "(missing)"
    }`,
  );
  console.log(`status: ${valueToString(response.status) ?? "(not present)"}`);
  console.log(`expiresIn: ${expiresIn ?? "(not present)"}`);
  console.log(`expirationTime: ${expirationTime ?? "(not derivable)"}`);
  if (storeResult.target === "file") {
    console.log(`raw response path saved: yes (${storeResult.path})`);
  } else if (storeResult.target === "mongo") {
    console.log("raw response path saved: no (saved to MongoDB)");
  } else {
    console.log("raw response path saved: no");
  }
}

function asSubscriptionResponse(raw: unknown): RingCentralSubscriptionResponse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as RingCentralSubscriptionResponse;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value);
}

function valueToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function valueToNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

main()
  .catch((error) => {
    console.error(
      `RingCentral webhook subscription create failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
