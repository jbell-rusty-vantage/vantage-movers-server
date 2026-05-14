/**
 * Canonical Postman sync for the Vantage Movers API.
 *
 * Creates a collection that mirrors the public service probes and protected
 * /api/v1 CRUD routes, then recreates Local and Production environments.
 *
 * Required: POSTMAN_API_KEY
 * Optional: POSTMAN_WORKSPACE_ID, POSTMAN_API_BASE, POSTMAN_REGION=eu,
 *           VANTAGE_API_SECRET, VANTAGE_PRODUCTION_API_SECRET (required for *(Production)* requests from Local),
 *           LOCAL_BASE_URL, PRODUCTION_BASE_URL
 *
 * Each probe and /api/v1 request is duplicated with a “(Production)” sibling that
 * calls {{productionBaseUrl}} and, for protected routes, {{productionApiSecret}}.
 */
import { Collection, Item, ItemGroup } from "postman-collection";

const COLLECTION_NAME = "VantageMovers";
const LOCAL_ENVIRONMENT_NAME = "VantageMovers Local";
const PRODUCTION_ENVIRONMENT_NAME = "VantageMovers Production";
const DEFAULT_LOCAL_BASE_URL = "http://localhost:3000";
/** Canonical Vercel deployment host for vantage_movers_server. */
const DEFAULT_PRODUCTION_BASE_URL = "https://vantage-movers-servers.vercel.app";
const SAMPLE_OBJECT_ID = "000000000000000000000001";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type RequestBody = Record<string, unknown>;
type RequestTarget = "default" | "production";

type ResourceConfig = {
  folderName: string;
  variablePrefix: string;
  path: string;
  createDescription: string;
  updateDescription: string;
  createBody: RequestBody;
  updateBody: RequestBody;
  captureId?: boolean;
};

type PostmanEnvironmentValue = {
  key: string;
  value: string;
  type: "text" | "secret";
  enabled: boolean;
};

const FORM_LEAD_CREATE_BODY = {
  source_company: "main_site",
  name: "Jane Doe",
  source_company_site: "https://vantagemovers.com",
  timestamp: "2026-06-15T12:00:00.000Z",
  pickup_zip: "10001",
  destination_zip: "90210",
  move_size: "2 Bedrooms",
  move_date: "2026-07-01T12:00:00.000Z",
  ref_no: "postman-form-001",
  email: "jane.doe@example.com",
  phone_number: "2125551234",
  quoted: false,
  cubic_feet: 750,
};

const CALL_LEAD_CREATE_BODY = {
  source_company: "main_site",
  source_company_site: "https://vantagemovers.com",
  timestamp: "2026-06-15T12:15:00.000Z",
  name: "John Caller",
  email: "john.caller@example.com",
  phone_number: "2125559876",
  duration: 180,
  start_time: "2026-06-15T12:15:00.000Z",
  end_time: "2026-06-15T12:18:00.000Z",
  local: "long_distance",
  pickup_zip: "10001",
  delivery_zip: "90210",
  cubic_feet: 900,
};

const BOOKED_LEAD_CREATE_BODY = {
  timestamp: "2026-06-15T13:00:00.000Z",
  agent: "Postman QA",
  book_date: "2026-06-16T12:00:00.000Z",
  job_no: "POSTMAN-BOOK-001",
  lead_ref: "{{formLeadId}}",
  lead_model: "FormLead",
  binder_amount: 250,
  deposit_amount: 1250,
  merchant: "Stripe",
  source: "main_site",
  local: "long_distance",
};

const CANCELLED_LEAD_CREATE_BODY = {
  timestamp: "2026-06-17T12:00:00.000Z",
  booked_lead: "{{bookedLeadId}}",
  reason: "Postman regression cancellation",
  notes: "Created by the canonical Vantage Movers API collection.",
  cancelled_by: "Postman QA",
};

const CUSTOMER_CREATE_BODY = {
  full_name: "Postman Customer",
  phone_number: "2125550000",
  email: "postman.customer@example.com",
};

