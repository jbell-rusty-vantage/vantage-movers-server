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

export const RECEIPT_MIGRATION_SCRIPT_VERSION = "granot-lifecycle-receipts/1";

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
};

export type ReceiptMigrationVerifyFailure = {
  masked_id: string;
  code: "missing_v2_fields" | "refused_status_written";
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
  };
}

export function assertReceiptMigrationApplyAllowed(plan: ReceiptMigrationPlan): void {
  if (plan.refused.length > 0) {
    throw new Error(
      `Refusing receipt apply: ${plan.refused.length} row(s) have a non-received processing_status.`,
    );
  }
}

export function verifyGranotLifecycleReceiptMigration(
  rows: readonly LegacyReceiptRow[],
): { ok: boolean; failures: ReceiptMigrationVerifyFailure[] } {
  const failures: ReceiptMigrationVerifyFailure[] = [];
  for (const row of rows) {
    const masked_id = maskReceiptId(row._id);
    const status =
      typeof row.processing_status === "string" ? row.processing_status : "unknown";
    if (status !== "received") {
      if (asRecord(row.processing)) {
        failures.push({ masked_id, code: "refused_status_written" });
      }
      continue;
    }
    const filled = fillLegacyWebhookReceiptV2Fields(row);
    if (!filled.ok || !filled.already_current) {
      failures.push({ masked_id, code: "missing_v2_fields" });
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
