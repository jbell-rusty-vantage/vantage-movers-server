import assert from "node:assert/strict";
import { test } from "node:test";
import ringCentralRouterModule from "./ringcentral-registry.routes";
import routerModule, { buildGranotSyncExpectedFilter } from "./v1.routes";

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
};

const router = (routerModule as { default?: unknown }).default ?? routerModule;
const ringCentralRouter =
  (ringCentralRouterModule as { default?: unknown }).default ??
  ringCentralRouterModule;

function registeredMethods(
  targetRouter: unknown,
): Set<string> {
  const stack =
    (targetRouter as { stack?: RouteLayer[] }).stack ?? [];
  return new Set(
    stack.flatMap((layer) => {
      const route = layer.route;
      if (!route?.path) return [];
      return Object.entries(route.methods ?? {})
        .filter(([, enabled]) => enabled)
        .map(([method]) => `${method.toUpperCase()} ${route.path}`);
    }),
  );
}

test("Operations Registry entities expose complete lifecycle CRUD surfaces", () => {
  const routes = registeredMethods(router);
  const ringCentralRoutes = registeredMethods(ringCentralRouter);

  for (const expected of [
    "GET /api/v1/admin/catalog/agents",
    "GET /api/v1/admin/agents",
    "GET /api/v1/admin/agents/:id",
    "POST /api/v1/admin/agents",
    "PATCH /api/v1/admin/agents/:id",
    "POST /api/v1/admin/agents/:id/activation",
    "GET /api/v1/admin/merchants",
    "GET /api/v1/admin/merchants/:id",
    "POST /api/v1/admin/merchants",
    "PATCH /api/v1/admin/merchants/:id",
    "POST /api/v1/admin/merchants/:id/activation",
    "GET /api/v1/admin/source-companies",
    "GET /api/v1/admin/source-companies/:id",
    "POST /api/v1/admin/source-companies",
    "PATCH /api/v1/admin/source-companies/:id",
    "POST /api/v1/admin/source-companies/:id/activation",
    "GET /api/v1/admin/source-granularities",
    "GET /api/v1/admin/source-granularities/:id",
    "POST /api/v1/admin/source-granularities",
    "PATCH /api/v1/admin/source-granularities/:id",
    "POST /api/v1/admin/source-granularities/:id/activation",
    "GET /api/v1/admin/cpl/snapshot",
    "GET /api/v1/admin/source-granularities/:id/cpl-periods",
    "POST /api/v1/admin/cpl/simple-schedule",
    "POST /api/v1/admin/source-granularities/:id/cpl-schedule/commands",
  ]) {
    assert.equal(routes.has(expected), true, `missing route ${expected}`);
  }

  for (const expected of [
    "GET /api/v1/admin/ringcentral/inbound-routes",
    "GET /api/v1/admin/ringcentral/inbound-routes/:id",
    "POST /api/v1/admin/ringcentral/inbound-routes",
    "PATCH /api/v1/admin/ringcentral/inbound-routes/:id",
    "POST /api/v1/admin/ringcentral/inbound-routes/:id/activate",
    "POST /api/v1/admin/ringcentral/inbound-routes/:id/reassign",
    "POST /api/v1/admin/ringcentral/inbound-routes/:id/deactivate",
  ]) {
    assert.equal(
      ringCentralRoutes.has(expected),
      true,
      `missing route ${expected}`,
    );
  }
});

test("admin analytics receiver-agent reports have GET routes", () => {
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
  const getRoutes = new Set(
    stack
      .map((layer) => layer.route)
      .filter((route): route is NonNullable<RouteLayer["route"]> => Boolean(route?.methods?.get))
      .map((route) => route.path),
  );

  assert.equal(getRoutes.has("/api/v1/admin/analytics/receiver-agent-performance"), true);
  assert.equal(getRoutes.has("/api/v1/admin/analytics/receiver-agent-trend"), true);
  assert.equal(getRoutes.has("/api/v1/admin/analytics/receiver-agent-source-breakdown"), true);
});

