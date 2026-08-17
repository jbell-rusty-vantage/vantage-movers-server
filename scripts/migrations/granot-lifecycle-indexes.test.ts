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
  GRANOT_CRM_SOURCE_UNIQUE_INDEX_APPLY_ENABLED,
  orderedGranotAutomationSourceIndexCreates,
  orderedGranotCrmSourceIndexCreates,
  orderedGranotLifecycleActivationIndexCreates,
  orderedGranotRecordLinkIndexCreates,
  orderedObservationIndexCreates,
  orderedReceiptIndexCreates,
  orderedSynchronizationDecisionIndexCreates,
  verifyGranotAutomationSourceIndexDefinitions,
  verifyGranotCrmSourceIndexDefinitions,
  verifyGranotLifecycleActivationIndexDefinitions,
  verifyGranotRecordLinkIndexDefinitions,
  verifyObservationIndexDefinitions,
  verifyReceiptIndexDefinitions,
  verifySynchronizationDecisionIndexDefinitions,
} from "./granot-lifecycle-indexes.lib";
import { SYNCHRONIZATION_DECISION_INDEXES } from "../../src/models/SynchronizationDecision";
import { GRANOT_LIFECYCLE_ACTIVATION_INDEXES } from "../../src/models/GranotLifecycleActivation";
import { GRANOT_RECORD_LINK_INDEXES } from "../../src/models/GranotRecordLink";
import { GRANOT_AUTOMATION_SOURCE_INDEXES } from "../../src/models/GranotAutomationSource";

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
