/**
 * One-shot migrate of historical open Granot Release Reconciliation Cases
 * onto booking intakes (spec §10).
 *
 * Does not mint official Bookings or Cancellations. Does not drop Release
 * collections. Open `release_without_vantage_booking` discrepancies stay
 * historical.
 *
 *   pnpm migration:granot-lifecycle:release-cases-into-booking-intake -- --report
 *   pnpm migration:granot-lifecycle:release-cases-into-booking-intake -- --apply --confirm-production=vantagemovers
 *   pnpm migration:granot-lifecycle:release-cases-into-booking-intake -- --verify --confirm-production=vantagemovers
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { BookedLead } from "../../src/models/BookedLead.js";
import { CancelledLead } from "../../src/models/CancelledLead.js";
import {
  getGranotBookingReconciliationCaseModel,
  type GranotBookingCaseEvidence,
  type GranotBookingReconciliationCaseDocument,
} from "../../src/models/GranotBookingReconciliationCase.js";
import { getGranotReleaseDiscrepancyModel } from "../../src/models/GranotReleaseDiscrepancy.js";
import {
  getGranotReleaseReconciliationCaseModel,
  type GranotReleaseReconciliationCaseDocument,
} from "../../src/models/GranotReleaseReconciliationCase.js";
import { equivalentNormalizedJobFilter } from "../../src/services/bookings/bookingIdentity.js";
import { createMongoBookingReconciliationStore } from "../../src/services/granotLifecycle/bookingReconciliation.js";
import { toObjectId } from "../../src/utils/objectId.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  RELEASE_CASE_MIGRATE_REASON,
  RELEASE_CASE_NO_ACTION_REASON_CODE,
  assertReleaseCasesIntoBookingIntakeApplyAllowed,
  buildReleaseCasesIntoBookingIntakeManifest,
  planReleaseCasesIntoBookingIntakeRow,
  planReleaseCasesIntoBookingIntakeWrites,
  scanReleaseCasesIntoBookingIntakeManifestForPii,
  type PlannedReleaseCasesIntoBookingIntakeRow,
  type ReleaseCasesIntoBookingIntakeFacts,
} from "./granot-lifecycle-release-cases-into-booking-intake.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-release-cases-into-booking-intake");

const MIGRATE_ACTOR = {
  actor_type: "system" as const,
  actor_id: "granot-lifecycle-release-cases-into-booking-intake",
  actor_label: "Release case migrate",
  actor_role: "system" as const,
  origin: "granot_lifecycle" as const,
};

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function observedContextWithoutContact(
  context: GranotReleaseReconciliationCaseDocument["observed_context"] | undefined,
): GranotBookingReconciliationCaseDocument["observed_context"] {
  if (!context) return {};
  return {
    ...(context.move_date ? { move_date: context.move_date } : {}),
    ...(context.estimated_cubic_feet !== undefined
      ? { estimated_cubic_feet: context.estimated_cubic_feet }
      : {}),
    ...(context.estimate ? { estimate: context.estimate } : {}),
    ...(context.payment ? { payment: context.payment } : {}),
    ...(context.balance ? { balance: context.balance } : {}),
    ...(context.granot_priority ? { granot_priority: context.granot_priority } : {}),
    ...(context.granot_username ? { granot_username: context.granot_username } : {}),
  };
}

function toBookingEvidence(
  row: GranotReleaseReconciliationCaseDocument["evidence"][number],
): GranotBookingCaseEvidence {
  return {
    observation_id: row.observation_id,
    decision_id: row.decision_id,
    captured_at: row.captured_at,
    action: "release",
  };
}

async function findOpenEquivalentBookingCase(normalizedJobNo: string) {
  const row = await getGranotBookingReconciliationCaseModel()
    .findOne({ action_kind: "booked", state: "open", ...equivalentNormalizedJobFilter(normalizedJobNo) })
    .select({ _id: 1, mode: 1, evidence: 1, deterministic_booking_id: 1 })
    .lean()
    .exec();
  if (!row) return undefined;
  return {
    id: String(row._id),
    mode: row.mode,
    evidence_observation_ids: row.evidence.map((item) => String(item.observation_id)),
    deterministic_booking_id: row.deterministic_booking_id
      ? String(row.deterministic_booking_id)
      : undefined,
  };
}

async function findMaxBookingSequence(normalizedJobNo: string): Promise<number> {
  const row = await getGranotBookingReconciliationCaseModel()
    .findOne({ normalized_job_no: normalizedJobNo, action_kind: "booked" })
    .sort({ sequence_number: -1 })
    .select({ sequence_number: 1 })
    .lean()
    .exec();
  return row?.sequence_number ?? 0;
}

async function findEquivalentBooking(normalizedJobNo: string) {
  const row = await BookedLead.findOne(equivalentNormalizedJobFilter(normalizedJobNo))
    .select({ _id: 1, cancelled: 1, domain_revision: 1 })
    .lean()
    .exec();
  if (!row) return undefined;
  const cancellationId = row.cancelled ? String(row.cancelled) : undefined;
  const cancellation = cancellationId
    ? await CancelledLead.findById(cancellationId).select({ _id: 1, domain_revision: 1 }).lean().exec()
    : null;
  return {
    id: String(row._id),
    officially_cancelled: Boolean(row.cancelled),
    domain_revision: Number(row.domain_revision ?? 0),
    cancellation: cancellation
      ? { id: String(cancellation._id), domain_revision: Number(cancellation.domain_revision ?? 0) }
      : undefined,
  };
}

function assembleFacts(
  releaseCase: Pick<
    GranotReleaseReconciliationCaseDocument,
    "_id" | "normalized_job_no" | "job_no_snapshot" | "evidence"
  >,
  openBookingCase: Awaited<ReturnType<typeof findOpenEquivalentBookingCase>>,
  maxBookingSequence: number,
  booking: Awaited<ReturnType<typeof findEquivalentBooking>>,
): ReleaseCasesIntoBookingIntakeFacts {
  return {
    release_case_id: String(releaseCase._id),
    normalized_job_no: releaseCase.normalized_job_no,
    job_no_snapshot: releaseCase.job_no_snapshot,
    release_evidence: releaseCase.evidence.map((row) => ({
      observation_id: String(row.observation_id),
      decision_id: String(row.decision_id),
      captured_at: iso(row.captured_at) ?? new Date(0).toISOString(),
    })),
    open_booking_case: openBookingCase,
    max_booking_sequence: maxBookingSequence,
    live_official_booking: booking
      ? {
          id: booking.id,
          officially_cancelled: booking.officially_cancelled,
          domain_revision: booking.domain_revision,
        }
      : undefined,
    official_cancellation: booking?.cancellation,
  };
}

async function planLiveRows(): Promise<PlannedReleaseCasesIntoBookingIntakeRow[]> {
  const openCases = await getGranotReleaseReconciliationCaseModel()
    .find({ state: "open" })
    .select({
      _id: 1,
      normalized_job_no: 1,
      job_no_snapshot: 1,
      evidence: 1,
    })
    .sort({ _id: 1 })
    .lean()
    .exec();
  const rows: PlannedReleaseCasesIntoBookingIntakeRow[] = [];
  for (const releaseCase of openCases) {
    if (!releaseCase.normalized_job_no) continue;
    const [openBookingCase, maxBookingSequence, booking] = await Promise.all([
      findOpenEquivalentBookingCase(releaseCase.normalized_job_no),
      findMaxBookingSequence(releaseCase.normalized_job_no),
      findEquivalentBooking(releaseCase.normalized_job_no),
    ]);
    rows.push(planReleaseCasesIntoBookingIntakeRow(assembleFacts(releaseCase, openBookingCase, maxBookingSequence, booking)));
  }
  return rows;
}

async function appendMissingEvidence(input: {
  bookingCaseId: string;
  releaseCase: GranotReleaseReconciliationCaseDocument;
  observationIds: readonly string[];
  session: mongoose.ClientSession;
}): Promise<number> {
  const store = createMongoBookingReconciliationStore();
  const existing = await getGranotBookingReconciliationCaseModel()
    .findById(input.bookingCaseId)
    .session(input.session)
    .lean()
    .exec();
  if (!existing || existing.state !== "open") {
    throw new Error(`Booking case ${input.bookingCaseId} is not open for evidence append.`);
  }
  const already = new Set(existing.evidence.map((row) => String(row.observation_id)));
  let appended = 0;
  for (const observationId of input.observationIds) {
    if (already.has(observationId)) continue;
    const source = input.releaseCase.evidence.find((row) => String(row.observation_id) === observationId);
    if (!source) continue;
    await store.refreshCase(
      {
        case_id: existing._id,
        evidence: toBookingEvidence(source),
        observed_context: existing.observed_context,
        suggestion_changed: false,
      },
      input.session,
    );
    already.add(observationId);
    appended += 1;
  }
  return appended;
}

async function setReviewMode(input: {
  bookingCaseId: string;
  bookingId: string;
  session: mongoose.ClientSession;
}): Promise<void> {
  await getGranotBookingReconciliationCaseModel().updateOne(
    { _id: toObjectId(input.bookingCaseId), state: "open" },
    {
      $set: {
        mode: "review_existing_booking",
        deterministic_booking_id: toObjectId(input.bookingId),
      },
      $inc: { case_revision: 1 },
    },
    { session: input.session },
  );
}

async function resolveReleaseCase(input: {
  releaseCase: GranotReleaseReconciliationCaseDocument;
  bookingCaseId: string;
  session: mongoose.ClientSession;
  now: Date;
}): Promise<boolean> {
  const result = await getGranotReleaseReconciliationCaseModel().updateOne(
    { _id: input.releaseCase._id, state: "open", case_revision: input.releaseCase.case_revision },
    {
      $set: {
        state: "resolved",
        resolved_at: input.now,
        resolution: {
          outcome: "no_action",
          command_execution_id: new mongoose.Types.ObjectId(),
          actor: { ...MIGRATE_ACTOR, request_id: String(input.releaseCase._id) },
          reason_code: RELEASE_CASE_NO_ACTION_REASON_CODE,
          reason_text: RELEASE_CASE_MIGRATE_REASON,
          resolved_at: input.now,
          entity_ref: { model: "GranotBookingReconciliationCase", id: input.bookingCaseId },
        },
      },
      $inc: { case_revision: 1 },
    },
    { session: input.session },
  );
  return result.matchedCount === 1;
}

async function applyRow(row: PlannedReleaseCasesIntoBookingIntakeRow): Promise<{
  opened: boolean;
  refreshed: boolean;
  resolved: boolean;
}> {
  const store = createMongoBookingReconciliationStore();
  const counts = { opened: false, refreshed: false, resolved: false };
  await store.withTransaction(async (session) => {
    const releaseCase = await getGranotReleaseReconciliationCaseModel()
      .findById(row.release_case_id)
      .session(session)
      .lean()
      .exec();
    if (!releaseCase) {
      throw new Error(`Release case ${row.release_case_id} disappeared before apply.`);
    }
    if (releaseCase.state !== "open") return;

    const now = new Date();
    let bookingCaseId = row.booking_case_id;
    const raced = await getGranotBookingReconciliationCaseModel()
      .findOne({
        action_kind: "booked",
        state: "open",
        ...equivalentNormalizedJobFilter(row.normalized_job_no),
      })
      .session(session)
      .lean()
      .exec();

    if (row.open_booking_case && !raced) {
      const caseId = new mongoose.Types.ObjectId();
      const evidence = releaseCase.evidence
        .filter((item) => row.append_observation_ids.includes(String(item.observation_id)))
        .map(toBookingEvidence);
      const lastEvidence = evidence.reduce<Date | undefined>((latest, item) => {
        if (!latest || item.captured_at > latest) return item.captured_at;
        return latest;
      }, undefined);
      const sequence = (await store.findMaxSequence(row.normalized_job_no, session)) + 1;
      const caseRow: GranotBookingReconciliationCaseDocument = {
        _id: caseId,
        normalized_job_no: row.normalized_job_no,
        job_no_snapshot: releaseCase.job_no_snapshot || row.normalized_job_no,
        action_kind: "booked",
        sequence_number: sequence,
        mode: row.booking_case_mode,
        state: "open",
        case_revision: 1,
        evidence_revision: 1,
        source_scope: releaseCase.source_scope,
        record_link_id: releaseCase.record_link_id,
        deterministic_booking_id:
          row.booking_case_mode === "review_existing_booking" && row.deterministic_booking_id
            ? toObjectId(row.deterministic_booking_id)
            : undefined,
        evidence,
        observed_context: observedContextWithoutContact(releaseCase.observed_context),
        opened_at: now,
        last_evidence_at: lastEvidence ?? now,
      };
      await store.insertCase(caseRow, session);
      bookingCaseId = String(caseId);
      counts.opened = true;
    } else {
      const target = raced ?? (bookingCaseId
        ? await getGranotBookingReconciliationCaseModel().findById(bookingCaseId).session(session).lean().exec()
        : null);
      if (!target) {
        throw new Error(`Release case ${row.release_case_id} has no booking case to refresh.`);
      }
      bookingCaseId = String(target._id);
      const appended = await appendMissingEvidence({
        bookingCaseId,
        releaseCase,
        observationIds: row.append_observation_ids,
        session,
      });
      if (appended > 0) counts.refreshed = true;
      if (
        row.booking_case_mode === "review_existing_booking" &&
        row.deterministic_booking_id &&
        (target.mode !== "review_existing_booking" ||
          String(target.deterministic_booking_id ?? "") !== row.deterministic_booking_id)
      ) {
        await setReviewMode({
          bookingCaseId,
          bookingId: row.deterministic_booking_id,
          session,
        });
      }
    }

    if (!bookingCaseId) {
      throw new Error(`Release case ${row.release_case_id} resolved without a booking case id.`);
    }
    counts.resolved = await resolveReleaseCase({
      releaseCase,
      bookingCaseId,
      session,
      now,
    });
  });
  return counts;
}

async function applyWrites(rows: readonly PlannedReleaseCasesIntoBookingIntakeRow[]): Promise<{
  booking_cases_opened: number;
  booking_cases_refreshed: number;
  release_cases_resolved: number;
}> {
  const writes = planReleaseCasesIntoBookingIntakeWrites(rows);
  assertReleaseCasesIntoBookingIntakeApplyAllowed({ rows, writes });
  const counts = {
    booking_cases_opened: 0,
    booking_cases_refreshed: 0,
    release_cases_resolved: 0,
  };
  for (const row of rows.filter((candidate) => candidate.apply_eligible)) {
    const applied = await applyRow(row);
    if (applied.opened) counts.booking_cases_opened += 1;
    if (applied.refreshed) counts.booking_cases_refreshed += 1;
    if (applied.resolved) counts.release_cases_resolved += 1;
  }
  return counts;
}

async function findBookingCaseWithObservation(observationId: string) {
  return getGranotBookingReconciliationCaseModel()
    .findOne({ "evidence.observation_id": toObjectId(observationId) })
    .select({ _id: 1 })
    .lean()
    .exec();
}

async function verifyOfficialRevision(input: {
  model: "BookedLead" | "CancelledLead";
  id: string;
  expected?: number;
}): Promise<string | undefined> {
  if (input.expected === undefined) return undefined;
  const row =
    input.model === "BookedLead"
      ? await BookedLead.findById(input.id).select({ domain_revision: 1 }).lean().exec()
      : await CancelledLead.findById(input.id).select({ domain_revision: 1 }).lean().exec();
  if (!row) return `missing_${input.model}:${input.id}`;
  if (Number(row.domain_revision ?? 0) !== input.expected) {
    return `domain_revision_changed:${input.model}:${input.id}`;
  }
  return undefined;
}

async function verifyMigratedCase(input: {
  release_case_id: string;
  observation_ids: readonly string[];
  official_booking_id?: string;
  official_booking_domain_revision?: number;
  official_cancellation_id?: string;
  official_cancellation_domain_revision?: number;
}): Promise<string[]> {
  const failures: string[] = [];
  const releaseCase = await getGranotReleaseReconciliationCaseModel()
    .findById(input.release_case_id)
    .select({ state: 1, resolution: 1, evidence: 1 })
    .lean()
    .exec();
  if (!releaseCase) {
    return [`release_case_missing:${input.release_case_id}`];
  }
  if (releaseCase.state === "open") {
    failures.push(`release_case_still_open:${input.release_case_id}`);
  } else if (releaseCase.resolution?.outcome !== "no_action") {
    failures.push(`release_case_not_no_action:${input.release_case_id}`);
  }
  const observationIds = [
    ...new Set([
      ...input.observation_ids,
      ...releaseCase.evidence.map((row) => String(row.observation_id)),
    ]),
  ];
  for (const observationId of observationIds) {
    const bookingCase = await findBookingCaseWithObservation(observationId);
    if (!bookingCase) failures.push(`observation_not_on_booking_case:${observationId}`);
  }
  const bookingFailure = await verifyOfficialRevision({
    model: "BookedLead",
    id: input.official_booking_id ?? "",
    expected: input.official_booking_id ? input.official_booking_domain_revision : undefined,
  });
  if (bookingFailure) failures.push(bookingFailure);
  const cancellationFailure = await verifyOfficialRevision({
    model: "CancelledLead",
    id: input.official_cancellation_id ?? "",
    expected: input.official_cancellation_id ? input.official_cancellation_domain_revision : undefined,
  });
  if (cancellationFailure) failures.push(cancellationFailure);
  return failures;
}

async function verifyIntake(rows: readonly PlannedReleaseCasesIntoBookingIntakeRow[]): Promise<{
  ok: boolean;
  failures: string[];
}> {
  const failures: string[] = [];
  const targets =
    rows.length > 0
      ? rows.map((row) => ({
          release_case_id: row.release_case_id,
          observation_ids: row.append_observation_ids,
          official_booking_id: row.official_booking_id,
          official_booking_domain_revision: row.official_booking_domain_revision,
          official_cancellation_id: row.official_cancellation_id,
          official_cancellation_domain_revision: row.official_cancellation_domain_revision,
        }))
      : (
          await getGranotReleaseReconciliationCaseModel()
            .find({ "resolution.reason_text": RELEASE_CASE_MIGRATE_REASON })
            .select({ _id: 1, evidence: 1 })
            .lean()
            .exec()
        ).map((row) => ({
          release_case_id: String(row._id),
          observation_ids: row.evidence.map((item) => String(item.observation_id)),
        }));

  for (const target of targets) {
    failures.push(...(await verifyMigratedCase(target)));
  }

  if (rows.length > 0) {
    const stillOpen = await getGranotReleaseReconciliationCaseModel()
      .countDocuments({
        _id: { $in: rows.map((row) => toObjectId(row.release_case_id)) },
        state: "open",
      })
      .exec();
    if (stillOpen > 0) {
      failures.push(`open_release_cases_remain:${stillOpen}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

async function countOpenReleaseWithoutBookingDiscrepancies(): Promise<number> {
  return getGranotReleaseDiscrepancyModel()
    .countDocuments({ state: "open", reason_code: "release_without_vantage_booking" })
    .exec();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseGranotLifecycleMigrationMode(args);
  const configured = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configured);
  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({ args, databaseName: configured });
  }
  if (mode === "verify" && configured === "vantagemovers") {
    assertGranotLifecycleApplyAuthorized({ args, databaseName: configured });
  }

  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertGranotLifecycleDatabaseAllowed(databaseName);
  if (databaseName !== configured) {
    throw new Error("Connected database does not match migration preflight database.");
  }
  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({ args, databaseName });
  }

  const rows = await planLiveRows();
  const writes = planReleaseCasesIntoBookingIntakeWrites(rows);
  if (mode === "apply") {
    assertReleaseCasesIntoBookingIntakeApplyAllowed({ rows, writes });
    console.log(JSON.stringify({ phase: "planned_writes", writes }, null, 2));
  }

  const applied =
    mode === "apply"
      ? await applyWrites(rows)
      : { booking_cases_opened: 0, booking_cases_refreshed: 0, release_cases_resolved: 0 };
  const verify = mode === "verify" || mode === "apply" ? await verifyIntake(rows) : undefined;
  if (mode === "verify" && verify && !verify.ok) {
    throw new Error(`Release-case migrate verify failed: ${verify.failures.join(", ")}`);
  }

  const openDiscrepancies = await countOpenReleaseWithoutBookingDiscrepancies();
  const manifest = buildReleaseCasesIntoBookingIntakeManifest({
    databaseName,
    mode,
    rows,
    writes: mode === "report" || mode === "apply" ? writes : [],
    openReleaseWithoutVantageBookingDiscrepancies: openDiscrepancies,
    applied,
    verify,
  });
  const pii = scanReleaseCasesIntoBookingIntakeManifestForPii(manifest);
  if (pii.length > 0) {
    throw new Error(`Refusing to write migrate manifest with PII paths: ${pii.join(", ")}`);
  }
  const runId = `${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const manifestPath = await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId,
    manifest,
  });
  console.log(
    JSON.stringify(
      {
        mode,
        database_name: databaseName,
        manifest_path: manifestPath,
        summary: manifest.summary,
        discrepancy: manifest.discrepancy,
        applied,
        verify: verify ?? null,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
