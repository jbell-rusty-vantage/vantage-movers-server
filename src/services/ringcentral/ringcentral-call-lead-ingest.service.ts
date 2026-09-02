import { logger } from "../../logger";
import { withTransaction } from "../../db";
import { recordOperationalEvent } from "../observability";
import {
  beginRingCentralCallLeadIngestion,
  completeCallLeadIngestion,
  ingestRingCentralCallLead,
  type CreateRingCentralCallLeadInput,
} from "../leads/callLead.service";
import type { RingCentralRouteResolution } from "../operationsRegistry";
import type { SourceCompany } from "../../config/domain";
import { classifyRingCentralCallLeadDuplicate } from "./ringcentral-duplicate-guard";
import {
  isRingCentralGranotAdoptionEnabled,
  resolveRingCentralLeadWriteMode,
} from "./ringcentral-config";
import {
  acquireRingCentralConvergenceScopeLock,
  attemptRingCentralCallLeadConvergence,
  RingCentralConvergenceScopeRaceError,
  selectRingCentralConvergenceCandidates,
} from "./callLeadConvergence.service";
import {
  findProcessedCall,
  assertProcessedCallAdoptionIndexes,
  RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES,
  upsertProcessedCall,
  type RingCentralProcessedCallStatus,
} from "./processed-calls-store";
import { insertShadowCallLead } from "./shadow-call-leads-store";
import type { RingCentralAdoptionOutcome } from "./ringcentral-metrics";

/**
 * The single, path-agnostic descriptor of a call that has qualified as a
 * lead. Both the webhook session aggregator and the Call Log cron build one
 * of these and hand it to `ingestRingCentralQualifiedCall`, so duplicate
 * rules, idempotency, and the create/shadow/dry-run decision are identical no
 * matter which strategy produced it.
 */
export type RingCentralQualifiedCall = {
  ingestionSource: "webhook" | "call_log_sync";
  telephonySessionId: string | null;
  sessionId: string | null;
  partyId: string | null;
  callLogId: string | null;
  sourceCompany: string;
  sourceLabel: string | null;
  routeResolution: RingCentralRouteResolution;
  callerPhoneNumber: string;
  callerName: string | null;
  targetPhoneNumber: string;
  targetName: string | null;
  answeredAt: Date | null;
  terminalAt: Date | null;
  startTime: Date | null;
  durationSeconds: number;
  qualificationReason: string;
};

export type RingCentralIngestAction =
  | "lead_created"
  | "lead_created_duplicate"
  | "lead_adopted"
  | "lead_adopted_duplicate"
  | "shadow_recorded"
  | "dry_run"
  | "skipped_already_processed";

export type RingCentralIngestResult = {
  action: RingCentralIngestAction;
  duplicate: boolean;
  duplicateReason: string | null;
  callLeadId: string | null;
  telephonySessionId: string | null;
  callLogId: string | null;
  /**
   * Read-only report of the Unit 20 convergence attempt for bounded caller
   * telemetry (Section 33 `ringcentral_adoptions_total{outcome}`). It reports
   * what convergence already decided and never changes candidate selection,
   * transaction, or duplicate rules. `null` means convergence was not reached
   * because the call was already terminal in the processed-call ledger.
   */
  convergenceOutcome: RingCentralAdoptionOutcome | null;
};

export type RingCentralIngestDependencies = {
  findProcessedCall: typeof findProcessedCall;
  attemptConvergence: typeof attemptRingCentralCallLeadConvergence;
  classifyDuplicate: typeof classifyRingCentralCallLeadDuplicate;
  resolveWriteMode: typeof resolveRingCentralLeadWriteMode;
  adoptionEnabled: typeof isRingCentralGranotAdoptionEnabled;
  assertAdoptionIndexes: typeof assertProcessedCallAdoptionIndexes;
  createLead: (
    input: CreateRingCentralCallLeadInput,
  ) => Promise<{ _id: { toString(): string } }>;
  insertShadow: typeof insertShadowCallLead;
  upsertProcessedCall: typeof upsertProcessedCall;
  recordEvent: typeof recordOperationalEvent;
};

const defaultIngestDependencies: RingCentralIngestDependencies = {
  findProcessedCall,
  attemptConvergence: attemptRingCentralCallLeadConvergence,
  classifyDuplicate: classifyRingCentralCallLeadDuplicate,
  resolveWriteMode: resolveRingCentralLeadWriteMode,
  adoptionEnabled: isRingCentralGranotAdoptionEnabled,
  assertAdoptionIndexes: assertProcessedCallAdoptionIndexes,
  createLead: ingestRingCentralCallLead,
  insertShadow: insertShadowCallLead,
  upsertProcessedCall,
  recordEvent: recordOperationalEvent,
};

