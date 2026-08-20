import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { getCallLeadModel } from "../../models/CallLead";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getRingCentralInboundRouteModel } from "../../models/RingCentralInboundRoute";
import { getRingCentralInboundRouteAssignmentModel } from "../../models/RingCentralInboundRouteAssignment";
import {
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  persistEntityChangeMutations,
} from "../domainCommands/entityChange";
import { executeCanonicalCommandWithPostCommit } from "../domainCommands/idempotency";
import {
  DomainCommandIdempotencyConflictError,
  DomainRevisionConflictError,
  type CanonicalCommandContext,
  type CanonicalCommandResult,
} from "../domainCommands/types";
import { createRingCentralCallIngestActor } from "../durableWork";
import { resolveLeadCplSnapshot } from "../leads/leadCplResolution";
import { enqueueSheetSyncJob, finalizeSheetSync } from "../sheetSync";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import { normalizePhoneNumberToE164Like } from "./phone-normalization";
import { getRingCentralCollectionName } from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";
import {
  assertProcessedCallAdoptionIndexes,
  findProcessedCall,
  upsertProcessedCall,
} from "./processed-calls-store";
import { classifyRingCentralCallLeadDuplicate } from "./ringcentral-duplicate-guard";
import type { RingCentralQualifiedCall } from "./ringcentral-call-lead-ingest.service";

const ADOPTION_WINDOW_MS = 12 * 60 * 60 * 1000;
export const MULTIPLE_ADOPTION_CANDIDATES = "multiple_adoption_candidates" as const;

export class RingCentralConvergenceScopeRaceError extends Error {
  constructor() {
    super("RingCentral/Granot convergence scope changed before Call Lead creation.");
    this.name = "RingCentralConvergenceScopeRaceError";
  }
}

export type RingCentralQualifiedCallIdentity = {
  ingestionSource: "webhook" | "call_log_sync";
  telephonySessionId: string | null;
  sessionId: string | null;
  partyId: string | null;
  callLogId: string | null;
  routeId: string;
  routeAssignmentId: string;
  sourceCompanyId: string;
  sourceGranularityId: string;
  sourceCompanySlug: string;
  sourceCompanyLabelSnapshot: string;
  sourceGranularityLabelSnapshot: string;
  sourceLabelSnapshot: string | null;
  targetPhoneNumber: string;
  targetName: string | null;
  callerPhoneNumber: string;
  normalizedCallerPhoneNumber: string;
  startTime: Date;
  answeredAt: Date | null;
  terminalAt: Date | null;
  durationSeconds: number;
  qualificationReason: string;
};

export type RingCentralConvergenceCandidate = {
  call_lead_id: string;
  domain_revision: number;
};

export type RingCentralConvergenceSelection =
  | { outcome: "ineligible"; reason: "missing_start_time" | "missing_caller_phone" }
  | { outcome: "not_found"; candidates: [] }
  | { outcome: "candidate"; candidate: RingCentralConvergenceCandidate }
  | { outcome: "conflict"; candidates: RingCentralConvergenceCandidate[] };

export type RingCentralConvergenceAttempt =
  | { outcome: "disabled" | "not_found" | "ineligible" | "conflict" }
  | {
      outcome: "adopted";
      callLeadId: string;
      duplicate: boolean;
      duplicateReason: string | null;
    };

export type AdoptRingCentralCallInput = {
  call_lead_id: string;
  expected_domain_revision: number;
  qualified_call: RingCentralQualifiedCallIdentity;
  context: CanonicalCommandContext;
};

export type MarkRingCentralConvergenceConflictInput = {
  call_lead_ids: string[];
  expected_domain_revisions: Array<{
    call_lead_id: string;
    domain_revision: number;
  }>;
  conflict_reason: typeof MULTIPLE_ADOPTION_CANDIDATES;
  qualified_call: RingCentralQualifiedCallIdentity;
  context: CanonicalCommandContext;
};

type RingCentralConvergenceTestDependencies = {
  fail_after?:
    | "lead"
    | "changes"
    | "outbox"
    | "ledger";
};

type ConvergenceQueryRow = {
  _id: mongoose.Types.ObjectId;
  domain_revision?: number;
  ingested_contact_snapshot?: { normalized_phone_number?: string };
};

