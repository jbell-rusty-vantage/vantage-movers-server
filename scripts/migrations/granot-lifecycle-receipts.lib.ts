import {
  fillLegacyWebhookReceiptV2Fields,
  type LegacyReceiptCompatibilityInput,
} from "../../src/services/granotLifecycle/receiptCompatibility";
import {
  emptyRemovedCredentialKeyCounts,
  mergeRemovedCredentialKeyCounts,
  redactCredentialKeys,
  type RemovedCredentialKeyCounts,
} from "../../src/services/granotLifecycle/receiptEvidence";
import { maskReceiptId } from "./granot-lifecycle-migration.lib";

export const RECEIPT_MIGRATION_SCRIPT_VERSION = "granot-lifecycle-receipts/3";

export const RETIRED_RECEIPT_FIELDS = [
  "event_type",
  "received_at",
  "schema_version",
  "processing_status",
  "processing_attempts",
  "processed_at",
  "processing_error",
] as const;

export type LegacyReceiptRow = LegacyReceiptCompatibilityInput & {
  _id: string;
  provider?: unknown;
  event_type?: unknown;
  processing_status?: unknown;
  schema_version?: unknown;
};

export type ReceiptMigrationRefusal = {
  id: string;
  masked_id: string;
  processing_status: string;
  reason?: string;
};

export type ReceiptMigrationTranslation = {
  id: string;
  masked_id: string;
  fields: Extract<
    ReturnType<typeof fillLegacyWebhookReceiptV2Fields>,
    { ok: true; already_current: false }
  >["fields"];
  set_fields: Extract<
    ReturnType<typeof fillLegacyWebhookReceiptV2Fields>,
    { ok: true }
  >["set_fields"];
};

export type ReceiptMigrationPlan = {
  total: number;
  status_counts: Record<string, number>;
  event_class_counts: Record<string, number>;
  credential_key_counts: RemovedCredentialKeyCounts;
  translate: ReceiptMigrationTranslation[];
  already_current: number;
  refused: ReceiptMigrationRefusal[];
  legacy_field_counts: Record<(typeof RETIRED_RECEIPT_FIELDS)[number], number>;
  cleanup_masked_ids: string[];
  supported_legacy_consumers: readonly string[];
};

export type ReceiptMigrationVerifyFailure = {
  masked_id: string;
  code:
    | "missing_v2_fields"
    | "legacy_fields_remaining"
    | "credential_keys_remaining";
};

export function planGranotLifecycleReceiptMigration(
  rows: readonly LegacyReceiptRow[],
): ReceiptMigrationPlan {
  const status_counts: Record<string, number> = {};
  const event_class_counts: Record<string, number> = {};
  let credential_key_counts = emptyRemovedCredentialKeyCounts();
  const translate: ReceiptMigrationTranslation[] = [];
  const refused: ReceiptMigrationRefusal[] = [];
  let already_current = 0;
  const legacy_field_counts = Object.fromEntries(
    RETIRED_RECEIPT_FIELDS.map((field) => [field, 0]),
  ) as Record<(typeof RETIRED_RECEIPT_FIELDS)[number], number>;
  const cleanup_masked_ids: string[] = [];

  for (const row of rows) {
    const status =
      typeof row.processing_status === "string" ? row.processing_status : "unknown";
    status_counts[status] = (status_counts[status] ?? 0) + 1;
    const eventClass =
      typeof row.event_type === "string"
        ? row.event_type
        : typeof row.route_event_class === "string"
          ? row.route_event_class
          : "unknown";
    event_class_counts[eventClass] = (event_class_counts[eventClass] ?? 0) + 1;

    const headerCounts = redactCredentialKeys(row.headers ?? {}).removed_key_counts;
    const payloadCounts = redactCredentialKeys(row.payload).removed_key_counts;
    credential_key_counts = mergeRemovedCredentialKeyCounts(
      credential_key_counts,
      headerCounts,
      payloadCounts,
    );

    const filled = fillLegacyWebhookReceiptV2Fields(row);
    const masked_id = maskReceiptId(row._id);
    let hasLegacyField = false;
    for (const field of RETIRED_RECEIPT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        legacy_field_counts[field] += 1;
        hasLegacyField = true;
      }
    }
    if (!filled.ok) {
      refused.push({
        id: row._id,
        masked_id,
        processing_status: filled.processing_status,
        reason: filled.reason,
      });
      continue;
    }
    if (filled.already_current) {
      already_current += 1;
      if (hasLegacyField) cleanup_masked_ids.push(masked_id);
      continue;
    }
    translate.push({
      id: row._id,
      masked_id,
      fields: filled.fields,
      set_fields: filled.set_fields,
    });
  }

  return {
    total: rows.length,
    status_counts: sortCounts(status_counts),
    event_class_counts: sortCounts(event_class_counts),
    credential_key_counts,
    translate,
    already_current,
    refused,
    legacy_field_counts,
    cleanup_masked_ids: cleanup_masked_ids.sort(),
    supported_legacy_consumers: [],
  };
}