/**
 * Materializes a qualified call into a lead according to the current env
 * posture. Order of operations:
 *
 *   1. Idempotency — if this session/call-log was already turned into a lead,
 *      skip (cross-path safe).
 *   2. Duplicate classification — same caller + source within the window?
 *   3. Write — create real lead, shadow lead, or dry-run, per env flags.
 *   4. Ledger — record the outcome in `ringcentral_processed_calls`.
 *
 * Never throws on the happy path failing to create a lead due to a race; the
 * unique session index + processed-calls ledger absorb double attempts.
 */
export async function ingestRingCentralQualifiedCall(
  call: RingCentralQualifiedCall,
  now: Date = new Date(),
  dependencies: Partial<RingCentralIngestDependencies> = {},
  convergenceRaceRetries = 0,
): Promise<RingCentralIngestResult> {
  const deps = { ...defaultIngestDependencies, ...dependencies };
  const existing = await deps.findProcessedCall({
    telephonySessionId: call.telephonySessionId,
    sessionId: call.sessionId,
    callLogId: call.callLogId,
  });

  if (
    existing &&
    RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES.includes(
      existing.status as (typeof RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES)[number],
    )
  ) {
    logger.info({
      msg: "ringcentral.ingest.skipped_already_processed",
      telephonySessionId: call.telephonySessionId,
      callLogId: call.callLogId,
      previousStatus: existing.status,
      ingestionSource: call.ingestionSource,
    });
    await deps.recordEvent({
      level: "info",
      eventKey: "ringcentral.call_lead.skipped_already_processed",
      category: "ringcentral",
      workflow: "ringcentral_call_lead_ingest",
      summary: "RingCentral call already processed; ingest skipped.",
      sourceCompany: call.sourceCompany as SourceCompany,
      entity: existing.callLeadId
        ? { type: "call_lead", id: existing.callLeadId }
        : undefined,
      details: {
        telephonySessionId: call.telephonySessionId,
        callLogId: call.callLogId,
        previousStatus: existing.status,
        ingestionSource: call.ingestionSource,
        callLeadId: existing.callLeadId,
      },
      reportable: false,
    });
    return {
      action: "skipped_already_processed",
      duplicate: existing.duplicate,
      duplicateReason: existing.duplicateReason,
      callLeadId: existing.callLeadId,
      telephonySessionId: call.telephonySessionId,
      callLogId: call.callLogId,
      convergenceOutcome: null,
    };
  }

  const writeMode = deps.resolveWriteMode();
  const adoptionEnabled = deps.adoptionEnabled();
  if (
    writeMode === "create" &&
    (adoptionEnabled ||
      (!call.telephonySessionId && Boolean(call.callLogId)))
  ) {
    await deps.assertAdoptionIndexes();
  }
  if (adoptionEnabled) {
    await deps.recordEvent({
      level: "info",
      eventKey: "ringcentral.call_lead.convergence_attempted",
      category: "ringcentral",
      workflow: "ringcentral_call_lead_convergence",
      summary: "Qualified RingCentral call entered Granot Call Lead convergence.",
      sourceCompany: call.sourceCompany as SourceCompany,
      details: {
        outcome: "attempted",
        route_id: call.routeResolution.route_id,
        ingestion_source: call.ingestionSource,
      },
      notificationCandidate: false,
      reportable: false,
    });
  }
  const convergence = await deps.attemptConvergence({
    call,
    enabled: adoptionEnabled,
    allowMutations: writeMode === "create",
  });
  if (convergence.outcome === "adopted") {
    const action = convergence.duplicate
      ? "lead_adopted_duplicate"
      : "lead_adopted";
    await deps.recordEvent({
      level: convergence.duplicate ? "warn" : "info",
      eventKey: "ringcentral.granot_adoption.adopted",
      category: "ringcentral",
      workflow: "ringcentral_call_lead_convergence",
      summary: convergence.duplicate
        ? "Qualified RingCentral call adopted into a Granot-created duplicate Call Lead."
        : "Qualified RingCentral call adopted into a Granot-created Call Lead.",
      sourceCompany: call.sourceCompany as SourceCompany,
      entity: { type: "call_lead", id: convergence.callLeadId },
      details: {
        outcome: action,
        route_id: call.routeResolution.route_id,
        ingestion_source: call.ingestionSource,
      },
      notificationCandidate: false,
      reportable: false,
    });
    return {
      action,
      duplicate: convergence.duplicate,
      duplicateReason: convergence.duplicateReason,
      callLeadId: convergence.callLeadId,
      telephonySessionId: call.telephonySessionId,
      callLogId: call.callLogId,
      convergenceOutcome: "adopted",
    };
  }
  if (
    convergence.outcome === "conflict" ||
    convergence.outcome === "not_found" ||
    convergence.outcome === "ineligible"
  ) {
    await deps.recordEvent({
      level: convergence.outcome === "conflict" ? "warn" : "info",
      eventKey: convergence.outcome === "conflict"
        ? "ringcentral.granot_adoption.conflict"
        : `ringcentral.call_lead.convergence_${convergence.outcome}`,
      category: "ringcentral",
      workflow: "ringcentral_call_lead_convergence",
      summary:
        convergence.outcome === "conflict"
          ? "Qualified RingCentral call found multiple Granot Call Lead convergence candidates."
          : convergence.outcome === "not_found"
            ? "Qualified RingCentral call found no Granot Call Lead convergence candidate."
            : "Qualified RingCentral call was ineligible for Granot Call Lead convergence.",
      sourceCompany: call.sourceCompany as SourceCompany,
      details: {
        outcome: convergence.outcome,
        route_id: call.routeResolution.route_id,
        ingestion_source: call.ingestionSource,
      },
      notificationCandidate: false,
      reportable: false,
    });
  }

  const callTimestamp = call.startTime ?? call.answeredAt ?? now;
  const duplicate = await deps.classifyDuplicate({
    sourceCompany: call.sourceCompany as SourceCompany,
    leadSourceCompany: call.routeResolution.company_id,
    sourceGranularityId: call.routeResolution.granularity_id,
    callerPhoneNumber: call.callerPhoneNumber,
    telephonySessionId: call.telephonySessionId,
    sessionId: call.sessionId,
    callLogId: call.callLogId,
    callTimestamp,
  });

  let action: RingCentralIngestAction;
  let status: RingCentralProcessedCallStatus;
  let callLeadId: string | null = null;

  if (writeMode === "create") {
    const createInput: CreateRingCentralCallLeadInput = {
      source_company: call.sourceCompany as SourceCompany,
      source_resolution: call.routeResolution,
      phone_number: call.callerPhoneNumber,
      duration: call.durationSeconds,
      start_time: call.answeredAt ?? call.startTime,
      end_time: call.terminalAt,
      timestamp: callTimestamp,
      duplicate: duplicate.isDuplicate,
      ringcentral: {
        telephony_session_id: call.telephonySessionId,
        session_id: call.sessionId,
        party_id: call.partyId,
        call_log_id: call.callLogId,
        source_label: call.sourceLabel,
        ingestion_source: call.ingestionSource,
        qualification_reason: call.qualificationReason,
        answered_at: call.answeredAt,
        terminal_at: call.terminalAt,
        duration_seconds: call.durationSeconds,
        route_id: call.routeResolution.route_id,
        route_assignment_id: call.routeResolution.assignment_id,
        target_phone_number: call.routeResolution.normalized_target_number,
      },
    };
    if (dependencies.createLead) {
      const lead = await deps.createLead(createInput);
      callLeadId = lead._id.toString();
    } else {
      try {
        const pending = await withTransaction(async (session) => {
          if (adoptionEnabled) {
            await acquireRingCentralConvergenceScopeLock({
              source_granularity_id:
                call.routeResolution.granularity_id,
              normalized_phone_number: call.callerPhoneNumber,
              session,
              now,
            });
            const lateProcessed = await deps.findProcessedCall({
              telephonySessionId: call.telephonySessionId,
              sessionId: call.sessionId,
              callLogId: call.callLogId,
              session,
            });
            if (
              lateProcessed &&
              RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES.includes(
                lateProcessed.status as (typeof RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES)[number],
              )
            ) {
              throw new RingCentralConvergenceScopeRaceError();
            }
            const lateSelection =
              await selectRingCentralConvergenceCandidates(
                call,
                session,
              );
            if (
              lateSelection.outcome === "candidate" ||
              lateSelection.outcome === "conflict"
            ) {
              throw new RingCentralConvergenceScopeRaceError();
            }
          }
          const created = await beginRingCentralCallLeadIngestion(
            createInput,
            { session, now },
          );
          await deps.upsertProcessedCall({
            provider: "ringcentral",
            telephonySessionId: call.telephonySessionId,
            sessionId: call.sessionId,
            callLogId: call.callLogId,
            ingestionSource: call.ingestionSource,
            status: duplicate.isDuplicate
              ? "lead_created_duplicate"
              : "lead_created",
            duplicate: duplicate.isDuplicate,
            duplicateReason: duplicate.reason,
            sourceCompany: call.sourceCompany as SourceCompany,
            sourceLabel: call.sourceLabel,
            callerPhoneNumber: call.callerPhoneNumber,
            durationSeconds: call.durationSeconds,
            qualificationReason: call.qualificationReason,
            callLeadId: created.lead._id.toString(),
            now,
            session,
          });
          return created;
        });
        callLeadId = pending.lead._id.toString();
        await completeCallLeadIngestion(pending);
      } catch (error) {
        if (
          error instanceof RingCentralConvergenceScopeRaceError &&
          convergenceRaceRetries < 2
        ) {
          return ingestRingCentralQualifiedCall(
            call,
            now,
            dependencies,
            convergenceRaceRetries + 1,
          );
        }
        if (!isDuplicateKeyError(error)) throw error;
        const raced = await deps.findProcessedCall({
          telephonySessionId: call.telephonySessionId,
          sessionId: call.sessionId,
          callLogId: call.callLogId,
        });
        if (!raced) throw error;
        return {
          action: "skipped_already_processed",
          duplicate: raced.duplicate,
          duplicateReason: raced.duplicateReason,
          callLeadId: raced.callLeadId,
          telephonySessionId: call.telephonySessionId,
          callLogId: call.callLogId,
          convergenceOutcome: convergence.outcome,
        };
      }
    }
    action = duplicate.isDuplicate ? "lead_created_duplicate" : "lead_created";
    status = action;
  } else if (writeMode === "shadow") {
    await deps.insertShadow({
      telephonySessionId: call.telephonySessionId,
      sessionId: call.sessionId,
      callLogId: call.callLogId,
      ingestionSource: call.ingestionSource,
      sourceCompany: call.sourceCompany as SourceCompany,
      sourceLabel: call.sourceLabel,
      callerPhoneNumber: call.callerPhoneNumber,
      callerName: call.callerName,
      targetPhoneNumber: call.targetPhoneNumber,
      duration: call.durationSeconds,
      answeredAt: call.answeredAt,
      terminalAt: call.terminalAt,
      duplicate: duplicate.isDuplicate,
      qualificationReason: call.qualificationReason,
      now,
    });
    action = "shadow_recorded";
    status = "shadow_recorded";
  } else {
    action = "dry_run";
    status = "dry_run";
  }

  if (writeMode !== "create" || dependencies.createLead) {
    await deps.upsertProcessedCall({
      provider: "ringcentral",
      telephonySessionId: call.telephonySessionId,
      sessionId: call.sessionId,
      callLogId: call.callLogId,
      ingestionSource: call.ingestionSource,
      status,
      duplicate: duplicate.isDuplicate,
      duplicateReason: duplicate.reason,
      sourceCompany: call.sourceCompany as SourceCompany,
      sourceLabel: call.sourceLabel,
      callerPhoneNumber: call.callerPhoneNumber,
      durationSeconds: call.durationSeconds,
      qualificationReason: call.qualificationReason,
      callLeadId,
      now,
    });
  }

  logger.info({
    msg: "ringcentral.ingest.processed",
    action,
    writeMode,
    duplicate: duplicate.isDuplicate,
    duplicateReason: duplicate.reason,
    ingestionSource: call.ingestionSource,
    telephonySessionId: call.telephonySessionId,
    callLogId: call.callLogId,
    sourceCompany: call.sourceCompany,
    durationSeconds: call.durationSeconds,
    callLeadId,
  });

  if (action === "lead_created" || action === "lead_created_duplicate") {
    const isDuplicateAction = action === "lead_created_duplicate";
    await deps.recordEvent({
      level: isDuplicateAction ? "warn" : "info",
      eventKey: isDuplicateAction
        ? "ringcentral.call_lead.duplicate_created"
        : "ringcentral.call_lead.created",
      category: "ringcentral",
      workflow: "ringcentral_call_lead_ingest",
      summary: isDuplicateAction
        ? "RingCentral qualified call created a duplicate call lead."
        : "RingCentral qualified call created a call lead.",
      leadIdentity: { name: call.callerName, phone: call.callerPhoneNumber },
      sourceCompany: call.sourceCompany,
      entity: callLeadId ? { type: "call_lead", id: callLeadId } : undefined,
      details: {
        telephonySessionId: call.telephonySessionId,
        callLogId: call.callLogId,
        ingestionSource: call.ingestionSource,
        durationSeconds: call.durationSeconds,
        duplicate: duplicate.isDuplicate,
        duplicateReason: duplicate.reason,
      },
      notificationCandidate: false,
    });
  }

  return {
    action,
    duplicate: duplicate.isDuplicate,
    duplicateReason: duplicate.reason,
    callLeadId,
    telephonySessionId: call.telephonySessionId,
    callLogId: call.callLogId,
    convergenceOutcome: convergence.outcome,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000,
  );
}
