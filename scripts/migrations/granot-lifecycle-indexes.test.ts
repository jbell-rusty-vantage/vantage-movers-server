import assert from "node:assert/strict";
import { test } from "node:test";
import { GRANOT_OBSERVATION_INDEXES } from "../../src/models/GranotObservation";
import {
  GRANOT_OBSERVATION_RECEIPT_INDEXES,
  GRANOT_OBSERVATION_RECEIPT_LEGACY_INDEXES,
} from "../../src/models/GranotObservationReceipt";
import { GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES } from "../../src/models/GranotCrmSource";
import {
  findActivationKeyCollisions,
  findActiveRecordLinkJobCollisions,
  findChannelOperationIdCollisions,
  findDecisionObservationAttemptCollisions,
  findNormalizedGranotLabelCollisions,
  findObservationReceiptIdCollisions,
  findCallLogSyncStateKeyCollisions,
  orderedCallLogSyncStateIndexCreates,
  reportCallLogSyncStateRows,
  verifyCallLogSyncStateIndexDefinitions,
  GRANOT_CRM_SOURCE_UNIQUE_INDEX_APPLY_ENABLED,
  orderedGranotAutomationSourceIndexCreates,
  orderedGranotCrmSourceIndexCreates,
  orderedGranotLifecycleActivationIndexCreates,
  orderedGranotRecordLinkIndexCreates,
  orderedObservationIndexCreates,
  orderedReceiptIndexCreates,
  orderedEntityChangeIndexCreates,
  orderedSynchronizationDecisionIndexCreates,
  verifyEntityChangeIndexDefinitions,
  verifyGranotAutomationSourceIndexDefinitions,
  verifyGranotCrmSourceIndexDefinitions,
  verifyGranotLifecycleActivationIndexDefinitions,
  verifyGranotRecordLinkIndexDefinitions,
  verifyObservationIndexDefinitions,
  verifyReceiptIndexDefinitions,
  verifySynchronizationDecisionIndexDefinitions,
  findBookedLeadNormalizedJobCollisions,
  hasGlobalUniqueLeadJobIndex,
  leadS08IndexesAreAllNonUnique,
  orderedBookedLeadIndexCreates,
  orderedCallLeadS08IndexCreates,
  orderedFormLeadS08IndexCreates,
  verifyBookedLeadNormalizedJobIndexDefinitions,
  verifyCallLeadS08IndexDefinitions,
  verifyFormLeadS08IndexDefinitions,
  findGranotBookingCaseCollisions,
  orderedGranotBookingCaseIndexCreates,
  verifyGranotBookingCaseIndexDefinitions,
  findGranotReleaseCaseCollisions,
  orderedGranotReleaseCaseIndexCreates,
  verifyGranotReleaseCaseIndexDefinitions,
  findGranotDiscrepancyCollisions,
  orderedGranotBookingDiscrepancyIndexCreates,
  orderedGranotReleaseDiscrepancyIndexCreates,
  verifyGranotBookingDiscrepancyIndexDefinitions,
  verifyGranotReleaseDiscrepancyIndexDefinitions,
} from "./granot-lifecycle-indexes.lib";
import { GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES } from "../../src/models/GranotBookingReconciliationCase";
import { GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES } from "../../src/models/GranotReleaseReconciliationCase";
import { SYNCHRONIZATION_DECISION_INDEXES } from "../../src/models/SynchronizationDecision";
import { GRANOT_LIFECYCLE_ACTIVATION_INDEXES } from "../../src/models/GranotLifecycleActivation";
import { GRANOT_RECORD_LINK_INDEXES } from "../../src/models/GranotRecordLink";
import { GRANOT_AUTOMATION_SOURCE_INDEXES } from "../../src/models/GranotAutomationSource";
import { BOOKED_LEAD_NORMALIZED_JOB_INDEX } from "../../src/models/BookedLead";
import { CALL_LEAD_S08_INDEXES } from "../../src/models/CallLead";
import { FORM_LEAD_S08_INDEXES } from "../../src/models/FormLead";
import { GRANOT_BOOKING_DISCREPANCY_INDEXES } from "../../src/models/GranotBookingDiscrepancy";
import { GRANOT_RELEASE_DISCREPANCY_INDEXES } from "../../src/models/GranotReleaseDiscrepancy";

