import assert from "node:assert/strict";
import { test } from "node:test";
import { FORM_LEAD_UNKNOWN_STATE } from "../../models/FormLead";
import {
  deriveFormLeadLocal,
  deriveLocal,
  normalizeState,
} from "./leadLocation.service";

test("deriveLocal is local only when both states match", () => {
  assert.equal(deriveLocal("FL", "FL"), "local");
  assert.equal(deriveLocal("FL", "NY"), "long_distance");
});

test("deriveFormLeadLocal treats not_found on either side as a Local Move", () => {
  assert.equal(deriveFormLeadLocal("FL", FORM_LEAD_UNKNOWN_STATE), "local");
  assert.equal(deriveFormLeadLocal(FORM_LEAD_UNKNOWN_STATE, "NY"), "local");
  assert.equal(
    deriveFormLeadLocal(FORM_LEAD_UNKNOWN_STATE, FORM_LEAD_UNKNOWN_STATE),
    "local",
  );
});

test("deriveFormLeadLocal still classifies two known states", () => {
  assert.equal(deriveFormLeadLocal("FL", "FL"), "local");
  assert.equal(deriveFormLeadLocal("FL", "NY"), "long_distance");
});

test("normalizeState keeps the not_found sentinel and uppercases codes", () => {
  assert.equal(normalizeState("not_found"), FORM_LEAD_UNKNOWN_STATE);
  assert.equal(normalizeState("fl"), "FL");
  assert.equal(normalizeState("  "), undefined);
});
