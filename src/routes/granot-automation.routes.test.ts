import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { GranotAutomationRun } from "../models/GranotAutomationRun";
import { GranotAutomationSource } from "../models/GranotAutomationSource";
import {
  DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS,
  DEFAULT_GRANOT_AUTOMATION_SOURCES,
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
  assert.equal(
    method("/api/v1/admin/granot-automation/run-groups", "post"),
    true,
  );
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
    "run_group_id",
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
      supported_operations: ["form_leads"],
      created_from: "admin",
    }).validateSync()?.errors.label,
  );
});

test("Granot source catalog persists exact labels and ships all requested defaults", () => {
  for (const path of [
    "label",
    "active",
    "supported_operations",
    "created_from",
    "created_by",
  ]) {
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
  assert.deepEqual(
    DEFAULT_GRANOT_AUTOMATION_SOURCES.filter((source) =>
      source.supported_operations.some(
        (operation) => operation === "form_leads",
      ),
    ).map((source) => source.label),
    [
      "Best Relocation Forms",
      "Main Site Forms",
      "TBM Forms",
      "TBM Forms Prime",
      "Top10 Forms",
    ],
  );
  assert.deepEqual(
    DEFAULT_GRANOT_AUTOMATION_SOURCES.filter((source) =>
      source.supported_operations.some(
        (operation) => operation === "call_leads",
      ),
    ).map((source) => source.label),
    [
      "10best Inbounds",
      "BestRelocation Inbounds",
      "TBM Prime Inbounds",
      "Top10 Inbounds",
    ],
  );
  assert.ok(
    GranotAutomationSource.schema
      .indexes()
      .some(
        (entry: [Record<string, number>, { name?: string }]) =>
          entry[1].name === "granot_automation_source_active_label",
      ),
  );
  assert.ok(
    GranotAutomationSource.schema
      .indexes()
      .some(
        (entry: [Record<string, number>, { name?: string }]) =>
          entry[1].name ===
          "granot_automation_source_active_operation_label",
      ),
  );
  assert.ok(GranotAutomationSource.schema.path("granot_crm_source"));
  assert.ok(
    GranotAutomationSource.schema
      .indexes()
      .some(
        (entry: [Record<string, number>, { name?: string }]) =>
          entry[1].name === "granot_automation_source_crm_source_active",
      ),
  );
});

test("Granot source schema requires one or two unique supported workflows", () => {
  const source = (supported_operations: string[]) =>
    new GranotAutomationSource({
      label: `Source ${supported_operations.join("-") || "empty"}`,
      active: true,
      supported_operations,
      created_from: "admin",
    }).validateSync();
  assert.ok(source([])?.errors.supported_operations);
  assert.ok(source(["form_leads", "form_leads"])?.errors.supported_operations);
  assert.ok(source(["unknown"])?.errors["supported_operations.0"]);
  assert.equal(source(["form_leads"]), undefined);
  assert.equal(source(["form_leads", "call_leads"]), undefined);
});

test("Granot queue contention defers to a durable continuation", async () => {
  const consumer = await readFile(
    path.join(
      __dirname,
      "../../api/queues/granot-automation-consumer.ts",
    ),
    "utf8",
  );
  assert.match(consumer, /status === "lease_busy"/);
  assert.match(consumer, /consumer\.deferred/);
  assert.match(consumer, /continueGranotRuns\(result\.run_id\)/);
  assert.match(
    consumer,
    /continuation\.recoverable && !continuation\.queue_published/,
  );
});
