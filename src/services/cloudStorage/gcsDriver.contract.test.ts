import { objectStoreContract } from "./contractSuite";
import { createGcsDriver } from "./gcsDriver";

/**
 * Integration proof against a real, disposable GCS bucket. Skipped unless an operator opts in:
 *
 *   CLOUD_STORAGE_CONTRACT_TESTS=true CLOUD_STORAGE_CONTRACT_BUCKET=<disposable bucket> \
 *   TEST_MODE=true GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64=<test-project key> \
 *   node --import tsx --import ./ops/test-setup.ts --test src/services/cloudStorage/gcsDriver.contract.test.ts
 *
 * The bucket must be a throwaway bucket with no retention policy, no default event-based hold and
 * no object versioning. Every object is written under `contract/<uuid>/` and deleted at the end.
 * Production buckets are refused by name. See docs/knowledge/services/cloud-storage.md.
 */
const env = process.env;
const bucket = env.CLOUD_STORAGE_CONTRACT_BUCKET?.trim() ?? "";
const PRODUCTION_BUCKETS = new Set(["vantage-mongodb-backups-496816", "vantage-sheets-496816"]);

function skipReason(): string | false {
  if (env.CLOUD_STORAGE_CONTRACT_TESTS !== "true") return "real-bucket contract test is opt-in (CLOUD_STORAGE_CONTRACT_TESTS=true)";
  if (!bucket) return "CLOUD_STORAGE_CONTRACT_BUCKET is required";
  if (PRODUCTION_BUCKETS.has(bucket) || !/(^|[-_.])(test|disposable|scratch)([-_.]|$)/.test(bucket)) {
    throw new Error(`Refusing ${bucket}: use a disposable bucket whose name contains test, disposable or scratch`);
  }
  return false;
}

objectStoreContract(`real GCS bucket ${bucket || "(not configured)"}`, () => createGcsDriver({ bucket }), { skip: skipReason() });
