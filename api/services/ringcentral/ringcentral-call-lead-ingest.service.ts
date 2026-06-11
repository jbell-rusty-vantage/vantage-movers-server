import { logger } from "../../logger";
import { recordOperationalEvent } from "../observability";
import { createRingCentralCallLead } from "../leads/callLead.service";
import type { SourceCompany } from "./call-lead-sources";
import { classifyRingCentralCallLeadDuplicate } from "./ringcentral-duplicate-guard";
import { resolveRingCentralLeadWriteMode } from "./ringcentral-config";
import {
  findProcessedCall,
  upsertProcessedCall,
  type RingCentralProcessedCallStatus,
} from "./processed-calls-store";
import { insertShadowCallLead } from "./shadow-call-leads-store";

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
  sourceCompany: SourceCompany;
  sourceLabel: string | null;
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
): Promise<RingCentralIngestResult> {
  const existing = await findProcessedCall({
    telephonySessionId: call.telephonySessionId,
    callLogId: call.callLogId,
  });

  if (
    existing &&
    (existing.status === "lead_created" ||
      existing.status === "lead_created_duplicate" ||
      existing.status === "shadow_recorded")
  ) {
    logger.info({
      msg: "ringcentral.ingest.skipped_already_processed",
      telephonySessionId: call.telephonySessionId,
      callLogId: call.callLogId,
      previousStatus: existing.status,
      ingestionSource: call.ingestionSource,
    });
    await recordOperationalEvent({
      level: "info",
      eventKey: "ringcentral.call_lead.skipped_already_processed",
      category: "ringcentral",
      workflow: "ringcentral_call_lead_ingest",
      summary: "RingCentral call already processed; ingest skipped.",
      sourceCompany: call.sourceCompany,
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
    };
  }

  const duplicate = await classifyRingCentralCallLeadDuplicate({
    sourceCompany: call.sourceCompany,
    callerPhoneNumber: call.callerPhoneNumber,
    telephonySessionId: call.telephonySessionId,
    now,
  });

  const writeMode = resolveRingCentralLeadWriteMode();
  let action: RingCentralIngestAction;
  let status: RingCentralProcessedCallStatus;
  let callLeadId: string | null = null;

  if (writeMode === "create") {
    const lead = await createRingCentralCallLead({
      source_company: call.sourceCompany,
      phone_number: call.callerPhoneNumber,
      duration: call.durationSeconds,
      start_time: call.answeredAt ?? call.startTime,
      end_time: call.terminalAt,
      timestamp: call.startTime ?? call.answeredAt ?? now,
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
      },
    });
    callLeadId = lead._id.toString();
    action = duplicate.isDuplicate ? "lead_created_duplicate" : "lead_created";
    status = action;
  } else if (writeMode === "shadow") {
    await insertShadowCallLead({
      telephonySessionId: call.telephonySessionId,
      sessionId: call.sessionId,
      callLogId: call.callLogId,
      ingestionSource: call.ingestionSource,
      sourceCompany: call.sourceCompany,
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

  await upsertProcessedCall({
    provider: "ringcentral",
    telephonySessionId: call.telephonySessionId,
    sessionId: call.sessionId,
    callLogId: call.callLogId,
    ingestionSource: call.ingestionSource,
    status,
    duplicate: duplicate.isDuplicate,
    duplicateReason: duplicate.reason,
    sourceCompany: call.sourceCompany,
    sourceLabel: call.sourceLabel,
    callerPhoneNumber: call.callerPhoneNumber,
    durationSeconds: call.durationSeconds,
    qualificationReason: call.qualificationReason,
    callLeadId,
    now,
  });

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
    await recordOperationalEvent({
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
  };
}
