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
/** CSI-11 gets NEW revision-specific discovery jobs, including after a completed original. */
export async function rediscoverAttachmentPage(change: AttachmentChanged, session: ClientSession, after?: string) {
  const rows = await getCallInteractionModel().find({ contact_number_id: change.number_id, merged_into_id: null,
    ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(500).session(session).lean();
  for (const row of rows) await enqueueCsiJob({ stage: "recording_discovery", subject_key: `interaction:${row._id}`,
    dedupe_key: `csi:recording_discovery:interaction:${row._id}:attachment:${change.number_id}:${change.revision}`,
    input_revision: change.revision, input_refs: [String(row._id)] }, session);
  for (const row of rows) await enqueueCsiJob({ stage: "outreach_ensure", subject_key: `number:${change.number_id}`,
    dedupe_key: `csi:outreach_ensure:interaction:${row._id}:attachment:${change.number_id}:${change.revision}`,
    input_revision: change.revision, input_refs: [String(row._id)] }, session);
  if (rows.length === 500) {
    const last = String(rows.at(-1)!._id);
    await enqueueCsiJob({ stage: "attachment_refresh", subject_key: `attachment-change:${change.number_id}`,
      dedupe_key: `csi:attachment-change:${change.number_id}:${change.revision}:after:${last}`,
      input_revision: change.revision, input_refs: [change.number_id, last] }, session);
  }
  return rows.length;
}
