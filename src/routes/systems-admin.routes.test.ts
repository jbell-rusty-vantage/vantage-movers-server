import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { createCapacitySnapshotCronRouter } from "./capacity-snapshot-cron.routes";
import { createSystemsAdminRouter } from "./systems-admin.routes";
import { RegistryError } from "../services/operationsRegistry/errors";
import { REGISTRY_ERROR_CODES } from "../services/errors/registryErrorCodes";

const calls: string[] = [];
const owner = { actorType: "owner", actorId: "o1", actorLabel: "owner@example.com", actorRole: "owner", requestId: "r1" } as const;
const deps = {
  connect: async () => undefined as never,
  locations: (async () => {
    calls.push("locations");
    return { revision: 1 };
  }) as never,
  patchLocations: (async (patch: unknown, actor: { actorLabel: string }) => {
    calls.push(`patch:${actor.actorLabel}:${JSON.stringify(patch)}`);
    return { revision: 2 };
  }) as never,
  capacity: (async (query: unknown) => {
    calls.push(`capacity:${JSON.stringify(query)}`);
    return { generated_at: "now" };
  }) as never,
};

// The real signed-Owner check (no signature here, so every read is refused) …
const gated = express().use(express.json()).use(createSystemsAdminRouter(deps));
// … and a pass-through Owner for the happy path.
const open = express().use(express.json()).use(createSystemsAdminRouter({ ...deps, requireOwner: () => owner }));
let snapshotRuns = 0;
const cron = express().use(
  createCapacitySnapshotCronRouter({
    connect: async () => undefined,
    snapshot: (async () => {
      snapshotRuns += 1;
      return snapshotRuns === 1
        ? { written: true, day: "2026-10-07", snapshot: { day: "2026-10-07" } }
        : { written: false, day: "2026-10-07", reason: "already_exists" };
    }) as never,
  }),
);
const urls: Record<string, string> = {};
const servers: Array<ReturnType<express.Express["listen"]>> = [];

before(async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  for (const [name, app] of Object.entries({ gated, open, cron })) {
    await new Promise<void>((resolve) => {
      const server = app.listen(0, () => resolve());
      servers.push(server);
      urls[name] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
  }
});
after(() => servers.forEach((server) => server.close()));

test("every Systems read and the edit are Owner-only", async () => {
  for (const [method, path] of [
    ["GET", "/api/v1/admin/systems/locations"],
    ["PATCH", "/api/v1/admin/systems/locations"],
    ["GET", "/api/v1/admin/systems/capacity"],
  ] as const) {
    const response = await fetch(`${urls.gated}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "PATCH" ? JSON.stringify({ revision: 1, locations: {} }) : undefined,
    });
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal(((await response.json()) as { error: string }).error, "Systems is for the Owner only.");
  }
  assert.deepEqual(calls, []);
});

test("the Owner reads locations and capacity, and refresh=1 reaches the service", async () => {
  const locations = await fetch(`${urls.open}/api/v1/admin/systems/locations`);
  assert.equal(locations.status, 200);
  assert.equal(locations.headers.get("cache-control"), "no-store");
  assert.deepEqual(await locations.json(), { ok: true, data: { revision: 1 } });
  const capacity = await fetch(`${urls.open}/api/v1/admin/systems/capacity?refresh=1`);
  assert.equal(capacity.status, 200);
  assert.ok(calls.includes('capacity:{"refresh":true}'));
});

test("the edit validates before writing and passes the signed actor", async () => {
  const bad = await fetch(`${urls.open}/api/v1/admin/systems/locations`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, locations: { partner_pages: { url: "http://vantagemoves.com" } } }),
  });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: string }).error, "partner_pages › url: Links must start with https://");
  const good = await fetch(`${urls.open}/api/v1/admin/systems/locations`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, locations: { partner_pages: { url: "https://partners.example.com" } } }),
  });
  assert.equal(good.status, 200);
  assert.ok(calls.some((call) => call.startsWith("patch:owner@example.com:")));
});

test("a stale revision answers 409 with the reason", async () => {
  const stale = express()
    .use(express.json())
    .use(
      createSystemsAdminRouter({
        ...deps,
        requireOwner: () => owner,
        patchLocations: (async () => {
          throw new RegistryError("Someone else saved the locations first. Reload and try again.", {
            registryCode: REGISTRY_ERROR_CODES.STALE_REVISION,
          });
        }) as never,
      }),
    );
  const server = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
    const s = stale.listen(0, () => resolve(s));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/admin/systems/locations`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, locations: { main_site: { label: "Site" } } }),
    });
    assert.equal(response.status, 409);
    assert.match(((await response.json()) as { error: string }).error, /Reload/);
  } finally {
    server.close();
  }
});

test("the snapshot cron needs the cron secret and reports an existing row on the second run", async () => {
  const unauthorized = await fetch(`${urls.cron}/api/cron/capacity-snapshot`);
  assert.equal(unauthorized.status, 401);
  const headers = { authorization: "Bearer test-cron-secret" };
  const first = (await (await fetch(`${urls.cron}/api/cron/capacity-snapshot`, { headers })).json()) as Record<string, unknown>;
  assert.equal(first.ok, true);
  assert.equal(first.written, true);
  const second = (await (await fetch(`${urls.cron}/api/cron/capacity-snapshot`, { headers })).json()) as Record<string, unknown>;
  assert.deepEqual(second, { ok: true, written: false, day: "2026-10-07", reason: "already_exists" });
});
