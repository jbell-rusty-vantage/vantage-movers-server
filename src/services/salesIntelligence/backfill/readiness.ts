import type { ClientSession } from "mongoose";
import { getSalesIntelligenceSyncWindowModel } from "../../../models/SalesIntelligenceSyncWindow";
import { CALL_LOG_BACKFILL_STREAM } from "./windows";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { csiDataset } from "../../../config/domain/salesIntelligence";

/** Later planned history must be captured before old obligations become current work. */
export async function historicalCaptureReady(at: Date, session?: ClientSession) {
  return !await getSalesIntelligenceSyncWindowModel().exists({ stream: CALL_LOG_BACKFILL_STREAM,
    window_to: { $gt: at }, status: { $ne: "complete" } }).session(session ?? null);
}

/** Capture schedules attachment discovery transactionally; all scan pages must settle first. */
export async function historicalAttachmentsReady(numberId: string, session?: ClientSession) {
  return !await getSalesIntelligenceJobModel().exists({ ...csiDataset(), stage: "attachment_refresh",
    subject_key: { $in: [`number:${numberId}`, `attachment-scan:FormLead:${numberId}`, `attachment-scan:CallLead:${numberId}`] },
    status: { $ne: "completed" } }).session(session ?? null);
}