export function assertReceiptBackfillApplyAllowed(plan: ReceiptMigrationPlan): void {
  if (plan.refused.length > 0) {
    throw new Error(
      `Refusing receipt backfill: ${plan.refused.length} row(s) have a non-received processing_status.`,
    );
  }
  if (plan.supported_legacy_consumers.length > 0) {
    throw new Error("Refusing receipt backfill while supported legacy consumers remain.");
  }
}

export function buildReceiptReshapeUpdate(
  translation: ReceiptMigrationTranslation,
): {
  $set: ReceiptMigrationTranslation["set_fields"];
  $unset: Record<(typeof RETIRED_RECEIPT_FIELDS)[number], "">;
} {
  return {
    $set: translation.set_fields,
    $unset: Object.fromEntries(RETIRED_RECEIPT_FIELDS.map((field) => [field, ""])) as Record<
      (typeof RETIRED_RECEIPT_FIELDS)[number],
      ""
    >,
  };
}

export function assertReceiptMigrationApplyAllowed(plan: ReceiptMigrationPlan): void {
  if (plan.refused.length > 0) {
    throw new Error(
      `Refusing receipt apply: ${plan.refused.length} row(s) have a non-received processing_status.`,
    );
  }
  if (plan.translate.length > 0) {
    throw new Error(
      `Refusing receipt cleanup: ${plan.translate.length} row(s) are not v2-complete. Run the compatibility backfill release first.`,
    );
  }
  const credentialKeys = Object.values(plan.credential_key_counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (credentialKeys > 0) {
    throw new Error(
      `Refusing receipt cleanup: ${credentialKeys} forbidden credential key occurrence(s) remain.`,
    );
  }
  if (plan.supported_legacy_consumers.length > 0) {
    throw new Error("Refusing receipt cleanup while supported legacy consumers remain.");
  }
}

export function verifyGranotLifecycleReceiptMigration(
  rows: readonly LegacyReceiptRow[],
): { ok: boolean; failures: ReceiptMigrationVerifyFailure[] } {
  const failures: ReceiptMigrationVerifyFailure[] = [];
  for (const row of rows) {
    const masked_id = maskReceiptId(row._id);
    const filled = fillLegacyWebhookReceiptV2Fields(row);
    if (!filled.ok || !filled.already_current) {
      failures.push({ masked_id, code: "missing_v2_fields" });
      continue;
    }
    if (RETIRED_RECEIPT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(row, field))) {
      failures.push({ masked_id, code: "legacy_fields_remaining" });
    }
    const headerCounts = redactCredentialKeys(row.headers ?? {}).removed_key_counts;
    const payloadCounts = redactCredentialKeys(row.payload).removed_key_counts;
    const credentialCount = Object.values(
      mergeRemovedCredentialKeyCounts(headerCounts, payloadCounts),
    ).reduce((sum, count) => sum + count, 0);
    if (credentialCount > 0) {
      failures.push({ masked_id, code: "credential_keys_remaining" });
    }
  }
  return { ok: failures.length === 0, failures };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function sortCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}
