/**
 * Test bootstrap loaded via `node --import` before the test files.
 *
 * Observability writes are best-effort side effects that must never run against
 * a real database during the unit suite. If `MONGO_URI` happens to be present
 * in the environment, an enabled observability layer would open Mongo
 * connections (leaking open handles that hang the test runner) and could write
 * events to real collections. We therefore default observability and email
 * notifications OFF for tests unless a test explicitly opts in.
 *
 * Individual tests that exercise observability directly set the relevant env
 * vars themselves, so this only changes the default posture.
 */
if (process.env.OBSERVABILITY_ENABLED === undefined) {
  process.env.OBSERVABILITY_ENABLED = "false";
}
if (process.env.EMAIL_NOTIFICATIONS_ENABLED === undefined) {
  process.env.EMAIL_NOTIFICATIONS_ENABLED = "false";
}
