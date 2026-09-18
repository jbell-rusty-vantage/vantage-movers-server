import { z } from "zod";
import { csiDataset, type CSI_JOB_STAGES } from "../../config/domain/salesIntelligence";
import { logger } from "../../logger";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { csiIdSchema } from "../../validation/v1/salesIntelligence";
import { runCaptureProjectionJob, type CaptureProjectionWorkerDeps } from "./captureProjectionWorker";
import { runRebuildJob, type RebuildWorkerDeps } from "./rebuild";
import { runRecordingDiscoveryJob } from "../salesIntelligence/conversations/discover";
import { runMediaFetchJob } from "../salesIntelligence/conversations/media";
import { runTranscriptionJob } from "../salesIntelligence/conversations/transcribe";

/**
 * Queue wake-up dispatch. The payload is exactly `{ job_id }`; stage and
 * routing come from the authoritative Mongo job row, never from the message.
 * Stages without a registered consumer are left pending (not claimed), so a
 * wake-up for future Team C work never burns its attempts here.
 */
export const csiWakeupSchema = z.object({ job_id: csiIdSchema }).strict();

export type CsiStage = (typeof CSI_JOB_STAGES)[number];
export type StageHandler = (jobId: string) => Promise<unknown>;

export type DispatchOutcome =
  | { status: "invalid_payload" }
  | { status: "unknown_job"; job_id: string }
  | { status: "no_consumer"; job_id: string; stage: CsiStage }
  | { status: "dispatched"; job_id: string; stage: CsiStage; outcome: unknown };

export type DispatchDependencies = {
  handlers?: Partial<Record<CsiStage, StageHandler>>;
  capture?: CaptureProjectionWorkerDeps;
  rebuild?: RebuildWorkerDeps;
};

/** Registered consumers including CSI-11. Future Team C stages stay pending until registered. */
export function defaultStageHandlers(
  capture: CaptureProjectionWorkerDeps = {},
  rebuild: RebuildWorkerDeps = {},
): Partial<Record<CsiStage, StageHandler>> {
  return {
    capture_projection: (jobId) => runCaptureProjectionJob(jobId, capture),
    rebuild: (jobId) => runRebuildJob(jobId, rebuild),
    recording_discovery: (jobId) => runRecordingDiscoveryJob(jobId),
    media_fetch: (jobId) => runMediaFetchJob(jobId),
    transcription: (jobId) => runTranscriptionJob(jobId),
  };
}

export function parseCsiWakeup(payload: unknown): string | null {
  const parsed = csiWakeupSchema.safeParse(payload);
  return parsed.success ? parsed.data.job_id : null;
}

export async function dispatchCsiWakeup(
  payload: unknown,
  deps: DispatchDependencies = {},
): Promise<DispatchOutcome> {
  const jobId = parseCsiWakeup(payload);
  if (!jobId) return { status: "invalid_payload" };
  const job = await getSalesIntelligenceJobModel()
    .findOne({ _id: jobId, ...csiDataset() }, { stage: 1 })
    .lean();
  if (!job) return { status: "unknown_job", job_id: jobId };
  const handlers = deps.handlers ?? defaultStageHandlers(deps.capture, deps.rebuild);
  const handler = handlers[job.stage as CsiStage];
  if (!handler) {
    logger.info({ msg: "sales_intelligence.queue.no_consumer", jobId, stage: job.stage });
    return { status: "no_consumer", job_id: jobId, stage: job.stage as CsiStage };
  }
  const outcome = await handler(jobId);
  return { status: "dispatched", job_id: jobId, stage: job.stage as CsiStage, outcome };
}