const RESOURCES: ResourceConfig[] = [
  {
    folderName: "Form Leads",
    variablePrefix: "formLead",
    path: "/api/v1/form-leads",
    createDescription: "Creates a form lead and syncs it to the relevant lead sheets.",
    updateDescription: "Partially updates a form lead. Requires formLeadId.",
    createBody: FORM_LEAD_CREATE_BODY,
    updateBody: {
      quoted: true,
      cubic_feet: 825,
    },
    captureId: true,
  },
  {
    folderName: "Call Leads",
    variablePrefix: "callLead",
    path: "/api/v1/call-leads",
    createDescription: "Creates a call lead and syncs it to the relevant call sheets.",
    updateDescription: "Partially updates a call lead. Requires callLeadId.",
    createBody: CALL_LEAD_CREATE_BODY,
    updateBody: {
      duration: 240,
      local: "long_distance",
    },
    captureId: true,
  },
  {
    folderName: "Booked Leads",
    variablePrefix: "bookedLead",
    path: "/api/v1/booked-leads",
    createDescription:
      "Creates a booking from formLeadId, upserts a customer, and mirrors booking state to the source lead.",
    updateDescription: "Partially updates a booking. Requires bookedLeadId.",
    createBody: BOOKED_LEAD_CREATE_BODY,
    updateBody: {
      deposit_amount: 2250,
      merchant: "Stripe",
    },
    captureId: true,
  },
  {
    folderName: "Cancelled Leads",
    variablePrefix: "cancelledLead",
    path: "/api/v1/cancelled-leads",
    createDescription:
      "Creates a cancellation from bookedLeadId and mirrors cancellation state to the linked records.",
    updateDescription: "Partially updates a cancellation. Requires cancelledLeadId.",
    createBody: CANCELLED_LEAD_CREATE_BODY,
    updateBody: {
      notes: "Updated cancellation notes from Postman.",
    },
    captureId: true,
  },
  {
    folderName: "Customers",
    variablePrefix: "customer",
    path: "/api/v1/customers",
    createDescription: "Creates a standalone customer record.",
    updateDescription: "Partially updates a customer. Requires customerId.",
    createBody: CUSTOMER_CREATE_BODY,
    updateBody: {
      full_name: "Updated Postman Customer",
    },
    captureId: true,
  },
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
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
    return (await res.text()).slice(0, 2000);
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
  const workspaces = data.workspaces ?? [];
  const workspace =
    workspaces.find((w) => (w.type ?? "").toLowerCase() === "personal") ?? workspaces[0];

  if (!workspace?.id) {
    console.error("No Postman workspace found. Set POSTMAN_WORKSPACE_ID in .env.");
    process.exit(1);
  }

  console.log(`Using workspace: ${workspace.name ?? workspace.id} (${workspace.id})`);
  return workspace.id;
}

async function listAllCollections(
  apiKey: string,
  workspaceId: string,
): Promise<Array<{ id: string; name: string }>> {
  const collections: Array<{ id: string; name: string }> = [];
  let cursor: string | undefined;

  for (;;) {
    const query = new URLSearchParams({ workspace: workspaceId, limit: "100" });
    if (cursor) {
      query.set("cursor", cursor);
    }

    const res = await postmanFetch(apiKey, `/collections?${query.toString()}`);
    if (!res.ok) {
      console.error("Failed to list collections:", res.status, await readErrorBody(res));
      process.exit(1);
    }

    const data = (await res.json()) as {
      collections?: Array<{ id: string; name: string }>;
      meta?: { nextCursor?: string };
    };
    collections.push(...(data.collections ?? []).map((c) => ({ id: c.id, name: c.name })));

    cursor = data.meta?.nextCursor;
    if (!cursor) {
      return collections;
    }
  }
}