test("[AC-36] discrepancy collisions are PII-safe and indexes are ordered and exact", () => {
  const rows = [
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", normalized_job_no: "JOB-29", discrepancy_kind: "booking", reason_fingerprint: "f".repeat(64), state: "open" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", normalized_job_no: "JOB-29", discrepancy_kind: "booking", reason_fingerprint: "f".repeat(64), state: "open" },
    { _id: "cccccccccccccccccccccccc", normalized_job_no: "JOB-29", discrepancy_kind: "booking", reason_fingerprint: "f".repeat(64), state: "resolved" },
  ];
  const collisions = findGranotDiscrepancyCollisions(rows);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.count, 2);
  assert.equal(JSON.stringify(collisions).includes("JOB-29"), false);
  assert.equal(JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);

  for (const [ordered, definitions, verify] of [
    [orderedGranotBookingDiscrepancyIndexCreates(), GRANOT_BOOKING_DISCREPANCY_INDEXES, verifyGranotBookingDiscrepancyIndexDefinitions],
    [orderedGranotReleaseDiscrepancyIndexCreates(), GRANOT_RELEASE_DISCREPANCY_INDEXES, verifyGranotReleaseDiscrepancyIndexDefinitions],
  ] as const) {
    assert.equal(ordered.nonUnique.length, 1);
    assert.equal(ordered.unique.length, 1);
    assert.deepEqual(
      ordered.unique[0] && "partialFilterExpression" in ordered.unique[0]
        ? ordered.unique[0].partialFilterExpression
        : undefined,
      { state: "open" },
    );
    const actual = definitions.map((index) => ({ ...index, key: { ...index.key } }));
    assert.equal(verify(actual).ok, true);
    assert.equal(verify(actual.slice(0, 1)).ok, false);
  }
});

test("[AC-02] unique/partial collision report ignores webhook rows without operation ids", () => {
  const collisions = findChannelOperationIdCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", observation_channel: "granot_webhook" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", observation_channel: "granot_webhook" },
    {
      _id: "cccccccccccccccccccccccc",
      observation_channel: "browser_extension",
      channel_operation_id: "77777777-7777-4777-8777-777777777777",
    },
    {
      _id: "dddddddddddddddddddddddd",
      observation_channel: "browser_extension",
      channel_operation_id: "77777777-7777-4777-8777-777777777777",
    },
  ]);

  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.count, 2);
  assert.equal(collisions[0]?.observation_channel, "browser_extension");
  assert.equal(
    collisions[0]?.channel_operation_id,
    "77777777-7777-4777-8777-777777777777",
  );
  assert.equal(
    JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"),
    false,
  );
});

test("[AC-36] Booking-case collisions, ordering, and exact definitions are deterministic", () => {
  const collisions = findGranotBookingCaseCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", normalized_job_no: "JOB-22", action_kind: "booked", sequence_number: 1, state: "open" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", normalized_job_no: "JOB-22", action_kind: "booked", sequence_number: 1, state: "open" },
    { _id: "cccccccccccccccccccccccc", normalized_job_no: "JOB-22", action_kind: "booked", sequence_number: 2, state: "resolved" },
  ]);
  assert.equal(collisions.open.length, 1);
  assert.equal(collisions.sequence.length, 1);
  assert.equal(JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
  assert.equal(JSON.stringify(collisions).includes("JOB-22"), false);
  assert.deepEqual(findGranotBookingCaseCollisions([]), { open: [], sequence: [] });
  const ordered = orderedGranotBookingCaseIndexCreates();
  assert.equal(ordered.nonUnique.length, 3);
  assert.equal(ordered.unique.length, 2);
  const actual = GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES.map((index) => ({
    name: index.name,
    key: { ...index.key },
    unique: "unique" in index ? true : undefined,
    partialFilterExpression: "partialFilterExpression" in index
      ? { ...index.partialFilterExpression }
      : undefined,
  }));
  assert.equal(verifyGranotBookingCaseIndexDefinitions(actual).ok, true);
  assert.equal(verifyGranotBookingCaseIndexDefinitions([]).missing.length, 5);
  assert.deepEqual(
    verifyGranotBookingCaseIndexDefinitions(actual),
    verifyGranotBookingCaseIndexDefinitions(actual),
  );
});

