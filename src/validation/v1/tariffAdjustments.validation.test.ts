import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TARIFF_ADJUSTMENT_FORBIDDEN_KEYS,
  createTariffAdjustmentsSchema,
} from "./tariffAdjustments.validation";

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

const ACCESSORIAL_ROW = {
  effective_date: "9/1/2026",
  pickup_zone: "22079",
  delivery_zone: "29671",
  service: "Accesorial Services",
  rule: "Stair Fee",
  new_rule: "100.00",
  carrier: "C2C",
} as const;

const VALID_ROWS = [LINEHAUL_ROW, PGS_ROW] as const;

test("createTariffAdjustmentsSchema accepts two shared-field service rows", () => {
  const parsed = createTariffAdjustmentsSchema.parse({ rows: VALID_ROWS });
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]?.service, "Linehaul");
  assert.equal(parsed.rows[1]?.service, "P.G.S.");
});

test("createTariffAdjustmentsSchema accepts a Linehaul-only payload", () => {
  const parsed = createTariffAdjustmentsSchema.parse({ rows: [LINEHAUL_ROW] });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]?.service, "Linehaul");
});

test("createTariffAdjustmentsSchema accepts Linehaul plus an owner-written service", () => {
  const parsed = createTariffAdjustmentsSchema.parse({
    rows: [LINEHAUL_ROW, ACCESSORIAL_ROW],
  });
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1]?.service, "Accesorial Services");
});

test("createTariffAdjustmentsSchema accepts three matching rows", () => {
  const parsed = createTariffAdjustmentsSchema.parse({
    rows: [LINEHAUL_ROW, PGS_ROW, ACCESSORIAL_ROW],
  });
  assert.equal(parsed.rows.length, 3);
});

test("createTariffAdjustmentsSchema allows omitted effective_date when all rows omit it", () => {
  const parsed = createTariffAdjustmentsSchema.parse({
    rows: VALID_ROWS.map(({ effective_date: _effectiveDate, ...row }) => row),
  });
  assert.equal(parsed.rows[0]?.effective_date, undefined);
});

test("createTariffAdjustmentsSchema rejects an empty rows array", () => {
  assert.equal(createTariffAdjustmentsSchema.safeParse({ rows: [] }).success, false);
});

test("createTariffAdjustmentsSchema rejects more than 20 rows", () => {
  const rows = Array.from({ length: 21 }, () => LINEHAUL_ROW);
  assert.equal(createTariffAdjustmentsSchema.safeParse({ rows }).success, false);
});

test("createTariffAdjustmentsSchema requires at least one Linehaul row", () => {
  const parsed = createTariffAdjustmentsSchema.safeParse({
    rows: [PGS_ROW],
  });
  assert.equal(parsed.success, false);
});

test("createTariffAdjustmentsSchema requires shared fields to match", () => {
  const parsed = createTariffAdjustmentsSchema.safeParse({
    rows: [LINEHAUL_ROW, { ...PGS_ROW, pickup_zone: "92037" }],
  });
  assert.equal(parsed.success, false);
});

test("createTariffAdjustmentsSchema rejects three rows with a mismatched pickup_zone", () => {
  const parsed = createTariffAdjustmentsSchema.safeParse({
    rows: [
      LINEHAUL_ROW,
      PGS_ROW,
      { ...ACCESSORIAL_ROW, pickup_zone: "92037" },
    ],
  });
  assert.equal(parsed.success, false);
});

test("createTariffAdjustmentsSchema requires a 5-digit ZIP and a carrier", () => {
  assert.equal(
    createTariffAdjustmentsSchema.safeParse({
      rows: [LINEHAUL_ROW, { ...PGS_ROW, delivery_zone: "2967" }],
    }).success,
    false,
  );
  assert.equal(
    createTariffAdjustmentsSchema.safeParse({
      rows: [
        { ...LINEHAUL_ROW, carrier: "" },
        { ...PGS_ROW, carrier: "" },
      ],
    }).success,
    false,
  );
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

test("createTariffAdjustmentsSchema rejects customer and job identifiers", () => {
  for (const key of TARIFF_ADJUSTMENT_FORBIDDEN_KEYS) {
    assert.equal(
      createTariffAdjustmentsSchema.safeParse({
        rows: VALID_ROWS,
        [key]: "forbidden",
      }).success,
      false,
      `body must reject ${key}`,
    );
    assert.equal(
      createTariffAdjustmentsSchema.safeParse({
        rows: [{ ...LINEHAUL_ROW, [key]: "forbidden" }, PGS_ROW],
      }).success,
      false,
      `row must reject ${key}`,
    );
  }
});
