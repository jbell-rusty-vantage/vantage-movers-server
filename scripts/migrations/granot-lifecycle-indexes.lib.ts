import {
  GRANOT_OBSERVATION_INDEXES,
} from "../../src/models/GranotObservation";
import {
  GRANOT_OBSERVATION_RECEIPT_INDEXES,
  GRANOT_OBSERVATION_RECEIPT_LEGACY_INDEXES,
} from "../../src/models/GranotObservationReceipt";
import { GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES } from "../../src/models/GranotCrmSource";
import { GRANOT_AUTOMATION_SOURCE_INDEXES } from "../../src/models/GranotAutomationSource";
import { SYNCHRONIZATION_DECISION_INDEXES } from "../../src/models/SynchronizationDecision";
import { GRANOT_LIFECYCLE_ACTIVATION_INDEXES } from "../../src/models/GranotLifecycleActivation";
import { GRANOT_RECORD_LINK_INDEXES } from "../../src/models/GranotRecordLink";
import { maskReceiptId } from "./granot-lifecycle-migration.lib";

export const INDEX_MIGRATION_SCRIPT_VERSION = "granot-lifecycle-indexes/5";

export const GRANOT_CRM_SOURCE_UNIQUE_INDEX_APPLY_ENABLED = true;

export type ReceiptIndexContract = (typeof GRANOT_OBSERVATION_RECEIPT_INDEXES)[number];
export type ObservationIndexContract = (typeof GRANOT_OBSERVATION_INDEXES)[number];

export type OperationIdCollision = {
  observation_channel: string;
  channel_operation_id: string;
  count: number;
  masked_ids: string[];
};

export type DeclaredMongoIndex = {
  name: string;
  key: Record<string, unknown>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

export function findChannelOperationIdCollisions(
  rows: readonly {
    _id: string;
    observation_channel?: unknown;
    channel_operation_id?: unknown;
  }[],
): OperationIdCollision[] {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  for (const row of rows) {
    if (typeof row.channel_operation_id !== "string") {
      continue;
    }
    const channel =
      typeof row.observation_channel === "string"
        ? row.observation_channel
        : "unknown";
    const key = `${channel}\u0000${row.channel_operation_id}`;
    const current = groups.get(key) ?? { count: 0, masked_ids: [] };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(row._id));
    groups.set(key, current);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([key, group]) => {
      const separator = key.indexOf("\u0000");
      return {
        observation_channel: key.slice(0, separator),
        channel_operation_id: key.slice(separator + 1),
        count: group.count,
        masked_ids: group.masked_ids.sort(),
      };
    })
    .sort((left, right) =>
      left.observation_channel.localeCompare(right.observation_channel) ||
      left.channel_operation_id.localeCompare(right.channel_operation_id),
    );
}

export function orderedReceiptIndexCreates(): {
  nonUnique: ReceiptIndexContract[];
  unique: ReceiptIndexContract[];
} {
  const nonUnique = GRANOT_OBSERVATION_RECEIPT_INDEXES.filter(
    (index) => !("unique" in index),
  );
  const unique = GRANOT_OBSERVATION_RECEIPT_INDEXES.filter(
    (index) => "unique" in index,
  );
  return { nonUnique, unique };
}

export type ObservationReceiptIdCollision = {
  receipt_id: string;
  count: number;
  masked_ids: string[];
};

export function findObservationReceiptIdCollisions(
  rows: readonly {
    _id: string;
    receipt_id?: unknown;
  }[],
): ObservationReceiptIdCollision[] {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  for (const row of rows) {
    if (row.receipt_id == null || row.receipt_id === "") {
      continue;
    }
    const receiptId = String(row.receipt_id);
    const current = groups.get(receiptId) ?? { count: 0, masked_ids: [] };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(row._id));
    groups.set(receiptId, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([receipt_id, group]) => ({
      receipt_id,
      count: group.count,
      masked_ids: group.masked_ids.sort(),
    }))
    .sort((left, right) => left.receipt_id.localeCompare(right.receipt_id));
}

export function orderedObservationIndexCreates(): {
  nonUnique: ObservationIndexContract[];
  unique: ObservationIndexContract[];
} {
  const nonUnique = GRANOT_OBSERVATION_INDEXES.filter(
    (index) => !("unique" in index),
  );
  const unique = GRANOT_OBSERVATION_INDEXES.filter((index) => "unique" in index);
  return { nonUnique, unique };
}