test("[AC-36] Release-case collisions, ordering, and exact definitions are deterministic and PII-safe", () => {
  const collisions = findGranotReleaseCaseCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", normalized_job_no: "U26-JOB", action_kind: "release", sequence_number: 1, state: "open" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", normalized_job_no: "U26-JOB", action_kind: "release", sequence_number: 1, state: "open" },
    { _id: "cccccccccccccccccccccccc", normalized_job_no: "U26-JOB", action_kind: "release", sequence_number: 2, state: "resolved" },
  ]);
  assert.equal(collisions.open.length, 1);
  assert.equal(collisions.sequence.length, 1);
  assert.equal(JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
  assert.equal(JSON.stringify(collisions).includes("U26-JOB"), false);
  assert.deepEqual(findGranotReleaseCaseCollisions([]), { open: [], sequence: [] });

  const ordered = orderedGranotReleaseCaseIndexCreates();
  assert.equal(ordered.nonUnique.length, 3);
  assert.equal(ordered.unique.length, 2);
  const actual = GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES.map((index) => ({
    name: index.name,
    key: { ...index.key },
    unique: "unique" in index ? true : undefined,
    partialFilterExpression: "partialFilterExpression" in index
      ? { ...index.partialFilterExpression }
      : undefined,
  }));
  assert.equal(verifyGranotReleaseCaseIndexDefinitions(actual).ok, true);
  assert.equal(verifyGranotReleaseCaseIndexDefinitions([]).missing.length, 5);
});

test("[AC-02] index apply creates non-unique indexes before the unique partial index", () => {
  const ordered = orderedReceiptIndexCreates();
  assert.ok(ordered.nonUnique.length >= 4);
  assert.equal(ordered.unique.length, 1);
  assert.equal(
    ordered.unique[0]?.name,
    "granot_observation_receipt_channel_operation_id_unique",
  );
  assert.ok(
    ordered.nonUnique.every((index) => index.name !== ordered.unique[0]?.name),
  );
  assert.ok(
    ordered.nonUnique.some(
      (index) => index.name === "granot_observation_receipt_payload_sha256_diag",
    ),
  );
  assert.notEqual(
    GRANOT_OBSERVATION_RECEIPT_INDEXES.find(
      (index) => index.name === "granot_observation_receipt_payload_sha256_diag",
    ) && "unique" in GRANOT_OBSERVATION_RECEIPT_INDEXES.find(
      (index) => index.name === "granot_observation_receipt_payload_sha256_diag",
    )!,
    true,
  );
});

test("[AC-02] index verify matches the model contract names and definitions", () => {
  const actual = [
    ...GRANOT_OBSERVATION_RECEIPT_INDEXES.map((index) => ({
      name: index.name,
      key: { ...index.key },
      unique: "unique" in index ? true : undefined,
      partialFilterExpression:
        "partialFilterExpression" in index
          ? { ...index.partialFilterExpression }
          : undefined,
    })),
    ...GRANOT_OBSERVATION_RECEIPT_LEGACY_INDEXES.map((index, position) => ({
      name: `legacy_${position}`,
      key: { ...index.key },
    })),
  ];
  const verified = verifyReceiptIndexDefinitions(actual);
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.missing, []);
  assert.deepEqual(verified.mismatched, []);

  const missingUnique = verifyReceiptIndexDefinitions(
    actual.filter(
      (index) =>
        index.name !== "granot_observation_receipt_channel_operation_id_unique",
    ),
  );
  assert.equal(missingUnique.ok, false);
  assert.deepEqual(missingUnique.missing, [
    "granot_observation_receipt_channel_operation_id_unique",
  ]);

  const mismatched = verifyReceiptIndexDefinitions(
    actual.map((index) =>
      index.name === "granot_observation_receipt_payload_sha256_diag"
        ? { ...index, unique: true }
        : index,
    ),
  );
  assert.equal(mismatched.ok, false);
  assert.deepEqual(mismatched.mismatched, [
    "granot_observation_receipt_payload_sha256_diag",
  ]);
});

