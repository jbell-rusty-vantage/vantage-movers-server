import assert from "node:assert/strict";
import test from "node:test";
import { isReportingGoogleDeliveryEnabled } from "./reporting";

test("Google reporting delivery kill switch is fail-closed", () => {
  assert.equal(isReportingGoogleDeliveryEnabled(undefined), false);
  assert.equal(isReportingGoogleDeliveryEnabled(""), false);
  assert.equal(isReportingGoogleDeliveryEnabled("false"), false);
  assert.equal(isReportingGoogleDeliveryEnabled("unexpected"), false);
});

test("Google reporting delivery kill switch accepts only explicit true", () => {
  assert.equal(isReportingGoogleDeliveryEnabled("true"), true);
  assert.equal(isReportingGoogleDeliveryEnabled(" TRUE "), true);
});