export type RingCentralConvergenceCandidateQuery = {
  source_granularity_id: string;
  normalized_phone_number: string;
  created_from: Date;
  created_to: Date;
  session?: ClientSession;
};

export type RingCentralConvergenceDependencies = {
  findCandidates: (
    query: RingCentralConvergenceCandidateQuery,
  ) => Promise<ConvergenceQueryRow[]>;
};

export async function ensureRingCentralConvergenceScopeLock(input: {
  source_granularity_id: string;
  normalized_phone_number: string | null | undefined;
}): Promise<boolean> {
  const identity = convergenceScopeIdentity(input);
  if (!identity) return false;
  const db = await getRingCentralDb();
  const collection = db.collection(
    getRingCentralCollectionName("convergenceLocks"),
  );
  const write = () =>
    collection.updateOne(
      { _id: identity as never },
      {
        $setOnInsert: {
          created_at: new Date(),
          identity_version: 1,
        },
        $set: { touched_at: new Date() },
      },
      { upsert: true },
    );
  try {
    await write();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await write();
  }
  return true;
}

export async function acquireRingCentralConvergenceScopeLock(input: {
  source_granularity_id: string;
  normalized_phone_number: string | null | undefined;
  session: ClientSession;
  now: Date;
}): Promise<boolean> {
  const identity = convergenceScopeIdentity(input);
  if (!identity) return false;
  const db = await getRingCentralDb();
  const result = await db
    .collection(getRingCentralCollectionName("convergenceLocks"))
    .updateOne(
      { _id: identity as never },
      {
        $set: {
          touched_at: input.now,
          transaction_nonce: new mongoose.Types.ObjectId(),
        },
      },
      { session: input.session },
    );
  if (result.matchedCount !== 1) {
    throw new RingCentralConvergenceScopeRaceError();
  }
  return true;
}

const defaultConvergenceDependencies: RingCentralConvergenceDependencies = {
  async findCandidates(query) {
    return (await getCallLeadModel()
      .find({
        source_granularity_id: query.source_granularity_id,
        ingestion_origin: "granot_lead_created",
        "ingested_contact_snapshot.normalized_phone_number":
          query.normalized_phone_number,
        "ringcentral_convergence.state": "pending",
        "ringcentral.telephony_session_id": { $in: [null, ""] },
        "ringcentral.session_id": { $in: [null, ""] },
        "ringcentral.call_log_id": { $in: [null, ""] },
        createdAt: { $gte: query.created_from, $lte: query.created_to },
      })
      .sort({ createdAt: 1, _id: 1 })
      .session(query.session ?? null)
      .lean()
      .exec()) as unknown as ConvergenceQueryRow[];
  },
};

export async function selectRingCentralConvergenceCandidates(
  call: RingCentralQualifiedCall,
  session?: ClientSession,
  deps: RingCentralConvergenceDependencies = defaultConvergenceDependencies,
): Promise<RingCentralConvergenceSelection> {
  if (!call.startTime || Number.isNaN(call.startTime.getTime())) {
    return { outcome: "ineligible", reason: "missing_start_time" };
  }
  const normalizedPhone = normalizePhoneNumberForMatch(call.callerPhoneNumber);
  if (!normalizedPhone) {
    return { outcome: "ineligible", reason: "missing_caller_phone" };
  }
  const from = new Date(call.startTime.getTime() - ADOPTION_WINDOW_MS);
  const to = new Date(call.startTime.getTime() + ADOPTION_WINDOW_MS);
  const rows = await deps.findCandidates({
    source_granularity_id: call.routeResolution.granularity_id,
    normalized_phone_number: normalizedPhone,
    created_from: from,
    created_to: to,
    session,
  });
  const candidates = rows
    .filter(
      (row) =>
        normalizePhoneNumberForMatch(
          row.ingested_contact_snapshot?.normalized_phone_number,
        ) === normalizedPhone,
    )
    .map((row) => ({
      call_lead_id: String(row._id),
      domain_revision: Number(row.domain_revision ?? 0),
    }));
  if (candidates.length === 0) return { outcome: "not_found", candidates: [] };
  if (candidates.length === 1) {
    return { outcome: "candidate", candidate: candidates[0]! };
  }
  return { outcome: "conflict", candidates };
}

