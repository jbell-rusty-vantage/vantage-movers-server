import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalize,
  computeResultHash,
  isOperationalReportKey,
} from "./operationalReports.service";

const period = {
  from: new Date("2026-06-01T04:00:00.000Z"),
  to: new Date("2026-06-11T04:00:00.000Z"),
  timezone: "America/New_York",
};

test("canonicalize sorts object keys and serializes dates deterministically", () => {
  const a = canonicalize({ b: 2, a: 1, when: new Date("2026-06-11T00:00:00.000Z") });
  const b = canonicalize({ when: new Date("2026-06-11T00:00:00.000Z"), a: 1, b: 2 });
  assert.equal(a, b);
});

test("result hash is stable for identical inputs regardless of key order", () => {
  const result = { rows: [{ workflow: "crm_submit", event_count: 3 }] };
  const hashA = computeResultHash({
    report_key: "workflow-failure-summary",
    report_version: 1,
    period,
    filters: { category: "crm", level: "error" },
    result,
  });
  const hashB = computeResultHash({
    report_key: "workflow-failure-summary",
    report_version: 1,
    period,
    filters: { level: "error", category: "crm" },
    result: { rows: [{ event_count: 3, workflow: "crm_submit" }] },
  });
  assert.equal(hashA, hashB);
});

test("result hash changes when result data changes", () => {
  const base = {
    report_key: "workflow-failure-summary",
    report_version: 1,
    period,
    filters: {},
  };
  const hashA = computeResultHash({ ...base, result: { rows: [{ event_count: 1 }] } });
  const hashB = computeResultHash({ ...base, result: { rows: [{ event_count: 2 }] } });
  assert.notEqual(hashA, hashB);
});

test("isOperationalReportKey validates known keys", () => {
  assert.equal(isOperationalReportKey("daily-owner-operational-summary"), true);
  assert.equal(isOperationalReportKey("not-a-report"), false);
});
