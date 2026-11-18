import assert from "node:assert/strict";
import { test } from "node:test";
import routerModule from "./granot-automation.routes";

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
};

test("the dashboard only exposes scheduled Estimates freshness", () => {
  const router = (routerModule as { default?: unknown }).default ?? routerModule;
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
  assert.deepEqual(stack.map(layer => [layer.route?.path, Object.keys(layer.route?.methods ?? {})]), [
    ["/api/v1/admin/granot-automation/runs/freshness", ["get"]],
  ]);
});
