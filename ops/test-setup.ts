/**
 * Test bootstrap loaded via `node --import` before the test files.
 *
 * The unit suite must never write to a real database or publish real queue
 * messages as a side effect. We therefore:
 *   - mark the process as a test runner using a non-env global marker,
 *   - install the in-memory Daily Operations sink before test files load,
 *   - disable sheet-sync queue publishes.
 */
import { markVantageTestRunner } from "../src/config/domain/runtime";
import { installTestDailyOperationsSink } from "../src/services/dailyOperations/testDailyOperationsSink";
import { isLoopbackMongoUri } from "./lib/loopback-mongo";

markVantageTestRunner();
installTestDailyOperationsSink();

process.env.VANTAGE_TEST_RUNNER = "true";

delete process.env.ALLOW_TEST_SHEET_SYNC_QUEUE;

// A test process must never hold a non-loopback database target. Production credentials once
// reached the suite through an import-time `.env` load (removed 2026-11-21); refuse them outright.
const mongoUri = process.env.MONGO_URI?.trim();
if (mongoUri && !isLoopbackMongoUri(mongoUri)) {
  throw new Error("Refusing to run tests: MONGO_URI is not a loopback target. Unset it or point it at a local replica.");
}
