import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HISTORICAL_DATABASE,
  PRODUCTION_DATABASE,
  TEST_DATABASE,
} from "./operations-registry-migration.lib";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  maskReceiptId,
  parseGranotLifecycleMigrationMode,
} from "./granot-lifecycle-migration.lib";
import {
  assertReceiptMigrationApplyAllowed,
  planGranotLifecycleReceiptMigration,
  verifyGranotLifecycleReceiptMigration,
  type LegacyReceiptRow,
} from "./granot-lifecycle-receipts.lib";

const receivedAt = new Date("2026-08-14T18:00:00.000Z");

function legacyReceived(overrides: Partial<LegacyReceiptRow> = {}): LegacyReceiptRow {
  return {
    _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    provider: "granot",
    event_type: "lead_created",
    received_at: receivedAt,
    createdAt: receivedAt,
    schema_version: 1,
    payload_kind: "object",
    headers: { "content-type": "application/json" },
    payload: { event_type: "lead_created", priority: "1" },
    processing_status: "received",
    processing_attempts: 0,
    ...overrides,
  };
}

function publicReceiptManifest(
  plan: ReturnType<typeof planGranotLifecycleReceiptMigration>,
) {
  return {
    status_counts: plan.status_counts,
    event_class_counts: plan.event_class_counts,
    credential_key_counts: plan.credential_key_counts,
    translate_count: plan.translate.length,
    already_current: plan.already_current,
    refused: plan.refused.map(({ masked_id, processing_status }) => ({
      masked_id,
      processing_status,
    })),
    translated_masked_ids: plan.translate.map((entry) => entry.masked_id),
  };
}