export async function findPreCreationRingCentralConvergenceCandidates(input: {
  source_granularity_id: string;
  normalized_phone_number: string | null | undefined;
  session?: ClientSession;
}): Promise<RingCentralConvergenceCandidate[]> {
  const normalizedPhone = normalizePhoneNumberForMatch(
    input.normalized_phone_number,
  );
  if (!normalizedPhone) return [];
  const rows = (await getCallLeadModel()
    .find({
      source_granularity_id: input.source_granularity_id,
      $or: [
        { normalized_phone_number: normalizedPhone },
        {
          "ingested_contact_snapshot.normalized_phone_number":
            normalizedPhone,
        },
      ],
      duplicate: { $ne: true },
    })
    .sort({ createdAt: 1, _id: 1 })
    .session(input.session ?? null)
    .lean()
    .exec()) as unknown as ConvergenceQueryRow[];
  return rows.map((row) => ({
    call_lead_id: String(row._id),
    domain_revision: Number(row.domain_revision ?? 0),
  }));
}

export async function attemptRingCentralCallLeadConvergence(input: {
  call: RingCentralQualifiedCall;
  enabled: boolean;
  allowMutations: boolean;
}, raceRetries = 0, testDeps: {
  after_selection?: (selection: RingCentralConvergenceSelection) => Promise<void>;
} = {}): Promise<RingCentralConvergenceAttempt> {
  if (!input.enabled) return { outcome: "disabled" };
  await ensureRingCentralConvergenceScopeLock({
    source_granularity_id: input.call.routeResolution.granularity_id,
    normalized_phone_number: input.call.callerPhoneNumber,
  });
  const selection = await selectRingCentralConvergenceCandidates(input.call);
  await testDeps.after_selection?.(selection);
  if (selection.outcome === "ineligible") return { outcome: "ineligible" };
  if (selection.outcome === "not_found") {
    const raced = await findProcessedCall({
      telephonySessionId: input.call.telephonySessionId,
      sessionId: input.call.sessionId,
      callLogId: input.call.callLogId,
    });
    if (
      raced?.callLeadId &&
      (raced.status === "lead_adopted" ||
        raced.status === "lead_adopted_duplicate")
    ) {
      return {
        outcome: "adopted",
        callLeadId: raced.callLeadId,
        duplicate: raced.duplicate,
        duplicateReason: raced.duplicateReason,
      };
    }
    return { outcome: "not_found" };
  }
  if (!input.allowMutations) {
    return { outcome: selection.outcome === "candidate" ? "not_found" : "conflict" };
  }

  await assertProcessedCallAdoptionIndexes();
  const qualifiedCall = toQualifiedCallIdentity(input.call);
  if (selection.outcome === "conflict") {
    const context = buildRingCentralCommandContext(
      "convergence-conflict",
      qualifiedCall,
      selection.candidates,
    );
    try {
      await markRingCentralConvergenceConflict({
        call_lead_ids: selection.candidates.map(
          (candidate) => candidate.call_lead_id,
        ),
        expected_domain_revisions: selection.candidates,
        conflict_reason: MULTIPLE_ADOPTION_CANDIDATES,
        qualified_call: qualifiedCall,
        context,
      });
    } catch (error) {
      if (
        isConvergenceCommandRace(error) &&
        raceRetries < 2
      ) {
        return attemptRingCentralCallLeadConvergence(
          input,
          raceRetries + 1,
          testDeps,
        );
      }
      throw error;
    }
    return { outcome: "conflict" };
  }

  const context = buildRingCentralCommandContext(
    "adopt",
    qualifiedCall,
    selection.candidate,
  );
  try {
    await adoptRingCentralCall({
      call_lead_id: selection.candidate.call_lead_id,
      expected_domain_revision: selection.candidate.domain_revision,
      qualified_call: qualifiedCall,
      context,
    });
  } catch (error) {
    if (isConvergenceCommandRace(error) && raceRetries < 2) {
      const raced = await findProcessedCall({
        telephonySessionId: qualifiedCall.telephonySessionId,
        sessionId: qualifiedCall.sessionId,
        callLogId: qualifiedCall.callLogId,
      });
      if (
        raced?.callLeadId &&
        (raced.status === "lead_adopted" ||
          raced.status === "lead_adopted_duplicate")
      ) {
        return {
          outcome: "adopted",
          callLeadId: raced.callLeadId,
          duplicate: raced.duplicate,
          duplicateReason: raced.duplicateReason,
        };
      }
      return attemptRingCentralCallLeadConvergence(
        input,
        raceRetries + 1,
        testDeps,
      );
    }
    throw error;
  }
  const stored = await findProcessedCall({
    telephonySessionId: qualifiedCall.telephonySessionId,
    sessionId: qualifiedCall.sessionId,
    callLogId: qualifiedCall.callLogId,
  });
  if (
    !stored ||
    (stored.status !== "lead_adopted" &&
      stored.status !== "lead_adopted_duplicate")
  ) {
    throw new Error("RingCentral adoption committed without a terminal ledger result.");
  }
  return {
    outcome: "adopted",
    callLeadId: stored.callLeadId!,
    duplicate: stored.duplicate,
    duplicateReason: stored.duplicateReason,
  };
}

