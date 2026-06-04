import mongoose from "mongoose";
import { getRequiredEnv } from "../../api/config/domain";
import { buildRingCentralTelephonyEventFilters } from "../../api/services/ringcentral/call-lead-sources";
import {
  ringCentralRequest,
  RingCentralApiError,
} from "../../api/services/ringcentral/client";
import { RINGCENTRAL_LOCAL_WEBHOOK_ROUTE } from "../../api/services/ringcentral/local-webhook-capture";
import { getRingCentralWebhookFilterMode } from "../../api/services/ringcentral/ringcentral-config";
import {
  storeRingCentralWebhookSubscriptionMetadata,
  type RingCentralSubscriptionStoreResult,
} from "../../api/services/ringcentral/webhook-subscriptions";

/**
 * Creates a RingCentral webhook subscription that ALWAYS points at the local
 * ngrok tunnel route (`/api/webhooks/ringcentral-local`), using the exact same
 * telephony event filters as the production subscription.
 *
 * Unlike `ringcentral-webhook-create.ts`, this script has NO fallbacks: it
 * requires `NGROK_LOCAL_WEBHOOK_URL` (the base ngrok URL from `ngrok http 3000`)
 * and refuses to run without it, so it can never accidentally target
 * production. The local route only captures raw events to a gitignored file.
 *
 * Workflow:
 *   1. `ngrok http 3000` -> copy the https URL into NGROK_LOCAL_WEBHOOK_URL
 *   2. `pnpm dev:local`
 *   3. `pnpm ringcentral:webhook:create:local`
 *   4. Inspect `ringcentral-local-webhook-events.jsonl`
 *   5. Delete it when done: RINGCENTRAL_SUBSCRIPTION_ID=<id> pnpm ringcentral:webhook:delete
 */
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
  const ngrokBaseUrl = getRequiredEnv("NGROK_LOCAL_WEBHOOK_URL");
  const webhookUrl = resolveLocalWebhookUrl(ngrokBaseUrl);
  validateWebhookUrl(webhookUrl);

  const filterMode = getRingCentralWebhookFilterMode();
  const eventFilters = buildRingCentralTelephonyEventFilters(filterMode);

  console.log(`[local] Webhook delivery address: ${webhookUrl}`);
  console.log(`[local] Filter mode: ${filterMode} (${eventFilters.length} filter(s))`);
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

/**
 * Always affixes the local capture route to the ngrok base, overriding any
 * path the env value may already carry.
 */
function resolveLocalWebhookUrl(value: string): string {
  const url = new URL(value);
  url.pathname = RINGCENTRAL_LOCAL_WEBHOOK_ROUTE;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function validateWebhookUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NGROK_LOCAL_WEBHOOK_URL must be a valid URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("NGROK_LOCAL_WEBHOOK_URL must start with https://");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  ) {
    throw new Error(
      "NGROK_LOCAL_WEBHOOK_URL must be the public ngrok URL, not localhost",
    );
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

  console.log("RingCentral LOCAL webhook subscription created");
  console.log(`subscriptionId: ${valueToString(response.id) ?? "(missing)"}`);
  console.log(`eventFilters: ${JSON.stringify(response.eventFilters ?? [])}`);
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
  console.log("");
  console.log(
    "Delete when done: RINGCENTRAL_SUBSCRIPTION_ID=<id> pnpm ringcentral:webhook:delete",
  );
}

function asSubscriptionResponse(raw: unknown): RingCentralSubscriptionResponse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as RingCentralSubscriptionResponse;
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
    if (error instanceof RingCentralApiError) {
      console.error(
        `RingCentral LOCAL webhook subscription create failed: ${error.status} ${error.statusText}`,
      );
      console.error(
        `RingCentral error body: ${JSON.stringify(error.responseBody, null, 2)}`,
      );
      console.error(
        "Common causes: (1) the local dev server is not running or ngrok is not " +
          "forwarding to it, so RingCentral's Validation-Token handshake timed out; " +
          "(2) a subscription with these same event filters already exists.",
      );
    } else {
      console.error(
        `RingCentral LOCAL webhook subscription create failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
