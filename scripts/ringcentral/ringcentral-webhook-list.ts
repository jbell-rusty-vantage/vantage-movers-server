import { ringCentralRequest } from "../../api/services/ringcentral/client";

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
  expiresIn?: unknown;
};

async function main(): Promise<void> {
  const response = await ringCentralRequest("GET", "/restapi/v1.0/subscription");
  const records = getSubscriptionRecords(response);

  if (records.length === 0) {
    console.log("No RingCentral webhook subscriptions found");
    return;
  }

  for (const [index, subscription] of records.entries()) {
    if (index > 0) {
      console.log("");
    }
    printSubscription(subscription);
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

function printSubscription(subscription: RingCentralSubscriptionSummary): void {
  console.log(`id: ${valueToString(subscription.id) ?? "(missing)"}`);
  console.log(`eventFilters: ${JSON.stringify(subscription.eventFilters ?? [])}`);
  console.log(
    `deliveryMode.transportType: ${
      valueToString(subscription.deliveryMode?.transportType) ?? "(missing)"
    }`,
  );
  console.log(
    `deliveryMode.address: ${
      valueToString(subscription.deliveryMode?.address) ?? "(missing)"
    }`,
  );
  console.log(`status: ${valueToString(subscription.status) ?? "(not present)"}`);
  console.log(`expiresIn: ${valueToString(subscription.expiresIn) ?? "(not present)"}`);
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
  console.error(
    `RingCentral webhook subscription list failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