async function deleteCollectionByName(
  apiKey: string,
  workspaceId: string,
  name: string,
): Promise<void> {
  const collections = await listAllCollections(apiKey, workspaceId);
  const matches = collections.filter((c) => c.name === name);

  for (const collection of matches) {
    const res = await postmanFetch(apiKey, `/collections/${collection.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      console.error("Failed to delete collection:", res.status, await readErrorBody(res));
      process.exit(1);
    }
    console.log(`Removed existing collection "${name}" (${collection.id})`);
  }
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
  const environments = await listEnvironments(apiKey, workspaceId);
  const matches = environments.filter((e) => e.name === name);

  for (const environment of matches) {
    const res = await postmanFetch(apiKey, `/environments/${environment.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      console.error("Failed to delete environment:", res.status, await readErrorBody(res));
      process.exit(1);
    }
    console.log(`Removed existing environment "${name}" (${environment.id})`);
  }
}

async function createEnvironment(
  apiKey: string,
  workspaceId: string,
  name: string,
  values: PostmanEnvironmentValue[],
): Promise<void> {
  const res = await postmanFetch(
    apiKey,
    `/environments?workspace=${encodeURIComponent(workspaceId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        environment: {
          name,
          values,
        },
      }),
    },
  );

  if (!res.ok) {
    console.error(`Failed to create environment "${name}":`, res.status, await readErrorBody(res));
    process.exit(1);
  }
}

function buildCollection(): Record<string, unknown> {
  const collection = new Collection({
    info: {
      name: COLLECTION_NAME,
      description: [
        "Canonical testing surface for vantage_movers_server.",
        "",
        "Select **VantageMovers Local** for localhost + optional **(Production)** mirrors, or **VantageMovers Production** when every request should hit Vercel.",
        "",
        "Default requests use `{{baseUrl}}` and `x-api-secret: {{apiSecret}}`.",
        "Sibling requests named **(Production)** use `{{productionBaseUrl}}` and `x-api-secret: {{productionApiSecret}}` so you can hit https://vantage-movers-servers.vercel.app from the Local environment without switching.",
      ].join("\n"),
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "baseUrl", value: DEFAULT_LOCAL_BASE_URL, type: "string" },
      { key: "apiSecret", value: "", type: "string" },
      { key: "productionBaseUrl", value: DEFAULT_PRODUCTION_BASE_URL, type: "string" },
      { key: "productionApiSecret", value: "", type: "string" },
      { key: "formLeadId", value: SAMPLE_OBJECT_ID, type: "string" },
      { key: "callLeadId", value: SAMPLE_OBJECT_ID, type: "string" },
      { key: "bookedLeadId", value: SAMPLE_OBJECT_ID, type: "string" },
      { key: "cancelledLeadId", value: SAMPLE_OBJECT_ID, type: "string" },
      { key: "customerId", value: SAMPLE_OBJECT_ID, type: "string" },
    ],
  });

  collection.items.add(buildServiceFolder());
  collection.items.add(buildV1Folder());

  return collection.toJSON() as Record<string, unknown>;
}

function buildServiceFolder(): ItemGroup {
  const folder = new ItemGroup({
    name: "Service Probes",
    description: "Unauthenticated service and deployment probes from api/index.ts.",
  });

  addMirroredRequests(folder, {
    name: "GET /",
    method: "GET",
    path: "/",
    description: "Service metadata probe.",
    protectedRoute: false,
    expectedStatuses: [200],
    expectOkFlag: false,
  });
  addMirroredRequests(folder, {
    name: "GET /health",
    method: "GET",
    path: "/health",
    description: "Liveness probe. Returns an ok string body.",
    protectedRoute: false,
    expectedStatuses: [200],
    expectJson: false,
    expectOkFlag: false,
  });
  addMirroredRequests(folder, {
    name: "GET /db",
    method: "GET",
    path: "/db",
    description: "Mongo connectivity probe.",
    protectedRoute: false,
    expectedStatuses: [200, 503],
    expectOkFlag: true,
  });

  return folder;
}

function buildV1Folder(): ItemGroup {
  const folder = new ItemGroup({
    name: "API v1",
    description:
      "Protected Express routes mounted under /api/v1. All requests require x-api-secret.",
  });

  for (const resource of RESOURCES) {
    folder.items.add(buildResourceFolder(resource));
  }

  return folder;
}

function buildResourceFolder(resource: ResourceConfig): ItemGroup {
  const folder = new ItemGroup({
    name: resource.folderName,
    description: `${resource.path} CRUD routes.`,
  });

  addMirroredRequests(folder, {
    name: `List ${resource.folderName}`,
    method: "GET",
    path: resource.path,
    description: `GET ${resource.path} - returns the latest 200 ${resource.folderName.toLowerCase()}.`,
    protectedRoute: true,
    expectedStatuses: [200],
  });

  addMirroredRequests(folder, {
    name: `Create ${singularize(resource.folderName)}`,
    method: "POST",
    path: resource.path,
    description: resource.createDescription,
    body: resource.createBody,
    protectedRoute: true,
    expectedStatuses: [201],
    captureIdVariable: resource.captureId ? `${resource.variablePrefix}Id` : undefined,
  });

  addMirroredRequests(folder, {
    name: `Update ${singularize(resource.folderName)}`,
    method: "PATCH",
    path: `${resource.path}/{{${resource.variablePrefix}Id}}`,
    description: resource.updateDescription,
    body: resource.updateBody,
    protectedRoute: true,
    expectedStatuses: [200],
    captureIdVariable: resource.captureId ? `${resource.variablePrefix}Id` : undefined,
  });

  addMirroredRequests(folder, {
    name: `Delete ${singularize(resource.folderName)}`,
    method: "DELETE",
    path: `${resource.path}/{{${resource.variablePrefix}Id}}`,
    description: `DELETE ${resource.path}/:id. Use the cascade variant when dependent records exist.`,
    protectedRoute: true,
    expectedStatuses: [204],
  });

  addMirroredRequests(folder, {
    name: `Delete ${singularize(resource.folderName)} with Cascade`,
    method: "DELETE",
    path: `${resource.path}/{{${resource.variablePrefix}Id}}?cascade=true`,
    description: `DELETE ${resource.path}/:id?cascade=true for records with dependents.`,
    protectedRoute: true,
    expectedStatuses: [204],
  });

  return folder;
}

function addMirroredRequests(
  folder: ItemGroup,
  args: Omit<Parameters<typeof buildRequest>[0], "target">,
): void {
  folder.items.add(buildRequest({ ...args, target: "default" }));
  folder.items.add(buildRequest({ ...args, target: "production" }));
}

function buildRequest(args: {
  name: string;
  method: HttpMethod;
  path: string;
  description: string;
  protectedRoute: boolean;
  expectedStatuses: number[];
  body?: RequestBody;
  captureIdVariable?: string;
  expectJson?: boolean;
  expectOkFlag?: boolean;
  target?: RequestTarget;
}): Item {
  const target: RequestTarget = args.target ?? "default";
  const displayName = target === "production" ? `${args.name} (Production)` : args.name;
  const baseVar = target === "production" ? "productionBaseUrl" : "baseUrl";
  const secretHeaderVar = target === "production" ? "productionApiSecret" : "apiSecret";

  const headers = [];
  if (args.protectedRoute) {
    headers.push({ key: "x-api-secret", value: `{{${secretHeaderVar}}}`, type: "text" });
  }
  if (args.body) {
    headers.push({ key: "Content-Type", value: "application/json", type: "text" });
  }

  return new Item({
    name: displayName,
    request: {
      method: args.method,
      header: headers,
      body: args.body
        ? {
            mode: "raw",
            raw: JSON.stringify(args.body, null, 2),
            options: { raw: { language: "json" } },
          }
        : undefined,
      url: `{{${baseVar}}}${args.path}`,
      description:
        target === "production"
          ? `${args.description}\n\n**Target:** Vercel (\`{{productionBaseUrl}}\`).`
          : args.description,
    },
    event: [
      {
        listen: "test",
        script: {
          type: "text/javascript",
          exec: buildTestScript({
            expectedStatuses: args.expectedStatuses,
            captureIdVariable: args.captureIdVariable,
            expectJson: args.expectJson ?? !args.expectedStatuses.includes(204),
            expectOkFlag: args.expectOkFlag ?? args.protectedRoute,
          }),
        },
      },
    ],
  });
}