test("employee booking reconciliation routes are registered", () => {
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
  const routes = new Set(
    stack
      .map((layer) => layer.route)
      .filter((route): route is NonNullable<RouteLayer["route"]> => Boolean(route?.path))
      .map((route) => route.path),
  );

  assert.equal(routes.has("/api/v1/employee-booking-options"), true);
  assert.equal(routes.has("/api/v1/employee-booking-submissions"), true);
  assert.equal(routes.has("/api/v1/admin/booking-lead-reconciliations"), true);
  assert.equal(routes.has("/api/v1/admin/booking-lead-reconciliations/:id"), true);
  assert.equal(
    routes.has("/api/v1/admin/booking-lead-reconciliations/:id/candidates/search"),
    true,
  );
  assert.equal(
    routes.has("/api/v1/admin/booking-lead-reconciliations/:id/resolve"),
    true,
  );
});

test("Granot form-lead resolution route is registered before the id route", () => {
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
  const routes = stack
    .map((layer) => layer.route)
    .filter((route): route is NonNullable<RouteLayer["route"]> =>
      Boolean(route?.path),
    );
  const resolverIndex = routes.findIndex(
    (route) =>
      route.path === "/api/v1/form-leads/granot-match" &&
      route.methods?.post,
  );
  const idIndex = routes.findIndex(
    (route) => route.path === "/api/v1/form-leads/:id" && route.methods?.get,
  );

  assert.ok(resolverIndex >= 0, "missing Granot form-lead resolver route");
  assert.ok(resolverIndex < idIndex, "resolver route must precede /:id");
  assert.ok(
    routes.some(
      (route) =>
        route.path === "/api/v1/form-leads/:id/granot-sync" &&
        route.methods?.patch,
    ),
    "missing drift-checked Granot sync route",
  );
});

test("Granot sync expected filter enforces fill-only and empty receiver fields", () => {
  assert.deepEqual(
    buildGranotSyncExpectedFilter(
      {
        pickup_city: "Miami",
        pickup_state: "FL",
        destination_zip: "33139",
        receiver_agent: "507f1f77bcf86cd799439011",
      },
      "top10_leads",
      {
        pickup_state: "FL",
        pickup_zip: null,
        receiver_agent: null,
      },
    ),
    {
      source_company: "top10_leads",
      duplicate: { $ne: true },
      pickup_state: "FL",
      pickup_zip: null,
      receiver_agent: null,
      $and: [
        { pickup_city: { $in: [null, ""] } },
        { pickup_state: { $in: [null, "", "not_found"] } },
        {
          $or: [
            { destination_zip: { $in: [null, ""] } },
            { destination_zip: { $regex: /^0+$/ } },
          ],
        },
        { receiver_agent: null },
      ],
    },
  );
});

test("legacy CPL rates remain read-only after temporal schedule cutover", () => {
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
  const legacyRoutes = stack
    .map((layer) => layer.route)
    .filter((route): route is NonNullable<RouteLayer["route"]> =>
      Boolean(route?.path?.startsWith("/api/v1/admin/cpl-rates")),
    );

  assert.equal(
    legacyRoutes.some(
      (route) => route.path === "/api/v1/admin/cpl-rates" && route.methods?.get,
    ),
    true,
  );
  assert.equal(legacyRoutes.some((route) => route.methods?.patch), false);
});

test("temporal CPL schedule and correction routes are registered", () => {
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
  const routes = new Set(
    stack
      .map((layer) => layer.route)
      .filter((route): route is NonNullable<RouteLayer["route"]> =>
        Boolean(route?.path),
      )
      .map((route) => route.path),
  );

  for (const path of [
    "/api/v1/admin/cpl/snapshot",
    "/api/v1/admin/cpl/simple-schedule",
    "/api/v1/admin/source-granularities/:id/cpl-periods",
    "/api/v1/admin/source-granularities/:id/cpl-schedule/commands",
    "/api/v1/admin/cpl-corrections/preview",
    "/api/v1/admin/cpl-corrections",
    "/api/v1/admin/cpl-corrections/:id",
    "/api/v1/admin/cpl-corrections/:id/cancel",
  ]) {
    assert.equal(routes.has(path), true, `missing route ${path}`);
  }
});
