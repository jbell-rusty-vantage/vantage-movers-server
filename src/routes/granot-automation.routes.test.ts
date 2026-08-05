import assert from "node:assert/strict";
import { test } from "node:test";
import { GranotAutomationRun } from "../models/GranotAutomationRun";
import { GranotAutomationSource } from "../models/GranotAutomationSource";
import {
  DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS,
  GRANOT_AUTOMATION_SOURCE_LIMIT,
  GranotAutomationSourceConflict,
} from "../services/granotHttpCollector/sourceCatalog";
import routerModule from "./granot-automation.routes";

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
};

test("Granot automation exposes the durable admin run contract", () => {
  const router =
    (routerModule as { default?: unknown }).default ?? routerModule;
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
  const routes = stack
    .map((layer) => layer.route)
    .filter((route): route is NonNullable<typeof route> => Boolean(route));
  const method = (path: string, verb: string) =>
    routes.some((route) => route.path === path && route.methods?.[verb]);
  const base = "/api/v1/admin/granot-automation/runs";
  assert.equal(method(base, "post"), true);
  assert.equal(method(base, "get"), true);
  assert.equal(method(`${base}/sources`, "get"), true);
  assert.equal(method(`${base}/sources`, "post"), true);
  assert.equal(method(`${base}/worker`, "post"), true);
  assert.equal(method(`${base}/:runId/approve`, "post"), true);
  assert.equal(method(`${base}/:runId`, "get"), true);
});

test("Granot run schema carries immutable plan and durable control fields", () => {
  for (const path of [
    "operation",
    "workflow",
    "plan_snapshot",
    "plan_checksum",
    "plan_locked_at",
    "expires_at",
    "approval",
    "receipts",
    "checkpoint",
    "lease_epoch",
  ]) {
    assert.ok(GranotAutomationRun.schema.path(path), `missing ${path}`);
  }
  assert.ok(
    GranotAutomationRun.schema
      .indexes()
      .some(
        (entry: [Record<string, number>, { name?: string }]) =>
          entry[1].name === "granot_run_plan_identity",
      ),
  );
  assert.equal(GRANOT_AUTOMATION_SOURCE_LIMIT, 200);
  assert.equal(
    new GranotAutomationSourceConflict().message.includes("TBM Forms"),
    false,
  );
  assert.ok(
    new GranotAutomationSource({
      label: `Safe label\u202E`,
      active: true,
      created_from: "admin",
    }).validateSync()?.errors.label,
  );
});

test("Granot source catalog persists exact labels and ships all requested defaults", () => {
  for (const path of ["label", "active", "created_from", "created_by"]) {
    assert.ok(GranotAutomationSource.schema.path(path), `missing ${path}`);
  }
  assert.deepEqual(DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS, [
    "10best Inbounds",
    "Best Relocation Forms",
    "BestRelocation Inbounds",
    "Main Site Forms",
    "TBM Forms",
    "TBM Forms Prime",
    "TBM Prime Inbounds",
    "Top10 Forms",
    "Top10 Inbounds",
  ]);
  assert.ok(
    GranotAutomationSource.schema
      .indexes()
      .some(
        (entry: [Record<string, number>, { name?: string }]) =>
          entry[1].name === "granot_automation_source_active_label",
      ),
  );
});
