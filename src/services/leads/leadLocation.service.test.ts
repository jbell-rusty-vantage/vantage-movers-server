import assert from "node:assert/strict";
import { test } from "node:test";
import { FORM_LEAD_UNKNOWN_STATE } from "../../models/FormLead";
import {
  deriveFormLeadLocal,
} from "./leadLocation.service";

test("deriveFormLeadLocal treats not_found on either side as a Local Move", () => {
  assert.equal(deriveFormLeadLocal("FL", FORM_LEAD_UNKNOWN_STATE), "local");
  assert.equal(deriveFormLeadLocal(FORM_LEAD_UNKNOWN_STATE, "NY"), "local");
  assert.equal(
    deriveFormLeadLocal(FORM_LEAD_UNKNOWN_STATE, FORM_LEAD_UNKNOWN_STATE),
    "local",
  );
});