test("[AC-05] Observation unique receipt_id collision report refuses unique creation", () => {
  const collisions = findObservationReceiptIdCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", receipt_id: "cccccccccccccccccccccccc" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", receipt_id: "cccccccccccccccccccccccc" },
    { _id: "dddddddddddddddddddddddd", receipt_id: "eeeeeeeeeeeeeeeeeeeeeeee" },
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.count, 2);
  assert.equal(collisions[0]?.receipt_id, "cccccccccccccccccccccccc");
  assert.equal(JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("[AC-05] Observation index apply creates non-unique indexes before unique receipt_id", () => {
  const ordered = orderedObservationIndexCreates();
  assert.equal(ordered.unique.length, 1);
  assert.equal(ordered.unique[0]?.name, "granot_observation_receipt_id_unique");
  assert.equal(ordered.nonUnique.length, 5);
  assert.ok(
    ordered.nonUnique.every((index) => index.name !== ordered.unique[0]?.name),
  );
  assert.equal(GRANOT_OBSERVATION_INDEXES.filter((index) => "unique" in index).length, 1);
});

test("[AC-05] Observation index verify matches the model contract names and definitions", () => {
  const actual = GRANOT_OBSERVATION_INDEXES.map((index) => ({
    name: index.name,
    key: { ...index.key },
    unique: "unique" in index ? true : undefined,
  }));
  const verified = verifyObservationIndexDefinitions(actual);
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.missing, []);
  assert.deepEqual(verified.mismatched, []);

  const missingUnique = verifyObservationIndexDefinitions(
    actual.filter((index) => index.name !== "granot_observation_receipt_id_unique"),
  );
  assert.equal(missingUnique.ok, false);
  assert.deepEqual(missingUnique.missing, ["granot_observation_receipt_id_unique"]);

  const mismatched = verifyObservationIndexDefinitions(
    actual.map((index) =>
      index.name === "granot_observation_kind_captured"
        ? { ...index, unique: true }
        : index,
    ),
  );
  assert.equal(mismatched.ok, false);
  assert.deepEqual(mismatched.mismatched, ["granot_observation_kind_captured"]);
});

test("[AC-38] normalized Granot label collision report masks ids and ignores empty labels", () => {
  const collisions = findNormalizedGranotLabelCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", normalized_granot_label: "bestrelocation forms" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", normalized_granot_label: "bestrelocation forms" },
    { _id: "cccccccccccccccccccccccc", normalized_granot_label: "referral" },
    { _id: "dddddddddddddddddddddddd" },
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.count, 2);
  assert.equal(collisions[0]?.normalized_granot_label, "bestrelocation forms");
  assert.equal(JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("[AC-38] unique normalized-label index is created only after a zero-collision report", () => {
  assert.equal(GRANOT_CRM_SOURCE_UNIQUE_INDEX_APPLY_ENABLED, true);
  const ordered = orderedGranotCrmSourceIndexCreates();
  assert.equal(ordered.unique.length, 1);
  assert.equal(ordered.unique[0]?.name, "granot_crm_source_normalized_label_unique");
  assert.ok(
    ordered.nonUnique.every(
      (index) => index.name !== "granot_crm_source_normalized_label_unique",
    ),
  );
  assert.equal(ordered.nonUnique.length, 2);
  const collisions = findNormalizedGranotLabelCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", normalized_granot_label: "referral" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", normalized_granot_label: "referral" },
  ]);
  assert.equal(collisions.length, 1);
});

test("[AC-38] source and automation index verify matches the model contract", () => {
  const sourceActual = GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES.map((index) => ({
    name: index.name,
    key: { ...index.key },
    unique: "unique" in index ? true : undefined,
  }));
  assert.equal(verifyGranotCrmSourceIndexDefinitions(sourceActual).ok, true);
  const automationActual = GRANOT_AUTOMATION_SOURCE_INDEXES.map((index) => ({
    name: index.name,
    key: { ...index.key },
  }));
  assert.equal(verifyGranotAutomationSourceIndexDefinitions(automationActual).ok, true);
  assert.equal(orderedGranotAutomationSourceIndexCreates().unique.length, 0);
  assert.ok(
    orderedGranotAutomationSourceIndexCreates().nonUnique.some(
      (index) => index.name === "granot_automation_source_crm_source_active",
    ),
  );
});

