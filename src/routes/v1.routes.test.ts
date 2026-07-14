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