test("[AC-02][AC-35] receipt report counts statuses, event classes, and credential keys only", () => {
  const plan = planGranotLifecycleReceiptMigration([
    legacyReceived({
      headers: {
        "x-api-secret": "must-not-be-stored",
        "content-type": "application/json",
      },
      payload: {
        event_type: "lead_created",
        authorization: "must-not-be-stored",
      },
    }),
    legacyReceived({
      _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
      event_type: "priority_updated",
      processing_status: "processed",
    }),
  ]);

  assert.deepEqual(plan.status_counts, { processed: 1, received: 1 });
  assert.deepEqual(plan.event_class_counts, {
    lead_created: 1,
    priority_updated: 1,
  });
  assert.equal(plan.credential_key_counts["x-api-secret"], 1);
  assert.equal(plan.credential_key_counts.authorization, 1);
  assert.equal(plan.translate.length, 1);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.translate[0]?.fields.authentication_method, "legacy_unknown");
  assert.equal(plan.translate[0]?.fields.processing.state, "pending");
  assert.equal(plan.translate[0]?.masked_id, maskReceiptId("aaaaaaaaaaaaaaaaaaaaaaaa"));

  const manifest = JSON.stringify(publicReceiptManifest(plan));
  assert.equal(manifest.includes("must-not-be-stored"), false);
  assert.equal(manifest.includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("[AC-02] missing or unknown processing_status refuses apply instead of defaulting to received", () => {
  const missing = planGranotLifecycleReceiptMigration([
    legacyReceived({ processing_status: undefined }),
  ]);
  assert.equal(missing.translate.length, 0);
  assert.equal(missing.refused[0]?.processing_status, "unknown");
  assert.throws(
    () => assertReceiptMigrationApplyAllowed(missing),
    /non-received processing_status/,
  );
});

test("[AC-02] v2-complete rows are cleanup candidates while no consumer is retained", () => {
  const first = planGranotLifecycleReceiptMigration([legacyReceived()]);
  const translated = first.translate[0];
  assert.ok(translated);
  const proven = planGranotLifecycleReceiptMigration([
    {
      ...legacyReceived(),
      ...translated.fields,
      authentication_method: "body_secret",
    },
  ]);
  assert.equal(proven.translate.length, 0);
  assert.equal(proven.already_current, 1);
  assert.deepEqual(proven.translate, []);
  assert.equal(proven.cleanup_masked_ids.length, 1);
  assert.deepEqual(proven.supported_legacy_consumers, []);
});

test("[AC-02] cleanup refuses incomplete v2 rows and refused statuses", () => {
  const received = planGranotLifecycleReceiptMigration([legacyReceived()]);
  assert.equal(received.translate[0]?.fields.source_system, "granot");
  assert.equal(received.translate[0]?.fields.observation_channel, "granot_webhook");
  assert.equal(received.translate[0]?.fields.evidence_version, 2);
  assert.equal(received.translate[0]?.fields.processing.state, "pending");
  assert.throws(
    () => assertReceiptMigrationApplyAllowed(received),
    /not v2-complete/,
  );

  const refused = planGranotLifecycleReceiptMigration([
    legacyReceived({ processing_status: "failed" }),
  ]);
  assert.equal(refused.translate.length, 0);
  assert.equal(refused.refused[0]?.processing_status, "failed");
  assert.throws(
    () => assertReceiptMigrationApplyAllowed(refused),
    /non-received processing_status/,
  );
});

test("[AC-02] receipt cleanup plan is idempotent for already-translated rows", () => {
  const first = planGranotLifecycleReceiptMigration([legacyReceived()]);
  const translated = first.translate[0];
  assert.ok(translated);
  const second = planGranotLifecycleReceiptMigration([
    {
      ...legacyReceived(),
      ...translated.fields,
    },
  ]);
  assert.equal(second.translate.length, 0);
  assert.equal(second.already_current, 1);
  assert.equal(second.refused.length, 0);
  assert.doesNotThrow(() => assertReceiptMigrationApplyAllowed(second));
});

test("[AC-02] verify fails for missing v2 fields and remaining legacy fields", () => {
  const missing = verifyGranotLifecycleReceiptMigration([legacyReceived()]);
  assert.equal(missing.ok, false);
  assert.equal(missing.failures[0]?.code, "missing_v2_fields");

  const first = planGranotLifecycleReceiptMigration([legacyReceived()]).translate[0];
  assert.ok(first);
  const withLegacy = verifyGranotLifecycleReceiptMigration([
    { ...legacyReceived(), ...first.fields },
  ]);
  assert.equal(withLegacy.ok, false);
  assert.equal(withLegacy.failures[0]?.code, "legacy_fields_remaining");

  const clean = { ...legacyReceived(), ...first.fields } as Record<string, unknown>;
  for (const field of [
    "event_type", "received_at", "schema_version", "processing_status",
    "processing_attempts", "processed_at", "processing_error",
  ]) delete clean[field];
  assert.equal(
    verifyGranotLifecycleReceiptMigration([clean as LegacyReceiptRow]).ok,
    true,
  );
});

test("[AC-35] migration mode parsing rejects combined flags and defaults to report", () => {
  assert.equal(parseGranotLifecycleMigrationMode([]), "report");
  assert.equal(parseGranotLifecycleMigrationMode(["--report"]), "report");
  assert.equal(parseGranotLifecycleMigrationMode(["--apply"]), "apply");
  assert.equal(parseGranotLifecycleMigrationMode(["--verify"]), "verify");
  assert.throws(
    () => parseGranotLifecycleMigrationMode(["--report", "--apply"]),
    /combined/,
  );
});

test("[AC-35] receipt migration refuses historical and unknown databases", () => {
  assert.doesNotThrow(() => assertGranotLifecycleDatabaseAllowed(TEST_DATABASE));
  assert.doesNotThrow(() =>
    assertGranotLifecycleDatabaseAllowed(PRODUCTION_DATABASE),
  );
  assert.throws(
    () => assertGranotLifecycleDatabaseAllowed(HISTORICAL_DATABASE),
    /historical/,
  );
  assert.throws(
    () => assertGranotLifecycleDatabaseAllowed("inventeddb"),
    /unknown/,
  );
  assert.throws(
    () =>
      assertGranotLifecycleApplyAuthorized({
        args: ["--apply"],
        databaseName: TEST_DATABASE,
      }),
    /confirm-production/,
  );
  assert.doesNotThrow(() =>
    assertGranotLifecycleApplyAuthorized({
      args: ["--apply", `--confirm-production=${TEST_DATABASE}`],
      databaseName: TEST_DATABASE,
    }),
  );
});
