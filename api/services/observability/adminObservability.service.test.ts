import assert from "node:assert/strict";
import { test } from "node:test";
import { compareIncidentSeverity } from "./adminObservability.service";

test("incident severity comparison ranks critical above error and warn", () => {
  assert.ok(compareIncidentSeverity("critical", "error") > 0);
  assert.ok(compareIncidentSeverity("error", "warn") > 0);
  assert.ok(compareIncidentSeverity("warn", "critical") < 0);
});
