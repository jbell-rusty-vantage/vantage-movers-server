import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getAlertEmailImmediateLevels,
  getAlertEmailOwnerEvents,
  getEmailNotificationsMode,
  getObservabilityCollectionNames,
  getObservabilityEventMinLevel,
  getObservabilityWriteMode,
  isEmailNotificationsEnabled,
  isObservabilityEnabled,
  shouldCaptureAuthEvents,
  shouldCaptureZipStateEvents,
  shouldPersistEventLevel,
  shouldWriteObservabilityCollections,
  validateObservabilityConfig,
} from "./observability";
import { isVantageTestRunner, markVantageTestRunner } from "./runtime";

/**
 * These tests mutate `process.env` to exercise the call-time reads. Each test
 * restores the keys it touched so ordering stays independent.
 */
const TOUCHED_ENV_KEYS = [
  "ALLOW_TEST_OBSERVABILITY",
  "ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS",
  "VERCEL",
  "VERCEL_ENV",
  "NODE_TEST_CONTEXT",
  "VANTAGE_TEST_RUNNER",
  "OBSERVABILITY_ENABLED",
  "OBSERVABILITY_WRITE_MODE",
  "OBSERVABILITY_EVENT_MIN_LEVEL",
  "OBSERVABILITY_CAPTURE_INFO_EVENTS",
  "OBSERVABILITY_CAPTURE_OWNER_EVENTS",
  "OBSERVABILITY_COLLECTION_MODE",
  "OBSERVABILITY_COLLECTION_PREFIX",
  "OBSERVABILITY_EVENTS_COLLECTION",
  "OBSERVABILITY_INCIDENTS_COLLECTION",
  "OBSERVABILITY_NOTIFICATIONS_COLLECTION",
  "OBSERVABILITY_REPORT_RUNS_COLLECTION",
  "EMAIL_NOTIFICATIONS_ENABLED",
  "EMAIL_NOTIFICATIONS_MODE",
  "ALERT_EMAIL_IMMEDIATE_LEVELS",
  "ALERT_EMAIL_OWNER_EVENTS",
  "TEST_MODE",
];

afterEach(() => {
  for (const key of TOUCHED_ENV_KEYS) {
    delete process.env[key];
  }
});

test("observability is disabled inside the test runner even with opt-in flags", () => {
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  process.env.ALLOW_TEST_OBSERVABILITY = "true";
  delete process.env.OBSERVABILITY_ENABLED;
  delete process.env.OBSERVABILITY_WRITE_MODE;
  assert.equal(isObservabilityEnabled(), false);
  assert.equal(shouldWriteObservabilityCollections(), false);
});

test("node test runner disables observability writes even when explicitly allowed", () => {
  process.env.NODE_TEST_CONTEXT = "child-v8";
  process.env.OBSERVABILITY_ENABLED = "true";
  process.env.OBSERVABILITY_WRITE_MODE = "enabled";
  assert.equal(isObservabilityEnabled(), false);
  assert.equal(shouldWriteObservabilityCollections(), false);

  process.env.ALLOW_TEST_OBSERVABILITY = "true";
  assert.equal(isObservabilityEnabled(), false);
  assert.equal(shouldWriteObservabilityCollections(), false);
});

test("bootstrap test runner marker survives env cleanup", () => {
  markVantageTestRunner();
  delete process.env.NODE_TEST_CONTEXT;
  delete process.env.VANTAGE_TEST_RUNNER;
  process.env.VERCEL_ENV = "production";
  process.env.OBSERVABILITY_ENABLED = "true";
  process.env.OBSERVABILITY_WRITE_MODE = "enabled";
  process.env.OBSERVABILITY_COLLECTION_MODE = "production";

  assert.equal(isVantageTestRunner(), true);
  assert.equal(isObservabilityEnabled(), false);
  assert.equal(shouldWriteObservabilityCollections(), false);
  assert.equal(
    getObservabilityCollectionNames().events,
    "test_operational_events",
  );
});

test("ALLOW_TEST_OBSERVABILITY is ignored on Vercel runtimes", () => {
  process.env.ALLOW_TEST_OBSERVABILITY = "true";
  process.env.VANTAGE_TEST_RUNNER = "true";
  process.env.OBSERVABILITY_ENABLED = "true";
  process.env.OBSERVABILITY_WRITE_MODE = "enabled";
  process.env.OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS = "true";
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  assert.equal(isObservabilityEnabled(), false);
  assert.equal(shouldCaptureZipStateEvents(), false);
});

test("zip-state and auth capture flags are off while observability is disabled", () => {
  process.env.NODE_TEST_CONTEXT = "child-v8";
  process.env.OBSERVABILITY_ENABLED = "true";
  process.env.OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS = "true";
  process.env.OBSERVABILITY_CAPTURE_AUTH_EVENTS = "true";
  assert.equal(isObservabilityEnabled(), false);
  assert.equal(shouldCaptureZipStateEvents(), false);
  assert.equal(shouldCaptureAuthEvents(), false);

  process.env.ALLOW_TEST_OBSERVABILITY = "true";
  assert.equal(shouldCaptureZipStateEvents(), false);
  assert.equal(shouldCaptureAuthEvents(), false);
});

