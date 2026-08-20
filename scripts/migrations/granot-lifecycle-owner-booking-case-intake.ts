/**
 * Owner-gated booking-case intake for today's Booked Granot observations.
 *
 * Opens GranotBookingReconciliationCase rows so the owner can finalize.
 * Does not mint official Bookings or rewrite original Decisions.
 *
 *   pnpm migration:granot-lifecycle:owner-booking-case-intake -- --report
 *   pnpm migration:granot-lifecycle:owner-booking-case-intake -- --apply --confirm-production=vantagemovers
 *   pnpm migration:granot-lifecycle:owner-booking-case-intake -- --verify --confirm-production=vantagemovers
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { BookedLead } from "../../src/models/BookedLead.js";
import {
  getGranotBookingReconciliationCaseModel,
  type GranotBookingReconciliationCaseDocument,
} from "../../src/models/GranotBookingReconciliationCase.js";
import { getGranotObservationModel } from "../../src/models/GranotObservation.js";
import { getGranotObservationReceiptModel } from "../../src/models/GranotObservationReceipt.js";
import { getGranotRecordLinkModel } from "../../src/models/GranotRecordLink.js";
import {
  getSynchronizationDecisionModel,
  type SynchronizationDecisionDocument,
} from "../../src/models/SynchronizationDecision.js";
import { equivalentNormalizedJobFilter } from "../../src/services/bookings/bookingIdentity.js";
import {
  classifyBookingReconciliation,
  createMongoBookingReconciliationStore,
  toBookingLeadSuggestion,
  type BookingReconciliationCurrentContext,
} from "../../src/services/granotLifecycle/bookingReconciliation.js";
import {
  createMongoLeadIdentityStore,
  resolveLeadIdentity,
  type LeadIdentityResult,
} from "../../src/services/granotLifecycle/identity.js";
import {
  createMongoSourcePolicyStore,
  resolveSourcePolicy,
  type SourcePolicySnapshot,
} from "../../src/services/granotLifecycle/sourcePolicy.js";
import { toObjectId } from "../../src/utils/objectId.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  OPERATOR_BOOKING_CASE_INTAKE_GATE,
  assertOwnerBookingCaseIntakeApplyAllowed,
  buildOwnerBookingCaseIntakeManifest,
  planOwnerBookingCaseIntakeRow,
  planOwnerBookingCaseIntakeWrites,
  scanOwnerBookingCaseIntakeManifestForPii,
  type OwnerBookingCaseIntakeFacts,
  type PlannedOwnerBookingCaseIntakeRow,
} from "./granot-lifecycle-owner-booking-case-intake.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-owner-booking-case-intake");
const DEFAULT_CAPTURED_FROM = "2026-08-20T04:00:00.000Z";
const DEFAULT_CAPTURED_TO = "2026-08-21T04:00:00.000Z";

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function readIsoFlag(args: readonly string[], name: string, fallback: string): string {
  const flag = args.find((arg) => arg.startsWith(`${name}=`));
  const raw = flag?.slice(name.length + 1).trim();
  if (!raw) return fallback;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} must be an ISO timestamp.`);
  }
  return date.toISOString();
}

function emptyPolicy(): SourcePolicySnapshot {
  return {
    granot_crm_source_id: "",
    lifecycle_disposition: "deferred",
    lead_created_policy: "observation_only",
    operational_enabled: false,
    lifecycle_enabled: false,
    source_company_active: false,
    source_granularity_active: false,
  };
}

async function loadLatestBookedObservations(capturedFrom: Date, capturedTo: Date) {
  return getGranotObservationModel()
    .aggregate<{
      _id: string;
      observation_id: mongoose.Types.ObjectId;
    }>([
      {
        $match: {
          captured_at: { $gte: capturedFrom, $lt: capturedTo },
          route_event_class: "booking_status_changed",
          "booking_action.normalized": "booked",
        },
      },
      { $sort: { captured_at: -1, _id: -1 } },
      {
        $group: {
          _id: "$identity.normalized_job_no",
          observation_id: { $first: "$_id" },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .exec();
}

async function findLatestDecision(observationId: mongoose.Types.ObjectId) {
  return getSynchronizationDecisionModel()
    .findOne({ observation_id: observationId })
    .sort({ attempt: -1 })
    .lean()
    .exec();
}

async function findActiveEquivalentLink(normalizedJobNo: string | undefined) {
  if (!normalizedJobNo) return undefined;
  const row = await getGranotRecordLinkModel()
    .findOne({ provider: "granot", state: "active", ...equivalentNormalizedJobFilter(normalizedJobNo) })
    .select({ _id: 1 })
    .lean()
    .exec();
  return row ? { id: String(row._id) } : undefined;
}

async function findEquivalentBooking(normalizedJobNo: string | undefined) {
  if (!normalizedJobNo) return undefined;
  const row = await BookedLead.findOne(equivalentNormalizedJobFilter(normalizedJobNo))
    .select({ _id: 1, lead_ref: 1, lead_model: 1, is_referral_booking: 1, cancelled: 1 })
    .lean()
    .exec();
  if (!row) return undefined;
  return {
    id: String(row._id),
    has_lead: Boolean(row.lead_ref && row.lead_model),
    officially_cancelled: Boolean(row.cancelled),
    referral: row.is_referral_booking === true,
  };
}

async function findOpenEquivalentCase(normalizedJobNo: string | undefined) {
  if (!normalizedJobNo) return undefined;
  const row = await getGranotBookingReconciliationCaseModel()
    .findOne({ action_kind: "booked", state: "open", ...equivalentNormalizedJobFilter(normalizedJobNo) })
    .select({ _id: 1, mode: 1, state: 1 })
    .lean()
    .exec();
  return row ? { id: String(row._id), mode: row.mode, state: row.state } : undefined;
}

async function assembleFacts(observationId: mongoose.Types.ObjectId): Promise<OwnerBookingCaseIntakeFacts> {
  const observation = await getGranotObservationModel().findById(observationId).lean().exec();
  if (!observation) {
    throw new Error(`Observation ${String(observationId)} was not found.`);
  }
  const decision = await findLatestDecision(observation._id);
  if (!decision) {
    throw new Error(`Observation ${String(observation._id)} has no SynchronizationDecision.`);
  }

  const policy = await resolveSourcePolicy(
    {
      source_label: observation.normalized_source_label ?? observation.source_label_raw ?? "",
      origin_state: observation.move?.origin?.state,
      destination_state: observation.move?.destination?.state,
      provider_type: observation.provider_context?.type_raw,
    },
    createMongoSourcePolicyStore(),
  );
  const policySnapshot = policy.snapshot ?? emptyPolicy();
  const identity = await resolveLeadIdentity(
    {
      observation: {
        identity: {
          normalized_job_no: observation.identity?.normalized_job_no,
          normalized_form_ref: observation.identity?.normalized_form_ref,
        },
        contact: {
          normalized_phone: observation.contact?.normalized_phone,
          normalized_email: observation.contact?.normalized_email,
        },
        agent_identity: {
          user_raw: observation.agent_identity?.user_raw,
          rep_raw: observation.agent_identity?.rep_raw,
        },
        provider_context: observation.provider_context,
      },
      policy: policySnapshot,
      policy_failure: policy.ok ? undefined : { outcome: policy.outcome, reason: policy.reason },
    },
    createMongoLeadIdentityStore(),
  );

  const observationJob = observation.identity?.normalized_job_no;
  const recordLink = await findActiveEquivalentLink(observationJob);
  const booking = await findEquivalentBooking(observationJob);
  const openCase = await findOpenEquivalentCase(observationJob);
  const bookingAction = observation.booking_action?.normalized;

  const context: BookingReconciliationCurrentContext = {
    observation_id: String(observation._id),
    receipt_id: String(observation.receipt_id),
    captured_at: new Date(observation.captured_at),
    normalized_job_no: observationJob,
    job_no_snapshot: observation.identity?.job_no_raw ?? observationJob,
    priority: {
      canonical: observation.priority?.canonical,
      valid: observation.priority?.valid === true,
    },
    booking_action: bookingAction,
    lifecycle_disposition:
      policySnapshot.lifecycle_disposition === "source_scoped_lead" ||
      policySnapshot.lifecycle_disposition === "referral_booking" ||
      policySnapshot.lifecycle_disposition === "deferred"
        ? policySnapshot.lifecycle_disposition
        : undefined,
    identity,
    record_link_id: recordLink?.id,
    booking,
  };
  const classified = classifyBookingReconciliation(context);
  const bookingClassification =
    classified.kind === "case"
      ? {
          kind: classified.kind,
          mode: classified.mode,
          evidence_action: classified.evidence_action,
          deterministic_booking_id: classified.deterministic_booking_id,
        }
      : classified.kind === "none"
        ? { kind: classified.kind, reason: classified.reason }
        : { kind: classified.kind, reason_code: "reason_code" in classified ? classified.reason_code : undefined };

  return {
    observation_id: String(observation._id),
    receipt_id: String(observation.receipt_id),
    latest_decision_id: String(decision._id),
    attempt: decision.attempt,
    execution_mode: decision.execution_mode,
    captured_at: iso(observation.captured_at),
    observation_job: observationJob,
    source_label: observation.normalized_source_label ?? observation.source_label_raw,
    booking_action: bookingAction,
    lifecycle_disposition: policySnapshot.lifecycle_disposition,
    identity_outcome: identity.outcome,
    identity_reason_code: identity.reason_code,
    identity_match_method: identity.match_method,
    identity_target_id: identity.target?.id,
    identity_target_model: identity.target?.model,
    record_link_id: recordLink?.id,
    booking_exists: Boolean(booking),
    booking_id: booking?.id,
    case_exists: Boolean(openCase),
    case_id: openCase?.id,
    booking_classification: bookingClassification,
  };
}

async function planLiveRows(capturedFrom: Date, capturedTo: Date): Promise<PlannedOwnerBookingCaseIntakeRow[]> {
  const grouped = await loadLatestBookedObservations(capturedFrom, capturedTo);
  const rows: PlannedOwnerBookingCaseIntakeRow[] = [];
  for (const group of grouped) {
    if (!group.observation_id) continue;
    rows.push(planOwnerBookingCaseIntakeRow(await assembleFacts(group.observation_id)));
  }
  return rows;
}

function requireSheetSyncDisabled(): void {
  if (process.env.SHEET_SYNC_MODE !== "disabled") {
    throw new Error("Owner booking-case intake requires SHEET_SYNC_MODE=disabled.");
  }
}

async function applyWrites(rows: readonly PlannedOwnerBookingCaseIntakeRow[]): Promise<{
  booking_cases: number;
  repair_decisions: number;
}> {
  const writes = planOwnerBookingCaseIntakeWrites(rows);
  assertOwnerBookingCaseIntakeApplyAllowed({ rows, writes });
  const store = createMongoBookingReconciliationStore();
  const counts = { booking_cases: 0, repair_decisions: 0 };

  for (const row of rows.filter((candidate) => candidate.apply_eligible)) {
    const opened = await insertOwnerBookingCase(row, store);
    if (opened) {
      counts.booking_cases += 1;
      counts.repair_decisions += 1;
    }
  }
  return counts;
}

async function insertOwnerBookingCase(
  row: PlannedOwnerBookingCaseIntakeRow,
  store: ReturnType<typeof createMongoBookingReconciliationStore>,
): Promise<boolean> {
  const job = row.observation_job;
  if (!job) throw new Error(`Eligible row ${row.observation_id} is missing observation_job.`);
  const existing = await findOpenEquivalentCase(job);
  if (existing) return false;

  const observation = await getGranotObservationModel().findById(row.observation_id).lean().exec();
  if (!observation) throw new Error(`Observation ${row.observation_id} disappeared before apply.`);
  const policy = await resolveSourcePolicy(
    {
      source_label: observation.normalized_source_label ?? observation.source_label_raw ?? "",
      origin_state: observation.move?.origin?.state,
      destination_state: observation.move?.destination?.state,
      provider_type: observation.provider_context?.type_raw,
    },
    createMongoSourcePolicyStore(),
  );
  const snapshot = policy.snapshot ?? emptyPolicy();
  const identity = await resolveLeadIdentity(
    {
      observation: {
        identity: {
          normalized_job_no: observation.identity?.normalized_job_no,
          normalized_form_ref: observation.identity?.normalized_form_ref,
        },
        contact: {
          normalized_phone: observation.contact?.normalized_phone,
          normalized_email: observation.contact?.normalized_email,
        },
        agent_identity: {
          user_raw: observation.agent_identity?.user_raw,
          rep_raw: observation.agent_identity?.rep_raw,
        },
        provider_context: observation.provider_context,
      },
      policy: snapshot,
      policy_failure: policy.ok ? undefined : { outcome: policy.outcome, reason: policy.reason },
    },
    createMongoLeadIdentityStore(),
  );

  const mode = row.booking_case_mode;
  if (
    mode !== "create_missing_booking" &&
    mode !== "review_existing_booking" &&
    mode !== "create_referral_booking"
  ) {
    throw new Error(`Observation ${row.observation_id} is missing a booking-case mode.`);
  }

  const suggestion = mode === "create_referral_booking" ? undefined : toBookingLeadSuggestion(identity);
  const decisionId = new mongoose.Types.ObjectId();
  const caseId = new mongoose.Types.ObjectId();
  const now = new Date();
  let wrote = false;

  await store.withTransaction(async (session) => {
    const raced = await store.findOpenCase(job, session);
    if (raced) return;
    const sequence = (await store.findMaxSequence(job, session)) + 1;
    const caseRow: GranotBookingReconciliationCaseDocument = {
      _id: caseId,
      normalized_job_no: job,
      job_no_snapshot: observation.identity?.job_no_raw ?? job,
      action_kind: "booked",
      sequence_number: sequence,
      mode,
      state: "open",
      case_revision: 1,
      evidence_revision: 1,
      source_scope:
        mode !== "create_referral_booking" &&
        snapshot.granot_crm_source_id &&
        snapshot.lead_source_company_id &&
        snapshot.source_granularity_id
          ? {
              granot_crm_source_id: toObjectId(snapshot.granot_crm_source_id),
              lead_source_company: toObjectId(snapshot.lead_source_company_id),
              source_granularity_id: toObjectId(snapshot.source_granularity_id),
            }
          : undefined,
      record_link_id: row.record_link_id ? toObjectId(row.record_link_id) : undefined,
      deterministic_booking_id:
        mode === "review_existing_booking" && row.booking_id ? toObjectId(row.booking_id) : undefined,
      evidence: [
        {
          observation_id: observation._id,
          decision_id: decisionId,
          captured_at: new Date(observation.captured_at),
          action: "booked",
        },
      ],
      observed_context: {
        granot_priority: observation.priority?.canonical,
        granot_username: observation.agent_identity?.user_raw ?? observation.agent_identity?.rep_raw,
        estimate: observation.display_money?.estimate?.raw,
        payment: observation.display_money?.payment?.raw,
        balance: observation.display_money?.balance?.raw,
        move_date: observation.move?.move_date,
        estimated_cubic_feet: observation.move?.estimated_cubic_feet,
      },
      suggested_lead: suggestion
        ? {
            lead_ref: {
              model: suggestion.lead_ref.model,
              id: toObjectId(suggestion.lead_ref.id),
            },
            confidence: suggestion.confidence,
            match_method: suggestion.match_method,
            reason_codes: suggestion.reason_codes,
          }
        : undefined,
      opened_at: now,
      last_evidence_at: new Date(observation.captured_at),
    };
    await store.insertCase(caseRow, session);
    await persistIntakeDecision({
      row,
      decisionId,
      target: { model: "GranotBookingReconciliationCase", id: String(caseId) },
      session,
      decidedAt: now,
      identity,
    });
    wrote = true;
  });
  return wrote;
}

async function persistIntakeDecision(input: {
  row: PlannedOwnerBookingCaseIntakeRow;
  decisionId: mongoose.Types.ObjectId;
  target: { model: "GranotBookingReconciliationCase"; id: string };
  session: mongoose.ClientSession;
  decidedAt: Date;
  identity: LeadIdentityResult;
}): Promise<void> {
  const existing = await getSynchronizationDecisionModel()
    .findOne({ observation_id: toObjectId(input.row.observation_id), attempt: input.row.next_attempt })
    .session(input.session)
    .lean()
    .exec();
  if (existing) {
    if (existing.reason_code !== "booking_case_opened") {
      throw new Error(
        `Observation ${input.row.observation_id} already has attempt ${input.row.next_attempt} with ${existing.reason_code}.`,
      );
    }
    return;
  }
  const decision: SynchronizationDecisionDocument = {
    _id: input.decisionId,
    observation_id: toObjectId(input.row.observation_id),
    attempt: input.row.next_attempt,
    execution_mode: input.row.execution_mode,
    outcome: "linked",
    reason_code: "booking_case_opened",
    match_method: input.identity.match_method,
    target: input.target,
    candidates: input.identity.candidates ?? [],
    evaluated_gates: [{ gate: OPERATOR_BOOKING_CASE_INTAKE_GATE, allowed: true }],
    effects: [{ kind: "booking_case_opened", ref: input.target }],
    decided_at: input.decidedAt,
  };
  await getSynchronizationDecisionModel().create([decision], { session: input.session });
  if (input.row.receipt_id) {
    await getGranotObservationReceiptModel().collection.updateOne(
      { _id: toObjectId(input.row.receipt_id) },
      { $set: { "processing.latest_decision_id": input.decisionId } },
      { session: input.session },
    );
  }
}

async function verifyIntake(rows: readonly PlannedOwnerBookingCaseIntakeRow[]): Promise<{
  ok: boolean;
  failures: string[];
}> {
  const failures: string[] = [];
  for (const row of rows) {
    const original = await getSynchronizationDecisionModel().findById(row.latest_decision_id).lean().exec();
    if (!original) {
      failures.push(`original_decision_missing:${row.latest_decision_id}`);
      continue;
    }
    if (original.reason_code === "booking_case_opened" && row.action !== "already_open") {
      // Latest decision may already be the intake row after apply; that is expected.
    }
    if (!row.observation_job) continue;
    if (row.action === "open_booking_case_operator_exception" || row.action === "already_open") {
      const openCase = await findOpenEquivalentCase(row.observation_job);
      if (!openCase) failures.push(`missing_booking_case:${row.observation_job}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseGranotLifecycleMigrationMode(args);
  const capturedFrom = readIsoFlag(args, "--captured-from", DEFAULT_CAPTURED_FROM);
  const capturedTo = readIsoFlag(args, "--captured-to", DEFAULT_CAPTURED_TO);
  const configured = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configured);
  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({ args, databaseName: configured });
    requireSheetSyncDisabled();
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

  const rows = await planLiveRows(new Date(capturedFrom), new Date(capturedTo));
  const writes = planOwnerBookingCaseIntakeWrites(rows);
  if (mode === "apply") {
    assertOwnerBookingCaseIntakeApplyAllowed({ rows, writes });
    console.log(JSON.stringify({ phase: "planned_writes", writes }, null, 2));
  }

  const applied =
    mode === "apply" ? await applyWrites(rows) : { booking_cases: 0, repair_decisions: 0 };
  const verify = mode === "verify" || mode === "apply" ? await verifyIntake(rows) : undefined;
  if (mode === "verify" && verify && !verify.ok) {
    throw new Error(`Owner booking-case intake verify failed: ${verify.failures.join(", ")}`);
  }

  const manifest = buildOwnerBookingCaseIntakeManifest({
    databaseName,
    mode,
    capturedFrom,
    capturedTo,
    rows,
    writes: mode === "report" || mode === "apply" ? writes : [],
    applied,
    verify,
  });
  const pii = scanOwnerBookingCaseIntakeManifestForPii(manifest);
  if (pii.length > 0) {
    throw new Error(`Refusing to write intake manifest with PII paths: ${pii.join(", ")}`);
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
