import type { ClientSession } from "mongoose";
import { CSI_BACKFILL_JOB_PRIORITY } from "../../../config/domain/salesIntelligence";
import { enqueueCsiJob } from "../jobs";

/** Reuse capture's exact dedupe identities after the history barrier opens. */
export async function enqueueDeferredDiscovery(call: { _id: unknown; projection_revision: number;
  contact_number_id?: unknown; recordings: { provider_recording_id: string }[] }, session: ClientSession, now: Date) {
  const id = String(call._id);
  const keys = call.recordings.length ? call.recordings.map(r => `csi:recording_discovery:interaction:${id}:recording:${r.provider_recording_id}`)
    : [`csi:recording_discovery:interaction:${id}:pending`];
  for (const key of keys) await enqueueCsiJob({ dedupe_key: key, stage: "recording_discovery",
    subject_key: `interaction:${id}`, input_revision: 1, input_refs: [id], priority: CSI_BACKFILL_JOB_PRIORITY }, session, now);
}