export async function adoptRingCentralCall(
  input: AdoptRingCentralCallInput,
  deps: RingCentralConvergenceTestDependencies = {},
): Promise<CanonicalCommandResult> {
  assertAdoptionEnvelope(input);
  const pending = await executeCanonicalCommandWithPostCommit({
    command_name: "adoptRingCentralCall",
    context: input.context,
    operation: async (tx) => {
      const result = await applyAdoption(
        input,
        tx.session,
        tx.now,
        tx.command_execution_id,
        deps,
      );
      return { entity_refs: result.entity_refs, pending: result.sheetJob };
    },
    finalize: finalizeSheetSync,
  });
  return {
    status: "applied",
    entity_refs: pending.entity_refs,
    warnings: pending.warnings,
  };
}

export async function markRingCentralConvergenceConflict(
  input: MarkRingCentralConvergenceConflictInput,
  deps: RingCentralConvergenceTestDependencies = {},
): Promise<CanonicalCommandResult> {
  assertConflictEnvelope(input);
  const pending = await executeCanonicalCommandWithPostCommit({
    command_name: "markRingCentralConvergenceConflict",
    context: input.context,
    operation: async (tx) => {
      const result = await applyConflict(
        input,
        tx.session,
        tx.now,
        tx.command_execution_id,
        deps,
      );
      return { entity_refs: result.entity_refs, pending: result.sheetJobs };
    },
    finalize: async (jobs) => {
      for (const job of jobs) await finalizeSheetSync(job);
    },
  });
  return {
    status: "applied",
    entity_refs: pending.entity_refs,
    warnings: pending.warnings,
  };
}

