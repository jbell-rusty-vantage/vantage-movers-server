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
  shouldPersistEventLevel,
  shouldWriteObservabilityCollections,
  validateObservabilityConfig,
} from "./observability";

/**
 * These tests mutate `process.env` to exercise the call-time reads. Each test
 * restores the keys it touched so ordering stays independent.
 */
const TOUCHED_ENV_KEYS = [
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

test("observability is enabled by default and disabled by flags", () => {
  delete process.env.OBSERVABILITY_ENABLED;
  assert.equal(isObservabilityEnabled(), true);

  process.env.OBSERVABILITY_ENABLED = "false";
  assert.equal(isObservabilityEnabled(), false);

  process.env.OBSERVABILITY_ENABLED = "true";
  process.env.OBSERVABILITY_WRITE_MODE = "disabled";
  assert.equal(isObservabilityEnabled(), false);
});

test("write mode controls whether collections are written", () => {
  delete process.env.OBSERVABILITY_WRITE_MODE;
  assert.equal(getObservabilityWriteMode(), "enabled");
  assert.equal(shouldWriteObservabilityCollections(), true);

  process.env.OBSERVABILITY_WRITE_MODE = "log_only";
  assert.equal(shouldWriteObservabilityCollections(), false);
});

test("collection names follow runtime TEST_MODE by default", () => {
  delete process.env.OBSERVABILITY_COLLECTION_MODE;
  delete process.env.TEST_MODE;
  assert.equal(getObservabilityCollectionNames().events, "operational_events");

  process.env.TEST_MODE = "true";
  assert.equal(
    getObservabilityCollectionNames().events,
    "test_operational_events",
  );
});

test("collection mode production/test override TEST_MODE", () => {
  process.env.TEST_MODE = "true";
  process.env.OBSERVABILITY_COLLECTION_MODE = "production";
  assert.equal(getObservabilityCollectionNames().incidents, "operational_incidents");

  process.env.OBSERVABILITY_COLLECTION_MODE = "test";
  assert.equal(
    getObservabilityCollectionNames().incidents,
    "test_operational_incidents",
  );
});

test("collection prefix is applied to default names", () => {
  process.env.OBSERVABILITY_COLLECTION_MODE = "production";
  process.env.OBSERVABILITY_COLLECTION_PREFIX = "dev_";
  assert.equal(getObservabilityCollectionNames().events, "dev_operational_events");
});

test("custom collection mode requires explicit names", () => {
  process.env.OBSERVABILITY_COLLECTION_MODE = "custom";
  assert.throws(() => getObservabilityCollectionNames());

  process.env.OBSERVABILITY_EVENTS_COLLECTION = "x_events";
  process.env.OBSERVABILITY_INCIDENTS_COLLECTION = "x_incidents";
  process.env.OBSERVABILITY_NOTIFICATIONS_COLLECTION = "x_notifications";
  process.env.OBSERVABILITY_REPORT_RUNS_COLLECTION = "x_report_runs";
  assert.equal(getObservabilityCollectionNames().events, "x_events");
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

test("config validation reports custom collection errors without throwing", () => {
  process.env.OBSERVABILITY_COLLECTION_MODE = "custom";
  const validation = validateObservabilityConfig();
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((message) => message.includes("OBSERVABILITY_EVENTS_COLLECTION")));
});
