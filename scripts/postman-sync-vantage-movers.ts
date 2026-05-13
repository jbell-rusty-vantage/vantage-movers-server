/**
 * Builds a Postman Collection (postman-collection SDK) and upserts it + a
 * workspace environment via the Postman HTTP API (X-API-Key).
 *
 * Requires: POSTMAN_API_KEY, LEAD_WEBHOOK_SECRET (for the synced environment).
 * Optional: POSTMAN_WORKSPACE_ID, BASE_URL (default http://localhost:3000),
 * POSTMAN_API_BASE (default https://api.postman.com), POSTMAN_REGION=eu.
 */
import { Collection, Item, ItemGroup } from "postman-collection";

const COLLECTION_NAME = "VantageMovers";
const LEADS_FOLDER_NAME = "Leads";
const ENVIRONMENT_NAME = "VantageMovers Local";

const SAMPLE_CREATE_LEAD_BODY = {
  name: "Jane Doe",
  pickupZip: "10001",
  destinationZip: "90210",
  moveSize: "2 Bedrooms",
  moveDate: "2026-06-15T12:00:00.000Z",
  phoneNumber: "2125551234",
  refNo: "demo-001",
  booked: false,
  email: "jane.doe@example.com",
  sourceCompanySite: "https://example.com",
  sourceCompanyLabel: "Example Movers",
  cancelled: false,
  cpl: null,
};

const SAMPLE_PATCH_LEAD_BODY = {
  booked: true,
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function apiBase(): string {
  const raw = process.env.POSTMAN_API_BASE?.trim();
  if (raw) {
    return raw.replace(/\/$/, "");
  }
  if (process.env.POSTMAN_REGION?.trim().toLowerCase() === "eu") {
    return "https://api.eu.postman.com";
  }
  return "https://api.postman.com";
}

async function postmanFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", apiKey);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 2000);
  } catch {
    return "";
  }
}

async function getWorkspaceId(apiKey: string): Promise<string> {
  const override = process.env.POSTMAN_WORKSPACE_ID?.trim();
  if (override) {
    return override;
  }

  const res = await postmanFetch(apiKey, "/workspaces");
  if (!res.ok) {
    console.error("Failed to list workspaces:", res.status, await readErrorBody(res));
    process.exit(1);
  }
  const data = (await res.json()) as {
    workspaces?: Array<{ id: string; type?: string; name?: string }>;
  };
  const list = data.workspaces ?? [];
  const personal =
    list.find((w) => (w.type ?? "").toLowerCase() === "personal") ?? list[0];
  if (!personal?.id) {
    console.error("No workspace found. Set POSTMAN_WORKSPACE_ID in .env.");
    process.exit(1);
  }
  console.log(`Using workspace: ${personal.name ?? personal.id} (${personal.id})`);
  return personal.id;
}

async function listAllCollections(
  apiKey: string,
  workspaceId: string,
): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  let cursor: string | undefined;
  for (;;) {
    const q = new URLSearchParams({ workspace: workspaceId, limit: "100" });
    if (cursor) {
      q.set("cursor", cursor);
    }
    const res = await postmanFetch(apiKey, `/collections?${q.toString()}`);
    if (!res.ok) {
      console.error("Failed to list collections:", res.status, await readErrorBody(res));
      process.exit(1);
    }
    const data = (await res.json()) as {
      collections?: Array<{ id: string; name: string }>;
      meta?: { nextCursor?: string };
    };
    for (const c of data.collections ?? []) {
      out.push({ id: c.id, name: c.name });
    }
    cursor = data.meta?.nextCursor;
    if (!cursor) {
      break;
    }
  }
  return out;
}

