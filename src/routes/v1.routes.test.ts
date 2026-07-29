import assert from "node:assert/strict";
import { test } from "node:test";
import routerModule from "./v1.routes";

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
};

const router = (routerModule as { default?: unknown }).default ?? routerModule;

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