async function applyAdoption(
  input: AdoptRingCentralCallInput,
  session: ClientSession,
  now: Date,
  commandExecutionId: mongoose.Types.ObjectId,
  deps: RingCentralConvergenceTestDependencies,
) {
  await acquireRingCentralConvergenceScopeLock({
    source_granularity_id: input.qualified_call.sourceGranularityId,
    normalized_phone_number:
      input.qualified_call.normalizedCallerPhoneNumber,
    session,
    now,
  });
  await assertVerifiedRoute(input.qualified_call, session);
  const selection = await selectRingCentralConvergenceCandidates(
    fromQualifiedIdentity(input.qualified_call),
    session,
  );
  if (
    selection.outcome !== "candidate" ||
    selection.candidate.call_lead_id !== input.call_lead_id ||
    selection.candidate.domain_revision !== input.expected_domain_revision
  ) {
    throw new DomainRevisionConflictError(
      "RingCentral adoption candidate changed before commit.",
    );
  }
  const duplicate = await classifyRingCentralCallLeadDuplicate({
    sourceCompany: input.qualified_call.sourceCompanySlug as never,
    leadSourceCompany: input.qualified_call.sourceCompanyId,
    sourceGranularityId: input.qualified_call.sourceGranularityId,
    callerPhoneNumber: input.qualified_call.callerPhoneNumber,
    telephonySessionId: input.qualified_call.telephonySessionId,
    sessionId: input.qualified_call.sessionId,
    callLogId: input.qualified_call.callLogId,
    callLeadIdToExclude: input.call_lead_id,
    callTimestamp: input.qualified_call.startTime,
    session,
  });
  const Lead = getCallLeadModel();
  const before = await Lead.findById(input.call_lead_id)
    .session(session)
    .lean()
    .exec();
  if (!before) throw new DomainRevisionConflictError();
  const duplicateCpl = duplicate.isDuplicate
    ? await resolveLeadCplSnapshot({
        sourceGranularityId: input.qualified_call.sourceGranularityId,
        storedBusinessTimestamp: input.qualified_call.startTime,
        duplicate: true,
      })
    : {};
  const convergence = before.ringcentral_convergence as
    | { observation_id?: mongoose.Types.ObjectId }
    | undefined;
  const set = {
    duration: input.qualified_call.durationSeconds,
    start_time: input.qualified_call.startTime,
    end_time: input.qualified_call.terminalAt,
    duplicate: duplicate.isDuplicate,
    ...duplicateCpl,
    ringcentral: {
      ...(input.qualified_call.telephonySessionId
        ? {
            telephony_session_id:
              input.qualified_call.telephonySessionId,
          }
        : {}),
      ...(input.qualified_call.sessionId
        ? { session_id: input.qualified_call.sessionId }
        : {}),
      ...(input.qualified_call.partyId
        ? { party_id: input.qualified_call.partyId }
        : {}),
      ...(input.qualified_call.callLogId
        ? { call_log_id: input.qualified_call.callLogId }
        : {}),
      source_label: input.qualified_call.sourceLabelSnapshot,
      ingestion_source: input.qualified_call.ingestionSource,
      qualification_reason: input.qualified_call.qualificationReason,
      start_time: input.qualified_call.startTime,
      end_time: input.qualified_call.terminalAt,
      answered_at: input.qualified_call.answeredAt,
      terminal_at: input.qualified_call.terminalAt,
      duration_seconds: input.qualified_call.durationSeconds,
      route_id: input.qualified_call.routeId,
      route_assignment_id: input.qualified_call.routeAssignmentId,
      target_phone_number: input.qualified_call.targetPhoneNumber,
      target_name: input.qualified_call.targetName,
      original_caller: {
        phone_number: input.qualified_call.callerPhoneNumber,
        normalized_phone_number:
          input.qualified_call.normalizedCallerPhoneNumber,
        captured_at: now,
      },
    },
    ringcentral_convergence: {
      ...(before.ringcentral_convergence as Record<string, unknown> | undefined),
      state: "adopted",
      adopted_at: now,
      ...(convergence?.observation_id
        ? { observation_id: convergence.observation_id }
        : {}),
    },
  };
  const updated = await Lead.findOneAndUpdate(
    {
      _id: input.call_lead_id,
      domain_revision: input.expected_domain_revision,
      ingestion_origin: "granot_lead_created",
      "ringcentral_convergence.state": "pending",
      "ringcentral.telephony_session_id": { $in: [null, ""] },
      "ringcentral.session_id": { $in: [null, ""] },
      "ringcentral.call_log_id": { $in: [null, ""] },
      "ringcentral.original_caller": { $exists: false },
    },
    { $set: set },
    { returnDocument: "after", session, runValidators: true },
  )
    .lean()
    .exec();
  if (!updated) throw new DomainRevisionConflictError();
  failAfter(deps, "lead");
  const fields = collectDocumentFieldChanges(
    before as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
    CALL_LEAD_CHANGE_PATHS,
  );
  await persistEntityChangeMutations({
    session,
    now,
    command_name: "adoptRingCentralCall",
    command_execution_id: commandExecutionId,
    context: input.context,
    mutations: [
      {
        change_id: new mongoose.Types.ObjectId(),
        entity: { model: "CallLead", id: input.call_lead_id },
        revision_before: input.expected_domain_revision,
        fields,
      },
    ],
  });
  failAfter(deps, "changes");
  const sheetJob = {
    resource: "source_lead" as const,
    operation: "call_lead.update" as const,
    leadModel: "CallLead" as const,
    leadId: input.call_lead_id,
  };
  await enqueueSheetSyncJob(sheetJob, { session, createdBy: "api" });
  failAfter(deps, "outbox");
  await upsertProcessedCall({
    provider: "ringcentral",
    telephonySessionId: input.qualified_call.telephonySessionId,
    sessionId: input.qualified_call.sessionId,
    callLogId: input.qualified_call.callLogId,
    ingestionSource: input.qualified_call.ingestionSource,
    status: duplicate.isDuplicate ? "lead_adopted_duplicate" : "lead_adopted",
    duplicate: duplicate.isDuplicate,
    duplicateReason: duplicate.reason,
    sourceCompany: input.qualified_call.sourceCompanySlug as never,
    sourceLabel: input.qualified_call.sourceLabelSnapshot,
    callerPhoneNumber: input.qualified_call.callerPhoneNumber,
    durationSeconds: input.qualified_call.durationSeconds,
    qualificationReason: input.qualified_call.qualificationReason,
    callLeadId: input.call_lead_id,
    now,
    session,
  });
  failAfter(deps, "ledger");
  return {
    entity_refs: [{ model: "CallLead", id: input.call_lead_id }],
    sheetJob,
  };
}

