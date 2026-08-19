/**
 * 34.5 — Granot Observation Receipt and Observation index deployment.
 *
 * Dry-run / --report by default. Mutation requires
 * --apply --confirm-production=<database-name>.
 *
 *   pnpm migration:granot-lifecycle:indexes -- --report
 *   pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=testvantagemovers
 *   pnpm migration:granot-lifecycle:indexes -- --verify
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import {
  GRANOT_OBSERVATION_COLLECTION,
  GRANOT_OBSERVATION_INDEXES,
} from "../../src/models/GranotObservation.js";
import {
  GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  GRANOT_OBSERVATION_RECEIPT_INDEXES,
} from "../../src/models/GranotObservationReceipt.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  GRANOT_CRM_SOURCE_COLLECTION,
  GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES,
} from "../../src/models/GranotCrmSource.js";
import {
  GRANOT_AUTOMATION_SOURCE_COLLECTION,
  GRANOT_AUTOMATION_SOURCE_INDEXES,
} from "../../src/models/GranotAutomationSource.js";
import {
  INDEX_MIGRATION_SCRIPT_VERSION,
  findActivationKeyCollisions,
  findActiveRecordLinkJobCollisions,
  findChannelOperationIdCollisions,
  findDecisionObservationAttemptCollisions,
  findNormalizedGranotLabelCollisions,
  findObservationReceiptIdCollisions,
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
  BOOKED_LEAD_COLLECTION,
  CALL_LEAD_COLLECTION,
  FORM_LEAD_COLLECTION,
  findBookedLeadNormalizedJobCollisions,
  orderedBookedLeadIndexCreates,
  verifyBookedLeadNormalizedJobIndexDefinitions,
  findEntityChangeRevisionCollisions,
  orderedEntityChangeIndexCreates,
  verifyEntityChangeIndexDefinitions,
  leadS08IndexAlreadyPresent,
  orderedCallLeadS08IndexCreates,
  orderedFormLeadS08IndexCreates,
  verifyCallLeadS08IndexDefinitions,
  verifyFormLeadS08IndexDefinitions,
  findCallLogSyncStateKeyCollisions,
  orderedCallLogSyncStateIndexCreates,
  reportCallLogSyncStateRows,
  verifyCallLogSyncStateIndexDefinitions,
  type DeclaredMongoIndex,
  GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
  findGranotBookingCaseCollisions,
  orderedGranotBookingCaseIndexCreates,
  verifyGranotBookingCaseIndexDefinitions,
  GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION,
  findGranotReleaseCaseCollisions,
  orderedGranotReleaseCaseIndexCreates,
  verifyGranotReleaseCaseIndexDefinitions,
  GRANOT_BOOKING_DISCREPANCY_COLLECTION,
  GRANOT_RELEASE_DISCREPANCY_COLLECTION,
  findGranotDiscrepancyCollisions,
  orderedGranotBookingDiscrepancyIndexCreates,
  orderedGranotReleaseDiscrepancyIndexCreates,
  verifyGranotBookingDiscrepancyIndexDefinitions,
  verifyGranotReleaseDiscrepancyIndexDefinitions,
} from "./granot-lifecycle-indexes.lib.js";
import { GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES } from "../../src/models/GranotBookingReconciliationCase.js";
import { GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES } from "../../src/models/GranotReleaseReconciliationCase.js";
import { GRANOT_BOOKING_DISCREPANCY_INDEXES } from "../../src/models/GranotBookingDiscrepancy.js";
import { GRANOT_RELEASE_DISCREPANCY_INDEXES } from "../../src/models/GranotReleaseDiscrepancy.js";
import { getRingCentralCollectionName } from "../../src/services/ringcentral/ringcentral-config.js";
import { RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX } from "../../src/services/ringcentral/call-log-sync-state.store.js";
import { CALL_LEAD_S08_INDEXES } from "../../src/models/CallLead.js";
import { FORM_LEAD_S08_INDEXES } from "../../src/models/FormLead.js";
import {
  ENTITY_CHANGE_COLLECTION,
  ENTITY_CHANGE_INDEXES,
} from "../../src/models/EntityChange.js";
import { BOOKED_LEAD_NORMALIZED_JOB_INDEX } from "../../src/models/BookedLead.js";
import {
  SYNCHRONIZATION_DECISION_COLLECTION,
  SYNCHRONIZATION_DECISION_INDEXES,
} from "../../src/models/SynchronizationDecision.js";
import {
  GRANOT_LIFECYCLE_ACTIVATION_COLLECTION,
  GRANOT_LIFECYCLE_ACTIVATION_INDEXES,
} from "../../src/models/GranotLifecycleActivation.js";
import {
  GRANOT_RECORD_LINK_COLLECTION,
  GRANOT_RECORD_LINK_INDEXES,
} from "../../src/models/GranotRecordLink.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-indexes");

async function loadOperationIdRows(): Promise<
  Array<{
    _id: string;
    observation_channel?: unknown;
    channel_operation_id?: unknown;
  }>
> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
  if (!collection) {
    throw new Error("Cannot load receipts: Mongo collection is unavailable.");
  }
  const documents = await collection
    .find(
      {},
      { projection: { observation_channel: 1, channel_operation_id: 1 } },
    )
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    observation_channel: document.observation_channel,
    channel_operation_id: document.channel_operation_id,
  }));
}

async function listDeclaredIndexes(collectionName: string): Promise<DeclaredMongoIndex[]> {
  const collection = mongoose.connection.db?.collection(collectionName);
  if (!collection) {
    throw new Error("Cannot list indexes: Mongo collection is unavailable.");
  }
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if (isNamespaceNotFound(error)) return [];
    throw error;
  }
  return indexes.map((index) => ({
    name: String(index.name),
    key: index.key as Record<string, unknown>,
    unique: index.unique === true ? true : undefined,
    partialFilterExpression: index.partialFilterExpression as
      | Record<string, unknown>
      | undefined,
  }));
}

function isNamespaceNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 26,
  );
}

async function createIndexes(
  collectionName: string,
  specs: readonly {
    name: string;
    key: Record<string, number>;
    unique?: true;
    partialFilterExpression?: Record<string, unknown>;
    accepted_names?: readonly string[];
  }[],
): Promise<string[]> {
  const collection = mongoose.connection.db?.collection(collectionName);
  if (!collection) {
    throw new Error("Cannot create indexes: Mongo collection is unavailable.");
  }
  const created: string[] = [];
  for (const spec of specs) {
    await collection.createIndex(spec.key, {
      name: spec.name,
      ...("unique" in spec ? { unique: true } : {}),
      ...("partialFilterExpression" in spec
        ? { partialFilterExpression: spec.partialFilterExpression }
        : {}),
    });
    created.push(spec.name);
  }
  return created;
}

async function loadObservationReceiptIdRows(): Promise<
  Array<{ _id: string; receipt_id?: unknown }>
> {
  const collection = mongoose.connection.db?.collection(GRANOT_OBSERVATION_COLLECTION);
  if (!collection) {
    throw new Error("Cannot load observations: Mongo collection is unavailable.");
  }
  const documents = await collection
    .find({}, { projection: { receipt_id: 1 } })
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    receipt_id: document.receipt_id,
  }));
}

async function loadNormalizedGranotLabelRows(): Promise<
  Array<{ _id: string; normalized_granot_label?: unknown }>
> {
  const collection = mongoose.connection.db?.collection(GRANOT_CRM_SOURCE_COLLECTION);
  if (!collection) {
    throw new Error("Cannot load Granot CRM sources: Mongo collection is unavailable.");
  }
  const documents = await collection
    .find({}, { projection: { normalized_granot_label: 1 } })
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    normalized_granot_label: document.normalized_granot_label,
  }));
}

async function loadDecisionObservationAttemptRows(): Promise<
  Array<{ _id: string; observation_id?: unknown; attempt?: unknown }>
> {
  const collection = mongoose.connection.db?.collection(SYNCHRONIZATION_DECISION_COLLECTION);
  if (!collection) {
    return [];
  }
  const documents = await collection
    .find({}, { projection: { observation_id: 1, attempt: 1 } })
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    observation_id: document.observation_id,
    attempt: document.attempt,
  }));
}

async function loadActivationKeyRows(): Promise<Array<{ _id: string; key?: unknown }>> {
  const collection = mongoose.connection.db?.collection(GRANOT_LIFECYCLE_ACTIVATION_COLLECTION);
  if (!collection) {
    return [];
  }
  const documents = await collection.find({}, { projection: { key: 1 } }).toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    key: document.key,
  }));
}

async function loadActiveRecordLinkRows(): Promise<
  Array<{
    _id: string;
    provider?: unknown;
    normalized_job_no?: unknown;
    state?: unknown;
  }>
> {
  const collection = mongoose.connection.db?.collection(GRANOT_RECORD_LINK_COLLECTION);
  if (!collection) {
    return [];
  }
  const documents = await collection
    .find({}, { projection: { provider: 1, normalized_job_no: 1, state: 1 } })
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    provider: document.provider,
    normalized_job_no: document.normalized_job_no,
    state: document.state,
  }));
}

async function loadEntityChangeRevisionRows(): Promise<
  Array<{
    _id: string;
    entity_model?: unknown;
    entity_id?: unknown;
    revision_after?: unknown;
  }>
> {
  const collection = mongoose.connection.db?.collection(ENTITY_CHANGE_COLLECTION);
  if (!collection) {
    return [];
  }
  const documents = await collection
    .find({}, { projection: { entity: 1, revision_after: 1 } })
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    entity_model: (document as { entity?: { model?: unknown } }).entity?.model,
    entity_id: (document as { entity?: { id?: unknown } }).entity?.id,
    revision_after: (document as { revision_after?: unknown }).revision_after,
  }));
}

async function loadBookedLeadNormalizedJobRows(): Promise<
  Array<{ _id: string; normalized_job_no?: unknown }>
> {
  const collection = mongoose.connection.db?.collection(BOOKED_LEAD_COLLECTION);
  if (!collection) {
    return [];
  }
  const documents = await collection
    .find({}, { projection: { normalized_job_no: 1 } })
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    normalized_job_no: document.normalized_job_no,
  }));
}

async function loadGranotBookingCaseRows(): Promise<
  Array<{
    _id: string;
    normalized_job_no?: unknown;
    action_kind?: unknown;
    sequence_number?: unknown;
    state?: unknown;
  }>
> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
  );
  if (!collection) return [];
  const documents = await collection
    .find({}, { projection: { normalized_job_no: 1, action_kind: 1, sequence_number: 1, state: 1 } })
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    normalized_job_no: document.normalized_job_no,
    action_kind: document.action_kind,
    sequence_number: document.sequence_number,
    state: document.state,
  }));
}

async function loadGranotReleaseCaseRows(): Promise<
  Array<{
    _id: string;
    normalized_job_no?: unknown;
    action_kind?: unknown;
    sequence_number?: unknown;
    state?: unknown;
  }>
> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION,
  );
  if (!collection) return [];
  const documents = await collection
    .find({}, { projection: { normalized_job_no: 1, action_kind: 1, sequence_number: 1, state: 1 } })
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    normalized_job_no: document.normalized_job_no,
    action_kind: document.action_kind,
    sequence_number: document.sequence_number,
    state: document.state,
  }));
}

async function loadGranotDiscrepancyRows(collectionName: string): Promise<
  Array<{
    _id: string;
    normalized_job_no?: unknown;
    discrepancy_kind?: unknown;
    reason_fingerprint?: unknown;
    state?: unknown;
  }>
> {
  const collection = mongoose.connection.db?.collection(collectionName);
  if (!collection) return [];
  const documents = await collection.find({}, {
    projection: { normalized_job_no: 1, discrepancy_kind: 1, reason_fingerprint: 1, state: 1 },
  }).toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    normalized_job_no: document.normalized_job_no,
    discrepancy_kind: document.discrepancy_kind,
    reason_fingerprint: document.reason_fingerprint,
    state: document.state,
  }));
}

/**
 * Unit 21 — the RingCentral Call Log sync-state singleton. The collection name
 * follows `RINGCENTRAL_COLLECTION_MODE`, so a test-mode run reports and
 * verifies the `_test` collection and never the production one.
 */
