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
import { BOOKED_LEAD_NORMALIZED_JOB_INDEX } from "../../src/models/BookedLead";
import {
  GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
  GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES,
} from "../../src/models/GranotBookingReconciliationCase";
import {
  GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION,
  GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES,
} from "../../src/models/GranotReleaseReconciliationCase";
import {
  GRANOT_BOOKING_DISCREPANCY_COLLECTION,
  GRANOT_BOOKING_DISCREPANCY_INDEXES,
} from "../../src/models/GranotBookingDiscrepancy";
import {
  GRANOT_RELEASE_DISCREPANCY_COLLECTION,
  GRANOT_RELEASE_DISCREPANCY_INDEXES,
} from "../../src/models/GranotReleaseDiscrepancy";
import { FORM_LEAD_S08_INDEXES } from "../../src/models/FormLead";
import { CALL_LEAD_S08_INDEXES } from "../../src/models/CallLead";
import { maskReceiptId } from "./granot-lifecycle-migration.lib";
import {
  inventoryBookingJobs,
  type BookingJobCollision,
} from "./granot-lifecycle-revisions.lib";

import { ENTITY_CHANGE_INDEXES } from "../../src/models/EntityChange";
import { RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX } from "../../src/services/ringcentral/call-log-sync-state.store";

export const INDEX_MIGRATION_SCRIPT_VERSION = "granot-lifecycle-indexes/12";
export {
  GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
  GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION,
  GRANOT_BOOKING_DISCREPANCY_COLLECTION,
  GRANOT_RELEASE_DISCREPANCY_COLLECTION,
};
export const FORM_LEAD_COLLECTION = "form_leads";
export const CALL_LEAD_COLLECTION = "call_leads";

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

export function findEntityChangeRevisionCollisions(
  rows: readonly {
    _id: string;
    entity_model?: unknown;
    entity_id?: unknown;
    revision_after?: unknown;
  }[],
) {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  for (const row of rows) {
    if (
      typeof row.entity_model !== "string" ||
      typeof row.entity_id !== "string" ||
      typeof row.revision_after !== "number"
    ) {
      continue;
    }
    const key = `${row.entity_model}\u0000${row.entity_id}\u0000${row.revision_after}`;
    const current = groups.get(key) ?? { count: 0, masked_ids: [] };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(row._id));
    groups.set(key, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([key, group]) => {
      const [entity_model, entity_id, revision_after] = key.split("\u0000");
      return {
        entity_model,
        entity_id,
        revision_after,
        count: group.count,
        masked_ids: group.masked_ids.sort(),
      };
    });
}

export function orderedEntityChangeIndexCreates() {
  return {
    nonUnique: ENTITY_CHANGE_INDEXES.filter((index) => !("unique" in index)),
    unique: ENTITY_CHANGE_INDEXES.filter((index) => "unique" in index),
  };
}

export function verifyEntityChangeIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyNamedIndexDefinitions(actual, ENTITY_CHANGE_INDEXES);
}

export const BOOKED_LEAD_COLLECTION = "booked_leads";

export function findBookedLeadNormalizedJobCollisions(
  rows: readonly { _id: string; normalized_job_no?: unknown }[],
): BookingJobCollision[] {
  return inventoryBookingJobs(rows).collision_groups;
}

export function orderedBookedLeadIndexCreates() {
  return {
    nonUnique: [] as Array<typeof BOOKED_LEAD_NORMALIZED_JOB_INDEX>,
    unique: [BOOKED_LEAD_NORMALIZED_JOB_INDEX],
  };
}

export function bookingNormalizedJobIndexReady(
  actual: readonly DeclaredMongoIndex[],
): { ready: boolean; observed_name?: string } {
  const verified = verifyBookedLeadNormalizedJobIndexDefinitions(actual);
  return { ready: verified.ok, observed_name: verified.observed_name };
}

export function verifyBookedLeadNormalizedJobIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
): { ok: boolean; missing: string[]; mismatched: string[]; observed_name?: string } {
  const expected = BOOKED_LEAD_NORMALIZED_JOB_INDEX;
  const found = actual.find((index) =>
    (expected.accepted_names as readonly string[]).includes(index.name),
  );
  if (!found) {
    const byKey = actual.find((index) => sameKey(index.key, expected.key));
    if (byKey && sameIndexDefinition(byKey, expected)) {
      return {
        ok: true,
        missing: [],
        mismatched: [],
        observed_name: byKey.name,
      };
    }
    return {
      ok: false,
      missing: [expected.name],
      mismatched: [],
    };
  }
  if (!sameIndexDefinition(found, expected)) {
    return {
      ok: false,
      missing: [],
      mismatched: [found.name],
      observed_name: found.name,
    };
  }
  return {
    ok: true,
    missing: [],
    mismatched: [],
    observed_name: found.name,
  };
}

export type GranotBookingCaseCollision = {
  masked_job_no: string;
  action_kind: string;
  sequence_number?: number;
  count: number;
  masked_ids: string[];
};

export function findGranotBookingCaseCollisions(
  rows: readonly {
    _id: string;
    normalized_job_no?: unknown;
    action_kind?: unknown;
    sequence_number?: unknown;
    state?: unknown;
  }[],
): { open: GranotBookingCaseCollision[]; sequence: GranotBookingCaseCollision[] } {
  const group = (
    include: (row: (typeof rows)[number]) => boolean,
    sequence: boolean,
  ): GranotBookingCaseCollision[] => {
    const grouped = new Map<string, { count: number; masked_ids: string[] }>();
    for (const row of rows) {
      if (
        !include(row) ||
        typeof row.normalized_job_no !== "string" ||
        typeof row.action_kind !== "string" ||
        (sequence && typeof row.sequence_number !== "number")
      ) continue;
      const key = sequence
        ? `${row.normalized_job_no}\u0000${row.action_kind}\u0000${row.sequence_number}`
        : `${row.normalized_job_no}\u0000${row.action_kind}`;
      const current = grouped.get(key) ?? { count: 0, masked_ids: [] };
      current.count += 1;
      current.masked_ids.push(maskReceiptId(row._id));
      grouped.set(key, current);
    }
    return [...grouped.entries()]
      .filter(([, value]) => value.count > 1)
      .map(([key, value]) => {
        const [normalized_job_no, action_kind, sequenceRaw] = key.split("\u0000");
        return {
          masked_job_no: maskReceiptId(normalized_job_no!),
          action_kind: action_kind!,
          sequence_number: sequence ? Number(sequenceRaw) : undefined,
          count: value.count,
          masked_ids: value.masked_ids.sort(),
        };
      })
      .sort((left, right) =>
        left.masked_job_no.localeCompare(right.masked_job_no) ||
        left.action_kind.localeCompare(right.action_kind) ||
        (left.sequence_number ?? 0) - (right.sequence_number ?? 0),
      );
  };
  return {
    open: group((row) => row.state === "open", false),
    sequence: group(() => true, true),
  };
}

export function orderedGranotBookingCaseIndexCreates() {
  return {
    nonUnique: GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES.filter(
      (index) => !("unique" in index),
    ),
    unique: GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES.filter(
      (index) => "unique" in index,
    ),
  };
}

export function verifyGranotBookingCaseIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyNamedIndexDefinitions(actual, GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES);
}

export function findGranotReleaseCaseCollisions(
  rows: readonly {
    _id: string;
    normalized_job_no?: unknown;
    action_kind?: unknown;
    sequence_number?: unknown;
    state?: unknown;
  }[],
): { open: GranotBookingCaseCollision[]; sequence: GranotBookingCaseCollision[] } {
  return findGranotBookingCaseCollisions(rows);
}

export function orderedGranotReleaseCaseIndexCreates() {
  return {
    nonUnique: GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES.filter(
      (index) => !("unique" in index),
    ),
    unique: GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES.filter(
      (index) => "unique" in index,
    ),
  };
}

export function verifyGranotReleaseCaseIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyNamedIndexDefinitions(actual, GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES);
}

