/**
 * Owner-gated repair for inbound Granot job-prefix conflicts.
 *
 * Report-by-default. Apply requires --apply --confirm-production=<db>.
 * Does not rewrite CallLead job_no, original conflict Decisions, or official Bookings.
 *
 *   pnpm migration:granot-lifecycle:inbound-job-prefix-repair -- --report
 *   pnpm migration:granot-lifecycle:inbound-job-prefix-repair -- --apply --confirm-production=vantagemovers
 *   pnpm migration:granot-lifecycle:inbound-job-prefix-repair -- --verify --confirm-production=vantagemovers
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo, withTransaction } from "../../src/db.js";
import { BookedLead } from "../../src/models/BookedLead.js";
import { getCallLeadModel } from "../../src/models/CallLead.js";
import { ENTITY_CHANGE_COLLECTION } from "../../src/models/EntityChange.js";
import {
  getGranotBookingReconciliationCaseModel,
  type GranotBookingReconciliationCaseDocument,
} from "../../src/models/GranotBookingReconciliationCase.js";
import { getGranotObservationModel } from "../../src/models/GranotObservation.js";
import { getGranotObservationReceiptModel } from "../../src/models/GranotObservationReceipt.js";
import {
  getGranotRecordLinkModel,
  type GranotRecordLinkDocument,
} from "../../src/models/GranotRecordLink.js";
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
  assertInboundJobPrefixRepairApplyAllowed,
  buildInboundJobPrefixRepairManifest,
  planInboundJobPrefixRepairRow,
  planInboundJobPrefixRepairWrites,
  scanInboundJobPrefixRepairManifestForPii,
  type InboundJobPrefixRepairFacts,
  type PlannedInboundJobPrefixRepairRow,
} from "./granot-lifecycle-inbound-job-prefix-repair.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-inbound-job-prefix-repair");

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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

async function loadConflictDecisions(): Promise<SynchronizationDecisionDocument[]> {
  return getSynchronizationDecisionModel()
    .find({ reason_code: "job_number_conflict" })
    .sort({ _id: 1 })
    .lean()
    .exec();
}

async function findEquivalentCallLead(normalizedJobNo: string | undefined, preferredId?: string) {
  if (preferredId && mongoose.isValidObjectId(preferredId)) {
    const preferred = await getCallLeadModel()
      .findById(preferredId)
      .select({ _id: 1, job_no: 1, normalized_job_no: 1 })
      .lean()
      .exec();
    if (preferred) {
      return {
        id: String(preferred._id),
        job_no: typeof preferred.job_no === "string" ? preferred.job_no : undefined,
        normalized_job_no:
          typeof preferred.normalized_job_no === "string" ? preferred.normalized_job_no : undefined,
      };
    }
  }
  if (!normalizedJobNo) return undefined;
  const row = await getCallLeadModel()
    .findOne(equivalentNormalizedJobFilter(normalizedJobNo))
    .select({ _id: 1, job_no: 1, normalized_job_no: 1 })
    .lean()
    .exec();
  if (!row) return undefined;
  return {
    id: String(row._id),
    job_no: typeof row.job_no === "string" ? row.job_no : undefined,
    normalized_job_no: typeof row.normalized_job_no === "string" ? row.normalized_job_no : undefined,
  };
}

async function findActiveEquivalentLink(normalizedJobNo: string | undefined) {
  if (!normalizedJobNo) return undefined;
  const row = await getGranotRecordLinkModel()
    .findOne({ provider: "granot", state: "active", ...equivalentNormalizedJobFilter(normalizedJobNo) })
    .select({ _id: 1, normalized_job_no: 1, lead_ref: 1, booking_ref: 1 })
    .lean()
    .exec();
  if (!row) return undefined;
  return {
    id: String(row._id),
    normalized_job_no: row.normalized_job_no,
    has_lead_ref: Boolean(row.lead_ref),
    has_booking_ref: Boolean(row.booking_ref),
  };
}

async function findEquivalentBooking(normalizedJobNo: string | undefined) {
  if (!normalizedJobNo) return undefined;
  const row = await BookedLead.findOne(equivalentNormalizedJobFilter(normalizedJobNo))
    .select({ _id: 1 })
    .lean()
    .exec();
  return row ? { id: String(row._id) } : undefined;
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

async function assembleFacts(
  decision: SynchronizationDecisionDocument,
): Promise<InboundJobPrefixRepairFacts> {
  const observation = await getGranotObservationModel().findById(decision.observation_id).lean().exec();
  if (!observation) {
    throw new Error(`Observation ${String(decision.observation_id)} was not found for Decision ${String(decision._id)}.`);
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
  const identityTargetId = identity.target?.model === "CallLead" ? identity.target.id : undefined;
  const callLead = await findEquivalentCallLead(observationJob, identityTargetId);
  const recordLink = await findActiveEquivalentLink(observationJob);
  const booking = await findEquivalentBooking(observationJob);
  const openCase = await findOpenEquivalentCase(observationJob);
  const bookingAction = observation.booking_action?.normalized;
  const booked = bookingAction === "booked";

  let bookingClassification: InboundJobPrefixRepairFacts["booking_classification"];
  if (booked) {
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
      lifecycle_disposition: policySnapshot.lifecycle_disposition === "source_scoped_lead" ||
        policySnapshot.lifecycle_disposition === "referral_booking" ||
        policySnapshot.lifecycle_disposition === "deferred"
        ? policySnapshot.lifecycle_disposition
        : undefined,
      identity,
      record_link_id: recordLink?.id,
      booking: booking ? { id: booking.id, has_lead: true, officially_cancelled: false, referral: false } : undefined,
    };
    const classified = classifyBookingReconciliation(context);
    bookingClassification =
      classified.kind === "case"
        ? { kind: classified.kind, mode: classified.mode, evidence_action: classified.evidence_action }
        : classified.kind === "none"
          ? { kind: classified.kind, reason: classified.reason }
          : { kind: classified.kind, reason_code: "reason_code" in classified ? classified.reason_code : undefined };
  }

  return {
    decision_id: String(decision._id),
    observation_id: String(observation._id),
    receipt_id: String(observation.receipt_id),
    attempt: decision.attempt,
    execution_mode: decision.execution_mode,
    old_outcome: decision.outcome,
    old_reason_code: decision.reason_code,
    decided_at: iso(decision.decided_at) ?? new Date().toISOString(),
    captured_at: iso(observation.captured_at),
    route_event_class: observation.route_event_class,
    booking_action: bookingAction,
    observation_job: observationJob,
    call_lead_id: callLead?.id,
    call_lead_job: callLead?.normalized_job_no ?? callLead?.job_no,
    identity: {
      outcome: identity.outcome,
      reason_code: identity.reason_code,
      match_method: identity.match_method,
      target_id: identity.target?.id,
      target_model: identity.target?.model,
    },
    record_link_exists: Boolean(recordLink),
    record_link_id: recordLink?.id,
    booking_exists: Boolean(booking),
    booking_id: booking?.id,
    case_exists: Boolean(openCase),
    case_id: openCase?.id,
    booking_classification: bookingClassification,
    live_processor_would_open_case: false,
    live_processor_block_reason: booked ? "historical_shadow_requires_live_mode" : undefined,
  };
}

async function planLiveRows(): Promise<PlannedInboundJobPrefixRepairRow[]> {
  const decisions = await loadConflictDecisions();
  const rows: PlannedInboundJobPrefixRepairRow[] = [];
  for (const decision of decisions) {
    rows.push(planInboundJobPrefixRepairRow(await assembleFacts(decision)));
  }
  return rows;
}

function requireSheetSyncDisabled(): void {
  if (process.env.SHEET_SYNC_MODE !== "disabled") {
    throw new Error("Inbound job-prefix repair requires SHEET_SYNC_MODE=disabled.");
  }
}

async function applyWrites(rows: readonly PlannedInboundJobPrefixRepairRow[]): Promise<{
  record_links: number;
  booking_cases: number;
  repair_decisions: number;
}> {
  const writes = planInboundJobPrefixRepairWrites(rows);
  assertInboundJobPrefixRepairApplyAllowed({ rows, writes });
  const store = createMongoBookingReconciliationStore();
  const counts = { record_links: 0, booking_cases: 0, repair_decisions: 0 };
  const linkByJob = new Map<string, string>();

  for (const row of rows.filter((candidate) => candidate.apply_eligible)) {
    const job = row.observation_job;
    if (!job) throw new Error(`Eligible row ${row.decision_id} is missing observation_job.`);
    const loaded = await loadApplyContext(row);
    let linkId = linkByJob.get(job) ?? (await findActiveEquivalentLink(job))?.id;
    if (linkId) linkByJob.set(job, linkId);

    if (row.open_booking_case) {
      const opened = await insertOwnerBookingCase({
        row,
        loaded,
        job,
        linkId,
        store,
        alsoInsertLink: row.establish_record_link && !linkId,
      });
      if (opened.insertedLink && opened.linkId) {
        linkByJob.set(job, opened.linkId);
        counts.record_links += 1;
      } else if (opened.linkId) {
        linkByJob.set(job, opened.linkId);
      }
      if (opened.insertedCase) {
        counts.booking_cases += 1;
        counts.repair_decisions += 1;
      }
      continue;
    }

    if (row.establish_record_link) {
      const created = await insertJobLevelRecordLink({ row, loaded, job, persistDecision: true });
      if (created.linkId) linkByJob.set(job, created.linkId);
      if (created.insertedLink) counts.record_links += 1;
      if (created.insertedDecision) counts.repair_decisions += 1;
    }
  }

  return counts;
}

async function loadApplyContext(row: PlannedInboundJobPrefixRepairRow) {
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
      policy: policy.snapshot ?? emptyPolicy(),
      policy_failure: policy.ok ? undefined : { outcome: policy.outcome, reason: policy.reason },
    },
    createMongoLeadIdentityStore(),
  );
  return { observation, policy, identity };
}

async function insertJobLevelRecordLink(input: {
  row: PlannedInboundJobPrefixRepairRow;
  loaded: Awaited<ReturnType<typeof loadApplyContext>>;
  job: string;
  persistDecision: boolean;
}): Promise<{ linkId?: string; insertedLink: boolean; insertedDecision: boolean }> {
  const snapshot = input.loaded.policy.snapshot;
  const linkId = new mongoose.Types.ObjectId();
  const decisionId = new mongoose.Types.ObjectId();
  const now = new Date();
  const source_scope =
    snapshot?.lead_source_company_id && snapshot.source_granularity_id
      ? {
          lead_source_company: toObjectId(snapshot.lead_source_company_id),
          source_granularity_id: toObjectId(snapshot.source_granularity_id),
        }
      : undefined;
  const link: GranotRecordLinkDocument = {
    _id: linkId,
    provider: "granot",
    normalized_job_no: input.job,
    job_no_snapshot: input.loaded.observation.identity?.job_no_raw ?? input.job,
    state: "active",
    source_scope,
    disputed: false,
    established_by_decision_id: decisionId,
    established_at: now,
    last_observation_id: input.loaded.observation._id,
    last_observed_at: now,
    domain_revision: 0,
  };
  return withTransaction(async (session) => {
    const raced = await getGranotRecordLinkModel()
      .findOne({ provider: "granot", state: "active", ...equivalentNormalizedJobFilter(input.job) })
      .session(session)
      .lean()
      .exec();
    if (raced) return { linkId: String(raced._id), insertedLink: false, insertedDecision: false };
    await getGranotRecordLinkModel().create([link], { session });
    if (!input.persistDecision) {
      return { linkId: String(linkId), insertedLink: true, insertedDecision: false };
    }
    await persistRepairDecision({
      row: input.row,
      reason_code: "record_link_established",
      decisionId,
      target: { model: "GranotRecordLink", id: String(linkId) },
      session,
      decidedAt: now,
      identity: input.loaded.identity,
    });
    return { linkId: String(linkId), insertedLink: true, insertedDecision: true };
  });
}

async function insertOwnerBookingCase(input: {
  row: PlannedInboundJobPrefixRepairRow;
  loaded: Awaited<ReturnType<typeof loadApplyContext>>;
  job: string;
  linkId?: string;
  store: ReturnType<typeof createMongoBookingReconciliationStore>;
  alsoInsertLink: boolean;
}): Promise<{ insertedCase: boolean; insertedLink: boolean; linkId?: string }> {
  const existing = await findOpenEquivalentCase(input.job);
  if (existing) return { insertedCase: false, insertedLink: false, linkId: input.linkId };
  const suggestion = toBookingLeadSuggestion(input.loaded.identity);
  const decisionId = new mongoose.Types.ObjectId();
  const caseId = new mongoose.Types.ObjectId();
  const now = new Date();
  let wrote = false;
  let insertedLink = false;
  let linkId = input.linkId;
  await input.store.withTransaction(async (session) => {
    if (input.alsoInsertLink && !linkId) {
      const racedLink = await getGranotRecordLinkModel()
        .findOne({ provider: "granot", state: "active", ...equivalentNormalizedJobFilter(input.job) })
        .session(session)
        .lean()
        .exec();
      if (racedLink) {
        linkId = String(racedLink._id);
      } else {
        const snapshot = input.loaded.policy.snapshot;
        const createdLinkId = new mongoose.Types.ObjectId();
        await getGranotRecordLinkModel().create(
          [
            {
              _id: createdLinkId,
              provider: "granot",
              normalized_job_no: input.job,
              job_no_snapshot: input.loaded.observation.identity?.job_no_raw ?? input.job,
              state: "active",
              source_scope:
                snapshot?.lead_source_company_id && snapshot.source_granularity_id
                  ? {
                      lead_source_company: toObjectId(snapshot.lead_source_company_id),
                      source_granularity_id: toObjectId(snapshot.source_granularity_id),
                    }
                  : undefined,
              disputed: false,
              established_by_decision_id: decisionId,
              established_at: now,
              last_observation_id: input.loaded.observation._id,
              last_observed_at: now,
              domain_revision: 0,
            },
          ],
          { session },
        );
        linkId = String(createdLinkId);
        insertedLink = true;
      }
    }
    const raced = await input.store.findOpenCase(input.job, session);
    if (raced) return;
    const sequence = (await input.store.findMaxSequence(input.job, session)) + 1;
    const snapshot = input.loaded.policy.snapshot;
    const caseRow: GranotBookingReconciliationCaseDocument = {
      _id: caseId,
      normalized_job_no: input.job,
      job_no_snapshot: input.loaded.observation.identity?.job_no_raw ?? input.job,
      action_kind: "booked",
      sequence_number: sequence,
      mode: "create_missing_booking",
      state: "open",
      case_revision: 1,
      evidence_revision: 1,
      source_scope:
        snapshot?.granot_crm_source_id && snapshot.lead_source_company_id && snapshot.source_granularity_id
          ? {
              granot_crm_source_id: toObjectId(snapshot.granot_crm_source_id),
              lead_source_company: toObjectId(snapshot.lead_source_company_id),
              source_granularity_id: toObjectId(snapshot.source_granularity_id),
            }
          : undefined,
      record_link_id: linkId ? toObjectId(linkId) : undefined,
      evidence: [
        {
          observation_id: input.loaded.observation._id,
          decision_id: decisionId,
          captured_at: new Date(input.loaded.observation.captured_at),
          action: "booked",
        },
      ],
      observed_context: {
        granot_priority: input.loaded.observation.priority?.canonical,
        granot_username:
          input.loaded.observation.agent_identity?.user_raw ?? input.loaded.observation.agent_identity?.rep_raw,
        estimate: input.loaded.observation.display_money?.estimate?.raw,
        move_date: input.loaded.observation.move?.move_date,
        estimated_cubic_feet: input.loaded.observation.move?.estimated_cubic_feet,
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
      last_evidence_at: new Date(input.loaded.observation.captured_at),
    };
    await input.store.insertCase(caseRow, session);
    await persistRepairDecision({
      row: input.row,
      reason_code: "booking_case_opened",
      decisionId,
      target: { model: "GranotBookingReconciliationCase", id: String(caseId) },
      session,
      decidedAt: now,
      identity: input.loaded.identity,
    });
    wrote = true;
  });
  return { insertedCase: wrote, insertedLink, linkId };
}

async function persistRepairDecision(input: {
  row: PlannedInboundJobPrefixRepairRow;
  reason_code: "record_link_established" | "booking_case_opened";
  decisionId: mongoose.Types.ObjectId;
  target: { model: "GranotRecordLink" | "GranotBookingReconciliationCase"; id: string };
  session: mongoose.ClientSession;
  decidedAt: Date;
  identity?: LeadIdentityResult;
}): Promise<void> {
  const existing = await getSynchronizationDecisionModel()
    .findOne({ observation_id: toObjectId(input.row.observation_id), attempt: input.row.attempt + 1 })
    .session(input.session)
    .lean()
    .exec();
  if (existing) {
    if (existing.reason_code !== input.reason_code) {
      throw new Error(
        `Observation ${input.row.observation_id} already has attempt ${input.row.attempt + 1} with ${existing.reason_code}.`,
      );
    }
    return;
  }
  const decision: SynchronizationDecisionDocument = {
    _id: input.decisionId,
    observation_id: toObjectId(input.row.observation_id),
    attempt: input.row.attempt + 1,
    execution_mode: "historical_shadow",
    outcome: "linked",
    reason_code: input.reason_code,
    match_method: input.identity?.match_method,
    target: input.target,
    candidates: input.identity?.candidates ?? (input.row.identity_target_id && input.row.identity_target_model
      ? [{
          target: { model: input.row.identity_target_model as "CallLead", id: input.row.identity_target_id },
          reason_codes: [input.row.identity_reason_code],
        }]
      : []),
    evaluated_gates: [{ gate: "operator_inbound_job_prefix_repair", allowed: true }],
    effects: [
      {
        kind: input.reason_code,
        ref: input.target,
      },
    ],
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

async function verifyRepair(rows: readonly PlannedInboundJobPrefixRepairRow[]): Promise<{
  ok: boolean;
  failures: string[];
}> {
  const failures: string[] = [];
  for (const row of rows) {
    const original = await getSynchronizationDecisionModel().findById(row.decision_id).lean().exec();
    if (!original) {
      failures.push(`original_decision_missing:${row.decision_id}`);
      continue;
    }
    if (original.reason_code !== "job_number_conflict" || original.outcome !== "conflict") {
      failures.push(`original_decision_mutated:${row.decision_id}`);
    }
    if (!row.observation_job) continue;
    if (row.execution_mode !== "historical_shadow") continue;
    if (row.jobs_prefix_equivalent && row.identity_would_link) {
      const link = await findActiveEquivalentLink(row.observation_job);
      if (!link) failures.push(`missing_record_link:${row.observation_job}`);
      if (link?.has_lead_ref) failures.push(`unexpected_lead_ref:${row.observation_job}`);
      const booking = await findEquivalentBooking(row.observation_job);
      if (booking) failures.push(`unexpected_official_booking:${row.observation_job}`);
    }
    if (row.booking_action === "booked" && row.jobs_prefix_equivalent && row.identity_would_link) {
      const openCase = await findOpenEquivalentCase(row.observation_job);
      if (!openCase) failures.push(`missing_booking_case:${row.observation_job}`);
    }
  }

  const jobs = [...new Set(rows.map((row) => row.observation_job).filter((job): job is string => Boolean(job)))];
  if (mongoose.connection.db && jobs.length > 0) {
    const surpriseChanges = await mongoose.connection.db.collection(ENTITY_CHANGE_COLLECTION).countDocuments({
      "command.provenance.origin": "granot_lifecycle",
      "after.normalized_job_no": { $in: jobs },
    });
    if (surpriseChanges > 0) {
      failures.push(`unexpected_entity_changes:${surpriseChanges}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseGranotLifecycleMigrationMode(args);
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

  const rows = await planLiveRows();
  const writes = planInboundJobPrefixRepairWrites(rows);
  if (mode === "apply") {
    assertInboundJobPrefixRepairApplyAllowed({ rows, writes });
    console.log(JSON.stringify({ phase: "planned_writes", writes }, null, 2));
  }

  const applied =
    mode === "apply"
      ? await applyWrites(rows)
      : { record_links: 0, booking_cases: 0, repair_decisions: 0 };
  const verify = mode === "verify" || mode === "apply" ? await verifyRepair(rows) : undefined;
  if (mode === "verify" && verify && !verify.ok) {
    throw new Error(`Inbound job-prefix repair verify failed: ${verify.failures.join(", ")}`);
  }

  const manifest = buildInboundJobPrefixRepairManifest({
    databaseName,
    mode,
    rows,
    writes: mode === "report" || mode === "apply" ? writes : [],
    applied,
    verify,
  });
  const pii = scanInboundJobPrefixRepairManifestForPii(manifest);
  if (pii.length > 0) {
    throw new Error(`Refusing to write repair manifest with PII paths: ${pii.join(", ")}`);
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
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