function callLogSyncStateCollectionName(): string {
  return getRingCentralCollectionName("callLogSyncState");
}

async function loadCallLogSyncStateRows(): Promise<
  Array<{ _id: string; key?: unknown }>
> {
  const collection = mongoose.connection.db?.collection(
    callLogSyncStateCollectionName(),
  );
  if (!collection) {
    return [];
  }
  const documents = await collection.find({}, { projection: { key: 1 } }).toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    key: document.key,
  }));
}

async function main(): Promise<void> {
  const mode = parseGranotLifecycleMigrationMode(process.argv);
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertGranotLifecycleDatabaseAllowed(databaseName);
  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName,
    });
  }

  const rows = await loadOperationIdRows();
  const collisions = findChannelOperationIdCollisions(rows);
  const observationRows = await loadObservationReceiptIdRows();
  const observationCollisions = findObservationReceiptIdCollisions(observationRows);
  const sourceRows = await loadNormalizedGranotLabelRows();
  const normalizedLabelCollisions = findNormalizedGranotLabelCollisions(sourceRows);
  const decisionRows = await loadDecisionObservationAttemptRows();
  const decisionCollisions = findDecisionObservationAttemptCollisions(decisionRows);
  const activationRows = await loadActivationKeyRows();
  const activationCollisions = findActivationKeyCollisions(activationRows);
  const recordLinkRows = await loadActiveRecordLinkRows();
  const recordLinkCollisions = findActiveRecordLinkJobCollisions(recordLinkRows);
  const ordered = orderedReceiptIndexCreates();
  const observationOrdered = orderedObservationIndexCreates();
  const sourceOrdered = orderedGranotCrmSourceIndexCreates();
  const automationOrdered = orderedGranotAutomationSourceIndexCreates();
  const decisionOrdered = orderedSynchronizationDecisionIndexCreates();
  const activationOrdered = orderedGranotLifecycleActivationIndexCreates();
  const recordLinkOrdered = orderedGranotRecordLinkIndexCreates();
  const bookedLeadRows = await loadBookedLeadNormalizedJobRows();
  const bookedLeadCollisions = findBookedLeadNormalizedJobCollisions(bookedLeadRows);
  const bookedLeadOrdered = orderedBookedLeadIndexCreates();
  const bookingCaseRows = await loadGranotBookingCaseRows();
  const bookingCaseCollisions = findGranotBookingCaseCollisions(bookingCaseRows);
  const bookingCaseOrdered = orderedGranotBookingCaseIndexCreates();
  const releaseCaseRows = await loadGranotReleaseCaseRows();
  const releaseCaseCollisions = findGranotReleaseCaseCollisions(releaseCaseRows);
  const releaseCaseOrdered = orderedGranotReleaseCaseIndexCreates();
  const bookingDiscrepancyCollisions = findGranotDiscrepancyCollisions(
    await loadGranotDiscrepancyRows(GRANOT_BOOKING_DISCREPANCY_COLLECTION),
  );
  const releaseDiscrepancyCollisions = findGranotDiscrepancyCollisions(
    await loadGranotDiscrepancyRows(GRANOT_RELEASE_DISCREPANCY_COLLECTION),
  );
  const bookingDiscrepancyOrdered = orderedGranotBookingDiscrepancyIndexCreates();
  const releaseDiscrepancyOrdered = orderedGranotReleaseDiscrepancyIndexCreates();
  const entityChangeRows = await loadEntityChangeRevisionRows();
  const entityChangeCollisions = findEntityChangeRevisionCollisions(entityChangeRows);
  const entityChangeOrdered = orderedEntityChangeIndexCreates();
  const formLeadOrdered = orderedFormLeadS08IndexCreates();
  const callLeadOrdered = orderedCallLeadS08IndexCreates();
  const callLogSyncStateRows = await loadCallLogSyncStateRows();
  const callLogSyncStateCollisions =
    findCallLogSyncStateKeyCollisions(callLogSyncStateRows);
  const callLogSyncStateReport = reportCallLogSyncStateRows(callLogSyncStateRows);
  const callLogSyncStateOrdered = orderedCallLogSyncStateIndexCreates();
  let created: string[] = [];
  let verify: ReturnType<typeof verifyReceiptIndexDefinitions> | undefined;
  let observationVerify: ReturnType<typeof verifyObservationIndexDefinitions> | undefined;
  let sourceVerify: ReturnType<typeof verifyGranotCrmSourceIndexDefinitions> | undefined;
  let automationVerify: ReturnType<typeof verifyGranotAutomationSourceIndexDefinitions> | undefined;
  let decisionVerify: ReturnType<typeof verifySynchronizationDecisionIndexDefinitions> | undefined;
  let activationVerify: ReturnType<typeof verifyGranotLifecycleActivationIndexDefinitions> | undefined;
  let recordLinkVerify: ReturnType<typeof verifyGranotRecordLinkIndexDefinitions> | undefined;
  let bookedLeadVerify: ReturnType<typeof verifyBookedLeadNormalizedJobIndexDefinitions> | undefined;
  let bookingCaseVerify: ReturnType<typeof verifyGranotBookingCaseIndexDefinitions> | undefined;
  let releaseCaseVerify: ReturnType<typeof verifyGranotReleaseCaseIndexDefinitions> | undefined;
  let bookingDiscrepancyVerify: ReturnType<typeof verifyGranotBookingDiscrepancyIndexDefinitions> | undefined;
  let releaseDiscrepancyVerify: ReturnType<typeof verifyGranotReleaseDiscrepancyIndexDefinitions> | undefined;
  let entityChangeVerify: ReturnType<typeof verifyEntityChangeIndexDefinitions> | undefined;
  let formLeadVerify: ReturnType<typeof verifyFormLeadS08IndexDefinitions> | undefined;
  let callLeadVerify: ReturnType<typeof verifyCallLeadS08IndexDefinitions> | undefined;
  let callLogSyncStateVerify:
    | ReturnType<typeof verifyCallLogSyncStateIndexDefinitions>
    | undefined;

  if (mode === "apply") {
    created = await createIndexes(GRANOT_OBSERVATION_RECEIPT_COLLECTION, ordered.nonUnique);
    created = [
      ...created,
      ...(await createIndexes(GRANOT_OBSERVATION_COLLECTION, observationOrdered.nonUnique)),
      ...(await createIndexes(GRANOT_CRM_SOURCE_COLLECTION, sourceOrdered.nonUnique)),
      ...(await createIndexes(GRANOT_AUTOMATION_SOURCE_COLLECTION, automationOrdered.nonUnique)),
      ...(await createIndexes(SYNCHRONIZATION_DECISION_COLLECTION, decisionOrdered.nonUnique)),
      ...(await createIndexes(GRANOT_LIFECYCLE_ACTIVATION_COLLECTION, activationOrdered.nonUnique)),
      ...(await createIndexes(GRANOT_RECORD_LINK_COLLECTION, recordLinkOrdered.nonUnique)),
      ...(await createIndexes(ENTITY_CHANGE_COLLECTION, entityChangeOrdered.nonUnique)),
      ...(await createIndexes(
        GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
        bookingCaseOrdered.nonUnique,
      )),
      ...(await createIndexes(
        GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION,
        releaseCaseOrdered.nonUnique,
      )),
      ...(await createIndexes(GRANOT_BOOKING_DISCREPANCY_COLLECTION, bookingDiscrepancyOrdered.nonUnique)),
      ...(await createIndexes(GRANOT_RELEASE_DISCREPANCY_COLLECTION, releaseDiscrepancyOrdered.nonUnique)),
    ];
    if (collisions.length > 0 || observationCollisions.length > 0) {
      const manifest = buildManifest({
        databaseName,
        mode,
        collisions,
        observationCollisions,
        normalizedLabelCollisions,
        created,
        uniqueCreated: [],
        verify,
        observationVerify,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique index create: ${collisions.length + observationCollisions.length} collision group(s).`,
      );
    }
    if (
      decisionCollisions.length > 0 ||
      activationCollisions.length > 0 ||
      recordLinkCollisions.length > 0 ||
      entityChangeCollisions.length > 0
    ) {
      const manifest = buildManifest({
        databaseName,
        mode,
        collisions,
        observationCollisions,
        normalizedLabelCollisions,
        decisionCollisions,
        activationCollisions,
        recordLinkCollisions,
        created,
        uniqueCreated: [],
        verify,
        observationVerify,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique Decision/activation/Record Link index create: ${
          decisionCollisions.length + activationCollisions.length + recordLinkCollisions.length
        } collision group(s).`,
      );
    }
    if (normalizedLabelCollisions.length > 0) {
      const manifest = buildManifest({
        databaseName,
        mode,
        collisions,
        observationCollisions,
        normalizedLabelCollisions,
        created,
        uniqueCreated: [],
        verify,
        observationVerify,
        sourceVerify,
        automationVerify,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique normalized-label index create: ${normalizedLabelCollisions.length} collision group(s).`,
      );
    }
    created = [
      ...created,
      ...(await createIndexes(GRANOT_OBSERVATION_RECEIPT_COLLECTION, ordered.unique)),
      ...(await createIndexes(GRANOT_OBSERVATION_COLLECTION, observationOrdered.unique)),
      ...(await createIndexes(GRANOT_CRM_SOURCE_COLLECTION, sourceOrdered.unique)),
      ...(await createIndexes(SYNCHRONIZATION_DECISION_COLLECTION, decisionOrdered.unique)),
      ...(await createIndexes(GRANOT_LIFECYCLE_ACTIVATION_COLLECTION, activationOrdered.unique)),
      ...(await createIndexes(GRANOT_RECORD_LINK_COLLECTION, recordLinkOrdered.unique)),
      ...(entityChangeCollisions.length === 0
        ? await createIndexes(ENTITY_CHANGE_COLLECTION, entityChangeOrdered.unique)
        : []),
    ];
    if (bookedLeadCollisions.length > 0) {
      const manifest = buildManifest({
        databaseName,
        mode,
        collisions,
        observationCollisions,
        normalizedLabelCollisions,
        created,
        uniqueCreated: [],
        verify,
        observationVerify,
        bookedLeadCollisions,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique Booking normalized-Job index create: ${bookedLeadCollisions.length} collision group(s).`,
      );
    }
    if (
      bookingCaseCollisions.open.length > 0 ||
      bookingCaseCollisions.sequence.length > 0
    ) {
      const manifest = buildManifest({
        databaseName,
        mode,
        collisions,
        observationCollisions,
        normalizedLabelCollisions,
        created,
        uniqueCreated: [],
        bookingCaseCollisions,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique Granot Booking-case index create: ${
          bookingCaseCollisions.open.length + bookingCaseCollisions.sequence.length
        } collision group(s).`,
      );
    }
    if (
      releaseCaseCollisions.open.length > 0 ||
      releaseCaseCollisions.sequence.length > 0
    ) {
      const manifest = buildManifest({
        databaseName,
        mode,
        collisions,
        observationCollisions,
        normalizedLabelCollisions,
        created,
        uniqueCreated: [],
        bookingCaseCollisions,
        releaseCaseCollisions,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique Granot Release-case index create: ${
          releaseCaseCollisions.open.length + releaseCaseCollisions.sequence.length
        } collision group(s).`,
      );
    }
    if (bookingDiscrepancyCollisions.length > 0 || releaseDiscrepancyCollisions.length > 0) {
      const manifest = buildManifest({
        databaseName, mode, collisions, observationCollisions, normalizedLabelCollisions,
        created, uniqueCreated: [], bookingDiscrepancyCollisions, releaseDiscrepancyCollisions,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique Granot discrepancy index create: ${bookingDiscrepancyCollisions.length + releaseDiscrepancyCollisions.length} collision group(s).`,
      );
    }
    created = [
      ...created,
      ...(await createIndexes(
        GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
        bookingCaseOrdered.unique,
      )),
      ...(await createIndexes(
        GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION,
        releaseCaseOrdered.unique,
      )),
      ...(await createIndexes(GRANOT_BOOKING_DISCREPANCY_COLLECTION, bookingDiscrepancyOrdered.unique)),
      ...(await createIndexes(GRANOT_RELEASE_DISCREPANCY_COLLECTION, releaseDiscrepancyOrdered.unique)),
    ];
    const existingBookedLeadIndexes = await listDeclaredIndexes(BOOKED_LEAD_COLLECTION);
    const bookedLeadAlreadyPresent = verifyBookedLeadNormalizedJobIndexDefinitions(
      existingBookedLeadIndexes,
    ).ok;
    if (!bookedLeadAlreadyPresent) {
      created = [
        ...created,
        ...(await createIndexes(BOOKED_LEAD_COLLECTION, bookedLeadOrdered.unique)),
      ];
    }
    const existingFormLeadIndexes = await listDeclaredIndexes(FORM_LEAD_COLLECTION);
    const missingFormLead = formLeadOrdered.nonUnique.filter(
      (index) => !leadS08IndexAlreadyPresent(existingFormLeadIndexes, index),
    );
    created = [
      ...created,
      ...(await createIndexes(FORM_LEAD_COLLECTION, missingFormLead)),
    ];
    const existingCallLeadIndexes = await listDeclaredIndexes(CALL_LEAD_COLLECTION);
    const missingCallLead = callLeadOrdered.nonUnique.filter(
      (index) => !leadS08IndexAlreadyPresent(existingCallLeadIndexes, index),
    );
    created = [
      ...created,
      ...(await createIndexes(CALL_LEAD_COLLECTION, missingCallLead)),
    ];

    // Unit 21 singleton key. Stop and report rather than choosing, merging, or
    // deleting a state row automatically.
    if (callLogSyncStateCollisions.length > 0) {
      const manifest = buildManifest({
        databaseName,
        mode,
        collisions,
        observationCollisions,
        normalizedLabelCollisions,
        created,
        uniqueCreated: [],
        verify,
        observationVerify,
        callLogSyncStateCollisions,
        callLogSyncStateReport,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique Call Log sync state key index create: ${callLogSyncStateCollisions.length} collision group(s).`,
      );
    }
    created = [
      ...created,
      ...(await createIndexes(
        callLogSyncStateCollectionName(),
        callLogSyncStateOrdered.unique,
      )),
    ];
  }

  if (mode === "verify") {
    verify = verifyReceiptIndexDefinitions(
      await listDeclaredIndexes(GRANOT_OBSERVATION_RECEIPT_COLLECTION),
    );
    observationVerify = verifyObservationIndexDefinitions(
      await listDeclaredIndexes(GRANOT_OBSERVATION_COLLECTION),
    );
    sourceVerify = verifyGranotCrmSourceIndexDefinitions(
      await listDeclaredIndexes(GRANOT_CRM_SOURCE_COLLECTION),
    );
    automationVerify = verifyGranotAutomationSourceIndexDefinitions(
      await listDeclaredIndexes(GRANOT_AUTOMATION_SOURCE_COLLECTION),
    );
    decisionVerify = verifySynchronizationDecisionIndexDefinitions(
      await listDeclaredIndexes(SYNCHRONIZATION_DECISION_COLLECTION),
    );
    activationVerify = verifyGranotLifecycleActivationIndexDefinitions(
      await listDeclaredIndexes(GRANOT_LIFECYCLE_ACTIVATION_COLLECTION),
    );
    recordLinkVerify = verifyGranotRecordLinkIndexDefinitions(
      await listDeclaredIndexes(GRANOT_RECORD_LINK_COLLECTION),
    );
    bookedLeadVerify = verifyBookedLeadNormalizedJobIndexDefinitions(
      await listDeclaredIndexes(BOOKED_LEAD_COLLECTION),
    );
    bookingCaseVerify = verifyGranotBookingCaseIndexDefinitions(
      await listDeclaredIndexes(GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION),
    );
    releaseCaseVerify = verifyGranotReleaseCaseIndexDefinitions(
      await listDeclaredIndexes(GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION),
    );
    bookingDiscrepancyVerify = verifyGranotBookingDiscrepancyIndexDefinitions(
      await listDeclaredIndexes(GRANOT_BOOKING_DISCREPANCY_COLLECTION),
    );
    releaseDiscrepancyVerify = verifyGranotReleaseDiscrepancyIndexDefinitions(
      await listDeclaredIndexes(GRANOT_RELEASE_DISCREPANCY_COLLECTION),
    );
    entityChangeVerify = verifyEntityChangeIndexDefinitions(
      await listDeclaredIndexes(ENTITY_CHANGE_COLLECTION),
    );
    formLeadVerify = verifyFormLeadS08IndexDefinitions(
      await listDeclaredIndexes(FORM_LEAD_COLLECTION),
    );
    callLeadVerify = verifyCallLeadS08IndexDefinitions(
      await listDeclaredIndexes(CALL_LEAD_COLLECTION),
    );
    callLogSyncStateVerify = verifyCallLogSyncStateIndexDefinitions(
      await listDeclaredIndexes(callLogSyncStateCollectionName()),
    );
  }

  const uniqueCreated =
    mode === "apply" &&
    collisions.length === 0 &&
    observationCollisions.length === 0 &&
    normalizedLabelCollisions.length === 0 &&
    decisionCollisions.length === 0 &&
    activationCollisions.length === 0 &&
    recordLinkCollisions.length === 0 &&
    bookedLeadCollisions.length === 0 &&
    entityChangeCollisions.length === 0 &&
    callLogSyncStateCollisions.length === 0 &&
    bookingCaseCollisions.open.length === 0 &&
    bookingCaseCollisions.sequence.length === 0 &&
    releaseCaseCollisions.open.length === 0 &&
    releaseCaseCollisions.sequence.length === 0
    && bookingDiscrepancyCollisions.length === 0
    && releaseDiscrepancyCollisions.length === 0
      ? [
          ...ordered.unique.map((index) => index.name),
          ...observationOrdered.unique.map((index) => index.name),
          ...sourceOrdered.unique.map((index) => index.name),
          ...decisionOrdered.unique.map((index) => index.name),
          ...activationOrdered.unique.map((index) => index.name),
          ...recordLinkOrdered.unique.map((index) => index.name),
          ...bookedLeadOrdered.unique.map((index) => index.name),
          ...entityChangeOrdered.unique.map((index) => index.name),
          ...callLogSyncStateOrdered.unique.map((index) => index.name),
          ...bookingCaseOrdered.unique.map((index) => index.name),
          ...releaseCaseOrdered.unique.map((index) => index.name),
          ...bookingDiscrepancyOrdered.unique.map((index) => index.name),
          ...releaseDiscrepancyOrdered.unique.map((index) => index.name),
        ]
      : [];

  const manifest = buildManifest({
    databaseName,
    mode,
    collisions,
    observationCollisions,
    normalizedLabelCollisions,
    decisionCollisions,
    activationCollisions,
    recordLinkCollisions,
    created,
    uniqueCreated,
    verify,
    observationVerify,
    sourceVerify,
    automationVerify,
    decisionVerify,
    activationVerify,
    recordLinkVerify,
    bookedLeadCollisions,
    bookedLeadVerify,
    bookingCaseCollisions,
    bookingCaseVerify,
    releaseCaseCollisions,
    releaseCaseVerify,
    bookingDiscrepancyCollisions,
    releaseDiscrepancyCollisions,
    bookingDiscrepancyVerify,
    releaseDiscrepancyVerify,
    entityChangeCollisions,
    entityChangeVerify,
    formLeadVerify,
    callLeadVerify,
    callLogSyncStateCollisions,
    callLogSyncStateReport,
    callLogSyncStateVerify,
  });
  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
    manifest,
  });

  if (mode === "verify") {
    const failed = [
      verify,
      observationVerify,
      sourceVerify,
      automationVerify,
      decisionVerify,
      activationVerify,
      recordLinkVerify,
      bookedLeadVerify,
      bookingCaseVerify,
      releaseCaseVerify,
      bookingDiscrepancyVerify,
      releaseDiscrepancyVerify,
      entityChangeVerify,
      formLeadVerify,
      callLeadVerify,
      callLogSyncStateVerify,
    ].filter((result) => result && !result.ok);
    if (failed.length > 0) {
      const missing = failed.flatMap((result) => result?.missing ?? []);
      const mismatched = failed.flatMap((result) => result?.mismatched ?? []);
      throw new Error(
        `Index verify failed: missing ${missing.join(", ") || "none"}; mismatched ${mismatched.join(", ") || "none"}.`,
      );
    }
  }
}

function buildManifest(input: {
  databaseName: string;
  mode: string;
  collisions: ReturnType<typeof findChannelOperationIdCollisions>;
  observationCollisions: ReturnType<typeof findObservationReceiptIdCollisions>;
  normalizedLabelCollisions: ReturnType<typeof findNormalizedGranotLabelCollisions>;
  decisionCollisions?: ReturnType<typeof findDecisionObservationAttemptCollisions>;
  activationCollisions?: ReturnType<typeof findActivationKeyCollisions>;
  recordLinkCollisions?: ReturnType<typeof findActiveRecordLinkJobCollisions>;
  bookedLeadCollisions?: ReturnType<typeof findBookedLeadNormalizedJobCollisions>;
  bookingCaseCollisions?: ReturnType<typeof findGranotBookingCaseCollisions>;
  releaseCaseCollisions?: ReturnType<typeof findGranotReleaseCaseCollisions>;
  bookingDiscrepancyCollisions?: ReturnType<typeof findGranotDiscrepancyCollisions>;
  releaseDiscrepancyCollisions?: ReturnType<typeof findGranotDiscrepancyCollisions>;
  created: string[];
  uniqueCreated: string[];
  verify?: ReturnType<typeof verifyReceiptIndexDefinitions>;
  observationVerify?: ReturnType<typeof verifyObservationIndexDefinitions>;
  sourceVerify?: ReturnType<typeof verifyGranotCrmSourceIndexDefinitions>;
  automationVerify?: ReturnType<typeof verifyGranotAutomationSourceIndexDefinitions>;
  decisionVerify?: ReturnType<typeof verifySynchronizationDecisionIndexDefinitions>;
  activationVerify?: ReturnType<typeof verifyGranotLifecycleActivationIndexDefinitions>;
  recordLinkVerify?: ReturnType<typeof verifyGranotRecordLinkIndexDefinitions>;
  bookedLeadVerify?: ReturnType<typeof verifyBookedLeadNormalizedJobIndexDefinitions>;
  bookingCaseVerify?: ReturnType<typeof verifyGranotBookingCaseIndexDefinitions>;
  releaseCaseVerify?: ReturnType<typeof verifyGranotReleaseCaseIndexDefinitions>;
  bookingDiscrepancyVerify?: ReturnType<typeof verifyGranotBookingDiscrepancyIndexDefinitions>;
  releaseDiscrepancyVerify?: ReturnType<typeof verifyGranotReleaseDiscrepancyIndexDefinitions>;
  entityChangeCollisions?: ReturnType<typeof findEntityChangeRevisionCollisions>;
  entityChangeVerify?: ReturnType<typeof verifyEntityChangeIndexDefinitions>;
  formLeadVerify?: ReturnType<typeof verifyFormLeadS08IndexDefinitions>;
  callLeadVerify?: ReturnType<typeof verifyCallLeadS08IndexDefinitions>;
  callLogSyncStateCollisions?: ReturnType<typeof findCallLogSyncStateKeyCollisions>;
  callLogSyncStateReport?: ReturnType<typeof reportCallLogSyncStateRows>;
  callLogSyncStateVerify?: ReturnType<typeof verifyCallLogSyncStateIndexDefinitions>;
}) {
  return {
    script_version: INDEX_MIGRATION_SCRIPT_VERSION,
    database_name: input.databaseName,
    mode: input.mode,
    contract_index_names: [
      ...GRANOT_OBSERVATION_RECEIPT_INDEXES.map((index) => index.name),
      ...GRANOT_OBSERVATION_INDEXES.map((index) => index.name),
      ...GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES.map((index) => index.name),
      ...GRANOT_AUTOMATION_SOURCE_INDEXES.map((index) => index.name),
      ...SYNCHRONIZATION_DECISION_INDEXES.map((index) => index.name),
      ...GRANOT_LIFECYCLE_ACTIVATION_INDEXES.map((index) => index.name),
      ...GRANOT_RECORD_LINK_INDEXES.map((index) => index.name),
      BOOKED_LEAD_NORMALIZED_JOB_INDEX.name,
      ...ENTITY_CHANGE_INDEXES.map((index) => index.name),
      ...FORM_LEAD_S08_INDEXES.map((index) => index.name),
      ...CALL_LEAD_S08_INDEXES.map((index) => index.name),
      RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX.name,
      ...GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES.map((index) => index.name),
      ...GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES.map((index) => index.name),
      ...GRANOT_BOOKING_DISCREPANCY_INDEXES.map((index) => index.name),
      ...GRANOT_RELEASE_DISCREPANCY_INDEXES.map((index) => index.name),
    ],
    collision_count:
      input.collisions.length +
      input.observationCollisions.length +
      input.normalizedLabelCollisions.length +
      (input.decisionCollisions?.length ?? 0) +
      (input.activationCollisions?.length ?? 0) +
      (input.recordLinkCollisions?.length ?? 0) +
      (input.bookedLeadCollisions?.length ?? 0) +
      (input.entityChangeCollisions?.length ?? 0) +
      (input.callLogSyncStateCollisions?.length ?? 0) +
      (input.bookingCaseCollisions?.open.length ?? 0) +
      (input.bookingCaseCollisions?.sequence.length ?? 0) +
      (input.releaseCaseCollisions?.open.length ?? 0) +
      (input.releaseCaseCollisions?.sequence.length ?? 0) +
      (input.bookingDiscrepancyCollisions?.length ?? 0) +
      (input.releaseDiscrepancyCollisions?.length ?? 0),
    collisions: input.collisions,
    observation_receipt_id_collisions: input.observationCollisions,
    normalized_granot_label_collisions: input.normalizedLabelCollisions,
    decision_observation_attempt_collisions: input.decisionCollisions ?? [],
    activation_key_collisions: input.activationCollisions ?? [],
    active_record_link_job_collisions: input.recordLinkCollisions ?? [],
    granot_crm_source_unique_index_apply_enabled: true,
    created_index_names: input.created,
    unique_index_names_created: input.uniqueCreated,
    verify: input.verify,
    observation_verify: input.observationVerify,
    granot_crm_source_verify: input.sourceVerify,
    granot_automation_source_verify: input.automationVerify,
    synchronization_decision_verify: input.decisionVerify,
    granot_lifecycle_activation_verify: input.activationVerify,
    granot_record_link_verify: input.recordLinkVerify,
    booked_lead_normalized_job_collisions: input.bookedLeadCollisions ?? [],
    booked_lead_verify: input.bookedLeadVerify,
    granot_booking_case_open_collisions: input.bookingCaseCollisions?.open ?? [],
    granot_booking_case_sequence_collisions: input.bookingCaseCollisions?.sequence ?? [],
    granot_booking_case_verify: input.bookingCaseVerify,
    granot_release_case_open_collisions: input.releaseCaseCollisions?.open ?? [],
    granot_release_case_sequence_collisions: input.releaseCaseCollisions?.sequence ?? [],
    granot_release_case_verify: input.releaseCaseVerify,
    granot_booking_discrepancy_collisions: input.bookingDiscrepancyCollisions ?? [],
    granot_release_discrepancy_collisions: input.releaseDiscrepancyCollisions ?? [],
    granot_booking_discrepancy_verify: input.bookingDiscrepancyVerify,
    granot_release_discrepancy_verify: input.releaseDiscrepancyVerify,
    entity_change_revision_collisions: input.entityChangeCollisions ?? [],
    entity_change_verify: input.entityChangeVerify,
    form_lead_s08_verify: input.formLeadVerify,
    call_lead_s08_verify: input.callLeadVerify,
    call_log_sync_state_collection: callLogSyncStateCollectionName(),
    call_log_sync_state_key_collisions: input.callLogSyncStateCollisions ?? [],
    call_log_sync_state_rows: input.callLogSyncStateReport,
    call_log_sync_state_index_contract: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX,
    call_log_sync_state_verify: input.callLogSyncStateVerify,
    global_unique_lead_job_index: false,
  };
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