test("node test runner always forces test observability collections", () => {
  process.env.VANTAGE_TEST_RUNNER = "true";
  process.env.OBSERVABILITY_COLLECTION_MODE = "production";
  assert.equal(
    getObservabilityCollectionNames().events,
    "test_operational_events",
  );
  assert.equal(
    getObservabilityCollectionNames().incidents,
    "test_operational_incidents",
  );

  process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS = "true";
  assert.equal(
    getObservabilityCollectionNames().events,
    "test_operational_events",
  );
});

test("write mode parses values while test runner still blocks collection writes", () => {
  process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS = "true";
  process.env.OBSERVABILITY_ENABLED = "true";
  delete process.env.OBSERVABILITY_WRITE_MODE;
  assert.equal(getObservabilityWriteMode(), "enabled");
  assert.equal(shouldWriteObservabilityCollections(), false);

  process.env.OBSERVABILITY_WRITE_MODE = "log_only";
  assert.equal(shouldWriteObservabilityCollections(), false);
});

test("collection names follow runtime TEST_MODE by default", () => {
  process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS = "true";
  delete process.env.OBSERVABILITY_COLLECTION_MODE;
  delete process.env.TEST_MODE;
  assert.equal(getObservabilityCollectionNames().events, "test_operational_events");

  process.env.TEST_MODE = "true";
  assert.equal(
    getObservabilityCollectionNames().events,
    "test_operational_events",
  );
});

test("collection mode production/test override TEST_MODE", () => {
  process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS = "true";
  process.env.TEST_MODE = "true";
  process.env.OBSERVABILITY_COLLECTION_MODE = "production";
  assert.equal(getObservabilityCollectionNames().incidents, "test_operational_incidents");

  process.env.OBSERVABILITY_COLLECTION_MODE = "test";
  assert.equal(
    getObservabilityCollectionNames().incidents,
    "test_operational_incidents",
  );
});

test("collection prefix is applied to default names", () => {
  process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS = "true";
  process.env.OBSERVABILITY_COLLECTION_MODE = "production";
  process.env.OBSERVABILITY_COLLECTION_PREFIX = "dev_";
  assert.equal(getObservabilityCollectionNames().events, "dev_test_operational_events");
});

test("custom collection mode cannot override forced test collections in the test runner", () => {
  process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS = "true";
  process.env.OBSERVABILITY_COLLECTION_MODE = "custom";
  process.env.OBSERVABILITY_EVENTS_COLLECTION = "x_events";
  process.env.OBSERVABILITY_INCIDENTS_COLLECTION = "x_incidents";
  process.env.OBSERVABILITY_NOTIFICATIONS_COLLECTION = "x_notifications";
  process.env.OBSERVABILITY_REPORT_RUNS_COLLECTION = "x_report_runs";
  assert.deepEqual(getObservabilityCollectionNames(), {
    events: "test_operational_events",
    incidents: "test_operational_incidents",
    notifications: "test_notification_deliveries",
    reportRuns: "test_operational_report_runs",
  });
});

test("event min level and info capture gate persistence", () => {
  delete process.env.OBSERVABILITY_EVENT_MIN_LEVEL;
  assert.equal(getObservabilityEventMinLevel(), "info");
  assert.equal(shouldPersistEventLevel("info"), true);
  assert.equal(shouldPersistEventLevel("debug"), false);

  process.env.OBSERVABILITY_CAPTURE_INFO_EVENTS = "false";
  assert.equal(shouldPersistEventLevel("info"), false);
  assert.equal(shouldPersistEventLevel("warn"), true);

  process.env.OBSERVABILITY_EVENT_MIN_LEVEL = "error";
  assert.equal(shouldPersistEventLevel("warn"), false);
  assert.equal(shouldPersistEventLevel("critical"), true);
});

test("owner-visible info events can bypass general info suppression", () => {
  process.env.OBSERVABILITY_CAPTURE_INFO_EVENTS = "false";
  assert.equal(shouldPersistEventLevel("info"), false);
  assert.equal(shouldPersistEventLevel("info", { ownerVisible: true }), true);

  process.env.OBSERVABILITY_CAPTURE_OWNER_EVENTS = "false";
  assert.equal(shouldPersistEventLevel("info", { ownerVisible: true }), false);
});

test("email mode defaults to log_only and immediate levels default to critical", () => {
  delete process.env.EMAIL_NOTIFICATIONS_MODE;
  assert.equal(getEmailNotificationsMode(), "log_only");
  assert.equal(isEmailNotificationsEnabled(), true);

  process.env.EMAIL_NOTIFICATIONS_MODE = "disabled";
  assert.equal(isEmailNotificationsEnabled(), false);

  delete process.env.ALERT_EMAIL_IMMEDIATE_LEVELS;
  assert.deepEqual(getAlertEmailImmediateLevels(), ["critical"]);
});

test("owner events parse from csv", () => {
  process.env.ALERT_EMAIL_OWNER_EVENTS = "booking.created, cancellation.created ,";
  assert.deepEqual(getAlertEmailOwnerEvents(), [
    "booking.created",
    "cancellation.created",
  ]);
});

test("config validation keeps test collections under custom mode in the test runner", () => {
  process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS = "true";
  process.env.OBSERVABILITY_COLLECTION_MODE = "custom";
  const validation = validateObservabilityConfig();
  assert.equal(validation.ok, true);
  assert.equal(validation.collectionNames?.events, "test_operational_events");
});
