import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import {
  adminBrowseQuerySchema,
  adminSearchQuerySchema,
  analyticsQuerySchema,
  analyticsReportSchema,
} from "../../validation/v1.validation";
import type { AdminResource } from "./adminScope.service";

/**
 * SLIM-03: the admin reads never open the retired historical database. A driver spy records every
 * database name the process selects (Mongoose `useDb` and the native `MongoClient#db`) while each
 * read runs against an unconnected Mongoose; the reads fail fast at the driver, but every model and
 * database they would touch has been resolved by then.
 */
const HISTORICAL_DATABASE = "vantagemovershistorical";
const RESOURCES: AdminResource[] = ["form-leads", "call-leads", "booked-leads", "cancelled-leads"];
const selected: string[] = [];
const restores: Array<() => void> = [];
let savedBuffer: unknown;
let savedBufferTimeout: unknown;

function spy<T extends object>(target: T, key: keyof T & string): void {
  const original = target[key] as unknown as (this: unknown, name: string, ...rest: unknown[]) => unknown;
  (target as Record<string, unknown>)[key] = function (this: unknown, name: string, ...rest: unknown[]) {
    selected.push(String(name));
    return original.call(this, name, ...rest);
  };
  restores.push(() => {
    (target as Record<string, unknown>)[key] = original;
  });
}

before(() => {
  savedBuffer = mongoose.get("bufferCommands");
  savedBufferTimeout = mongoose.get("bufferTimeoutMS");
  mongoose.set("bufferCommands", false);
  mongoose.set("bufferTimeoutMS", 50);
  spy(mongoose.Connection.prototype, "useDb");
  spy(mongoose.mongo.MongoClient.prototype, "db");
});

after(() => {
  for (const restore of restores.reverse()) restore();
  mongoose.set("bufferCommands", savedBuffer as boolean);
  mongoose.set("bufferTimeoutMS", savedBufferTimeout as number);
});

async function attempt(read: () => Promise<unknown>): Promise<void> {
  await read().catch(() => undefined);
}

// Loaded after the spy is installed (CommonJS require), so model registration is observed too.
test("[SLIM-03] browse, detail, search, facets, CSV, Analytics and Overview never select the historical database", async () => {
  const { browseAdminResource, getAdminResourceDetail } = require("./adminBrowse.service") as typeof import("./adminBrowse.service");
  const { globalAdminSearch } = require("./adminSearch.service") as typeof import("./adminSearch.service");
  const { getAdminFacets, resetAdminFacetsCacheForTests } = require("./adminFacets.service") as typeof import("./adminFacets.service");
  const { exportAdminResourceCsv } = require("./adminExport.service") as typeof import("./adminExport.service");
  const { loadProductionCatalog } = require("./filterCatalog") as typeof import("./filterCatalog");
  const { getAnalyticsReport } = require("../analytics/analytics.service") as typeof import("../analytics/analytics.service");
  const { exportAnalyticsReportCsv } = require("../analytics/analyticsExport.service") as typeof import("../analytics/analyticsExport.service");
  const { getOverviewReport } = require("../analytics/overview.service") as typeof import("../analytics/overview.service");

  const browseQuery = adminBrowseQuerySchema.parse({});
  for (const resource of RESOURCES) {
    await attempt(() => browseAdminResource(resource, browseQuery));
    await attempt(() => getAdminResourceDetail(resource, "507f1f77bcf86cd799439011"));
    await attempt(() => exportAdminResourceCsv(resource, browseQuery));
  }
  await attempt(() => globalAdminSearch(adminSearchQuerySchema.parse({ q: "Jane" })));
  resetAdminFacetsCacheForTests();
  await attempt(() => getAdminFacets());
  await attempt(() => loadProductionCatalog());
  const analyticsQuery = analyticsQuerySchema.parse({});
  for (const report of analyticsReportSchema.options) {
    await attempt(() => getAnalyticsReport(report, analyticsQuery));
    await attempt(() => exportAnalyticsReportCsv(report, analyticsQuery));
  }
  await attempt(() => getOverviewReport());

  // The spy saw the reads resolve their databases, and none of them is the retired one.
  assert.ok(selected.includes(getMongoDatabaseName()), "the reads resolved their models through the spied useDb");
  assert.deepEqual(
    selected.filter((name) => name === HISTORICAL_DATABASE),
    [],
  );
});