test("[AC-02] Decision unique observation/attempt collision report masks ids", () => {
  const collisions = findDecisionObservationAttemptCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", observation_id: "cccccccccccccccccccccccc", attempt: 1 },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", observation_id: "cccccccccccccccccccccccc", attempt: 1 },
    { _id: "dddddddddddddddddddddddd", observation_id: "cccccccccccccccccccccccc", attempt: 2 },
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.count, 2);
  assert.equal(JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("[AC-31] Activation unique key collision report masks ids", () => {
  const collisions = findActivationKeyCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", key: "granot_lifecycle" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", key: "granot_lifecycle" },
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.key, "granot_lifecycle");
  assert.equal(JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("[AC-32] active Record Link job collision report ignores superseded rows", () => {
  const collisions = findActiveRecordLinkJobCollisions([
    {
      _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      provider: "granot",
      normalized_job_no: "SYNTHETIC JOB 100",
      state: "active",
    },
    {
      _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
      provider: "granot",
      normalized_job_no: "SYNTHETIC JOB 100",
      state: "active",
    },
    {
      _id: "cccccccccccccccccccccccc",
      provider: "granot",
      normalized_job_no: "SYNTHETIC JOB 100",
      state: "superseded",
    },
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.count, 2);
  assert.equal(JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("[AC-02][AC-31][AC-32] Decision, activation, and Record Link indexes create non-unique first and verify names", () => {
  const decisions = orderedSynchronizationDecisionIndexCreates();
  assert.equal(decisions.unique.length, 1);
  assert.equal(
    decisions.unique[0]?.name,
    "synchronization_decision_observation_attempt_unique",
  );
  assert.equal(decisions.nonUnique.length, 3);
  assert.equal(
    verifySynchronizationDecisionIndexDefinitions(
      SYNCHRONIZATION_DECISION_INDEXES.map((index) => ({
        name: index.name,
        key: { ...index.key },
        unique: "unique" in index ? true : undefined,
      })),
    ).ok,
    true,
  );

  const activations = orderedGranotLifecycleActivationIndexCreates();
  assert.equal(activations.unique.length, 1);
  assert.equal(activations.nonUnique.length, 0);
  assert.equal(
    verifyGranotLifecycleActivationIndexDefinitions(
      GRANOT_LIFECYCLE_ACTIVATION_INDEXES.map((index) => ({
        name: index.name,
        key: { ...index.key },
        unique: true,
      })),
    ).ok,
    true,
  );

  const links = orderedGranotRecordLinkIndexCreates();
  assert.equal(links.unique.length, 1);
  assert.equal(links.unique[0]?.name, "granot_record_link_active_job_unique");
  assert.equal(links.nonUnique.length, 2);
  assert.equal(
    verifyGranotRecordLinkIndexDefinitions(
      GRANOT_RECORD_LINK_INDEXES.map((index) => ({
        name: index.name,
        key: { ...index.key },
        unique: "unique" in index ? true : undefined,
        partialFilterExpression:
          "partialFilterExpression" in index
            ? { ...index.partialFilterExpression }
            : undefined,
      })),
    ).ok,
    true,
  );
});

test("[AC-21] Booking normalized-Job collision report masks ids and fingerprints the key", () => {
  const collisions = findBookedLeadNormalizedJobCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", normalized_job_no: "SYNTHETIC JOB 100" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", normalized_job_no: "SYNTHETIC JOB 100" },
    { _id: "cccccccccccccccccccccccc", normalized_job_no: "SYNTHETIC JOB 200" },
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.count, 2);
  assert.equal(JSON.stringify(collisions).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
  assert.equal(JSON.stringify(collisions).includes("SYNTHETIC JOB 100"), false);
});

test("[AC-21] Booking unique index is created only after a zero-collision report", () => {
  const ordered = orderedBookedLeadIndexCreates();
  assert.equal(ordered.nonUnique.length, 0);
  assert.equal(ordered.unique.length, 1);
  assert.equal(ordered.unique[0]?.name, BOOKED_LEAD_NORMALIZED_JOB_INDEX.name);
  const collisions = findBookedLeadNormalizedJobCollisions([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", normalized_job_no: "SYNTHETIC JOB 100" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", normalized_job_no: "SYNTHETIC JOB 100" },
  ]);
  assert.equal(collisions.length, 1);
});

test("[AC-21] Booking index verify accepts the named contract or the default deployed name", () => {
  const named = verifyBookedLeadNormalizedJobIndexDefinitions([
    {
      name: BOOKED_LEAD_NORMALIZED_JOB_INDEX.name,
      key: { ...BOOKED_LEAD_NORMALIZED_JOB_INDEX.key },
      unique: true,
      partialFilterExpression: {
        ...BOOKED_LEAD_NORMALIZED_JOB_INDEX.partialFilterExpression,
      },
    },
  ]);
  assert.equal(named.ok, true);
  assert.equal(named.observed_name, BOOKED_LEAD_NORMALIZED_JOB_INDEX.name);

  const legacy = verifyBookedLeadNormalizedJobIndexDefinitions([
    {
      name: "normalized_job_no_1",
      key: { normalized_job_no: 1 },
      unique: true,
      partialFilterExpression: { normalized_job_no: { $type: "string" } },
    },
  ]);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.observed_name, "normalized_job_no_1");

  const missing = verifyBookedLeadNormalizedJobIndexDefinitions([]);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, [BOOKED_LEAD_NORMALIZED_JOB_INDEX.name]);
});

test("[AC-10][AC-11][AC-12] foundation/partial: seven exact non-unique Lead indexes and no global unique Lead Job index", () => {
  assert.equal(FORM_LEAD_S08_INDEXES.length, 4);
  assert.equal(CALL_LEAD_S08_INDEXES.length, 3);
  assert.equal(leadS08IndexesAreAllNonUnique(), true);
  const formOrdered = orderedFormLeadS08IndexCreates();
  const callOrdered = orderedCallLeadS08IndexCreates();
  assert.equal(formOrdered.unique.length, 0);
  assert.equal(callOrdered.unique.length, 0);
  assert.equal(formOrdered.nonUnique.length, 4);
  assert.equal(callOrdered.nonUnique.length, 3);
  assert.deepEqual(formOrdered.nonUnique[0]?.key, { normalized_job_no: 1 });
  assert.deepEqual(formOrdered.nonUnique[3]?.key, { ref_no: 1, duplicate: 1 });
  assert.deepEqual(callOrdered.nonUnique[2]?.key, {
    ingestion_origin: 1,
    source_granularity_id: 1,
    "ingested_contact_snapshot.normalized_phone_number": 1,
    createdAt: -1,
  });

  const formActual = FORM_LEAD_S08_INDEXES.map((index) => ({
    name: index.name,
    key: { ...index.key },
  }));
  const formVerified = verifyFormLeadS08IndexDefinitions(formActual);
  assert.equal(formVerified.ok, true);
  const formLegacy = verifyFormLeadS08IndexDefinitions([
    { name: "normalized_job_no_1", key: { normalized_job_no: 1 } },
    {
      name: "source_granularity_id_1_normalized_job_no_1",
      key: { source_granularity_id: 1, normalized_job_no: 1 },
    },
    {
      name: "source_granularity_id_1_normalized_phone_number_1_duplicate_1",
      key: {
        source_granularity_id: 1,
        normalized_phone_number: 1,
        duplicate: 1,
      },
    },
    { name: "ref_no_1_duplicate_1", key: { ref_no: 1, duplicate: 1 } },
  ]);
  assert.equal(formLegacy.ok, true);

  const missing = verifyFormLeadS08IndexDefinitions([]);
  assert.equal(missing.ok, false);
  assert.equal(missing.missing.length, 4);

  const uniqueJob = verifyFormLeadS08IndexDefinitions([
    ...formActual,
    { name: "normalized_job_no_unique", key: { normalized_job_no: 1 }, unique: true },
  ]);
  assert.equal(uniqueJob.ok, false);
  assert.equal(
    hasGlobalUniqueLeadJobIndex([
      { name: "normalized_job_no_unique", key: { normalized_job_no: 1 }, unique: true },
    ]),
    true,
  );

  const callActual = CALL_LEAD_S08_INDEXES.map((index) => ({
    name: index.name,
    key: { ...index.key },
  }));
  assert.equal(verifyCallLeadS08IndexDefinitions(callActual).ok, true);
  const callMissing = verifyCallLeadS08IndexDefinitions(callActual.slice(0, 2));
  assert.equal(callMissing.ok, false);
  assert.deepEqual(callMissing.missing, ["call_lead_origin_source_ingested_phone_created"]);
});

test("[AC-32] EntityChange indexes create non-unique first and verify the unique entity/revision key", () => {
  const ordered = orderedEntityChangeIndexCreates();
  assert.equal(ordered.unique.length, 1);
  assert.deepEqual(ordered.unique[0]?.key, {
    "entity.model": 1,
    "entity.id": 1,
    revision_after: 1,
  });
  assert.equal(ordered.nonUnique.length, 3);
  assert.equal(
    verifyEntityChangeIndexDefinitions(
      [...ordered.nonUnique, ...ordered.unique].map((index) => ({
        name: index.name,
        key: { ...index.key },
        unique: "unique" in index ? true : undefined,
      })),
    ).ok,
    true,
  );
});

test("[AC-17] Call Log sync state reporting finds duplicate and non-account rows", () => {
  const rows = [
    { _id: "aaaaaaaaaaaaaaaaaaaaaaa1", key: "account" },
    { _id: "aaaaaaaaaaaaaaaaaaaaaaa2", key: "account" },
    { _id: "aaaaaaaaaaaaaaaaaaaaaaa3", key: "legacy" },
    { _id: "aaaaaaaaaaaaaaaaaaaaaaa4" },
  ];
  const collisions = findCallLogSyncStateKeyCollisions(rows);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.key, "account");
  assert.equal(collisions[0]?.count, 2);
  assert.equal(collisions[0]?.masked_ids.length, 2);
  // Masked identifiers only — no raw row ids in the manifest.
  for (const masked of collisions[0]?.masked_ids ?? []) {
    assert.equal(rows.some((row) => row._id === masked), false);
  }

  const report = reportCallLogSyncStateRows(rows);
  assert.equal(report.total_row_count, 4);
  assert.equal(report.account_row_count, 2);
  assert.equal(report.non_account_row_count, 1);
  assert.equal(report.missing_key_row_count, 1);
  assert.equal(report.non_account_masked_ids.length, 1);
});

test("[AC-17] a clean singleton reports zero collisions", () => {
  const rows = [{ _id: "aaaaaaaaaaaaaaaaaaaaaaa1", key: "account" }];
  assert.deepEqual(findCallLogSyncStateKeyCollisions(rows), []);
  assert.equal(reportCallLogSyncStateRows(rows).account_row_count, 1);
});

test("[AC-17] the Call Log sync state key index is unique and verifiable", () => {
  const ordered = orderedCallLogSyncStateIndexCreates();
  assert.equal(ordered.nonUnique.length, 0);
  assert.equal(ordered.unique.length, 1);
  assert.deepEqual(ordered.unique[0], {
    name: "ringcentral_call_log_sync_state_key_unique",
    key: { key: 1 },
    unique: true,
  });

  assert.equal(
    verifyCallLogSyncStateIndexDefinitions([
      { name: "ringcentral_call_log_sync_state_key_unique", key: { key: 1 }, unique: true },
    ]).ok,
    true,
  );
  assert.deepEqual(verifyCallLogSyncStateIndexDefinitions([]).missing, [
    "ringcentral_call_log_sync_state_key_unique",
  ]);
  // A non-unique key index does not satisfy the singleton contract.
  assert.equal(
    verifyCallLogSyncStateIndexDefinitions([
      { name: "ringcentral_call_log_sync_state_key_unique", key: { key: 1 } },
    ]).ok,
    false,
  );
});