export type GranotDiscrepancyCollision = {
  masked_job_no: string;
  discrepancy_kind: string;
  reason_fingerprint: string;
  count: number;
  masked_ids: string[];
};

export function findGranotDiscrepancyCollisions(
  rows: readonly {
    _id: string;
    normalized_job_no?: unknown;
    discrepancy_kind?: unknown;
    reason_fingerprint?: unknown;
    state?: unknown;
  }[],
): GranotDiscrepancyCollision[] {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  for (const row of rows) {
    if (
      row.state !== "open" ||
      typeof row.normalized_job_no !== "string" ||
      typeof row.discrepancy_kind !== "string" ||
      typeof row.reason_fingerprint !== "string"
    ) continue;
    const key = [row.normalized_job_no, row.discrepancy_kind, row.reason_fingerprint].join("\u0000");
    const current = groups.get(key) ?? { count: 0, masked_ids: [] };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(row._id));
    groups.set(key, current);
  }
  return [...groups.entries()]
    .filter(([, value]) => value.count > 1)
    .map(([key, value]) => {
      const [job, discrepancy_kind, reason_fingerprint] = key.split("\u0000");
      return {
        masked_job_no: maskReceiptId(job!),
        discrepancy_kind: discrepancy_kind!,
        reason_fingerprint: reason_fingerprint!,
        count: value.count,
        masked_ids: value.masked_ids.sort(),
      };
    })
    .sort((left, right) =>
      left.masked_job_no.localeCompare(right.masked_job_no) ||
      left.discrepancy_kind.localeCompare(right.discrepancy_kind) ||
      left.reason_fingerprint.localeCompare(right.reason_fingerprint),
    );
}

function orderedGranotDiscrepancyIndexCreates<
  T extends { name: string; key: Record<string, number>; unique?: true; partialFilterExpression?: Record<string, unknown> },
>(indexes: readonly T[]) {
  return {
    nonUnique: indexes.filter((index) => !index.unique),
    unique: indexes.filter((index) => index.unique),
  };
}

export function orderedGranotBookingDiscrepancyIndexCreates() {
  return orderedGranotDiscrepancyIndexCreates(GRANOT_BOOKING_DISCREPANCY_INDEXES);
}

export function orderedGranotReleaseDiscrepancyIndexCreates() {
  return orderedGranotDiscrepancyIndexCreates(GRANOT_RELEASE_DISCREPANCY_INDEXES);
}

export function verifyGranotBookingDiscrepancyIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyNamedIndexDefinitions(actual, GRANOT_BOOKING_DISCREPANCY_INDEXES);
}

export function verifyGranotReleaseDiscrepancyIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyNamedIndexDefinitions(actual, GRANOT_RELEASE_DISCREPANCY_INDEXES);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Unit 21 — RingCentral Call Log sync state singleton.
 *
 * The `key: "account"` document carries both the high-water cursor and the
 * five-minute run lease, so two rows would allow two lease winners. Report
 * duplicate and non-`account` rows first; create the unique key index only on
 * a zero-collision report. Never choose, merge, or delete a row automatically.
 */
export type CallLogSyncStateKeyCollision = {
  key: string;
  count: number;
  masked_ids: string[];
};

export function findCallLogSyncStateKeyCollisions(
  rows: readonly { _id: string; key?: unknown }[],
): CallLogSyncStateKeyCollision[] {
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

export type CallLogSyncStateRowReport = {
  total_row_count: number;
  account_row_count: number;
  non_account_row_count: number;
  missing_key_row_count: number;
  non_account_masked_ids: string[];
};

export function reportCallLogSyncStateRows(
  rows: readonly { _id: string; key?: unknown }[],
): CallLogSyncStateRowReport {
  const nonAccount = rows.filter(
    (row) => typeof row.key === "string" && row.key && row.key !== "account",
  );
  return {
    total_row_count: rows.length,
    account_row_count: rows.filter((row) => row.key === "account").length,
    non_account_row_count: nonAccount.length,
    missing_key_row_count: rows.filter(
      (row) => typeof row.key !== "string" || !row.key,
    ).length,
    non_account_masked_ids: nonAccount
      .map((row) => maskReceiptId(row._id))
      .sort(),
  };
}

export function orderedCallLogSyncStateIndexCreates() {
  return {
    nonUnique: [] as Array<typeof RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX>,
    unique: [RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX],
  };
}

export function verifyCallLogSyncStateIndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
): { ok: boolean; missing: string[]; mismatched: string[] } {
  const expected = RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX;
  const found =
    actual.find((index) => index.name === expected.name) ??
    actual.find((index) => sameKey(index.key, expected.key));
  if (!found) {
    return { ok: false, missing: [expected.name], mismatched: [] };
  }
  if (found.unique !== true || !sameKey(found.key, expected.key)) {
    return { ok: false, missing: [], mismatched: [found.name] };
  }
  return { ok: true, missing: [], mismatched: [] };
}

