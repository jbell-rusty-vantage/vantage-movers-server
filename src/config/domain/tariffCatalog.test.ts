import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LINEHAUL_SERVICE,
  OWNER_TARIFF_SERVICES,
  isCatalogTariffPair,
  mapLinehaulCubicFeetToRule,
  rulesForTariffService,
} from "./tariffCatalog";

test("maps Initial Price cubic feet onto the Drop Downs Linehaul ranges", () => {
  assert.equal(mapLinehaulCubicFeetToRule(0), "0 to 300 c.f.");
  assert.equal(mapLinehaulCubicFeetToRule(300), "0 to 300 c.f.");
  assert.equal(mapLinehaulCubicFeetToRule(300.9), "0 to 300 c.f.");
  assert.equal(mapLinehaulCubicFeetToRule(301), "301 to 500 c.f");
  assert.equal(mapLinehaulCubicFeetToRule(1000), "501 to 1,000 c.f.");
  assert.equal(mapLinehaulCubicFeetToRule(3000), "2,501 to 3,000 c.f.");
  assert.equal(mapLinehaulCubicFeetToRule(3001), "3,000 + c.f.");
  assert.equal(mapLinehaulCubicFeetToRule(-1), undefined);
});

test("treats Binding Estimate Fee as automatic, not an owner dropdown", () => {
  assert.equal(OWNER_TARIFF_SERVICES.includes("Binding Estimate Fee" as never), false);
  assert.equal(isCatalogTariffPair("Binding Estimate Fee", "Binding Estimate Fee"), true);
});

test("rules for a Service stay inside that Service", () => {
  assert.deepEqual(rulesForTariffService("P.G.S."), [
    "Guaranteed Pickup Day",
    "Guaranteed Delivery Day",
    "Expedited Delivery",
    "Direct Delivery",
    "Extra Stop",
  ]);
  assert.equal(isCatalogTariffPair(LINEHAUL_SERVICE, "0 to 300 c.f."), true);
  assert.equal(isCatalogTariffPair("P.G.S.", "Guaranteed Pickup Day"), true);
  assert.equal(isCatalogTariffPair("P.G.S.", "Stair Fee"), false);
  assert.equal(isCatalogTariffPair("Accesorial Services", "Stair Fee"), true);
});
