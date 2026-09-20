import {
  CSI_JOB_STAGES,
  CSI_LIVE_JOB_PRIORITY,
  csiDataset,
} from "../../../config/domain/salesIntelligence";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { callLogReconcileLeaseHeld } from "../../numberActivity/reconcileCallLog";

const LIVE_STAGES: (typeof CSI_JOB_STAGES)[number][] = [
  "capture_projection",
  "call_log_reconcile",
  "recording_discovery",
  "media_fetch",
  "media",
  "transcription",
  "analysis",
  "number_refresh",
];

/** Live capture and due STT/analysis outrank historical window paging. */
export async function backfillYieldToLiveWork(now: Date): Promise<boolean> {
  if (await callLogReconcileLeaseHeld(now)) return true;
  const Jobs = getSalesIntelligenceJobModel();
  const due = await Jobs.exists({
    ...csiDataset(),
    stage: { $in: [...LIVE_STAGES] },
    status: { $in: ["pending", "retry", "leased"] },
    priority: { $gte: CSI_LIVE_JOB_PRIORITY },
    $or: [{ next_attempt_at: { $lte: now } }, { status: "leased" }],
  });
  return Boolean(due);
}
