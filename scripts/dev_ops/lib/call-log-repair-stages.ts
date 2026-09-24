/**
 * Real downstream stage runners for the CC-07 repair: the production workers, claimed by id,
 * with every queue wake-up suppressed so no production consumer is asked to run this work.
 * The process that uses them sets the model credential (the entry point: the operator's
 * personal gateway key and the personal ledger).
 */
import { runRecordingDiscoveryJob, type DiscoveryDependencies } from "../../../src/services/salesIntelligence/conversations/discover";
import { runMediaFetchJob, type MediaDependencies } from "../../../src/services/salesIntelligence/conversations/media";
import { scheduleTranscriptionJobs } from "../../../src/services/salesIntelligence/conversations/transcriptionScheduling";
import { runTranscriptionJob, type TranscriptionDependencies } from "../../../src/services/salesIntelligence/conversations/transcribe";
import { runIntelligenceJob } from "../../../src/services/salesIntelligence/analysis/worker";
import { runIntelligenceApplicationJob } from "../../../src/services/salesIntelligence/analysis/apply";
import { getSalesIntelligenceJobModel } from "../../../src/models/SalesIntelligenceJob";
import { continueStructuredAnalysis } from "../../backfill-csi-structured-analysis.lib";
import type { StageRunners } from "./call-log-repair";

/** No wake-up leaves this process: a published job id would be claimed by the production queue consumer. */
export const suppressWakeup = async () => ({ published: false, error_code: null });

export function createStageRunners(input: {
  runId: string;
  media?: Omit<MediaDependencies, "owner">;
  transcription?: Omit<TranscriptionDependencies, "owner" | "publish">;
  discovery?: Omit<DiscoveryDependencies, "owner" | "publish">;
  overrides?: Partial<StageRunners>;
}): StageRunners {
  const owner = (stage: string) => `csi-repair-${stage}:${input.runId}`;
  const loadJob = (id: string) => getSalesIntelligenceJobModel().findById(id).select("status next_attempt_at result").lean().exec();
  const real: StageRunners = {
    discovery: id => runRecordingDiscoveryJob(id, { ...input.discovery, owner: owner("discovery"), publish: suppressWakeup }),
    media: id => runMediaFetchJob(id, { ...input.media, owner: owner("media") }),
    scheduleTranscription: conversationId => scheduleTranscriptionJobs(1, suppressWakeup, { conversationIds: [conversationId] }),
    transcription: id => runTranscriptionJob(id, { ...input.transcription, owner: owner("stt"), publish: suppressWakeup }),
    // `historical` claims this row by id regardless of live work queued elsewhere; the mode stays live ("initial").
    analysis: (id, stage) => continueStructuredAnalysis(
      () => runIntelligenceJob(id, stage, { historical: true, publish: suppressWakeup }) as Promise<{ status: string; reason?: string }>,
      () => loadJob(id)),
    application: async id => {
      // Application commits in bounded batches; a checkpointed batch leaves the job pending and due.
      for (let round = 0; round < 50; round++) {
        const result = await runIntelligenceApplicationJob(id);
        const job = await loadJob(id);
        if (result.status !== "completed" || job?.status !== "pending") return result;
      }
      return { status: "retry", reason: "application_rounds_exhausted" };
    },
  };
  return { ...real, ...input.overrides };
}