export function verifyReceiptIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
): { ok: boolean; missing: string[]; mismatched: string[] } {
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const expected of GRANOT_OBSERVATION_RECEIPT_INDEXES) {
    const found = actual.find((index) => index.name === expected.name);
    if (!found) {
      missing.push(expected.name);
      continue;
    }
    if (!sameIndexDefinition(found, expected)) {
      mismatched.push(expected.name);
    }
  }
  for (const expected of GRANOT_OBSERVATION_RECEIPT_LEGACY_INDEXES) {
    const found = actual.find((index) => sameKey(index.key, expected.key));
    if (!found) {
      missing.push(JSON.stringify(expected.key));
    }
  }
  return {
    ok: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
  };
}

export function verifyObservationIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
): { ok: boolean; missing: string[]; mismatched: string[] } {
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const expected of GRANOT_OBSERVATION_INDEXES) {
    const found = actual.find((index) => index.name === expected.name);
    if (!found) {
      missing.push(expected.name);
      continue;
    }
    if (!sameIndexDefinition(found, expected)) {
      mismatched.push(expected.name);
    }
  }
  return {
    ok: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
  };
}

export function verifyGranotCrmSourceIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
): { ok: boolean; missing: string[]; mismatched: string[] } {
  return verifyNamedIndexDefinitions(actual, GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES);
}

export function verifyGranotAutomationSourceIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
): { ok: boolean; missing: string[]; mismatched: string[] } {
  return verifyNamedIndexDefinitions(actual, GRANOT_AUTOMATION_SOURCE_INDEXES);
}

export function orderedGranotAutomationSourceIndexCreates() {
  return {
    nonUnique: [...GRANOT_AUTOMATION_SOURCE_INDEXES],
    unique: [],
  };
}

function verifyNamedIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
  expectedIndexes: readonly {
    name: string;
    key: Record<string, number>;
    unique?: true;
    partialFilterExpression?: Record<string, unknown>;
  }[],
): { ok: boolean; missing: string[]; mismatched: string[] } {
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const expected of expectedIndexes) {
    const found = actual.find((index) => index.name === expected.name);
    if (!found) {
      missing.push(expected.name);
      continue;
    }
    if (!sameIndexDefinition(found, expected)) {
      mismatched.push(expected.name);
    }
  }
  return {
    ok: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
  };
}

function sameIndexDefinition(
  actual: DeclaredMongoIndex,
  expected: ReceiptIndexContract | ObservationIndexContract | { name: string; key: Record<string, number>; unique?: true },
): boolean {
  const expectedUnique = "unique" in expected ? expected.unique === true : false;
  const actualUnique = actual.unique === true;
  if (actualUnique !== expectedUnique) {
    return false;
  }
  if (!sameKey(actual.key, expected.key)) {
    return false;
  }
  const expectedPartial =
    "partialFilterExpression" in expected
      ? expected.partialFilterExpression
      : undefined;
  return sameJson(actual.partialFilterExpression, expectedPartial);
}

function sameKey(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return sameJson(actual, expected);
}

export type NormalizedLabelCollision = {
  normalized_granot_label: string;
  count: number;
  masked_ids: string[];
};

export function findNormalizedGranotLabelCollisions(
  rows: readonly {
    _id: string;
    normalized_granot_label?: unknown;
  }[],
): NormalizedLabelCollision[] {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  for (const row of rows) {
    if (typeof row.normalized_granot_label !== "string" || !row.normalized_granot_label) {
      continue;
    }
    const current = groups.get(row.normalized_granot_label) ?? {
      count: 0,
      masked_ids: [],
    };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(row._id));
    groups.set(row.normalized_granot_label, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([normalized_granot_label, group]) => ({
      normalized_granot_label,
      count: group.count,
      masked_ids: group.masked_ids.sort(),
    }))
    .sort((left, right) =>
      left.normalized_granot_label.localeCompare(right.normalized_granot_label),
    );
}

export function orderedGranotCrmSourceIndexCreates(): {
  nonUnique: typeof GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES[number][];
  unique: typeof GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES[number][];
} {
  const nonUnique = GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES.filter(
    (index) => !("unique" in index),
  );
  const unique = GRANOT_CRM_SOURCE_UNIQUE_INDEX_APPLY_ENABLED
    ? GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES.filter((index) => "unique" in index)
    : [];
  return { nonUnique, unique };
}

