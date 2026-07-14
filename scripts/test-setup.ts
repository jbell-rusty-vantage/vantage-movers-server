/**
 * Test bootstrap loaded via `node --import` before the test files.
 *
 * Observability writes are best-effort side effects that must never run against
 * production observability collections during the unit suite. If `MONGO_URI`
 * happens to be present in the environment, an enabled observability layer
 * would open Mongo connections (leaking open handles that hang the test runner)
 * and could write events to real collections. We therefore:
 *   - mark the process as a test runner using a non-env global marker,
 *   - install an in-memory observability sink before test files load,
 *   - force observability collection mode to `test`,
 *   - disable email notifications,
 *   - disable sheet-sync queue publishes.
 *
 * Tests that need observability assertions should read the in-memory capture,
 * not MongoDB. Real observability integration tests must live behind a separate
 * explicit runner that targets isolated test collections only.
 */
import { markVantageTestRunner } from "../src/config/domain/runtime";
import { installTestObservabilitySink } from "../src/services/observability/testObservabilitySink";

markVantageTestRunner();
installTestObservabilitySink();

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

process.env.OBSERVABILITY_ENABLED = "false";
process.env.OBSERVABILITY_WRITE_MODE = "disabled";
process.env.OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS = "false";
process.env.OBSERVABILITY_CAPTURE_AUTH_EVENTS = "false";
if (process.env.ALLOW_TEST_EMAIL_NOTIFICATIONS !== "true") {
  process.env.EMAIL_NOTIFICATIONS_ENABLED = "false";
  process.env.EMAIL_NOTIFICATIONS_MODE = "disabled";
}