async function applyConflict(
  input: MarkRingCentralConvergenceConflictInput,
  session: ClientSession,
  now: Date,
  commandExecutionId: mongoose.Types.ObjectId,
  deps: RingCentralConvergenceTestDependencies,
) {
  await acquireRingCentralConvergenceScopeLock({
    source_granularity_id: input.qualified_call.sourceGranularityId,
    normalized_phone_number:
      input.qualified_call.normalizedCallerPhoneNumber,
    session,
    now,
  });
  await assertVerifiedRoute(input.qualified_call, session);
  const selection = await selectRingCentralConvergenceCandidates(
    fromQualifiedIdentity(input.qualified_call),
    session,
  );
  const expected = [...input.expected_domain_revisions].sort((a, b) =>
    a.call_lead_id.localeCompare(b.call_lead_id),
  );
  const current =
    selection.outcome === "conflict"
      ? [...selection.candidates].sort((a, b) =>
          a.call_lead_id.localeCompare(b.call_lead_id),
        )
      : [];
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new DomainRevisionConflictError(
      "RingCentral convergence candidate set changed before conflict persistence.",
    );
  }
  const callIdentityHash = hashQualifiedCallIdentity(input.qualified_call);
  const mutations: Array<{
    change_id: mongoose.Types.ObjectId;
    entity: { model: "CallLead"; id: string };
    revision_before: number;
    fields: Array<{ path: string; before?: unknown; after?: unknown }>;
  }> = [];
  const sheetJobs: Array<{
    resource: "source_lead";
    operation: "call_lead.update";
    leadModel: "CallLead";
    leadId: string;
  }> = [];
  for (const candidate of expected) {
    const Lead = getCallLeadModel();
    const before = await Lead.findById(candidate.call_lead_id)
      .session(session)
      .lean()
      .exec();
    const updated = await Lead.findOneAndUpdate(
      {
        _id: candidate.call_lead_id,
        domain_revision: candidate.domain_revision,
        ingestion_origin: "granot_lead_created",
        "ringcentral_convergence.state": "pending",
      },
      {
        $set: {
          "ringcentral_convergence.state": "conflict",
          "ringcentral_convergence.conflict_reason": input.conflict_reason,
          "ringcentral_convergence.conflict_call_identity_hash":
            callIdentityHash,
        },
      },
      { returnDocument: "after", session, runValidators: true },
    )
      .lean()
      .exec();
    if (!before || !updated) throw new DomainRevisionConflictError();
    mutations.push({
      change_id: new mongoose.Types.ObjectId(),
      entity: { model: "CallLead", id: candidate.call_lead_id },
      revision_before: candidate.domain_revision,
      fields: collectDocumentFieldChanges(
        before as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
        CALL_LEAD_CHANGE_PATHS,
      ),
    });
    const job = {
      resource: "source_lead" as const,
      operation: "call_lead.update" as const,
      leadModel: "CallLead" as const,
      leadId: candidate.call_lead_id,
    };
    sheetJobs.push(job);
  }
  failAfter(deps, "lead");
  await persistEntityChangeMutations({
    session,
    now,
    command_name: "markRingCentralConvergenceConflict",
    command_execution_id: commandExecutionId,
    context: input.context,
    mutations,
  });
  failAfter(deps, "changes");
  for (const job of sheetJobs) {
    await enqueueSheetSyncJob(job, { session, createdBy: "api" });
  }
  failAfter(deps, "outbox");
  return {
    entity_refs: expected.map((candidate) => ({
      model: "CallLead",
      id: candidate.call_lead_id,
    })),
    sheetJobs,
  };
}