function buildTestScript(args: {
  expectedStatuses: number[];
  captureIdVariable?: string;
  expectJson: boolean;
  expectOkFlag: boolean;
}): string[] {
  const { captureIdVariable, expectJson, expectOkFlag, expectedStatuses } = args;
  const statusList = expectedStatuses.join(", ");
  const script = [
    `const expectedStatuses = [${statusList}];`,
    "pm.test(`status is one of ${expectedStatuses.join(', ')}`, function () {",
    "  pm.expect(expectedStatuses).to.include(pm.response.code);",
    "});",
  ];

  if (expectJson) {
    script.push(
      "",
      "pm.test('response body is valid JSON', function () {",
      "  pm.response.to.have.jsonBody();",
      "});",
      "",
      "const json = pm.response.json();",
    );
  }

  if (expectOkFlag) {
    script.push(
      "",
      "pm.test('response has ok flag', function () {",
      "  pm.expect(json).to.have.property('ok');",
      "});",
    );
  }

  if (captureIdVariable) {
    script.push(
      "",
      "if (pm.response.code >= 200 && pm.response.code < 300) {",
      "  const data = pm.response.json().data;",
      "  const id = data && (data._id || data.id);",
      "  if (id) {",
      `    pm.environment.set('${captureIdVariable}', id);`,
      "  }",
      "}",
    );
  }

  return script;
}

function singularize(name: string): string {
  return name.endsWith("s") ? name.slice(0, -1) : name;
}

