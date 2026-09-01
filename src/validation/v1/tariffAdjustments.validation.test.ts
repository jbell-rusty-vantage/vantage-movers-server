import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TARIFF_ADJUSTMENT_FORBIDDEN_KEYS,
  createTariffAdjustmentsSchema,
} from "./tariffAdjustments.validation";

const VALID_ROWS = [
  {
    effective_date: "9/1/2026",
    pickup_zone: "22079",
    delivery_zone: "29671",
    service: "Linehaul",
    rule: "300 cf",
    new_rule: "$3.75 per cf",
    carrier: "C2C",
  },
  {
    effective_date: "9/1/2026",
    pickup_zone: "22079",
    delivery_zone: "29671",
    service: "Additional Services",
    rule: "Binding Estimate Fee",
    new_rule: "$956.25",
    carrier: "C2C",
  },
] as const;

test("createTariffAdjustmentsSchema accepts two shared-field service rows", () => {
  const parsed = createTariffAdjustmentsSchema.parse({ rows: VALID_ROWS });
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]?.service, "Linehaul");
  assert.equal(parsed.rows[1]?.service, "Additional Services");
});

test("createTariffAdjustmentsSchema allows omitted effective_date when both rows omit it", () => {
  const parsed = createTariffAdjustmentsSchema.parse({
    rows: VALID_ROWS.map(({ effective_date: _effectiveDate, ...row }) => row),
  });
  assert.equal(parsed.rows[0]?.effective_date, undefined);
});

test("createTariffAdjustmentsSchema rejects the wrong row count", () => {
  assert.equal(createTariffAdjustmentsSchema.safeParse({ rows: [] }).success, false);
  assert.equal(
    createTariffAdjustmentsSchema.safeParse({ rows: [VALID_ROWS[0]] }).success,
    false,
  );
  assert.equal(
    createTariffAdjustmentsSchema.safeParse({
      rows: [...VALID_ROWS, VALID_ROWS[0]],
    }).success,
    false,
  );
});

test("createTariffAdjustmentsSchema requires one of each service", () => {
  const parsed = createTariffAdjustmentsSchema.safeParse({
    rows: [VALID_ROWS[0], { ...VALID_ROWS[1], service: "Linehaul" }],
  });
  assert.equal(parsed.success, false);
});

test("createTariffAdjustmentsSchema requires shared fields to match", () => {
  const parsed = createTariffAdjustmentsSchema.safeParse({
    rows: [VALID_ROWS[0], { ...VALID_ROWS[1], pickup_zone: "92037" }],
  });
  assert.equal(parsed.success, false);
});

test("createTariffAdjustmentsSchema requires a 5-digit ZIP and a carrier", () => {
  assert.equal(
    createTariffAdjustmentsSchema.safeParse({
      rows: [VALID_ROWS[0], { ...VALID_ROWS[1], delivery_zone: "2967" }],
    }).success,
    false,
  );
  assert.equal(
    createTariffAdjustmentsSchema.safeParse({
      rows: [
        { ...VALID_ROWS[0], carrier: "" },
        { ...VALID_ROWS[1], carrier: "" },
      ],
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
        rows: [{ ...VALID_ROWS[0], [key]: "forbidden" }, VALID_ROWS[1]],
      }).success,
      false,
      `row must reject ${key}`,
    );
  }
});
