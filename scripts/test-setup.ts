/**
 * Test bootstrap loaded via `node --import` before the test files.
 *
 * Observability writes are best-effort side effects that must never run against
 * a real database during the unit suite. If `MONGO_URI` happens to be present
 * in the environment, an enabled observability layer would open Mongo
 * connections (leaking open handles that hang the test runner) and could write
 * events to real collections. We therefore force observability and email
 * notifications OFF for tests unless a test explicitly opts in.
 *
 * Individual tests that exercise observability directly set the relevant env
 * vars themselves together with the ALLOW_TEST_* escape hatches.
 */
process.env.VANTAGE_TEST_RUNNER = "true";

if (process.env.ALLOW_TEST_OBSERVABILITY !== "true") {
  process.env.OBSERVABILITY_ENABLED = "false";
  process.env.OBSERVABILITY_WRITE_MODE = "disabled";
}
if (process.env.ALLOW_TEST_EMAIL_NOTIFICATIONS !== "true") {
  process.env.EMAIL_NOTIFICATIONS_ENABLED = "false";
  process.env.EMAIL_NOTIFICATIONS_MODE = "disabled";
}
