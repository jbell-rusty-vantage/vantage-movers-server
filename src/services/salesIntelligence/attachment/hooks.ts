import type { ClientSession } from "mongoose";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { enqueueCsiJob } from "../jobs";
import { reactToAttachmentChanged } from "../outreach/ensure";

/** CSI-06 consumes this committed change contract. No Outreach state or clock writes here. */
export type AttachmentChanged = { number_id: string; revision: number };
/** Transactional durable fan-out intent; revision is the serialized Contact Number revision. */
export async function onAttachmentChanged(change: AttachmentChanged, session: ClientSession) {
  await reactToAttachmentChanged(change, session);
  await enqueueCsiJob({ stage: "attachment_refresh", subject_key: `attachment-change:${change.number_id}`,
    dedupe_key: `csi:attachment-change:${change.number_id}:${change.revision}`, input_revision: change.revision,
    input_refs: [change.number_id] }, session);
}
export const ATTACHMENT_REDISCOVERY_PAGE = 500;
/**
 * CSI-11 gets NEW revision-specific discovery jobs, including after a completed original.
 *
 * Coalesced (17 §7). Outreach replay is one `outreach-number:` job per number
 * revision that walks the calls itself, instead of one job per call. Recording
 * rediscovery is only raised for calls that already carry a recording: a call
 * without one has nothing whose eligibility or Lead binding an attachment can
 * change, and capture already raises its own discovery when a recording
 * arrives (`persistInteraction`).
 */
export async function rediscoverAttachmentPage(change: AttachmentChanged, session: ClientSession, after?: string) {
  if (!after) await enqueueCsiJob({ stage: "outreach_ensure", subject_key: `outreach-number:${change.number_id}`,
    dedupe_key: `csi:outreach:number:${change.number_id}:${change.revision}`, input_revision: change.revision,
    input_refs: [change.number_id] }, session);
  const rows = await getCallInteractionModel().find({ contact_number_id: change.number_id, merged_into_id: null, "recordings.0": { $exists: true },
    ...(after ? { _id: { $gt: after } } : {}) }, { _id: 1 }).sort({ _id: 1 }).limit(ATTACHMENT_REDISCOVERY_PAGE).session(session).lean();
  for (const row of rows) await enqueueCsiJob({ stage: "recording_discovery", subject_key: `interaction:${row._id}`,
    dedupe_key: `csi:recording_discovery:interaction:${row._id}:attachment:${change.number_id}:${change.revision}`,
    input_revision: change.revision, input_refs: [String(row._id)] }, session);
  if (rows.length === ATTACHMENT_REDISCOVERY_PAGE) {
    const last = String(rows.at(-1)!._id);
    await enqueueCsiJob({ stage: "attachment_refresh", subject_key: `attachment-change:${change.number_id}`,
      dedupe_key: `csi:attachment-change:${change.number_id}:${change.revision}:after:${last}`,
      input_revision: change.revision, input_refs: [change.number_id, last] }, session);
  }
  return rows.length;
}