async function deleteCollectionByName(
  apiKey: string,
  workspaceId: string,
  name: string,
): Promise<void> {
  const collections = await listAllCollections(apiKey, workspaceId);
  const hit = collections.find((c) => c.name === name);
  if (!hit) {
    return;
  }
  const res = await postmanFetch(apiKey, `/collections/${hit.id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    console.error("Failed to delete collection:", res.status, await readErrorBody(res));
    process.exit(1);
  }
  console.log(`Removed existing collection "${name}" (${hit.id})`);
}

async function createCollection(
  apiKey: string,
  workspaceId: string,
  collectionJson: Record<string, unknown>,
): Promise<string> {
  const res = await postmanFetch(
    apiKey,
    `/collections?workspace=${encodeURIComponent(workspaceId)}`,
    {
      method: "POST",
      body: JSON.stringify({ collection: collectionJson }),
    },
  );
  if (!res.ok) {
    console.error("Failed to create collection:", res.status, await readErrorBody(res));
    process.exit(1);
  }
  const data = (await res.json()) as { collection?: { id?: string; uid?: string } };
  const id = data.collection?.id ?? data.collection?.uid;
  if (!id) {
    console.error("Unexpected create collection response:", JSON.stringify(data).slice(0, 500));
    process.exit(1);
  }
  return id;
}

async function listEnvironments(
  apiKey: string,
  workspaceId: string,
): Promise<Array<{ id: string; name: string }>> {
  const res = await postmanFetch(
    apiKey,
    `/environments?workspace=${encodeURIComponent(workspaceId)}`,
  );
  if (!res.ok) {
    console.error("Failed to list environments:", res.status, await readErrorBody(res));
    process.exit(1);
  }
  const data = (await res.json()) as {
    environments?: Array<{ id: string; name: string }>;
  };
  return (data.environments ?? []).map((e) => ({ id: e.id, name: e.name }));
}

async function deleteEnvironmentByName(
  apiKey: string,
  workspaceId: string,
  name: string,
): Promise<void> {
  const envs = await listEnvironments(apiKey, workspaceId);
  const hit = envs.find((e) => e.name === name);
  if (!hit) {
    return;
  }
  const res = await postmanFetch(apiKey, `/environments/${hit.id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    console.error("Failed to delete environment:", res.status, await readErrorBody(res));
    process.exit(1);
  }
  console.log(`Removed existing environment "${name}" (${hit.id})`);
}

async function createEnvironment(
  apiKey: string,
  workspaceId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await postmanFetch(
    apiKey,
    `/environments?workspace=${encodeURIComponent(workspaceId)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.error("Failed to create environment:", res.status, await readErrorBody(res));
    process.exit(1);
  }
}

function buildCollection(): Record<string, unknown> {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:3000";

  const collection = new Collection({
    info: {
      name: COLLECTION_NAME,
      description:
        "Synced from vantage_movers_server. Select environment **VantageMovers Local** before sending requests.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [{ key: "baseUrl", value: baseUrl, type: "string" }],
  });

  collection.items.add(
    new Item({
      name: "local_service_root",
      request: {
        method: "GET",
        header: [],
        url: "{{baseUrl}}/",
        description: "GET / — service metadata (api/index.ts).",
      },
    }),
  );

  collection.items.add(
    new Item({
      name: "local_health",
      request: {
        method: "GET",
        header: [],
        url: "{{baseUrl}}/health",
        description: "GET /health — liveness string body.",
      },
    }),
  );

  collection.items.add(
    new Item({
      name: "local_db_status",
      request: {
        method: "GET",
        header: [],
        url: "{{baseUrl}}/db",
        description: "GET /db — Mongo connectivity probe.",
      },
    }),
  );

  const leads = new ItemGroup({
    name: LEADS_FOLDER_NAME,
    description: "Lead webhook routes (api/routes/lead.routes.ts).",
  });

  leads.items.add(
    new Item({
      name: "local_leads_webhook_create",
      request: {
        method: "POST",
        header: [
          {
            key: "x-webhook-secret",
            value: "{{LEAD_WEBHOOK_SECRET}}",
            type: "text",
          },
          { key: "Content-Type", value: "application/json", type: "text" },
        ],
        body: {
          mode: "raw",
          raw: JSON.stringify(SAMPLE_CREATE_LEAD_BODY, null, 2),
          options: { raw: { language: "json" } },
        },
        url: "{{baseUrl}}/webhooks/leads",
        description: "POST /webhooks/leads — create lead (requireWebhookSecret).",
      },
    }),
  );

  leads.items.add(
    new Item({
      name: "local_leads_webhook_update",
      request: {
        method: "PATCH",
        header: [
          {
            key: "x-webhook-secret",
            value: "{{LEAD_WEBHOOK_SECRET}}",
            type: "text",
          },
          { key: "Content-Type", value: "application/json", type: "text" },
        ],
        body: {
          mode: "raw",
          raw: JSON.stringify(SAMPLE_PATCH_LEAD_BODY, null, 2),
          options: { raw: { language: "json" } },
        },
        url: "{{baseUrl}}/webhooks/leads/{{leadMongoId}}",
        description:
          "PATCH /webhooks/leads/:leadMongoId — partial update. Set **leadMongoId** in the environment.",
      },
    }),
  );

  collection.items.add(leads);

  return collection.toJSON() as Record<string, unknown>;
}

async function main(): Promise<void> {
  const apiKey = requireEnv("POSTMAN_API_KEY");
  const webhookSecret = requireEnv("LEAD_WEBHOOK_SECRET");
  const workspaceId = await getWorkspaceId(apiKey);

  await deleteCollectionByName(apiKey, workspaceId, COLLECTION_NAME);
  const collectionJson = buildCollection();
  const collectionId = await createCollection(apiKey, workspaceId, collectionJson);
  console.log(`Created collection "${COLLECTION_NAME}" (${collectionId})`);

  await deleteEnvironmentByName(apiKey, workspaceId, ENVIRONMENT_NAME);
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:3000";
  await createEnvironment(apiKey, workspaceId, {
    environment: {
      name: ENVIRONMENT_NAME,
      values: [
        {
          key: "baseUrl",
          value: baseUrl,
          type: "text",
          enabled: true,
        },
        {
          key: "LEAD_WEBHOOK_SECRET",
          value: webhookSecret,
          type: "secret",
          enabled: true,
        },
        {
          key: "leadMongoId",
          value: "000000000000000000000001",
          type: "text",
          enabled: true,
        },
      ],
    },
  });
  console.log(`Created environment "${ENVIRONMENT_NAME}" with baseUrl, LEAD_WEBHOOK_SECRET, leadMongoId.`);
  console.log("In Postman: select the **VantageMovers Local** environment, then run requests.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
