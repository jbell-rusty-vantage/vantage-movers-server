import assert from "node:assert/strict";
import { test } from "node:test";
import { GRANOT_CARRIER_CODE_SEEDS } from "../../config/domain/granotCarrierCodes";
import { planGranotCarrierCodeSeed } from "./granotCarrierCodeSeed";

test("seed catalog has unique Granot Carrier Codes and DOTs", () => {
  const codes = GRANOT_CARRIER_CODE_SEEDS.map((seed) => seed.granot_carrier_code);
  const dots = GRANOT_CARRIER_CODE_SEEDS.map((seed) => seed.dot_number);

  assert.equal(codes.length, 21);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(new Set(dots).size, dots.length);
  assert.ok(codes.includes("C2C"));
  assert.ok(dots.includes("4168983"));
});

test("seed plan sets missing codes and leaves matching codes alone", () => {
  const plans = planGranotCarrierCodeSeed([
    { dot_number: "4168983", granot_carrier_code: "C2C" },
    { dot_number: "1883785" },
    { dot_number: "3453793", granot_carrier_code: "OLD" },
  ]);

  assert.equal(plans.find((plan) => plan.dot_number === "4168983")?.outcome, "already_set");
  assert.equal(plans.find((plan) => plan.dot_number === "1883785")?.outcome, "will_set");
  assert.equal(plans.find((plan) => plan.dot_number === "3453793")?.outcome, "will_replace");
  assert.equal(plans.find((plan) => plan.dot_number === "4570153")?.outcome, "missing");
});