export function toQualifiedCallIdentity(
  call: RingCentralQualifiedCall,
): RingCentralQualifiedCallIdentity {
  const normalizedCallerPhoneNumber = normalizePhoneNumberForMatch(
    call.callerPhoneNumber,
  );
  if (
    !call.startTime ||
    !normalizedCallerPhoneNumber ||
    (!call.telephonySessionId && !call.callLogId)
  ) {
    throw new Error(
      "RingCentral convergence requires call start, caller phone, and a stable call identity.",
    );
  }
  return {
    ingestionSource: call.ingestionSource,
    telephonySessionId: call.telephonySessionId,
    sessionId: call.sessionId,
    partyId: call.partyId,
    callLogId: call.callLogId,
    routeId: call.routeResolution.route_id,
    routeAssignmentId: call.routeResolution.assignment_id,
    sourceCompanyId: call.routeResolution.company_id,
    sourceGranularityId: call.routeResolution.granularity_id,
    sourceCompanySlug: call.routeResolution.company_slug,
    sourceCompanyLabelSnapshot:
      call.routeResolution.company_label_snapshot,
    sourceGranularityLabelSnapshot:
      call.routeResolution.granularity_label_snapshot,
    sourceLabelSnapshot: call.sourceLabel,
    targetPhoneNumber: call.routeResolution.normalized_target_number,
    targetName: call.targetName,
    callerPhoneNumber: call.callerPhoneNumber,
    normalizedCallerPhoneNumber,
    startTime: call.startTime,
    answeredAt: call.answeredAt,
    terminalAt: call.terminalAt,
    durationSeconds: call.durationSeconds,
    qualificationReason: call.qualificationReason,
  };
}

function fromQualifiedIdentity(
  call: RingCentralQualifiedCallIdentity,
): RingCentralQualifiedCall {
  return {
    ingestionSource: call.ingestionSource,
    telephonySessionId: call.telephonySessionId,
    sessionId: call.sessionId,
    partyId: call.partyId,
    callLogId: call.callLogId,
    sourceCompany: call.sourceCompanySlug,
    sourceLabel: call.sourceLabelSnapshot,
    routeResolution: {
      route_id: call.routeId,
      assignment_id: call.routeAssignmentId,
      normalized_target_number: call.targetPhoneNumber,
      company_id: call.sourceCompanyId,
      company_slug: call.sourceCompanySlug,
      company_label_snapshot: call.sourceCompanyLabelSnapshot,
      granularity_id: call.sourceGranularityId,
      granularity_key: "",
      granularity_label_snapshot:
        call.sourceGranularityLabelSnapshot,
      crm_label_snapshot: call.sourceLabelSnapshot ?? "",
    },
    callerPhoneNumber: call.callerPhoneNumber,
    callerName: null,
    targetPhoneNumber: call.targetPhoneNumber,
    targetName: call.targetName,
    answeredAt: call.answeredAt,
    terminalAt: call.terminalAt,
    startTime: call.startTime,
    durationSeconds: call.durationSeconds,
    qualificationReason: call.qualificationReason,
  };
}

export function buildRingCentralCommandContext(
  operation: "adopt" | "convergence-conflict",
  call: RingCentralQualifiedCallIdentity,
  target:
    | RingCentralConvergenceCandidate
    | RingCentralConvergenceCandidate[],
): CanonicalCommandContext {
  const identity = stableCallIdentity(call);
  const actor = createRingCentralCallIngestActor(identity);
  return {
    command_id: new mongoose.Types.ObjectId().toString(),
    idempotency_key: `ringcentral:${operation}:${identity}`,
    payload_checksum: hashCanonical({
      operation,
      target,
      call: canonicalQualifiedCall(call),
    }),
    actor,
    initiator: actor,
    provenance: {
      origin: "ringcentral",
      run_id: null,
      source_receipt_id: identity,
      source_connection_key: `ringcentral:${call.ingestionSource}:${identity}`,
      observation_id: null,
      decision_id: null,
      case_id: null,
      discrepancy_id: null,
      observation_channel: null,
    },
  };
}

