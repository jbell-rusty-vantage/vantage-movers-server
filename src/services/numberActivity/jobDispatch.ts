import { z } from "zod";
import { csiDataset, isRetainedCsiJobStage, type CsiJobStage } from "../../config/domain/salesIntelligence";
import { logger } from "../../logger";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { csiIdSchema } from "../../validation/v1/salesIntelligence";
import { runCaptureProjectionJob, type CaptureProjectionWorkerDeps } from "./captureProjectionWorker";
import { runRebuildJob, type RebuildWorkerDeps } from "./rebuild";
import { runAttachmentRefreshJob } from "../salesIntelligence/attachment/refresh";
import { runNudgeRepairJob } from "../salesIntelligence/nudges/repair";
import { runCallLogRefreshJob } from "./callLogRefresh";
import { retireLegacyCsiJobs } from "../salesIntelligence/jobs";

/**
 * Queue wake-up dispatch. The payload is exactly `{ job_id }`; stage and
 * routing come from the authoritative Mongo job row, never from the message.
 * Only retained stages have a consumer. A wake-up for a row of a retired stage
 * (a late message from an earlier release) is acknowledged and the row is
 * terminalized as `retired`: no handler, no provider call, no effect.
 */
export const csiWakeupSchema = z.object({ job_id: csiIdSchema }).strict();

export type CsiStage = CsiJobStage;
export type StageHandler = (jobId: string) => Promise<unknown>;

export type DispatchOutcome =
  | { status: "invalid_payload" }
  | { status: "unknown_job"; job_id: string }
  | { status: "no_consumer"; job_id: string; stage: CsiStage }
  | { status: "retired"; job_id: string; stage: string; retired: number }
  | { status: "dispatched"; job_id: string; stage: CsiStage; outcome: unknown };

export type DispatchDependencies = {
  handlers?: Partial<Record<CsiStage, StageHandler>>;
  capture?: CaptureProjectionWorkerDeps;
  rebuild?: RebuildWorkerDeps;
  retire?: typeof retireLegacyCsiJobs;
  /** Reads the authoritative row's stage. Default: the dataset's job row. */
  loadJob?: (jobId: string) => Promise<{ stage: string } | null>;
};

/** The retained consumers. `call_log_reconcile` and `directory` run from their crons, not as queued jobs. */
export function defaultStageHandlers(
  capture: CaptureProjectionWorkerDeps = {},
  rebuild: RebuildWorkerDeps = {},
): Partial<Record<CsiStage, StageHandler>> {
  return {
    capture_projection: (jobId) => runCaptureProjectionJob(jobId, capture),
    rebuild: (jobId) => runRebuildJob(jobId, rebuild),
    attachment_refresh: (jobId) => runAttachmentRefreshJob(jobId),
    nudge_repair: (jobId) => runNudgeRepairJob(jobId),
    call_log_refresh: (jobId) => runCallLogRefreshJob(jobId),
  };
}

export function parseCsiWakeup(payload: unknown): string | null {
  const parsed = csiWakeupSchema.safeParse(payload);
  return parsed.success ? parsed.data.job_id : null;
}

async function loadJobStage(jobId: string): Promise<{ stage: string } | null> {
  return getSalesIntelligenceJobModel().findOne({ _id: jobId, ...csiDataset() }, { stage: 1 }).lean();
}

export async function dispatchCsiWakeup(
  payload: unknown,
  deps: DispatchDependencies = {},
): Promise<DispatchOutcome> {
  const jobId = parseCsiWakeup(payload);
  if (!jobId) return { status: "invalid_payload" };
  const job = await (deps.loadJob ?? loadJobStage)(jobId);
  if (!job) return { status: "unknown_job", job_id: jobId };
  const { stage } = job;
  if (!isRetainedCsiJobStage(stage)) {
    const { retired } = await (deps.retire ?? retireLegacyCsiJobs)({ jobId });
    logger.info({ msg: "sales_intelligence.queue.retired_stage", jobId, stage, retired });
    return { status: "retired", job_id: jobId, stage, retired };
  }
  const handlers = deps.handlers ?? defaultStageHandlers(deps.capture, deps.rebuild);
  const handler = handlers[stage];
  if (!handler) {
    logger.info({ msg: "sales_intelligence.queue.no_consumer", jobId, stage });
    return { status: "no_consumer", job_id: jobId, stage };
  }
  const outcome = await handler(jobId);
  return { status: "dispatched", job_id: jobId, stage, outcome };
}
