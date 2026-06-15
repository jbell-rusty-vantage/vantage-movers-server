/**
 * Test bootstrap loaded via `node --import` before the test files.
 *
 * Observability writes are best-effort side effects that must never run against
 * production observability collections during the unit suite. If `MONGO_URI`
 * happens to be present in the environment, an enabled observability layer
 * would open Mongo connections (leaking open handles that hang the test runner)
 * and could write events to real collections. We therefore:
 *   - mark the process as a test runner,
 *   - force observability collection mode to `test`,
 *   - disable observability/email notifications unless a test explicitly opts in,
 *   - disable sheet-sync queue publishes unless a test sets ALLOW_TEST_SHEET_SYNC_QUEUE.
 *
 * Even with `ALLOW_TEST_OBSERVABILITY=true`, production collection names are
 * blocked unless `ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS=true` is also set.
 *
 * Individual tests that exercise observability directly set the relevant env
 * vars themselves together with the ALLOW_TEST_* escape hatches.
 */
import { markVantageTestRunner } from "../api/config/domain/runtime";

markVantageTestRunner();

process.env.VANTAGE_TEST_RUNNER = "true";
process.env.OBSERVABILITY_COLLECTION_MODE = "test";
delete process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS;

// Vercel injects ALLOW_TEST_OBSERVABILITY from project env during builds; strip it
// so deploy-time test runs cannot write observability collections.
if (process.env.VERCEL === "1" || process.env.VERCEL_ENV?.trim()) {
  delete process.env.ALLOW_TEST_OBSERVABILITY;
  delete process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS;
}

delete process.env.ALLOW_TEST_SHEET_SYNC_QUEUE;

if (process.env.ALLOW_TEST_OBSERVABILITY !== "true") {
  process.env.OBSERVABILITY_ENABLED = "false";
  process.env.OBSERVABILITY_WRITE_MODE = "disabled";
  process.env.OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS = "false";
  process.env.OBSERVABILITY_CAPTURE_AUTH_EVENTS = "false";
}
if (process.env.ALLOW_TEST_EMAIL_NOTIFICATIONS !== "true") {
  process.env.EMAIL_NOTIFICATIONS_ENABLED = "false";
  process.env.EMAIL_NOTIFICATIONS_MODE = "disabled";
}