async function assertVerifiedRoute(
  call: RingCentralQualifiedCallIdentity,
  session: ClientSession,
): Promise<void> {
  const [route, assignment, company, granularity] = await Promise.all([
    getRingCentralInboundRouteModel()
      .findOne({
        _id: call.routeId,
        active: true,
        validation_status: "valid",
      })
      .session(session)
      .lean()
      .exec(),
    getRingCentralInboundRouteAssignmentModel()
      .findById(call.routeAssignmentId)
      .session(session)
      .lean()
      .exec(),
    getLeadSourceCompanyModel()
      .findById(call.sourceCompanyId)
      .session(session)
      .lean()
      .exec(),
    getLeadSourceGranularityModel()
      .findById(call.sourceGranularityId)
      .session(session)
      .lean()
      .exec(),
  ]);
  const target = normalizePhoneNumberToE164Like(route?.phone_number);
  if (
    !route ||
    !assignment ||
    !company ||
    !granularity ||
    company.active !== true ||
    granularity.active !== true ||
    granularity.channel !== "call" ||
    String(granularity.source_company) !== call.sourceCompanyId ||
    String(assignment.route) !== call.routeId ||
    String(assignment.source_company) !== call.sourceCompanyId ||
    String(assignment.source_granularity) !== call.sourceGranularityId ||
    assignment.active !== true ||
    new Date(assignment.effective_from).getTime() >
      call.startTime.getTime() ||
    (assignment.effective_until != null &&
      new Date(assignment.effective_until).getTime() <=
        call.startTime.getTime()) ||
    target !== call.targetPhoneNumber
  ) {
    throw new Error("RingCentral qualified call route proof is no longer valid.");
  }
}

function assertAdoptionEnvelope(input: AdoptRingCentralCallInput): void {
  const expectedKey = `ringcentral:adopt:${stableCallIdentity(input.qualified_call)}`;
  if (
    input.context.provenance.origin !== "ringcentral" ||
    input.context.idempotency_key !== expectedKey ||
    input.context.payload_checksum !==
      hashCanonical({
        operation: "adopt",
        target: {
          call_lead_id: input.call_lead_id,
          domain_revision: input.expected_domain_revision,
        },
        call: canonicalQualifiedCall(input.qualified_call),
      })
  ) {
    throw new Error("Invalid RingCentral adoption command envelope.");
  }
}

function assertConflictEnvelope(
  input: MarkRingCentralConvergenceConflictInput,
): void {
  const expectedKey = `ringcentral:convergence-conflict:${stableCallIdentity(
    input.qualified_call,
  )}`;
  if (
    input.conflict_reason !== MULTIPLE_ADOPTION_CANDIDATES ||
    input.call_lead_ids.length < 2 ||
    input.context.provenance.origin !== "ringcentral" ||
    input.context.idempotency_key !== expectedKey ||
    input.context.payload_checksum !==
      hashCanonical({
        operation: "convergence-conflict",
        target: input.expected_domain_revisions,
        call: canonicalQualifiedCall(input.qualified_call),
      })
  ) {
    throw new Error("Invalid RingCentral convergence-conflict command envelope.");
  }
}

function stableCallIdentity(call: RingCentralQualifiedCallIdentity): string {
  const identity = call.telephonySessionId ?? call.callLogId;
  if (!identity?.trim()) {
    throw new Error("RingCentral qualified call has no stable identity.");
  }
  return identity.trim();
}

function hashQualifiedCallIdentity(
  call: RingCentralQualifiedCallIdentity,
): string {
  return hashCanonical(canonicalQualifiedCall(call));
}

function canonicalQualifiedCall(call: RingCentralQualifiedCallIdentity) {
  return {
    ...call,
    startTime: call.startTime.toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    terminalAt: call.terminalAt?.toISOString() ?? null,
  };
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function failAfter(
  deps: RingCentralConvergenceTestDependencies,
  stage: NonNullable<RingCentralConvergenceTestDependencies["fail_after"]>,
): void {
  if (deps.fail_after === stage) {
    throw new Error(
      `Injected RingCentral convergence rollback after ${stage}.`,
    );
  }
}

function convergenceScopeIdentity(input: {
  source_granularity_id: string;
  normalized_phone_number: string | null | undefined;
}): string | null {
  const sourceGranularityId = input.source_granularity_id.trim();
  const normalizedPhone = normalizePhoneNumberForMatch(
    input.normalized_phone_number,
  );
  if (!sourceGranularityId || !normalizedPhone) return null;
  return createHash("sha256")
    .update(`v1:${sourceGranularityId}:${normalizedPhone}`)
    .digest("hex");
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000,
  );
}

function isConvergenceCommandRace(error: unknown): boolean {
  return (
    error instanceof DomainRevisionConflictError ||
    error instanceof DomainCommandIdempotencyConflictError
  );
}