export type DecisionObservationAttemptCollision = {
  observation_id: string;
  attempt: number;
  count: number;
  masked_ids: string[];
};

export function findDecisionObservationAttemptCollisions(
  rows: readonly {
    _id: string;
    observation_id?: unknown;
    attempt?: unknown;
  }[],
): DecisionObservationAttemptCollision[] {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  for (const row of rows) {
    if (row.observation_id == null || row.attempt == null) {
      continue;
    }
    const key = `${String(row.observation_id)}\u0000${String(row.attempt)}`;
    const current = groups.get(key) ?? { count: 0, masked_ids: [] };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(row._id));
    groups.set(key, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([key, group]) => {
      const separator = key.indexOf("\u0000");
      return {
        observation_id: key.slice(0, separator),
        attempt: Number(key.slice(separator + 1)),
        count: group.count,
        masked_ids: group.masked_ids.sort(),
      };
    })
    .sort(
      (left, right) =>
        left.observation_id.localeCompare(right.observation_id) ||
        left.attempt - right.attempt,
    );
}

export type ActivationKeyCollision = {
  key: string;
  count: number;
  masked_ids: string[];
};

export function findActivationKeyCollisions(
  rows: readonly { _id: string; key?: unknown }[],
): ActivationKeyCollision[] {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  for (const row of rows) {
    if (typeof row.key !== "string" || !row.key) {
      continue;
    }
    const current = groups.get(row.key) ?? { count: 0, masked_ids: [] };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(row._id));
    groups.set(row.key, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([key, group]) => ({
      key,
      count: group.count,
      masked_ids: group.masked_ids.sort(),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export type ActiveRecordLinkJobCollision = {
  provider: string;
  normalized_job_no: string;
  count: number;
  masked_ids: string[];
};

export function findActiveRecordLinkJobCollisions(
  rows: readonly {
    _id: string;
    provider?: unknown;
    normalized_job_no?: unknown;
    state?: unknown;
  }[],
): ActiveRecordLinkJobCollision[] {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  for (const row of rows) {
    if (row.state !== "active") {
      continue;
    }
    if (typeof row.provider !== "string" || typeof row.normalized_job_no !== "string") {
      continue;
    }
    const key = `${row.provider}\u0000${row.normalized_job_no}`;
    const current = groups.get(key) ?? { count: 0, masked_ids: [] };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(row._id));
    groups.set(key, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([key, group]) => {
      const separator = key.indexOf("\u0000");
      return {
        provider: key.slice(0, separator),
        normalized_job_no: key.slice(separator + 1),
        count: group.count,
        masked_ids: group.masked_ids.sort(),
      };
    })
    .sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        left.normalized_job_no.localeCompare(right.normalized_job_no),
    );
}

export function orderedSynchronizationDecisionIndexCreates() {
  return {
    nonUnique: SYNCHRONIZATION_DECISION_INDEXES.filter((index) => !("unique" in index)),
    unique: SYNCHRONIZATION_DECISION_INDEXES.filter((index) => "unique" in index),
  };
}

export function orderedGranotLifecycleActivationIndexCreates() {
  return {
    nonUnique: GRANOT_LIFECYCLE_ACTIVATION_INDEXES.filter((index) => !("unique" in index)),
    unique: GRANOT_LIFECYCLE_ACTIVATION_INDEXES.filter((index) => "unique" in index),
  };
}

export function orderedGranotRecordLinkIndexCreates() {
  return {
    nonUnique: GRANOT_RECORD_LINK_INDEXES.filter((index) => !("unique" in index)),
    unique: GRANOT_RECORD_LINK_INDEXES.filter((index) => "unique" in index),
  };
}

export function verifySynchronizationDecisionIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyNamedIndexDefinitions(actual, SYNCHRONIZATION_DECISION_INDEXES);
}

export function verifyGranotLifecycleActivationIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyNamedIndexDefinitions(actual, GRANOT_LIFECYCLE_ACTIVATION_INDEXES);
}

export function verifyGranotRecordLinkIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyNamedIndexDefinitions(actual, GRANOT_RECORD_LINK_INDEXES);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
