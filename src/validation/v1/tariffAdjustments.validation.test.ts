import assert from "node:assert/strict";
import { test } from "node:test";
import { createTariffAdjustmentsSchema } from "./tariffAdjustments.validation";

const LINEHAUL_ROW = {
  effective_date: "9/1/2026",
  pickup_zone: "22079",
  delivery_zone: "29671",
  service: "Linehaul",
  rule: "0 to 300 c.f.",
  new_rule: "$3.75 per cf",
  carrier: "C2C",
} as const;

const PGS_ROW = {
  effective_date: "9/1/2026",
  pickup_zone: "22079",
  delivery_zone: "29671",
  service: "P.G.S.",
  rule: "Guaranteed Pickup Day",
  new_rule: "100.00",
  carrier: "C2C",
} as const;

test("createTariffAdjustmentsSchema rejects more than 20 rows", () => {
  const rows = Array.from({ length: 21 }, () => LINEHAUL_ROW);
  assert.equal(createTariffAdjustmentsSchema.safeParse({ rows }).success, false);
});

test("createTariffAdjustmentsSchema rejects a Service and Rule that are not a Drop Downs pair", () => {
  assert.equal(
    createTariffAdjustmentsSchema.safeParse({
      rows: [{ ...LINEHAUL_ROW, rule: "300 cf" }],
    }).success,
    false,
  );
  assert.equal(
    createTariffAdjustmentsSchema.safeParse({
      rows: [LINEHAUL_ROW, { ...PGS_ROW, rule: "Stair Fee" }],
    }).success,
    false,
  );
});