function buildEnvironmentValues(opts: {
  baseUrl: string;
  apiSecret: string;
  productionBaseUrl: string;
  productionApiSecret: string;
}): PostmanEnvironmentValue[] {
  const { apiSecret, baseUrl, productionApiSecret, productionBaseUrl } = opts;
  return [
    {
      key: "baseUrl",
      value: baseUrl,
      type: "text",
      enabled: true,
    },
    {
      key: "apiSecret",
      value: apiSecret,
      type: "secret",
      enabled: true,
    },
    {
      key: "productionBaseUrl",
      value: productionBaseUrl,
      type: "text",
      enabled: true,
    },
    {
      key: "productionApiSecret",
      value: productionApiSecret,
      type: "secret",
      enabled: true,
    },
    {
      key: "formLeadId",
      value: SAMPLE_OBJECT_ID,
      type: "text",
      enabled: true,
    },
    {
      key: "callLeadId",
      value: SAMPLE_OBJECT_ID,
      type: "text",
      enabled: true,
    },
    {
      key: "bookedLeadId",
      value: SAMPLE_OBJECT_ID,
      type: "text",
      enabled: true,
    },
    {
      key: "cancelledLeadId",
      value: SAMPLE_OBJECT_ID,
      type: "text",
      enabled: true,
    },
    {
      key: "customerId",
      value: SAMPLE_OBJECT_ID,
      type: "text",
      enabled: true,
    },
  ];
}

async function main(): Promise<void> {
  const apiKey = requireEnv("POSTMAN_API_KEY");
  const workspaceId = await getWorkspaceId(apiKey);
  const localBaseUrl = optionalEnv("LOCAL_BASE_URL", DEFAULT_LOCAL_BASE_URL);
  const productionBaseUrl = optionalEnv("PRODUCTION_BASE_URL", DEFAULT_PRODUCTION_BASE_URL);
  const localApiSecret = optionalEnv("VANTAGE_API_SECRET");
  const explicitProductionSecret = optionalEnv("VANTAGE_PRODUCTION_API_SECRET");
  const productionEnvApiSecret = explicitProductionSecret || localApiSecret;

  await deleteCollectionByName(apiKey, workspaceId, COLLECTION_NAME);
  const collectionId = await createCollection(apiKey, workspaceId, buildCollection());
  console.log(`Created collection "${COLLECTION_NAME}" (${collectionId})`);

  await deleteEnvironmentByName(apiKey, workspaceId, LOCAL_ENVIRONMENT_NAME);
  await createEnvironment(
    apiKey,
    workspaceId,
    LOCAL_ENVIRONMENT_NAME,
    buildEnvironmentValues({
      baseUrl: localBaseUrl,
      apiSecret: localApiSecret,
      productionBaseUrl,
      productionApiSecret: explicitProductionSecret,
    }),
  );
  console.log(`Created environment "${LOCAL_ENVIRONMENT_NAME}" (${localBaseUrl})`);

  await deleteEnvironmentByName(apiKey, workspaceId, PRODUCTION_ENVIRONMENT_NAME);
  await createEnvironment(
    apiKey,
    workspaceId,
    PRODUCTION_ENVIRONMENT_NAME,
    buildEnvironmentValues({
      baseUrl: productionBaseUrl,
      apiSecret: productionEnvApiSecret,
      productionBaseUrl,
      productionApiSecret: productionEnvApiSecret,
    }),
  );
  console.log(`Created environment "${PRODUCTION_ENVIRONMENT_NAME}" (${productionBaseUrl})`);

  if (!localApiSecret) {
    console.warn("VANTAGE_API_SECRET was not set; fill apiSecret in the Local environment before testing.");
  }
  if (!productionEnvApiSecret) {
    console.warn(
      "VANTAGE_PRODUCTION_API_SECRET and VANTAGE_API_SECRET were not set; fill apiSecret in the Production environment before testing.",
    );
  }
  if (!explicitProductionSecret) {
    console.warn(
      "VANTAGE_PRODUCTION_API_SECRET was not set; *(Production)* requests need productionApiSecret when using VantageMovers Local (set it in the environment or add VANTAGE_PRODUCTION_API_SECRET to .env before sync).",
    );
  }

  console.log("Run with: pnpm postman:sync");
  console.log(
    "In Postman: each folder lists default requests plus *(Production)* mirrors against {{productionBaseUrl}}.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
