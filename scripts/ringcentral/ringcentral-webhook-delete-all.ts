import {
  ringCentralRequest,
  RingCentralApiError,
} from "../../api/services/ringcentral/client";

type RingCentralSubscriptionListResponse = {
  records?: unknown;
};

type RingCentralSubscriptionSummary = {
  id?: unknown;
  eventFilters?: unknown;
  deliveryMode?: {
    transportType?: unknown;
    address?: unknown;
  };
  status?: unknown;
};

type DeleteResult = {
  id: string;
  address: string | null;
  eventFilters: unknown;
  deleted: boolean;
  error: string | null;
};

async function main(): Promise<void> {
  const response = await ringCentralRequest("GET", "/restapi/v1.0/subscription");
  const subscriptions = getSubscriptionRecords(response);
  const webhooks = subscriptions.filter(isWebhookSubscription);

  if (webhooks.length === 0) {
    console.log("No RingCentral webhook subscriptions found");
    return;
  }

  console.log(`Found ${webhooks.length} RingCentral webhook subscription(s)`);
  const results: DeleteResult[] = [];

  for (const subscription of webhooks) {
    const id = valueToString(subscription.id);
    if (!id) {
      results.push({
        id: "(missing)",
        address: valueToString(subscription.deliveryMode?.address),
        eventFilters: subscription.eventFilters ?? [],
        deleted: false,
        error: "missing subscription id",
      });
      continue;
    }

    try {
      await ringCentralRequest(
        "DELETE",
        `/restapi/v1.0/subscription/${encodeURIComponent(id)}`,
      );
      results.push({
        id,
        address: valueToString(subscription.deliveryMode?.address),
        eventFilters: subscription.eventFilters ?? [],
        deleted: true,
        error: null,
      });
      console.log(`Deleted webhook subscription: ${id}`);
    } catch (error) {
      results.push({
        id,
        address: valueToString(subscription.deliveryMode?.address),
        eventFilters: subscription.eventFilters ?? [],
        deleted: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`Failed to delete webhook subscription: ${id}`);
    }
  }

  const deletedCount = results.filter((result) => result.deleted).length;
  const failedCount = results.length - deletedCount;
  console.log("");
  console.log(`Deleted: ${deletedCount}`);
  console.log(`Failed: ${failedCount}`);

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

function getSubscriptionRecords(raw: unknown): RingCentralSubscriptionSummary[] {
  if (Array.isArray(raw)) {
    return raw.map(asSubscriptionSummary);
  }

  const response = asListResponse(raw);
  if (!Array.isArray(response.records)) {
    return [];
  }

  return response.records.map(asSubscriptionSummary);
}

function isWebhookSubscription(subscription: RingCentralSubscriptionSummary): boolean {
  return valueToString(subscription.deliveryMode?.transportType)?.toLowerCase() === "webhook";
}

function asListResponse(raw: unknown): RingCentralSubscriptionListResponse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as RingCentralSubscriptionListResponse;
}

function asSubscriptionSummary(raw: unknown): RingCentralSubscriptionSummary {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as RingCentralSubscriptionSummary;
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

main().catch((error) => {
  if (error instanceof RingCentralApiError) {
    console.error(
      `RingCentral webhook delete-all failed: ${error.status} ${error.statusText}`,
    );
    console.error(`RingCentral error body: ${JSON.stringify(error.responseBody, null, 2)}`);
  } else {
    console.error(
      `RingCentral webhook delete-all failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  process.exitCode = 1;
});