export type LeadS08IndexContract = {
  name: string;
  key: Record<string, number>;
  accepted_names: readonly string[];
};

export function orderedFormLeadS08IndexCreates() {
  return {
    nonUnique: [...FORM_LEAD_S08_INDEXES],
    unique: [] as Array<(typeof FORM_LEAD_S08_INDEXES)[number]>,
  };
}

export function orderedCallLeadS08IndexCreates() {
  return {
    nonUnique: [...CALL_LEAD_S08_INDEXES],
    unique: [] as Array<(typeof CALL_LEAD_S08_INDEXES)[number]>,
  };
}

export function leadS08IndexesAreAllNonUnique(): boolean {
  return (
    FORM_LEAD_S08_INDEXES.length + CALL_LEAD_S08_INDEXES.length === 7 &&
    [...FORM_LEAD_S08_INDEXES, ...CALL_LEAD_S08_INDEXES].every(
      (index) => !("unique" in index),
    )
  );
}

function findLeadS08Index(
  actual: readonly DeclaredMongoIndex[],
  expected: LeadS08IndexContract,
): DeclaredMongoIndex | undefined {
  return (
    actual.find((index) => expected.accepted_names.includes(index.name)) ??
    actual.find((index) => sameKey(index.key, expected.key))
  );
}

export function leadS08IndexAlreadyPresent(
  actual: readonly DeclaredMongoIndex[],
  expected: LeadS08IndexContract,
): boolean {
  const found = findLeadS08Index(actual, expected);
  return Boolean(found && found.unique !== true && sameKey(found.key, expected.key));
}

function verifyLeadS08IndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
  expectedIndexes: readonly LeadS08IndexContract[],
): { ok: boolean; missing: string[]; mismatched: string[]; observed_names: string[] } {
  const missing: string[] = [];
  const mismatched: string[] = [];
  const observed_names: string[] = [];
  for (const expected of expectedIndexes) {
    const found = findLeadS08Index(actual, expected);
    if (!found) {
      missing.push(expected.name);
      continue;
    }
    observed_names.push(found.name);
    if (found.unique === true || !sameKey(found.key, expected.key)) {
      mismatched.push(found.name);
    }
  }
  const uniqueLeadJob = actual.filter(
    (index) => index.unique === true && "normalized_job_no" in index.key && Object.keys(index.key).length === 1,
  );
  if (uniqueLeadJob.length > 0) {
    mismatched.push(...uniqueLeadJob.map((index) => index.name));
  }
  return {
    ok: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
    observed_names,
  };
}

export function verifyFormLeadS08IndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyLeadS08IndexDefinitions(actual, FORM_LEAD_S08_INDEXES);
}

export function verifyCallLeadS08IndexDefinitions(
  actual: readonly DeclaredMongoIndex[],
) {
  return verifyLeadS08IndexDefinitions(actual, CALL_LEAD_S08_INDEXES);
}

export function hasGlobalUniqueLeadJobIndex(
  actual: readonly DeclaredMongoIndex[],
): boolean {
  return actual.some(
    (index) =>
      index.unique === true &&
      "normalized_job_no" in index.key &&
      Object.keys(index.key).length === 1,
  );
}
