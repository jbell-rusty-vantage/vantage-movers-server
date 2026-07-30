import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRingCentralRouteSnapshot,
  listActiveRingCentralSnapshotNumbers,
  loadRingCentralRouteSnapshot,
  resetRingCentralRouteSnapshotForTests,
  resolveRingCentralInboundRoute,
  setRingCentralSnapshotLoaderForTests,
} from "./ringCentralSnapshot";
import { invalidateRegistryCaches } from "./cacheInvalidation";

const routeId = "66a000000000000000000001";
const companyId = "66a000000000000000000002";
const oldGranularityId = "66a000000000000000000003";
const newGranularityId = "66a000000000000000000004";

test("RingCentral snapshot resolves historical assignment intervals", () => {
  const switchAt = new Date("2026-07-01T12:00:00.000Z");
  const snapshot = buildRingCentralRouteSnapshot({
    routes: [{
      _id: routeId,
      phone_number: "(888) 316-4387",
      ever_activated: true,
      validation_status: "valid",
    }],
    companies: [{
      _id: companyId,
      company_slug: "dynamic_company",
      owner_label: "Dynamic Company",
      active: true,
    }],
    granularities: [
      {
        _id: oldGranularityId,
        source_company: companyId,
        granularity_key: "dynamic_old_calls",
        owner_label: "Old Calls",
        crm_label: "Old Inbounds",
        active: true,
        channel: "call",
      },
      {
        _id: newGranularityId,
        source_company: companyId,
        granularity_key: "dynamic_new_calls",
        owner_label: "New Calls",
        crm_label: "New Inbounds",
        active: true,
        channel: "call",
      },
    ],
    assignments: [
      {
        _id: "66a000000000000000000005",
        route: routeId,
        source_company: companyId,
        source_granularity: oldGranularityId,
        effective_from: new Date("2026-06-01T00:00:00.000Z"),
        effective_until: switchAt,
        active: false,
      },
      {
        _id: "66a000000000000000000006",
        route: routeId,
        source_company: companyId,
        source_granularity: newGranularityId,
        effective_from: switchAt,
        active: true,
      },
    ],
  });

  assert.equal(
    resolveRingCentralInboundRoute(
      snapshot,
      "+1 888 316 4387",
      new Date("2026-07-01T11:59:59.999Z"),
    )?.granularity_id,
    oldGranularityId,
  );
  assert.equal(
    resolveRingCentralInboundRoute(snapshot, "+18883164387", switchAt)
      ?.granularity_id,
    newGranularityId,
  );
});

test("RingCentral snapshot rejects unknown and interval gaps", () => {
  const snapshot = buildRingCentralRouteSnapshot({
    routes: [{ _id: routeId, phone_number: "+18883164387" }],
    companies: [{
      _id: companyId,
      company_slug: "dynamic_company",
      owner_label: "Dynamic Company",
      active: true,
    }],
    granularities: [{
      _id: oldGranularityId,
      source_company: companyId,
      granularity_key: "dynamic_calls",
      owner_label: "Calls",
      crm_label: "Dynamic Inbounds",
      active: true,
      channel: "call",
    }],
    assignments: [{
      _id: "66a000000000000000000005",
      route: routeId,
      source_company: companyId,
      source_granularity: oldGranularityId,
      effective_from: new Date("2026-06-01T00:00:00.000Z"),
      effective_until: new Date("2026-06-02T00:00:00.000Z"),
      active: false,
    }],
  });
  assert.equal(
    resolveRingCentralInboundRoute(
      snapshot,
      "+18883164387",
      new Date("2026-06-03T00:00:00.000Z"),
    ),
    null,
  );
  assert.equal(
    resolveRingCentralInboundRoute(
      snapshot,
      "+19999999999",
      new Date("2026-06-01T12:00:00.000Z"),
    ),
    null,
  );
});

test("RingCentral snapshot excludes inactive source targets", () => {
  const snapshot = buildRingCentralRouteSnapshot({
    routes: [{
      _id: routeId,
      phone_number: "+18883164387",
      ever_activated: true,
      validation_status: "valid",
    }],
    companies: [{
      _id: companyId,
      company_slug: "inactive_company",
      owner_label: "Inactive Company",
      active: false,
    }],
    granularities: [{
      _id: oldGranularityId,
      source_company: companyId,
      granularity_key: "inactive_calls",
      owner_label: "Inactive Calls",
      crm_label: "Inactive Inbounds",
      active: true,
      channel: "call",
    }],
    assignments: [{
      _id: "66a000000000000000000005",
      route: routeId,
      source_company: companyId,
      source_granularity: oldGranularityId,
      effective_from: new Date("2026-06-01T00:00:00.000Z"),
      active: true,
    }],
  });

  assert.deepEqual(listActiveRingCentralSnapshotNumbers(snapshot), []);
});

test("active RingCentral snapshot number listing excludes closed history", () => {
  const snapshot = buildRingCentralRouteSnapshot({
    routes: [{
      _id: routeId,
      phone_number: "+18883164387",
      ever_activated: true,
      validation_status: "valid",
    }],
    companies: [{
      _id: companyId,
      company_slug: "dynamic_company",
      owner_label: "Dynamic Company",
      active: true,
    }],
    granularities: [{
      _id: oldGranularityId,
      source_company: companyId,
      granularity_key: "dynamic_calls",
      owner_label: "Calls",
      crm_label: "Dynamic Inbounds",
      active: true,
      channel: "call",
    }],
    assignments: [{
      _id: "66a000000000000000000005",
      route: routeId,
      source_company: companyId,
      source_granularity: oldGranularityId,
      effective_from: new Date("2026-06-01T00:00:00.000Z"),
      effective_until: new Date("2026-06-02T00:00:00.000Z"),
      active: false,
    }],
  });

  assert.deepEqual(
    listActiveRingCentralSnapshotNumbers(
      snapshot,
      new Date("2026-06-03T00:00:00.000Z"),
    ),
    [],
  );
});

test("cache invalidation discards an in-flight stale refresh", async () => {
  resetRingCentralRouteSnapshotForTests();
  let releaseFirst!: (snapshot: ReturnType<typeof buildRingCentralRouteSnapshot>) => void;
  const stale = buildRingCentralRouteSnapshot(
    { routes: [], companies: [], granularities: [], assignments: [] },
    new Date("2026-06-01T00:00:00.000Z"),
  );
  const fresh = buildRingCentralRouteSnapshot(
    { routes: [], companies: [], granularities: [], assignments: [] },
    new Date("2026-06-02T00:00:00.000Z"),
  );
  let calls = 0;
  setRingCentralSnapshotLoaderForTests(async () => {
    calls += 1;
    if (calls === 1) {
      return new Promise((resolve) => {
        releaseFirst = resolve;
      });
    }
    return fresh;
  });

  try {
    const pending = loadRingCentralRouteSnapshot({ forceRefresh: true });
    invalidateRegistryCaches(["source_granularities"]);
    releaseFirst(stale);
    const resolved = await pending;
    assert.equal(resolved.built_at.toISOString(), fresh.built_at.toISOString());
    assert.equal(calls, 2);
  } finally {
    setRingCentralSnapshotLoaderForTests();
    resetRingCentralRouteSnapshotForTests();
  }
});
